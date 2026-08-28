# H3 Studio Standalone — handoff completo

Ultimo aggiornamento: **28 agosto 2026**  
Stato verificato: **bootstrap standalone pubblico in prerelease e funzionante sul PC di sviluppo**<br>
Branch: `standalone-engine`  
Checkpoint iniziale: `a85f1fb` (`feat: bootstrap embedded standalone engine`)
Checkpoint implementazione bootstrap: `9f9f5fb` (`feat: build reproducible standalone engine artifacts`)
Checkpoint evidenza licenze: `4063be5` (`fix: resolve latent upscaler license evidence`)
Checkpoint split GitHub Release: `5b6a66c` (`feat: split engine for GitHub releases`)
Checkpoint prerelease pubblicata: `1ac9396`

Questo documento è il punto di ingresso per una nuova chat o per un nuovo
sviluppatore. È intenzionalmente autosufficiente: descrive obiettivo, confini,
stato reale, architettura, comandi, test, rischi e prossime attività.

## 1. Regola fondamentale: due progetti separati

| Variante | Percorso locale | Scopo | Stato Git |
|---|---|---|---|
| H3 Studio originale | `F:\H3-Studio` | Prodotto corrente basato su ComfyUI esterna | `f99de40`, repository GitHub originale |
| H3 Studio Standalone | `F:\H3-Studio-Standalone` | Nuova variante con motore incorporato invisibile | branch `standalone-engine`, prerelease `1ac9396`, repository GitHub dedicato |

Non modificare `F:\H3-Studio` mentre si lavora sulla variante standalone.
La copia standalone ha un remote chiamato `source-snapshot` configurato così:

```text
fetch: F:\H3-Studio
push:  DISABLED
```

Questo impedisce un push accidentale sul repository pubblico originale. Il
remote `origin` punta esclusivamente al repository pubblico dedicato:
`https://github.com/emanuelealbertosi/H3-Studio-Standalone.git`. Non riattivare
mai il push di `source-snapshot`.

## 2. Visione del prodotto

L'utente deve vedere una sola applicazione, H3 Studio. ComfyUI resta il motore
di inferenza, ma diventa un dettaglio interno:

- nessuna finestra o interfaccia ComfyUI da aprire;
- nessun URL e nessuna cartella output da configurare nel wizard normale;
- un solo launcher avvia web app, bridge ed engine;
- Ctrl+C arresta l'intero albero di processi;
- input, output e log del motore appartengono a H3 Studio;
- i modelli possono essere condivisi con archivi esistenti senza duplicazione;
- la modalità ComfyUI esterna rimane disponibile come fallback tecnico.

Non stiamo riscrivendo l'inferenza MiniMax H3 in Node o C++. La prima release
standalone incorpora una distribuzione ComfyUI ridotta e versionata: è la via
più rapida per conservare compatibilità con H3, FAST PDD, Krea 2, Flux Klein,
Anima, Chat Vision, Continue, Face e Latent Upscale.

## 3. Stato già raggiunto

### Completato e verificato

- Copia Git indipendente creata con `--no-hardlinks`.
- Branch dedicato `standalone-engine`.
- Push verso il repository originale disabilitato.
- `EngineManager` embedded/external implementato.
- Discovery automatica di Python e ComfyUI incorporati.
- Avvio ComfyUI su loopback con cartelle input/output private.
- Endpoint di identità privato per distinguere il nostro engine da una ComfyUI
  estranea sulla stessa porta.
- Rifiuto sicuro di una porta occupata da un processo non posseduto.
- Start, health check, timeout e stop coordinati.
- Fix UTF-8 per i custom node che stampano emoji senza console Windows.
- Launcher unico per bridge, engine e frontend.
- Chiusura verificata dell'intero process tree su Windows.
- Installer di sviluppo selettivo e atomico.
- Bootstrap pubblico guidato da manifest implementato, testato e pubblicato.
- Builder ZIP deterministico con commit sorgente, SHA-256, manifest generato,
  inventario componenti, SBOM Python e third-party notices.
