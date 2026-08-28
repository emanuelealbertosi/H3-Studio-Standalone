# Bootstrap pubblico del motore standalone

Stato al 28 agosto 2026: implementazione locale completata e verificata con
fixture; pubblicazione degli artefatti bloccata fino alla creazione del
repository standalone dedicato.

## Obiettivo

Il bootstrap installa o aggiorna il runtime incorporato senza richiedere una
ComfyUI preesistente. Non installa modelli e non modifica installazioni ComfyUI
esterne. La modalità H3_ENGINE_MODE=external resta indipendente.

File coinvolti:

- engine/manifest.json: contratto versionato e futura distinta artefatti;
- scripts/BOOTSTRAP_STANDALONE_ENGINE.ps1: download e installazione;
- INSTALL_H3_STUDIO_STANDALONE.bat: wrapper interattivo;
- scripts/test-standalone-bootstrap.mjs: test end-to-end su runtime fittizio;
- scripts/INSTALL_STANDALONE_ENGINE.ps1: importer di sviluppo separato.

## Stato intenzionale del manifest

Il manifest tracciato ha releaseState impostato a unpublished e nessun
artefatto. Il bootstrap predefinito deve quindi fermarsi con un errore
leggibile. URL e checksum non devono essere inventati o puntare al repository
H3 Studio originale.

Il passaggio a published è consentito soltanto dopo che:

1. esiste il repository standalone dedicato;
2. l'archivio del runtime è stato costruito e validato;
3. l'asset è stato caricato su una release immutabile;
4. dimensione e SHA-256 sono stati calcolati sull'asset pubblicato;
5. notice, licenze e versioni dei componenti sono completi.

## Contratto manifest schema 1

Campi principali:

- schemaVersion: versione del parser, attualmente 1;
- manifestVersion: revisione immutabile del manifest;
- releaseState: unpublished o published;
- engineVersion: versione mostrata e installata;
- runtimeRoot: destinazione relativa al progetto;
- installedSizeBytes: dimensione prevista del runtime estratto;
- minimumFreeBytesAfterInstall: margine da conservare;
- platform: sistema, architettura, build Windows minima e vendor GPU;
- requiredFiles: file che devono esistere prima dello swap;
- excludedArchivePrefixes: directory vietate negli artefatti;
- artifacts: archivi ordinati da scaricare ed estrarre;
- components: sorgente, versione e licenza dei componenti.

Ogni artefatto richiede id, fileName, urls, sha256, sizeBytes e archiveType.
Gli URL nel manifest pubblicato devono essere HTTPS, versionati e immutabili.
I percorsi locali sono accettati soltanto per sviluppo e test.

## Flusso di installazione

1. legge il manifest locale tracciato;
2. raccoglie build Windows, architettura, GPU/driver e spazio disco;
3. rifiuta piattaforme incompatibili o spazio insufficiente;
4. scarica nella cache con file .partial, HTTP Range, mirror e retry;
5. verifica dimensione e SHA-256 prima di usare ogni archivio;
6. rifiuta path traversal e contenuti sotto i prefissi esclusi;
7. estrae in uno staging sullo stesso volume della destinazione;
8. preserva l'eventuale ComfyUI/extra_model_paths.yaml esistente;
9. verifica tutti i requiredFiles;
10. sposta il runtime esistente in _backups;
11. sposta lo staging in runtime;
12. se lo swap fallisce, ripristina automaticamente il backup.

Cache, staging e backup sono collocati accanto alla destinazione. Con il layout
predefinito risultano in engine/_downloads, engine/_staging ed
engine/_backups; sono ignorati da Git.

## Comandi

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

Il parametro -AllowUnpublished è riservato a fixture o manifest di sviluppo e
non rende installabile un manifest privo di artefatti.

## Diagnostica e failure semantics

Ogni esecuzione produce sotto data/bootstrap:

- un log testuale con timestamp e fasi;
- un report JSON con stato, errore, versioni, destinazione, backup, sistema
  operativo, spazio disco, GPU e driver.

Un checksum errato, un archivio vietato o una validazione fallita avvengono
prima dello swap: il runtime attivo resta invariato e lo staging viene
conservato per l'analisi. Il rollback ignora backup incompleti e sceglie il più
recente che contiene almeno Python portable e ComfyUI/main.py.

## Verifica

    npm run typecheck
    npm run test:standalone-bootstrap
    npm run test:standalone-installer
    npm run test:standalone-launcher
    npm run build

Il test bootstrap usa archivi piccoli generati localmente e non modifica
engine/runtime, modelli, porte o processi.
