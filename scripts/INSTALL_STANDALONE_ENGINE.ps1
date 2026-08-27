[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePortableRoot,
  [string]$DestinationRoot = "",
  [switch]$ValidateOnly,
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-FullPath {
  param([Parameter(Mandatory = $true)][string]$PathValue)
  return [System.IO.Path]::GetFullPath($PathValue.Trim([char]34))
}

function Assert-ChildPath {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Child
  )
  $parentFull = (Resolve-FullPath $Parent).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  $childFull = Resolve-FullPath $Child
  if (-not $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Percorso non sicuro fuori dal progetto: $childFull"
  }
  return $childFull
}

function Invoke-RobocopySafe {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [string[]]$ExcludeDirectories = @()
  )
  $arguments = @($Source, $Destination, "/E", "/COPY:DAT", "/DCOPY:DAT", "/R:2", "/W:2", "/NFL", "/NDL", "/NP", "/NJH", "/NJS")
  if ($ExcludeDirectories.Count -gt 0) {
    $arguments += "/XD"
    $arguments += $ExcludeDirectories
  }
  & robocopy @arguments | Out-Host
  if ($LASTEXITCODE -gt 7) {
    throw "Robocopy fallito ($LASTEXITCODE): $Source -> $Destination"
  }
}

$projectRoot = Resolve-FullPath (Split-Path -Parent $PSScriptRoot)
$sourceRoot = Resolve-FullPath $SourcePortableRoot
$sourcePython = Join-Path $sourceRoot "python_embeded"
$sourceComfy = Join-Path $sourceRoot "ComfyUI"

if (-not (Test-Path -LiteralPath (Join-Path $sourcePython "python.exe") -PathType Leaf)) {
  throw "Python portable non trovato: $sourcePython\python.exe"
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceComfy "main.py") -PathType Leaf)) {
  throw "ComfyUI main.py non trovato: $sourceComfy\main.py"
}

if (-not $DestinationRoot) {
  $DestinationRoot = Join-Path $projectRoot "engine\runtime"
}
$runtimeRoot = Assert-ChildPath -Parent $projectRoot -Child $DestinationRoot
$engineRoot = Assert-ChildPath -Parent $projectRoot -Child (Join-Path $projectRoot "engine")
$stagingParent = Assert-ChildPath -Parent $engineRoot -Child (Join-Path $engineRoot "_staging")
$backupParent = Assert-ChildPath -Parent $engineRoot -Child (Join-Path $engineRoot "_backups")

$requiredNodeCandidates = @(
  @("ComfyUI-Fantastic-MiniMaxH3-PromptBuilder"),
  @("ComfyUI-DaSiWa-Nodes"),
  @("rgthree-comfy"),
  @("ComfyUI-KJNodes"),
  @("ComfyUI-VideoHelperSuite", "comfyui-videohelpersuite"),
  @("ComfyUI-MiniMax-H3-PDD-Acc"),
  @("ComfyUI-Conditioning-Rebalance", "Rebalance-Pack"),
  @("ComfyUI-H3-FaceRefine"),
  @("ComfyUI-H3-NativeAudioLock"),
  @("Comfyui_Minimax_h3_latent_Upscaler")
)

$sourceCustomNodes = Join-Path $sourceComfy "custom_nodes"
$resolvedNodes = [System.Collections.Generic.List[object]]::new()
$missingNodes = [System.Collections.Generic.List[string]]::new()
foreach ($candidates in $requiredNodeCandidates) {
  $match = $null
  foreach ($candidate in $candidates) {
    $candidatePath = Join-Path $sourceCustomNodes $candidate
    if (Test-Path -LiteralPath $candidatePath -PathType Container) {
      $match = [pscustomobject]@{ Name = $candidate; Path = $candidatePath }
      break
    }
  }
  if ($null -eq $match) {
    $missingNodes.Add(($candidates -join " oppure "))
  } else {
    $resolvedNodes.Add($match)
  }
}

$summary = [ordered]@{
  source = $sourceRoot
  destination = $runtimeRoot
  python = $sourcePython
  comfy = $sourceComfy
  nodesFound = @($resolvedNodes | ForEach-Object { $_.Name })
  nodesMissing = @($missingNodes)
  sourceModelPaths = Test-Path -LiteralPath (Join-Path $sourceComfy "extra_model_paths.yaml") -PathType Leaf
}

