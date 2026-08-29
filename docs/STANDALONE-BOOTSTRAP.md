# Bootstrap pubblico del motore standalone

Stato al 28 agosto 2026: bootstrap, builder riproducibile, manifest pubblico e
verifica runtime completati. La prerelease `v0.1.0-dev` usa due asset HTTPS
immutabili nel repository standalone dedicato; l'installazione combinata è
stata verificata fino al ciclo start/health/stop sulla RTX 5070 Ti.

## Obiettivo

Il bootstrap installa o aggiorna il runtime incorporato senza richiedere una
ComfyUI preesistente. Non installa modelli e non modifica installazioni ComfyUI
esterne. La modalità `H3_ENGINE_MODE=external` resta indipendente.

L'assenza dei modelli è una modalità supportata, non un errore di installazione:
il bootstrap non mostra checkpoint preselezionati e non avvia download impliciti.
La scelta successiva fra continuare senza pesi, collegare cartelle esistenti o
scaricare singoli elementi dall'Admin è definita in
`docs/STANDALONE-MODEL-CATALOG.md`.

L'interfaccia di installazione deve esporre sempre un comando evidente
**Salta per ora / Continua senza modelli**. Deve essere possibile completare
l'installazione senza selezionare alcun peso e indicare successivamente una
libreria già presente tramite `extra_model_paths.yaml`; questa operazione non
copia, sposta, riscarica o elimina i file dell'utente.

File coinvolti:

- `engine/manifest.json`: contratto versionato e distinta artefatti;
- `engine/components.lock.json`: componenti runtime, commit/versioni e licenze;
- `engine/python-package-licenses.lock.json`: correzioni documentate ai metadati
  incompleti dei wheel Python;
- `scripts/build-standalone-engine-artifact.py`: builder ZIP deterministico,
  inventario, SBOM e notice;
- `BUILD_STANDALONE_ENGINE_ARTIFACT.bat`: wrapper del builder;
- `scripts/BOOTSTRAP_STANDALONE_ENGINE.ps1`: download e installazione;
- `INSTALL_H3_STUDIO_STANDALONE.bat`: wrapper interattivo del bootstrap;
- `scripts/verify-standalone-runtime.ts`: prova reale start/health/stop;
- `scripts/test-standalone-artifact-builder.mjs`: test di riproducibilità;
- `scripts/test-standalone-bootstrap.mjs`: test end-to-end con fixture.

## Stato del manifest pubblico

Il manifest tracciato ha `releaseState: published` e descrive i due asset
ordinati `core` e `torch` della prerelease `v0.1.0-dev`. URL, dimensioni e
checksum puntano esclusivamente al repository standalone dedicato, non al
repository H3 Studio originale.

Il passaggio a `published` è consentito soltanto dopo che:

1. esiste il repository standalone dedicato;
2. il working tree è pulito;
3. tutte le licenze sono risolte;
4. l'archivio del runtime è stato costruito e validato;
5. l'asset è stato caricato su una release HTTPS immutabile;
6. dimensione e SHA-256 corrispondono all'asset pubblicato;
7. prima della promozione a release stabile, il bootstrap è stato provato anche
   su una seconda macchina Windows/NVIDIA pulita.

I punti 1-6 sono chiusi per la prerelease. Il punto 7 resta un gate di
promozione alla release stabile e non viene dichiarato completato.

`--release` rifiuta un working tree sporco, un URL non HTTPS e qualunque voce di
licenza irrisolta. `--allow-incomplete-notices` è ammesso solo per artefatti di
sviluppo e non può aggirare il gate release.

## Contratto manifest schema 1

Campi principali:

- `schemaVersion`: versione del parser, attualmente 1;
- `manifestVersion`: revisione immutabile del manifest;
- `releaseState`: `unpublished` o `published`;
- `engineVersion`: versione mostrata e installata;
- `runtimeRoot`: destinazione relativa al progetto;
- `installedSizeBytes`: dimensione prevista del runtime estratto;
- `minimumFreeBytesAfterInstall`: margine da conservare;
- `platform`: sistema, architettura, build Windows minima e vendor GPU;
- `requiredFiles`: file che devono esistere prima dello swap;
- `excludedArchivePrefixes`: directory vietate negli artefatti;
- `artifacts`: archivi ordinati da scaricare ed estrarre;
- `components`: sorgente, versione, hash dell'overlay e licenza dei componenti.

Ogni artefatto richiede `id`, `fileName`, `urls`, `sha256`, `sizeBytes` e
`archiveType`. Gli URL nel manifest pubblicato devono essere HTTPS, versionati e
immutabili. I percorsi locali sono accettati soltanto per sviluppo e test.

## Builder riproducibile

Il builder legge soltanto `engine/runtime` e gli overlay mantenuti in
`comfyui_nodes`. Ordina tutte le entry, usa timestamp e permessi fissati,
rifiuta collegamenti simbolici, esclude modelli e dati macchina e genera:

- `BUILD-INFO.json`, con commit Git e stato dirty;
- `component-inventory.json`;
- `python-packages.sbom.json`;
- `THIRD_PARTY_NOTICES.txt`;
- licenza e notice di H3 Studio;
- manifest con dimensione e SHA-256 calcolati sullo ZIP finale.

Validazione senza creare lo ZIP:

    BUILD_STANDALONE_ENGINE_ARTIFACT.bat --validate-only --allow-incomplete-notices

