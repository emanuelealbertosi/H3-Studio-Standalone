# Bootstrap pubblico del motore standalone

Stato al 28 agosto 2026: bootstrap, builder riproducibile e verifica runtime
implementati localmente. Un artefatto di sviluppo reale è stato costruito,
installato in una destinazione pulita e avviato sulla RTX 5070 Ti. La
pubblicazione resta bloccata fino alla creazione del repository standalone
dedicato e al caricamento di un asset HTTPS immutabile.

## Obiettivo

Il bootstrap installa o aggiorna il runtime incorporato senza richiedere una
ComfyUI preesistente. Non installa modelli e non modifica installazioni ComfyUI
esterne. La modalità `H3_ENGINE_MODE=external` resta indipendente.

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

## Stato intenzionale del manifest

Il manifest tracciato ha `releaseState: unpublished` e nessun artefatto. Il
bootstrap predefinito si ferma quindi con un errore leggibile. URL e checksum
non vengono inventati e non puntano al repository H3 Studio originale.

Il passaggio a `published` è consentito soltanto dopo che:

1. esiste il repository standalone dedicato;
2. il working tree è pulito;
3. tutte le licenze sono risolte;
4. l'archivio del runtime è stato costruito e validato;
5. l'asset è stato caricato su una release HTTPS immutabile;
6. dimensione e SHA-256 corrispondono all'asset pubblicato;
7. il bootstrap pubblicato è stato provato su una macchina Windows/NVIDIA
   pulita.

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

Release, soltanto dopo avere chiuso tutti i gate:

    BUILD_STANDALONE_ENGINE_ARTIFACT.bat --release ^
      --artifact-url https://host/repository/releases/download/VERSION/h3-engine.zip ^
      --force

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

Il builder ha creato un artefatto di sviluppo locale, ignorato da Git:

- file: `engine/_artifacts/h3-engine-0.1.0-dev-windows-nvidia-x64.zip`;
- dimensione: `3.351.766.538` byte;
- SHA-256: `e2de59f3060d880d9885ee109a9d1cd9e4cb9b4442aff1ba0477b3362a10887c`;
- payload: 65.542 file, 5.871.160.883 byte;
- modelli inclusi: no.

Il bootstrap ha installato questo ZIP in una destinazione pulita, ha generato
`extra_model_paths.yaml` verso `F:/H3-Studio-Standalone/models` e il runtime è
stato avviato, verificato e fermato sulla RTX 5070 Ti usando la porta isolata
19000. Dopo lo stop non erano rimasti listener o processi Python di test. Le
directory temporanee della prova sono state eliminate; l'artefatto locale è
stato conservato. La seconda prova, dopo la chiusura del gate licenze, ha
ripetuto con successo checksum, installazione pulita, start/health/stop e
controllo dell'assenza di `IMPORT FAILED`.

La validazione corrente censisce 14 componenti e 191 distribuzioni Python, con
zero licenze irrisolte. La dichiarazione Apache-2.0 del latent upscaler e la
relativa evidenza sono incluse nello ZIP. L'artefatto resta di sviluppo perché
il repository standalone e l'URL release immutabile non esistono ancora.

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