if ($ValidateOnly) {
  $summary | ConvertTo-Json -Depth 4
  exit 0
}

if ($missingNodes.Count -gt 0) {
  throw "Nodi richiesti mancanti nel runtime sorgente: $($missingNodes -join '', '')"
}
if ((Test-Path -LiteralPath $runtimeRoot) -and -not $Force) {
  throw "Il runtime esiste gia: $runtimeRoot. Usa -Force per archiviarlo e sostituirlo."
}

New-Item -ItemType Directory -Force -Path $stagingParent | Out-Null
$stagingRoot = Assert-ChildPath -Parent $stagingParent -Child (Join-Path $stagingParent ([guid]::NewGuid().ToString("N")))
New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

try {
  Write-Host "Importo Python portable..." -ForegroundColor Cyan
  Invoke-RobocopySafe -Source $sourcePython -Destination (Join-Path $stagingRoot "python_embeded") -ExcludeDirectories @("__pycache__")

  Write-Host "Importo ComfyUI core..." -ForegroundColor Cyan
  $comfyTarget = Join-Path $stagingRoot "ComfyUI"
  $excluded = @(
    (Join-Path $sourceComfy "models"),
    (Join-Path $sourceComfy "input"),
    (Join-Path $sourceComfy "output"),
    (Join-Path $sourceComfy "temp"),
    (Join-Path $sourceComfy "user"),
    (Join-Path $sourceComfy ".git"),
    (Join-Path $sourceComfy "custom_nodes"),
    "__pycache__"
  )
  Invoke-RobocopySafe -Source $sourceComfy -Destination $comfyTarget -ExcludeDirectories $excluded

  $customTarget = Join-Path $comfyTarget "custom_nodes"
  New-Item -ItemType Directory -Force -Path $customTarget | Out-Null
  foreach ($node in $resolvedNodes) {
    Write-Host "Importo nodo $($node.Name)..." -ForegroundColor DarkCyan
    Invoke-RobocopySafe -Source $node.Path -Destination (Join-Path $customTarget $node.Name) -ExcludeDirectories @(".git", "__pycache__", "node_modules")
  }

  foreach ($bundledName in @("ComfyUI-H3-Multishot", "H3-Studio-Gemma4-Chat")) {
    $bundledSource = Join-Path $projectRoot ("comfyui_nodes\" + $bundledName)
    if (-not (Test-Path -LiteralPath (Join-Path $bundledSource "__init__.py") -PathType Leaf)) {
      throw "Nodo incluso mancante: $bundledSource"
    }
    Invoke-RobocopySafe -Source $bundledSource -Destination (Join-Path $customTarget $bundledName) -ExcludeDirectories @("__pycache__")
  }

  $sourceExtraPaths = Join-Path $sourceComfy "extra_model_paths.yaml"
  if (Test-Path -LiteralPath $sourceExtraPaths -PathType Leaf) {
    Copy-Item -LiteralPath $sourceExtraPaths -Destination (Join-Path $comfyTarget "extra_model_paths.yaml") -Force
  } else {
    $modelRoot = (Join-Path $projectRoot "models").Replace("\", "/")
    $yaml = @"
h3_studio_models:
    base_path: $modelRoot
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
    Set-Content -LiteralPath (Join-Path $comfyTarget "extra_model_paths.yaml") -Value $yaml -Encoding UTF8
  }

  if (-not (Test-Path -LiteralPath (Join-Path $stagingRoot "python_embeded\python.exe") -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $stagingRoot "ComfyUI\main.py") -PathType Leaf)) {
    throw "Verifica del runtime preparato fallita."
  }

  if (Test-Path -LiteralPath $runtimeRoot) {
    New-Item -ItemType Directory -Force -Path $backupParent | Out-Null
    $backupRoot = Assert-ChildPath -Parent $backupParent -Child (Join-Path $backupParent ("runtime-" + (Get-Date -Format "yyyyMMdd-HHmmss")))
    Move-Item -LiteralPath $runtimeRoot -Destination $backupRoot
    Write-Host "Runtime precedente archiviato in $backupRoot" -ForegroundColor Yellow
  }
  Move-Item -LiteralPath $stagingRoot -Destination $runtimeRoot
  Write-Host "Motore standalone installato in $runtimeRoot" -ForegroundColor Green
  Write-Host "I modelli non sono stati duplicati; vengono letti dai percorsi esterni configurati." -ForegroundColor Green
} catch {
  Write-Error $_
  throw
}