Artefatto di sviluppo:

    BUILD_STANDALONE_ENGINE_ARTIFACT.bat --allow-incomplete-notices --compression fastest --force

Release GitHub suddivisa automaticamente sotto il limite di 2 GiB per asset:

    BUILD_STANDALONE_ENGINE_ARTIFACT.bat --release --github-release ^
      --artifact-base-url https://github.com/emanuelealbertosi/H3-Studio-Standalone/releases/download/v0.1.0-dev ^
      --compression fastest --force

## Flusso di installazione

1. legge il manifest locale tracciato;
2. raccoglie build Windows, architettura, GPU/driver e spazio disco;
3. rifiuta piattaforme incompatibili o spazio insufficiente;
4. scarica nella cache con file `.partial`, HTTP Range, mirror e retry;
5. verifica dimensione e SHA-256 prima di usare ogni archivio;
6. rifiuta path traversal e contenuti sotto i prefissi esclusi;
7. estrae in uno staging sullo stesso volume della destinazione;
8. preserva `ComfyUI/extra_model_paths.yaml` durante un aggiornamento oppure lo
   genera per la libreria `models` del progetto durante una prima installazione;
9. verifica tutti i `requiredFiles`;
10. sposta il runtime esistente in `_backups`;
11. sposta lo staging in `runtime`;
12. se lo swap fallisce, ripristina automaticamente il backup.

Cache, staging e backup sono collocati accanto alla destinazione. Con il layout
predefinito risultano in `engine/_downloads`, `engine/_staging` ed
`engine/_backups`; sono ignorati da Git.

## Comandi bootstrap

Diagnostica senza installare:

    powershell.exe -NoProfile -ExecutionPolicy Bypass ^
      -File .\scripts\BOOTSTRAP_STANDALONE_ENGINE.ps1 -DiagnosticsOnly

Installazione, dopo la pubblicazione del manifest:

    INSTALL_H3_STUDIO_STANDALONE.bat

Aggiornamento con backup del runtime corrente:

    powershell.exe -NoProfile -ExecutionPolicy Bypass ^
      -File .\scripts\BOOTSTRAP_STANDALONE_ENGINE.ps1 -Force

Rollback all'ultimo backup valido:

    powershell.exe -NoProfile -ExecutionPolicy Bypass ^
      -File .\scripts\BOOTSTRAP_STANDALONE_ENGINE.ps1 -RollbackLatest

Il parametro `-AllowUnpublished` è riservato a fixture o manifest di sviluppo e
non rende installabile un manifest privo di artefatti.

## Diagnostica e failure semantics

Ogni esecuzione produce sotto `data/bootstrap`:

- un log testuale con timestamp e fasi;
- un report JSON con stato, errore, versioni, destinazione, backup, sistema
  operativo, spazio disco, GPU e driver.

Un checksum errato, un archivio vietato o una validazione fallita avvengono
prima dello swap: il runtime attivo resta invariato e lo staging viene
conservato per l'analisi. Il rollback ignora backup incompleti e sceglie il più
recente che contiene almeno Python portable e `ComfyUI/main.py`.

## Risultato reale del 28 agosto 2026

Il builder ha creato da commit pulito `5b6a66c` i due asset ufficiali, ignorati
da Git ma descritti dal manifest tracciato:

- `h3-engine-0.1.0-dev-windows-nvidia-x64-core.zip`:
  `1.436.383.267` byte, SHA-256
  `9c9c6259c423bd0ab1936e67c9e92c14bb037f2b7ab921f6ff8641e32b3b3134`;
- `h3-engine-0.1.0-dev-windows-nvidia-x64-torch.zip`:
  `1.915.310.943` byte, SHA-256
  `c02d3b4bff7ce804412778c14addc0ccaef435036aea7a6a17887b19a033d110`.

Ogni asset resta sotto 2 GiB. Gli archivi non hanno entry sovrapposte e la loro
unione contiene 65.552 file. Il primo contiene il runtime generale, inventario,
SBOM e notice; il secondo contiene soltanto
`python_embeded/Lib/site-packages/torch/`. I modelli non sono inclusi.

Il bootstrap ha verificato entrambi i checksum, estratto in ordine i due ZIP in
una destinazione pulita e generato `extra_model_paths.yaml` verso
`F:/H3-Studio-Standalone/models`. Il runtime combinato è stato avviato,
verificato e fermato sulla RTX 5070 Ti usando la porta isolata 19000. Dopo lo
stop non erano rimasti listener, processi Python di test o `IMPORT FAILED`.

La validazione censisce 14 componenti e 191 distribuzioni Python, con zero
licenze irrisolte. La dichiarazione Apache-2.0 del latent upscaler e la relativa
evidenza sono incluse nell'asset core.

## Verifica

    npm run typecheck
    npm run test:standalone-artifact
    npm run test:standalone-bootstrap
    npm run test:standalone-installer
    npm run test:standalone-launcher
    npm run test:engine
    npm run build

Per provare un runtime installato in `engine/_test/verified-runtime`:

    npm run verify:standalone-runtime

I test fixture non modificano `engine/runtime`, i modelli, le porte o i processi
esistenti. Lo script di verifica runtime è invece un test reale esplicito e usa
la porta 19000 per impostazione predefinita.