- Resume/retry, SHA-256, staging, swap, backup e rollback verificati.
- Report diagnostico con Windows, spazio disco, GPU e driver verificato.
- Artefatto reale completo da 3.351.766.538 byte costruito e reinstallato da zero.
- Start/health/stop del runtime reinstallato verificato sulla RTX 5070 Ti.
- 14 componenti e 191 distribuzioni Python inventariati, con zero licenze
  irrisolte e gate `--release` verificato da working tree pulito.
- Import del runtime realmente eseguito da `D:\ComfyUI_NVMe`.
- Runtime risultante: **5,58 GiB**.
- Modelli non duplicati: viene riusato `extra_model_paths.yaml`.
- Wizard iniziale adattato alla modalità embedded.
- TypeScript configurato per ignorare il runtime di terze parti.
- Build di produzione verde.
- Suite di regressione principale verde.
- Checkpoint Git locale pulito.

### Test reale dell'engine

Il runtime incorporato è stato avviato su porte isolate e ha restituito:

```json
{
  "ok": true,
  "product": "h3-studio",
  "embedded": true
}
```

Il bridge ha riportato `installed: true`, `running: true`, `owned: true`. Il log
ha rilevato correttamente:

- NVIDIA GeForce RTX 5070 Ti;
- 16 GB VRAM;
- PyTorch CUDA;
- comfy-kitchen CUDA;
- DynamicVRAM;
- tutti i custom node richiesti, senza `IMPORT FAILED`.

Dopo Ctrl+C, engine e bridge non erano più in ascolto e il PID Python non era
più attivo.

Il 28 agosto 2026 è stato inoltre provato il ciclo pubblico completo con i due
asset ufficiali `core` e `torch`: build da commit pulito, verifica indipendente
dei checksum, installazione combinata in una destinazione vuota, generazione dei
model path, avvio sulla porta isolata 19000, health/identity e stop. Non sono
rimasti listener, processi Python di test o `IMPORT FAILED`. Le directory
temporanee sono state eliminate; gli asset locali ignorati da Git sono in
`engine/_artifacts`.

## 4. Layout locale

```text
F:\H3-Studio-Standalone\
  app/                         frontend React/vinext
  bridge/                      API Fastify e orchestrazione
  comfyui_nodes/               nodi H3 Studio mantenuti dal progetto
  data/
    engine-input/              input privati dell'engine
    engine-output/             output privati dell'engine
    engine.log                 log Python/ComfyUI
    h3-studio.sqlite           dati applicativi, se configurato
  docs/
  engine/
    manifest.json              contratto pubblico con due asset SHA-256
    components.lock.json       pin e licenze componenti runtime
    python-package-licenses.lock.json
    runtime/                   Python + ComfyUI; ignorato da Git
      python_embeded/python.exe
      ComfyUI/main.py
    _artifacts/                ZIP e manifest generati; ignorati
    _downloads/                cache download/resume; ignorata
    _staging/                  staging installer; ignorato
    _backups/                  rollback installer; ignorato
  models/                      libreria opzionale; ignorata da Git
  scripts/
  workflows/                   workflow sanitizzati e versionati
  INSTALL_STANDALONE_ENGINE.bat
  START_H3_STUDIO_STANDALONE.bat
```

Runtime, modelli, output, database e media non devono entrare nel repository.

## 5. Architettura runtime

```text
Browser :3000
    │
    ▼
H3 Studio Bridge :8787
    │  EngineManager
    ▼
Embedded ComfyUI :9000 (loopback)
    │
    ├── data/engine-input
    ├── data/engine-output
    ├── data/engine.log
    └── model roots esterne/configurabili
```

Il frontend non parla direttamente con ComfyUI. Il bridge conserva tutte le
responsabilità applicative già presenti: progetti, job, prompt mapping, libreria,
timeline, varianti, chat, crediti e persistenza.

