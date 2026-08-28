[CmdletBinding(DefaultParameterSetName = "Install")]
param(
  [Parameter(ParameterSetName = "Install")]
  [Parameter(ParameterSetName = "Diagnostics")]
  [string]$ManifestPath = "",
  [Parameter(ParameterSetName = "Install")][string]$DestinationRoot = "",
  [Parameter(ParameterSetName = "Install")][string]$DownloadRoot = "",
  [Parameter(ParameterSetName = "Install")][ValidateRange(1, 10)][int]$RetryCount = 3,
  [Parameter(ParameterSetName = "Install")][switch]$Force,
  [Parameter(ParameterSetName = "Install")][switch]$AllowUnpublished,
  [Parameter(Mandatory = $true, ParameterSetName = "Rollback")][switch]$RollbackLatest,
  [Parameter(ParameterSetName = "Rollback")][string]$RollbackDestinationRoot = "",
  [Parameter(Mandatory = $true, ParameterSetName = "Diagnostics")][switch]$DiagnosticsOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Resolve-FullPath {
  param([Parameter(Mandatory = $true)][string]$Value)
  [System.IO.Path]::GetFullPath($Value.Trim([char]34))
}

function Assert-ChildPath {
  param([string]$Parent, [string]$Child)
  $parentFull = (Resolve-FullPath $Parent).TrimEnd("\") + "\"
  $childFull = Resolve-FullPath $Child
  if (-not $childFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Percorso non sicuro fuori dal progetto: $childFull"
  }
  $childFull
}

function Write-Log {
  param([string]$Message, [ValidateSet("INFO", "WARN", "ERROR")][string]$Level = "INFO")
  $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffK"), $Level, $Message
  Write-Host $line
  Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
}

function Get-Sha256 {
  param([string]$Path)
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $algorithm.ComputeHash($stream)
    -join ($bytes | ForEach-Object { $_.ToString("x2") })
  } finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}

function Remove-CacheFile {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    Remove-Item -LiteralPath $Path -Force
  }
}

function Copy-LocalResumable {
  param([string]$Source, [string]$Partial)
  $sourceFull = Resolve-FullPath $Source
  $offset = if (Test-Path -LiteralPath $Partial -PathType Leaf) {
    (Get-Item -LiteralPath $Partial).Length
  } else { 0L }
  $sourceLength = (Get-Item -LiteralPath $sourceFull).Length
  if ($offset -gt $sourceLength) {
    Remove-CacheFile $Partial
    $offset = 0L
  }
  $input = [IO.File]::Open($sourceFull, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    [void]$input.Seek($offset, [IO.SeekOrigin]::Begin)
    $mode = if ($offset -gt 0) { [IO.FileMode]::Append } else { [IO.FileMode]::Create }
    $output = [IO.File]::Open($Partial, $mode, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $input.CopyTo($output) } finally { $output.Dispose() }
  } finally { $input.Dispose() }
}

function Receive-HttpsResumable {
  param([string]$Url, [string]$Partial)
  Add-Type -AssemblyName System.Net.Http
  $offset = if (Test-Path -LiteralPath $Partial -PathType Leaf) {
    (Get-Item -LiteralPath $Partial).Length
  } else { 0L }
  $client = [Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromHours(6)
  $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, $Url)
  if ($offset -gt 0) {
    $request.Headers.Range = [Net.Http.Headers.RangeHeaderValue]::new($offset, $null)
  }
  try {
    $response = $client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    if ($offset -gt 0 -and [int]$response.StatusCode -eq 416) { return }
    $response.EnsureSuccessStatusCode() | Out-Null
    $append = $offset -gt 0 -and [int]$response.StatusCode -eq 206
    if ($offset -gt 0 -and -not $append) {
      Write-Log "Il server non supporta resume per $Url; riparto da zero." "WARN"
    }
    $mode = if ($append) { [IO.FileMode]::Append } else { [IO.FileMode]::Create }
    $output = [IO.File]::Open($Partial, $mode, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
      $input = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
      try { $input.CopyTo($output) } finally { $input.Dispose() }
    } finally { $output.Dispose() }
  } finally {
    $request.Dispose()
    $client.Dispose()
  }
}

