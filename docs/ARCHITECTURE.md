# Architettura H3 Studio

```text
┌──────────────────────────────────────────────────────────┐
│ H3 Studio Web                                            │
│ Projects · Composer · Candidates · Timeline · Admin      │
└────────────────────────────┬─────────────────────────────┘
                             │ HTTP + WebSocket autenticati
┌────────────────────────────▼─────────────────────────────┐
│ H3 Studio Bridge — Node.js / Fastify                     │
│ AuthZ · Credits · Queue · Workflow Mapper · Media Index  │
└───────────────┬───────────────────────────┬──────────────┘
                │                           │
        HTTP / WebSocket                    │ SQLite + filesystem
                │                           │
┌───────────────▼──────────────┐   ┌────────▼──────────────┐
│ ComfyUI :9000               │   │ H3 Studio Data        │
│ Studio Backend workflow     │   │ projects/assets/meta  │
└─────────────────────────────┘   └───────────────────────┘
```

## Confini

- Il browser non modifica direttamente JSON ComfyUI.
- Il bridge ascolta su loopback per impostazione predefinita.
- ComfyUI non viene esposto pubblicamente.
- SQLite conserva dati strutturati; il filesystem conserva i media.
- Firebase è un'estensione opzionale, non il server di rendering.

## Flusso candidato

1. Il client richiede un preventivo crediti.
2. Il bridge valida utente, saldo, asset e parametri.
3. Crea Candidate e riserva il costo nel ledger.
4. Applica gli override a una copia del prompt API.
5. Accoda i candidati in ordine.
6. Registra `prompt_id` e progressi WebSocket.
7. Indicizza video, thumbnail e snapshot.
8. Regola l'addebito e rimborsa l'eventuale residuo.

## Flusso Continue

`Continue` crea uno Shot figlio, assegna il candidato scelto a VIDEO EXTENSION, eredita gli asset desiderati e genera altri 5 o 10 secondi. Non è un upscale.

## Flusso Edit

`Edit` usa il video scelto come sorgente VIDEO EDITING, massimo 10 secondi, e conserva l'originale come genitore immutabile.

## Clip e montaggio

I media generati sono oggetti immutabili. Una Sequence non contiene un MP4 progressivamente riscritto: contiene riferimenti ordinati ai Candidate selezionati e istruzioni di montaggio. Il player passa da un clip al successivo e applica in/out e transizioni in tempo reale. FFmpeg interviene soltanto durante l'esportazione o per normalizzare clip incompatibili.

La continuazione usa internamente il tail del genitore come conditioning. Il risultato pubblico dello shot contiene solo i nuovi 5 o 10 secondi; source+continuation e frame di overlap, se prodotti dal workflow, restano artefatti tecnici non inseriti due volte in timeline.

## Crediti

Il saldo visualizzato è una vista derivata dalle transazioni immutabili. Reserve e settle devono avvenire in transazioni atomiche per impedire doppia spesa quando arrivano richieste simultanee.

Indici SQLite iniziali saranno creati soltanto per query reali: job per stato/utente, candidati per shot, transazioni per utente/data e utenti per stato/email.

## Deployment futuro

Il frontend può essere ospitato; il bridge rimane sul PC con la GPU. L'interfaccia ospitata si associa al bridge senza aprire la porta 9000. I video restano locali salvo upload esplicito.

## Bootstrap e distribuzione

Al primo avvio il bridge non possiede credenziali. Il wizard locale crea la
password Admin, salva soltanto derivazione scrypt e sessioni hashate, quindi
registra URL ComfyUI, output, FFmpeg e profili workflow in `data/`. Tutte le
rotte `/api/admin/*` sono protette server-side.

I workflow versionati sono snapshot sanitizzati: nessun media, prompt personale
o LoRA dell'autore viene distribuito. Il bridge sostituisce a runtime modello,
step e fino a tre LoRA usando la configurazione Admin.

Il custom node H3 Studio è incluso in `comfyui_nodes/` perché alcune classi
sono estensioni locali non presenti nell'upstream. L'installer crea un backup
dell'eventuale nodo esistente, applica lo snapshot e clona i repository esterni.
I pesi restano fuori da Git e sono verificati tramite gli endpoint
`/models/<folder>` della ComfyUI collegata.