### Sequenza di avvio

1. `START_H3_STUDIO_STANDALONE.bat` individua Node >= 22.16.
2. `scripts/standalone-launcher.mjs` controlla che le porte siano libere.
3. Avvia il bridge.
4. Il bridge crea `EngineManager` e chiama `ensureRunning()`.
5. L'engine viene avviato nascosto e deve rispondere con la propria identità.
6. Il bridge diventa disponibile anche se il runtime manca, per consentire
   wizard e diagnostica.
7. Il launcher avvia il frontend e apre il browser.
8. Ctrl+C termina web, bridge ed engine posseduto.

### Ownership e sicurezza processi

`EngineManager` termina soltanto il processo che ha avviato. Una semplice
risposta su `/system_stats` non è sufficiente: in modalità embedded deve esistere
anche `/h3_studio/engine/identity` con `product=h3-studio` ed `embedded=true`.
Una ComfyUI esterna sulla porta configurata viene trattata come conflitto.

## 6. File introdotti o modificati

### Engine e bridge

- `bridge/engine-manager.ts`: discovery, start, probe, status e stop.
- `bridge/config.ts`: modalità `embedded|external` e directory engine.
- `bridge/server.ts`: avvio engine e API Admin start/stop/status.
- `comfyui_nodes/H3-Studio-Gemma4-Chat/h3_studio_chat.py`: endpoint identità.

### Bootstrap e launcher

- `scripts/INSTALL_STANDALONE_ENGINE.ps1`: import atomico selettivo.
- `INSTALL_STANDALONE_ENGINE.bat`: wrapper interattivo Windows.
- `scripts/BOOTSTRAP_STANDALONE_ENGINE.ps1`: bootstrap pubblico riproducibile.
- `INSTALL_H3_STUDIO_STANDALONE.bat`: wrapper del bootstrap pubblico.
- `scripts/test-standalone-bootstrap.mjs`: test di installazione e rollback.
- `scripts/build-standalone-engine-artifact.py`: builder ZIP deterministico.
- `BUILD_STANDALONE_ENGINE_ARTIFACT.bat`: wrapper Windows del builder.
- `engine/components.lock.json`: pin e inventario licenze dei componenti.
- `engine/python-package-licenses.lock.json`: override di licenza con evidenza.
- `scripts/test-standalone-artifact-builder.mjs`: test determinismo e gate.
- `scripts/verify-standalone-runtime.ts`: test reale start/health/stop.
- `docs/STANDALONE-BOOTSTRAP.md`: contratto manifest e gate di pubblicazione.
- `scripts/standalone-launcher.mjs`: supervisore unico.
- `START_H3_STUDIO_STANDALONE.bat`: entrypoint utente.
- `engine/manifest.json`: manifest pubblico schema 1 con asset `core` e `torch`.

### UI e configurazione

- `app/page.tsx`: wizard embedded e stato motore.
- `app/globals.css`: indicatori stato engine.
- `.env.example`: variabili engine.
- `.gitignore`: runtime/modelli esclusi.
- `tsconfig.json`: esclusione runtime terze parti.

### Test

- `scripts/test-engine-manager.ts`.
- `scripts/test-standalone-artifact-builder.mjs`.
- `scripts/test-standalone-bootstrap.mjs`.
- `scripts/test-standalone-installer.mjs`.
- `scripts/test-standalone-launcher.mjs`.
- `scripts/verify-standalone-runtime.ts`.

## 7. Configurazione

Valori predefiniti standalone:

```dotenv
H3_ENGINE_MODE=embedded
H3_ENGINE_ROOT=./engine/runtime
H3_ENGINE_HOST=127.0.0.1
H3_ENGINE_PORT=9000
H3_BRIDGE_HOST=127.0.0.1
H3_BRIDGE_PORT=8787
```

Override disponibili:

```dotenv
H3_ENGINE_PYTHON=C:/percorso/python.exe
H3_ENGINE_COMFY_ROOT=C:/percorso/ComfyUI
H3_ENGINE_START_TIMEOUT_MS=180000
H3_COMFY_URL=http://127.0.0.1:9000
H3_COMFY_OUTPUT_DIR=F:/H3-Studio-Standalone/data/engine-output
```

Per fallback esterno:

```dotenv
H3_ENGINE_MODE=external
H3_COMFY_URL=http://127.0.0.1:9000
H3_COMFY_OUTPUT_DIR=D:/ComfyUI_NVMe/ComfyUI/output
```

## 8. Installer di sviluppo

Uso interattivo:

```bat
INSTALL_STANDALONE_ENGINE.bat
```

Uso diretto:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\INSTALL_STANDALONE_ENGINE.ps1 `
  -SourcePortableRoot D:\ComfyUI_NVMe
```

Validazione senza copiare:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\INSTALL_STANDALONE_ENGINE.ps1 `
  -SourcePortableRoot D:\ComfyUI_NVMe `
  -ValidateOnly
```

L'installer:

1. verifica `python_embeded/python.exe` e `ComfyUI/main.py`;
2. verifica i custom node richiesti;
3. prepara tutto sotto `engine/_staging/<uuid>`;
4. copia Python portable;
5. copia il core escludendo modelli, media, user data, Git e custom node;
6. copia soltanto i nodi richiesti;
7. sovrascrive con le versioni dei nodi mantenuti dal progetto;
8. riusa `extra_model_paths.yaml`, se presente;
9. valida il risultato;
10. sposta atomicamente lo staging in `engine/runtime`.

Se si usa `-Force`, un runtime precedente viene spostato sotto
`engine/_backups`. Non vengono eseguite cancellazioni ricorsive del runtime.

### Custom node importati

- ComfyUI-Fantastic-MiniMaxH3-PromptBuilder
- ComfyUI-DaSiWa-Nodes
- rgthree-comfy
- ComfyUI-KJNodes
- ComfyUI-VideoHelperSuite
- ComfyUI-MiniMax-H3-PDD-Acc
- ComfyUI-Conditioning-Rebalance
- ComfyUI-H3-FaceRefine
- ComfyUI-H3-NativeAudioLock
- Comfyui_Minimax_h3_latent_Upscaler
- ComfyUI-H3-Multishot, dalla cartella `comfyui_nodes`
- H3-Studio-Gemma4-Chat, dalla cartella `comfyui_nodes`

Questa è una procedura di sviluppo, non ancora l'installer pubblico.

## 9. Avvio e verifica manuale

Avvio normale:

```bat
START_H3_STUDIO_STANDALONE.bat
```

Endpoint utili:

```text
http://127.0.0.1:8787/api/setup/status
http://127.0.0.1:8787/api/health
http://127.0.0.1:9000/h3_studio/engine/identity
```

Log:

```text
F:\H3-Studio-Standalone\data\engine.log
```

Nel primo avvio il wizard deve:

- mostrare “Motore H3 incorporato”;
- mostrare stato pronto o errore comprensibile;
- non mostrare URL ComfyUI e cartella output in modalità embedded;
- chiedere password Admin, workflow e FFmpeg;
- suggerire `INSTALL_STANDALONE_ENGINE.bat` se il runtime manca.

## 10. Comandi di sviluppo e test

Node richiesto: **22.16 o superiore**. Sul PC corrente il runtime Node usato dai
test è:

```text
C:\Users\emanu\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
```

Comandi principali:

```powershell
npm run typecheck
npm run build
npm run test:engine
npm run test:standalone-artifact
npm run test:standalone-bootstrap
npm run test:standalone-installer
npm run test:standalone-launcher
npm run test:setup
```

Regressioni applicative verificate il 28 agosto 2026:

- project repository;
- timeline export con FFmpeg;
- creative library e Krea dry-run;
- media esterni e migrazione durata 15s;
- contratto Krea live senza queue GPU;
- Image Studio;
- Chat;
- FAST Ref2VA/FL2VA PDD e preset standard;
- varianti Face/Upscale;
- cancellazione ComfyUI scoped;
- continuation boundary;
- preview layout e handoff Assets.

Typecheck e build di produzione sono verdi dopo l'import del runtime.

## 11. Cosa non è ancora completato

### Priorità P0 — stabilizzare e importare il delta della versione ComfyUI

La versione principale `F:\H3-Studio` è avanzata dopo la separazione dello
standalone. Il riferimento sorgente corrente è `f99de40`. **Non importare ancora
il delta con un merge o un cherry-pick indiscriminato**: le funzioni recenti
devono prima superare un breve ciclo di utilizzo reale sulla versione ComfyUI.
Il runtime standalone, il packaging e la prerelease `v0.1.0-dev` devono restare
riproducibili durante il porting.

Delta funzionale da integrare successivamente, con commit sorgente di riferimento:

- Chat con conversazioni persistenti per progetto, rinomina/eliminazione e
  conservazione opzionale dei media (`e0bc2a9`, `f0f21ca`);
- stato live delle generazioni in Chat, blocco input durante il job, arresto e
  popolamento automatico della card col media prodotto (`052de3f`);
- Audio Studio locale per TTS e musica, con picker Libreria, stato di coda,
  output persistente e scaricamento dei modelli al termine (`70b2c7d`, `36b7b57`);
- planner Gemma per musica, compilatore universale dei prompt e trascrizione
  automatica del reference script TTS (`39dd0e1`, `532ee03`, `7e8b49c`);
- azioni TTS e musica native nella Chat, compresi audio di riferimento e invio
  del risultato alla Libreria/Studio (`4c5f20c`);
- rinomina persistente di immagini, video, media esterni e montaggi (`ced7c31`);
- selezione multipla ed eliminazione in blocco in Assets e Libreria, con
  rimozione dei video anche dalle timeline e gestione esplicita dei fallimenti
  parziali (`1597797`);
- normalizzazione degli alias prodotti dal planner per edit/continue/I2V/R2V e
  unload garantito anche quando il piano Chat non è valido (`7db530b`);
- handoff Chat → Studio vincolato al `jobId` della card cliccata per Video,
  Immagini e Audio, senza ripristinare l'ultimo job precedente (`c09df61`).
- controllo Admin protetto della VRAM LLM con rilevamento dei singoli PID
  `llama-server.exe`, conferma esplicita e terminazione limitata al PID scelto (`c7e601a`).
- contratto stereo end-to-end: reference audio/video normalizzati a due canali prima di MiniMax H3, output TTS/musica verificati con FFprobe e convertiti con FFmpeg solo quando necessario (`fab28eb`).
- Admin resiliente agli aggiornamenti non sincronizzati: un endpoint opzionale LLM assente nel bridge precedente non oscura più configurazione, modelli e workflow (`f767639`).
- pannelli Immagini e Audio mantenuti montati durante la navigazione: job, card, polling e annullamento restano visibili tornando nello Studio (`e2b05cb`).
- persistenza Admin del modello Anima/Nova AM resa resistente al salvataggio immediato, con conferma del modello restituito dal server e regressione su riapertura dello store (`f99de40`).
- `Mantieni proporzioni` esteso da I2V a Keyframes, Reference, Continue ed Edit: Picture 1 guida I2V/Keyframes, Video 1 guida Continue/Edit e il workflow usa il primo visual disponibile in Reference (`f99de40`).
- Libreria immagini allineata alla sorgente di Assets: Personaggi, Oggetti, Luoghi e immagini senza tag mostrano anche i job moderni, con rinomina, eliminazione multipla e invio allo Studio; etichetta Paesaggio rinominata Luogo mantenendo il valore interno `background` (`f99de40`).

#### Gate di stabilizzazione sulla versione ComfyUI

Prima del porting eseguire almeno questi test reali:

1. TTS italiano senza reference e cloning one-shot con audio caricato da disco;
2. TTS con audio scelto dalla Libreria, reference script automatico e verifica
   che il modello venga scaricato dalla VRAM prima del job successivo;
3. musica da richiesta in italiano, planner attivo, con e senza reference audio;
4. creazione TTS/musica dalla Chat, avanzamento visibile, annullamento e media
   finale riutilizzabile;
5. rigenerazione dalla Chat con prompt modificabile, senza perdere gli allegati;
6. rinomina di ogni tipo di media e persistenza dopo riavvio;
7. cancellazione multipla mista in Libreria e cancellazione multipla in Assets;
8. cancellazione di un video presente in più montaggi, verificando l'integrità
   delle timeline e l'assenza di card bloccate o progressi fantasma;
9. salvataggio di ciascun Nova AM dall'Admin, ricarica pagina e verifica del modello effettivamente usato;
10. Keep Aspect in I2V, Keyframes, Reference con immagine/video, Continue ed Edit;
11. regressione minima di Video H3, Krea, Anima, Flux Edit, Face, Upscale ed export.

Il gate è superato quando i test sono verdi, non emergono regressioni per uno o
due giorni di uso reale e `F:\H3-Studio` viene marcato con un tag stabile, nome
proposto `v0.3.0-integration-base`.

#### Ordine di porting nello standalone

1. migrazioni database, repository e API di persistenza;
2. Audio Studio e dipendenze runtime TTS/musica;
3. planner e routing Chat, mantenendo l'unload dei modelli prima dei job media;
4. UI Chat/Audio e stati di avanzamento/cancellazione;
5. rinomina e cancellazione multipla di Assets/Libreria;
6. aggiornamento manifest, allowlist custom node, SBOM, licenze e artefatti;
7. typecheck, suite completa, build e QA GPU su porte isolate.

Ogni blocco deve essere un commit autonomo e reversibile. Non copiare database,
`data`, modelli o runtime dalla versione principale.

### Priorità P0 — installer pubblico riproducibile (completata in prerelease)

L'implementazione è completata, verificata e pubblicata. Copre:

- artefatti ZIP deterministici descritti da manifest schema 1;
- pin reali di ComfyUI, custom node e Python embedded;
- inventario di 14 componenti, SBOM di 191 distribuzioni Python e notice
  generati dentro l'artefatto;
- esclusione forzata di modelli e directory dati/macchina;
- download HTTPS con resume, mirror, retry, dimensione e SHA-256;
- staging isolato, swap atomico e ripristino automatico su errore;
- backup recuperabili e rollback all'ultimo backup valido;
- log testuale e report JSON diagnostico;
- preflight di spazio, Windows, architettura, GPU e driver;
- preservazione dei model path esistenti e generazione su installazione pulita;
- prova reale build/install/start/health/stop sulla RTX 5070 Ti.

Il repository standalone dedicato, il manifest `published` e la prerelease
HTTPS immutabile `v0.1.0-dev` chiudono il P0 di pubblicazione. I due asset
ufficiali sono entrambi sotto 2 GiB e fissati per dimensione e SHA-256.

Resta un solo gate prima di promuovere la prerelease a release stabile:
validare il bootstrap pubblicato su una seconda macchina Windows/NVIDIA pulita.

### Priorità P0 — Node e FFmpeg incorporati

Il launcher cerca già un futuro `engine/tools/node/node.exe`, ma il pacchetto non
lo contiene ancora. Servono:

- runtime Node LTS fissato;
- FFmpeg fissato e con licenza/notice;
- aggiornamento del manifest;
- launcher che non dipenda dal PATH dell'utente.

### Priorità P0 — QA GPU end-to-end

Eseguire almeno un job reale per ogni percorso:

1. H3 standard 8 step T2V;
2. FAST Alibaba PDD;
3. I2V/Reference;
4. Continue con boundary memory;
5. Edit video;
6. Krea 2;
7. Flux Klein edit con reference;
8. Anima;
9. Chat testo e Vision, con unload prima del render;
10. Face;
11. Upscale 1/2 MP;
12. Face dopo Upscale;
13. timeline export con audio.

Per ogni job verificare modello selezionato, numero step, output indicizzato,
tempo, cancellazione, recovery dopo riavvio e assenza di processi residui.

### Priorità P1 — Admin engine

La API esiste, ma l'Admin deve mostrare chiaramente:

- versione engine;
- installato/in esecuzione/PID;
- start, stop e restart;
- percorso log con pulsante Apri;
- spazio disco;
- versioni componenti e update disponibili;
- distinzione embedded/external;
- diagnostica custom node e modelli.

### Priorità P1 — model library standalone

Implementare una UI che permetta:

- collegare cartelle esistenti senza copiare;
- importare con hardlink solo quando sicuro e sullo stesso volume;
- copiare esplicitamente;
- scaricare modelli selezionati con checksum;
- vedere dimensione, licenza e workflow che li richiede;
- rilevare duplicati e file mancanti.

### Priorità P1 — packaging e aggiornamenti

- Installer Windows firmabile.
- Disinstallazione non distruttiva dei dati utente.
- Separazione `app`, `engine`, `models`, `data`.
- Update app indipendente da engine e modelli.
- Canale alpha e rollback.
- Migrazione database pre-update con backup.

### Priorità P2 — rifiniture

- produzione invece di `vinext dev` nel launcher pubblico;
- splash/progresso di avvio;
- visualizzatore log integrato;
- diagnostica esportabile in ZIP senza dati personali;
- telemetria solo opt-in;
- documentazione utente illustrata.

## 12. Criteri di accettazione MVP

L'MVP standalone è pronto quando un PC Windows/NVIDIA supportato può:

1. installare l'app senza una ComfyUI preesistente;
2. avviarla da un solo collegamento;
3. completare il wizard senza conoscere ComfyUI;
4. generare almeno H3 standard, FAST, immagine ed edit;
5. arrestare tutto senza lasciare processi Python/Node;
6. riavviare e recuperare progetti/job;
7. aggiornare app/engine senza perdere `data` e modelli;
8. produrre un report diagnostico utile in caso di errore.

## 13. Licenze e distribuzione

- Codice H3 Studio: `AGPL-3.0-only`.
- ComfyUI core: `GPL-3.0-only`.
- Componenti runtime: fonti, versioni e licenze sono in
  `engine/components.lock.json`.
- Pacchetti Python: inventario generato dai `METADATA`; le due correzioni con
  evidenza sono versionate in `engine/python-package-licenses.lock.json`.
- `latent-upscaler`: `Apache-2.0`, con testo ed evidenza associata versionati in
  `third_party_licenses/latent-upscaler`; il repository GitHub del nodo non
  contiene un proprio file `LICENSE`.
- Modelli: esclusi dall'artefatto e condivisi tramite `extra_model_paths.yaml`;
  non assumere che siano redistribuibili.

Il builder genera SBOM e `THIRD_PARTY_NOTICES.txt` e rifiuta una release se una
licenza è irrisolta. La validazione corrente restituisce zero voci irrisolte;
la dichiarazione Apache associata non sostituisce una revisione legale. Questo
documento non è un parere legale.

## 14. Rischi noti

- Aggiornamenti ComfyUI possono rompere i custom node o i workflow fissati.
- Copiare tutto `custom_nodes` renderebbe la distribuzione enorme e fragile;
  mantenere una allowlist minima.
- Il runtime portable corrente contiene pacchetti più recenti di alcuni
  requirements raccomandati; non aggiornare alla cieca dopo che i test passano.
- I model path attuali sono specifici del PC di sviluppo; il pacchetto pubblico
  deve generarli dal wizard.
- Il primo caricamento engine può richiedere più tempo del timeout su macchine
  lente; mostrare progresso reale.
- Antivirus e SmartScreen possono rallentare o bloccare eseguibili non firmati.
- L'esposizione LAN/Tailscale richiede autenticazione anche sulle API utente,
  non soltanto nell'Admin.
- Non terminare processi esterni basandosi soltanto sulla porta.

## 15. Metodo di lavoro consigliato

Per ogni modifica:

1. lavorare solo in `F:\H3-Studio-Standalone`;
2. controllare `git status` prima e dopo;
3. non aggiungere `engine/runtime`, `models` o `data` a Git;
4. usare modifiche piccole e testabili;
5. eseguire typecheck e test mirati;
6. eseguire una build prima del checkpoint;
7. effettuare test reali su porte isolate;
8. chiudere i processi di prova;
9. creare commit locali coerenti;
10. non configurare/pushare un remote pubblico senza richiesta esplicita.

## 16. Prompt pronto per una nuova chat

Copia integralmente il testo seguente nella nuova chat:

```text
Riprendi lo sviluppo di H3 Studio Standalone.