function Receive-Artifact {
  param([object]$Artifact, [string]$CacheRoot, [int]$Retries)
  foreach ($name in @("id", "fileName", "urls", "sha256", "sizeBytes", "archiveType")) {
    if (-not ($Artifact.PSObject.Properties.Name -contains $name)) {
      throw "Artefatto privo del campo obbligatorio '$name'."
    }
  }
  if ($Artifact.archiveType -ne "zip") {
    throw "Tipo archivio non supportato per $($Artifact.id): $($Artifact.archiveType)"
  }
  $expectedHash = ([string]$Artifact.sha256).ToLowerInvariant()
  if ($expectedHash -notmatch "^[0-9a-f]{64}$") {
    throw "Checksum SHA-256 non valido per $($Artifact.id)."
  }
  $destination = Assert-ChildPath $CacheRoot (Join-Path $CacheRoot ([string]$Artifact.fileName))
  $partial = "$destination.partial"
  if (Test-Path -LiteralPath $destination -PathType Leaf) {
    if ((Get-Sha256 $destination) -eq $expectedHash) {
      Write-Log "Cache verificata: $($Artifact.id)."
      return $destination
    }
    Write-Log "Cache non valida per $($Artifact.id); verrà riscaricata." "WARN"
    Remove-CacheFile $destination
  }
  $sources = @($Artifact.urls)
  if ($sources.Count -eq 0) { throw "Nessuna URL definita per $($Artifact.id)." }
  $lastFailure = ""
  for ($attempt = 1; $attempt -le $Retries; $attempt++) {
    $source = [string]$sources[($attempt - 1) % $sources.Count]
    try {
      Write-Log "Download $($Artifact.id), tentativo $attempt/$Retries da $source"
      if (Test-Path -LiteralPath $source -PathType Leaf) {
        Copy-LocalResumable $source $partial
      } else {
        $uri = $null
        if ([Uri]::TryCreate($source, [UriKind]::Absolute, [ref]$uri) -and $uri.IsFile) {
          Copy-LocalResumable $uri.LocalPath $partial
        } elseif ($source -match "^https://") {
          Receive-HttpsResumable $source $partial
        } else {
          throw "Sorgente non supportata (serve HTTPS o file locale): $source"
        }
      }
      $actualSize = (Get-Item -LiteralPath $partial).Length
      if ([int64]$Artifact.sizeBytes -gt 0 -and $actualSize -ne [int64]$Artifact.sizeBytes) {
        throw "Dimensione errata: attesi $($Artifact.sizeBytes) byte, trovati $actualSize."
      }
      $actualHash = Get-Sha256 $partial
      if ($actualHash -ne $expectedHash) {
        Remove-CacheFile $partial
        throw "Checksum SHA-256 errato: atteso $expectedHash, trovato $actualHash."
      }
      Move-Item -LiteralPath $partial -Destination $destination -Force
      Write-Log "Checksum verificato: $($Artifact.id) ($actualHash)."
      return $destination
    } catch {
      $lastFailure = $_.Exception.Message
      Write-Log "Tentativo fallito per $($Artifact.id): $lastFailure" "WARN"
      if ($attempt -lt $Retries) {
        Start-Sleep -Seconds ([Math]::Min([Math]::Pow(2, $attempt - 1), 8))
      }
    }
  }
  throw "Download fallito per $($Artifact.id) dopo $Retries tentativi: $lastFailure"
}

function Assert-ZipSafe {
  param([string]$ArchivePath, [string[]]$ExcludedPrefixes)
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    foreach ($entry in $archive.Entries) {
      $name = $entry.FullName.Replace("\", "/")
      $segments = @($name.Split("/") | Where-Object { $_ })
      if ([IO.Path]::IsPathRooted($name) -or $segments -contains "..") {
        throw "Archivio non sicuro, percorso non valido: $name"
      }
      foreach ($prefix in $ExcludedPrefixes) {
        $normalized = ([string]$prefix).Replace("\", "/").TrimStart("/")
        if ($name.StartsWith($normalized, [StringComparison]::OrdinalIgnoreCase) -and -not $name.EndsWith("/")) {
          throw "L'archivio contiene dati vietati dalla policy: $name"
        }
      }
    }
  } finally { $archive.Dispose() }
}

function Assert-Runtime {
  param([string]$Root, [object]$Manifest)
  foreach ($relative in @($Manifest.requiredFiles)) {
    $candidate = Assert-ChildPath $Root (Join-Path $Root ([string]$relative))
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      throw "Runtime incompleto, file richiesto mancante: $relative"
    }
  }
}

