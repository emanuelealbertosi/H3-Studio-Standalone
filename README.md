# H3 Studio

H3 Studio è un client web local-first per orchestrare ComfyUI e i workflow MiniMax H3 senza gestire direttamente grafi complessi.

Copyright (C) 2026 Emanuele. Il codice originale H3 Studio è distribuito con
licenza **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`): le
versioni modificate distribuite o offerte tramite rete devono rendere disponibile
il relativo codice sorgente. I componenti di terze parti conservano le proprie
licenze e attribuzioni, incluso il nodo H3 Multishot derivato dall'upstream MIT.
Vedi [LICENSE](LICENSE) e le note nelle rispettive cartelle.

Il prodotto organizza prompt, personaggi, asset, candidati e continuazioni. ComfyUI rimane il motore di rendering; H3 Studio gestisce progetti, coda, confronto, crediti e riproducibilità.

## Stato

Fase attuale: **Milestone 4 — montaggio locale, Continue/Edit e workflow multimodali**.

La UI è disponibile localmente con `npm run dev` usando Node 22 o superiore. Il workflow ComfyUI stabile non viene modificato: il bridge usa una copia UI e un export API dedicati nella cartella `workflows`.

I job sono persistiti in `data/h3-studio.sqlite`. I video restano negli output di ComfyUI; il database conserva metadati, promptId, seed, impostazioni e snapshot del workflow API.

La sezione **Progetti** mostra la cronologia locale e permette di riaprire un job nello Studio. Anche il candidato scelto viene salvato in SQLite e ripristinato dopo il riavvio del bridge.

La stessa sezione include ora progetti e timeline non distruttive: le clip possono
essere riordinate, copiate o spostate fra progetti e riprodotte come montaggio
virtuale. Il composer supporta il mapping dei sei modi H3 e conserva asset,
keyframe e ruoli Reference; nessun render parte senza il pulsante Genera. La
timeline può essere esportata in un MP4 unico con FFmpeg: prima tenta il concat
senza ricodifica e, se i segmenti non sono compatibili, usa una ricodifica H.264/AAC.

I controlli creativi Camera, Obiettivo ed Effetti aggiungono direttive leggibili
al prompt senza nascondere o sostituire il testo dell’utente.

Lo Studio espone cinque preset: **FAST / 8 / 12 / 20 / 30**. FAST è un motore
separato basato su Alibaba PDD-Acc a 8 NFE, con modello Ref2VA o FL2VA dedicato
**non-pruned** (il default è `minimax_h3_ref2va_int8_convrot.safetensors`),
sigmas PDD, Euler e shift 12/3. I quattro preset numerici usano invece il
workflow H3 standard senza forzare il motore FAST. Modello, file PDD e fino a
tre LoRA creativi del FAST si configurano nell'Admin separatamente dallo stack
H3 standard.

Il tab **Personaggi/Libreria** gestisce ora personaggi e oggetti persistenti,
reference multiple tramite drag-and-drop e character/object sheet con Krea 2.
Il pulsante **Usa nel video** trasferisce le immagini alla modalità H3 Reference
e compila automaticamente i ruoli Picture.

Lo **Studio Immagini** condivide progetti e layout con lo Studio Video. Genera
da uno a quattro candidati con Krea 2 oppure esegue edit Flux.2 Klein con un
massimo di quattro reference ordinate. Ogni candidato può essere taggato come
Personaggio, Oggetto o Sfondo, riusato come reference e condiviso
singolarmente con altri progetti. Il profilo Flux predefinito è il 4B
Distilled FP8 a quattro step e CFG 1; workflow, modello, encoder, VAE, cache e
attention backend sono gestiti dall’Admin.

Ogni candidato completato espone derivati non distruttivi **Face**, **Upscale
1 MP** e **Upscale 2 MP**. I target compaiono soltanto quando superano la
risoluzione della sorgente: un originale da 0,98 MP propone quindi solo 2 MP.
L'upscale rigenera lo stesso seed con il Latent Upscaler 3D verso 0,98 o 1,96
MP; non è un semplice resize del file MP4. Selezionando un Upscale pronto e
premendo Face si ottiene una vera catena **Upscale → Face**, senza rieseguire
l'upscale e conservando l'audio della variante scelta. L'originale rimane
sempre disponibile; la versione attiva può essere usata per Continue/Edit
oppure assegnata alla singola clip della timeline. Lineage, target e stato del
post-process sono persistiti nel database e recuperati dopo il riavvio del
bridge.

Durante generazione, Face o Upscale, il pulsante **Interrompi** elimina dalla
coda i prompt del job e ferma il prompt attivo soltanto se non risultano altri
run ComfyUI estranei in esecuzione.

L'Admin include **Riavvia server**: riavvia soltanto il bridge H3, mantiene
ComfyUI e i suoi job attivi e ricarica automaticamente l'interfaccia quando il
collegamento torna disponibile.

Dopo l'installazione o un aggiornamento dei nodi Face/Upscale è necessario
riavviare ComfyUI. Il bridge esegue un preflight e non accoda un render costoso
se il processo attivo espone ancora la vecchia definizione dei nodi.

I video completati possono essere eliminati dal cestino presente sia sulla
scheda candidato sia nella Libreria media. L'operazione chiede conferma, rimuove
la sorgente da tutti i montaggi, elimina le varianti derivate e cancella i file
video corrispondenti dall'output ComfyUI.

## Documentazione

- `docs/PROJECT-PLAN.md`: specifica e tracking principale.
- `docs/ARCHITECTURE.md`: componenti e flussi tecnici.
- `docs/GENERATION-MODES.md`: mapping verificato di T2V, I2V, Reference, Keyframes, Continue ed Edit.
- `docs/CREATIVE-LIBRARY.md`: personaggi, oggetti, reference e sheet Krea 2.
- `docs/IMAGE-STUDIO.md`: generazione, edit Flux Klein, reference e condivisione immagini fra progetti.
- `docs/INSTALLATION.md`: clone, primo avvio, sicurezza e dipendenze ComfyUI.
- `docs/GITHUB-RELEASE.md`: sanitizzazione, CI e checklist di pubblicazione.
- `docs/WORKLOG.md`: cronologia sintetica del lavoro.

Test locali principali: `npm run test:projects`, `npm run test:export`,
`npm run test:library`, `npm run test:krea-contract` e `npm run test:fast`.
Il bootstrap e l'autenticazione locale si verificano con `npm run test:setup`.
Il contratto completo Image Studio si verifica con `npm run test:images`.

## Avvio rapido

1. Installa Node.js 22 o superiore e prepara una ComfyUI funzionante.
2. Clona il repository ed esegui una volta `INSTALL_COMFY_DEPENDENCIES.bat`.
3. Avvia `START_H3_STUDIO.bat`.
4. Al primo avvio crea la password Admin e configura URL, cartella output e workflow.
5. Riavvia una volta H3 Studio e apri `http://localhost:3000`.

Il launcher installa automaticamente le dipendenze npm quando mancano e avvia
bridge e interfaccia in due console separate. I workflow pronti, il manifest
delle dipendenze e il nodo H3 Studio esteso sono inclusi; modelli e media
rimangono esterni al repository.

L'accesso Admin è protetto dalla password creata nel wizard. Prima di esporre
l'app direttamente a Internet va aggiunta autenticazione anche alle API utente;
la configurazione attuale è pensata per localhost, LAN fidata o Tailscale.