Lavora esclusivamente in F:\H3-Studio-Standalone e non modificare
F:\H3-Studio. Leggi per intero prima di agire:
F:\H3-Studio-Standalone\docs\STANDALONE-HANDOFF.md

La variante standalone è sul branch standalone-engine. Il checkpoint iniziale
è a85f1fb; il bootstrap riproducibile e il builder artefatti sono implementati
nel checkpoint 9f9f5fb; il gate licenze è chiuso in 4063be5; lo split per
GitHub Release è in 5b6a66c e la prerelease pubblicata è 1ac9396. La versione
ComfyUI è avanzata fino a f99de40: leggi la coda di integrazione nella sezione 11
e non importarla prima che superi il gate di stabilizzazione e riceva il tag
`v0.3.0-integration-base`. Il remote origin punta al repository standalone
dedicato. Il remote source-snapshot può leggere F:\H3-Studio ma ha il push
DISABLED: non riattivarlo e non usarlo mai per pubblicare.

Il runtime embedded è già installato localmente in engine/runtime, è ignorato
da Git e ha superato il test reale di start/health/stop sulla RTX 5070 Ti. Il
ciclo build/install/start/health/stop dell'artefatto è stato verificato. I
modelli sono condivisi tramite extra_model_paths.yaml e non vanno duplicati.