function Assert-BasicRuntime {
  param([string]$Root)
  foreach ($relative in @("python_embeded/python.exe", "ComfyUI/main.py")) {
    $candidate = Assert-ChildPath $Root (Join-Path $Root $relative)
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      throw "Backup non valido, file richiesto mancante: $relative"
    }
  }
}

function Write-DefaultModelPaths {
  param([string]$Path, [string]$ModelRoot)
  $normalized = (Resolve-FullPath $ModelRoot).Replace("\", "/")
  $yaml = @"
h3_studio_models:
    base_path: $normalized
    checkpoints: checkpoints
    diffusion_models: |
        diffusion_models
        unet
    text_encoders: |
        text_encoders
        clip
    clip_vision: clip_vision
    loras: loras
    vae: vae
    audio_encoders: audio_encoders
    upscale_models: upscale_models
    latent_upscale_models: latent_upscale_models
    model_patches: model_patches
"@
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  Set-Content -LiteralPath $Path -Value $yaml -Encoding UTF8
}

function Get-Diagnostics {
  param([string]$RuntimeRoot, [object]$Manifest)
  $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
  $gpus = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object {
    [ordered]@{ name = $_.Name; driverVersion = $_.DriverVersion; adapterRam = $_.AdapterRAM }
  })
  $driveName = [IO.Path]::GetPathRoot($RuntimeRoot).TrimEnd("\").TrimEnd(":")
  $drive = Get-PSDrive -Name $driveName -ErrorAction Stop
  $installed = Test-Path -LiteralPath $RuntimeRoot -PathType Container
  $valid = $false
  $validationError = $null
  if ($installed -and $null -ne $Manifest) {
    try {
      Assert-Runtime $RuntimeRoot $Manifest
      $valid = $true
    } catch {
      $validationError = $_.Exception.Message
    }
  }
  [ordered]@{
    timestamp = (Get-Date).ToString("o")
    computerName = $env:COMPUTERNAME
    osCaption = if ($null -ne $os) { $os.Caption } else { [Environment]::OSVersion.VersionString }
    osVersion = if ($null -ne $os) { $os.Version } else { [Environment]::OSVersion.Version.ToString() }
    osBuild = [Environment]::OSVersion.Version.Build
    processArchitecture = [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    gpu = $gpus
    drive = [ordered]@{ name = $drive.Name; freeBytes = [int64]$drive.Free; usedBytes = [int64]$drive.Used }
    runtime = [ordered]@{ root = $RuntimeRoot; installed = $installed; valid = $valid; validationError = $validationError }
  }
}

function Assert-Preflight {
  param([object]$Manifest, [object]$Diagnostics)
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "Il bootstrap pubblico supporta soltanto Windows."
  }
  if ($Manifest.platform.architecture -eq "x64" -and -not [Environment]::Is64BitOperatingSystem) {
    throw "È richiesto Windows x64."
  }
  if ([int]$Diagnostics.osBuild -lt [int]$Manifest.platform.minimumWindowsBuild) {
    throw "Build Windows non supportata: $($Diagnostics.osBuild); minima $($Manifest.platform.minimumWindowsBuild)."
  }
  if ($Manifest.platform.gpuVendor -eq "nvidia") {
    $nvidia = @($Diagnostics.gpu | Where-Object { ([string]$_.name) -match "NVIDIA" })
    if ($nvidia.Count -eq 0) {
      throw "GPU NVIDIA non rilevata. H3_ENGINE_MODE=external resta disponibile come fallback."
    }
  }
  $downloads = 0L
  foreach ($artifact in @($Manifest.artifacts)) { $downloads += [int64]$artifact.sizeBytes }
  $required = [int64]$Manifest.installedSizeBytes + $downloads + [int64]$Manifest.minimumFreeBytesAfterInstall
  if ([int64]$Diagnostics.drive.freeBytes -lt $required) {
    throw "Spazio insufficiente: richiesti almeno $required byte, disponibili $($Diagnostics.drive.freeBytes)."
  }
}

$projectRoot = Resolve-FullPath (Split-Path -Parent $PSScriptRoot)
$engineRoot = Assert-ChildPath $projectRoot (Join-Path $projectRoot "engine")
$reportRoot = Assert-ChildPath $projectRoot (Join-Path $projectRoot "data\bootstrap")
New-Item -ItemType Directory -Force -Path $reportRoot | Out-Null
$runId = Get-Date -Format "yyyyMMdd-HHmmss-fff"
$script:LogPath = Join-Path $reportRoot "bootstrap-$runId.log"
$reportPath = Join-Path $reportRoot "bootstrap-$runId.json"
New-Item -ItemType File -Force -Path $script:LogPath | Out-Null
$status = "failed"
$failure = $null
$manifest = $null
$diagnostics = $null
$runtimeRoot = $null
$backup = $null

try {
  if ($PSCmdlet.ParameterSetName -eq "Rollback") {
    $runtimeRoot = if ($RollbackDestinationRoot) {
      Assert-ChildPath $projectRoot $RollbackDestinationRoot
    } else { Assert-ChildPath $projectRoot (Join-Path $engineRoot "runtime") }
    $runtimeParent = Split-Path -Parent $runtimeRoot
    $backupParent = Assert-ChildPath $projectRoot (Join-Path $runtimeParent "_backups")
    $candidates = Get-ChildItem -LiteralPath $backupParent -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like "runtime-*" } |
      Sort-Object LastWriteTimeUtc -Descending
    $latest = $null
    foreach ($candidate in $candidates) {
      try {
        Assert-BasicRuntime $candidate.FullName
        $latest = $candidate
        break
      } catch {
        Write-Log "Backup ignorato perché non valido: $($candidate.FullName) ($($_.Exception.Message))" "WARN"
      }
    }
    if ($null -eq $latest) { throw "Nessun rollback disponibile in $backupParent." }
    $displaced = $null
    if (Test-Path -LiteralPath $runtimeRoot -PathType Container) {
      $displaced = Assert-ChildPath $backupParent (Join-Path $backupParent "replaced-$runId")
      Move-Item -LiteralPath $runtimeRoot -Destination $displaced
    }
    try { Move-Item -LiteralPath $latest.FullName -Destination $runtimeRoot } catch {
      if ($null -ne $displaced -and (Test-Path -LiteralPath $displaced -PathType Container)) {
        Move-Item -LiteralPath $displaced -Destination $runtimeRoot
      }
      throw
    }
    $backup = $latest.FullName
    $diagnostics = Get-Diagnostics $runtimeRoot $null
    Write-Log "Rollback completato da $backup. Il runtime sostituito resta in $displaced."
    $status = "rolled-back"
  } else {
    if (-not $ManifestPath) { $ManifestPath = Join-Path $engineRoot "manifest.json" }
    $manifestFull = Assert-ChildPath $projectRoot $ManifestPath
    if (-not (Test-Path -LiteralPath $manifestFull -PathType Leaf)) {
      throw "Manifest non trovato: $manifestFull"
    }
    $manifest = Get-Content -Raw -LiteralPath $manifestFull | ConvertFrom-Json
    if ([int]$manifest.schemaVersion -ne 1) {
      throw "schemaVersion manifest non supportata: $($manifest.schemaVersion)"
    }
    $runtimeRoot = if ($DestinationRoot) {
      Assert-ChildPath $projectRoot $DestinationRoot
    } else { Assert-ChildPath $projectRoot (Join-Path $projectRoot ([string]$manifest.runtimeRoot)) }
    $diagnostics = Get-Diagnostics $runtimeRoot $manifest
    if ($DiagnosticsOnly) {
      Write-Log "Diagnostica completata per $runtimeRoot."
      $status = "diagnostics"
    } else {
      if ($manifest.releaseState -ne "published" -and -not $AllowUnpublished) {
        throw "Release engine non pubblicata: $($manifest.publication.blockedReason)"
      }
      if (@($manifest.artifacts).Count -eq 0) { throw "Il manifest non contiene artefatti installabili." }
      Assert-Preflight $manifest $diagnostics
      if ((Test-Path -LiteralPath $runtimeRoot -PathType Container) -and -not $Force) {
        throw "Il runtime esiste già: $runtimeRoot. Usa -Force per archiviarlo e sostituirlo."
      }
      $runtimeParent = Split-Path -Parent $runtimeRoot
      $cacheRoot = if ($DownloadRoot) {
        Assert-ChildPath $projectRoot $DownloadRoot
      } else { Assert-ChildPath $projectRoot (Join-Path $runtimeParent ("_downloads\" + $manifest.manifestVersion)) }
      $stagingParent = Assert-ChildPath $projectRoot (Join-Path $runtimeParent "_staging")
      $backupParent = Assert-ChildPath $projectRoot (Join-Path $runtimeParent "_backups")
      New-Item -ItemType Directory -Force -Path $cacheRoot, $stagingParent, $backupParent | Out-Null
      $staging = Assert-ChildPath $stagingParent (Join-Path $stagingParent ([guid]::NewGuid().ToString("N")))
      New-Item -ItemType Directory -Force -Path $staging | Out-Null
      try {
        foreach ($artifact in @($manifest.artifacts)) {
          $archive = Receive-Artifact $artifact $cacheRoot $RetryCount
          Assert-ZipSafe $archive @($manifest.excludedArchivePrefixes)
          Write-Log "Estraggo $($artifact.id) nello staging."
          Expand-Archive -LiteralPath $archive -DestinationPath $staging -Force
        }
        $existingPaths = Join-Path $runtimeRoot "ComfyUI\extra_model_paths.yaml"
        $stagedPaths = Join-Path $staging "ComfyUI\extra_model_paths.yaml"
        if (Test-Path -LiteralPath $existingPaths -PathType Leaf) {
          New-Item -ItemType Directory -Force -Path (Split-Path -Parent $stagedPaths) | Out-Null
          Copy-Item -LiteralPath $existingPaths -Destination $stagedPaths -Force
          Write-Log "Configurazione modelli preservata; nessun modello è stato copiato."
        } else {
          Write-DefaultModelPaths $stagedPaths (Join-Path $projectRoot "models")
          Write-Log "Configurazione modelli creata per la libreria condivisa del progetto."
        }
        Assert-Runtime $staging $manifest
        Copy-Item -LiteralPath $manifestFull -Destination (Join-Path $staging ".installed-manifest.json") -Force
        $backupRoot = $null
        if (Test-Path -LiteralPath $runtimeRoot -PathType Container) {
          $backupRoot = Assert-ChildPath $backupParent (Join-Path $backupParent "runtime-$runId")
          Move-Item -LiteralPath $runtimeRoot -Destination $backupRoot
          Write-Log "Runtime precedente archiviato in $backupRoot."
        }
        try { Move-Item -LiteralPath $staging -Destination $runtimeRoot } catch {
          if ($null -ne $backupRoot -and (Test-Path -LiteralPath $backupRoot -PathType Container)) {
            Move-Item -LiteralPath $backupRoot -Destination $runtimeRoot
            Write-Log "Swap fallito; runtime precedente ripristinato automaticamente." "WARN"
          }
          throw
        }
        $backup = $backupRoot
        $diagnostics = Get-Diagnostics $runtimeRoot $manifest
        Write-Log "Motore $($manifest.engineVersion) installato in $runtimeRoot."
        $status = "installed"
      } catch {
        Write-Log "Staging conservato per diagnostica: $staging" "WARN"
        throw
      }
    }
  }
} catch {
  $failure = $_.Exception.Message
  Write-Log $failure "ERROR"
} finally {
  [ordered]@{
    schemaVersion = 1
    status = $status
    error = $failure
    logPath = $script:LogPath
    manifestVersion = if ($null -ne $manifest) { $manifest.manifestVersion } else { $null }
    engineVersion = if ($null -ne $manifest) { $manifest.engineVersion } else { $null }
    runtimeRoot = $runtimeRoot
    backup = $backup
    diagnostics = $diagnostics
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8
  Write-Host "Report diagnostico: $reportPath"
}

if ($null -ne $failure) { exit 1 }
exit 0