Il bootstrap è pubblicato con manifest versionato e due asset verificati nella
prerelease v0.1.0-dev. Prima della promozione stabile resta la prova su una
seconda macchina Windows/NVIDIA pulita. La prima attività P0 implementabile in
locale è incorporare e fissare Node e FFmpeg, con inventario licenze e launcher
indipendente dal PATH. Mantieni funzionante il fallback external e non rompere
i workflow/app esistenti. Prima di modificare, verifica git status, branch,
commit, spazio disco e stato delle porte. Dopo ogni blocco esegui typecheck,
test mirati e build; crea commit locali coerenti e pubblica solo su `origin`
quando espressamente autorizzato.
```

## 17. Riferimenti interni

- `docs/STANDALONE-ENGINE-PLAN.md`: piano sintetico del motore.
- `docs/ARCHITECTURE.md`: architettura applicativa generale.
- `docs/PROJECT-PLAN.md`: requisiti e roadmap del prodotto originale.
- `docs/INSTALLATION.md`: installazione della variante con ComfyUI esterna.
- `docs/CHAT.md`: runtime Gemma Vision e routing azioni.
- `docs/IMAGE-STUDIO.md`: Krea, Flux Klein e Anima.
- `docs/GENERATION-MODES.md`: modalità video e mapping workflow.
- `docs/WORKLOG.md`: cronologia della versione principale.

In caso di divergenza, questo documento descrive lo stato della variante
standalone al 28 agosto 2026; i test e il codice hanno comunque precedenza.
