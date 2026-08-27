# Installazione portabile

H3 Studio è progettato per essere clonato senza modificare il codice o i file
workflow. Stato locale, password, database, log e media non vengono versionati.

## Requisiti

- Windows 10/11.
- Node.js 22 o superiore.
- ComfyUI già funzionante e raggiungibile via HTTP.
- FFmpeg nel `PATH` oppure il suo percorso configurato nell'Admin.
- I modelli MiniMax H3, Krea e Flux.2 Klein scelti dall’Admin nelle cartelle ComfyUI corrette.

## Avvio

```powershell
git clone <URL-DEL-REPOSITORY>
cd H3-Studio
.\INSTALL_COMFY_DEPENDENCIES.bat
.\START_H3_STUDIO.bat
```

Il primo BAT chiede la cartella `ComfyUI`, installa il nodo H3 Studio incluso e
clona i custom node esterni mancanti. Se trova già `ComfyUI-H3-Multishot`,
crea prima un archivio recuperabile in
`custom_nodes/_h3_studio_backups/`. Non sovrascrive né scarica i pesi.

Per installare anche i `requirements.txt` con il Python della portable:

```powershell
.\scripts\INSTALL_COMFY_DEPENDENCIES.ps1 -ComfyRoot "D:\ComfyUI\ComfyUI" -InstallPythonRequirements
```

La modalità predefinita è conservativa: per i requisiti Python si può usare
anche ComfyUI Manager. Il secondo launcher esegue `npm install` soltanto se le
dipendenze web non sono presenti, poi apre `http://localhost:3000`.

## Primo avvio

Il browser mostra un wizard che richiede:

1. una nuova password Admin di almeno 10 caratteri;
2. l'URL della ComfyUI, per esempio `http://127.0.0.1:8188`;
3. la cartella `output` della stessa installazione ComfyUI;
4. i workflow associati ai ruoli Video, FAST, Krea e Flux Klein Edit;
5. il comando o percorso di FFmpeg.

La password viene derivata con `scrypt`; nel database non viene salvata in
chiaro. Dopo il wizard è necessario riavviare una volta H3 Studio. Lo Studio
resta utilizzabile senza login, mentre l'area Admin richiede una sessione locale
HTTP-only della durata di 12 ore.

## Workflow inclusi

- `workflows/studio-backend.ui.json`: AIO H3 da aprire in ComfyUI.
- `workflows/studio-backend.api.json`: snapshot API usato dal bridge.
- `workflows/studio-fast-pdd.api.json`: profilo FAST Alibaba PDD-Acc.
- `workflows/studio-krea2.api.json`: generazione immagini Krea 2.
- `workflows/studio-flux2-klein-edit.api.json`: edit Flux.2 Klein 4B Distilled con una-quattro reference.
- `workflows/catalog.json`: ruoli e associazioni disponibili.
- `workflows/dependencies.json`: nodi e modelli richiesti.

L'Admin interroga la ComfyUI collegata e mostra quali dipendenze risultano
presenti, includendo cartella e nome dei pesi mancanti. I pesi dei modelli non
sono inclusi nel repository.

Il pacchetto esteso `comfyui_nodes/ComfyUI-H3-Multishot` è necessario: il
repository H3 Multishot originale da solo non contiene autoprompter AIO, motion
memory e router Studio. Provenienza e commit base sono documentati nel file
`H3-STUDIO-NOTICE.md` della cartella.

## Dati esclusi da Git

Tutto ciò che si trova in `data/`, salvo `.gitkeep`, rimane sul computer:
database, password derivata, sessioni, configurazione dell'installazione,
progetti, log ed esportazioni. Anche `.env` è escluso.

## Configurazione avanzata

Copiare `.env.example` in `.env` è opzionale. Le variabili servono per porte,
origine web o percorsi iniziali; dopo il setup, i parametri gestiti dall'Admin
sono salvati in `data/install-settings.json`.

Completare il primo avvio da localhost. Solo dopo, per Tailscale impostare
`H3_ENABLE_TAILSCALE=1` prima di lanciare il file BAT.
Prima di esporre l'app a utenti non fidati va aggiunta autenticazione anche alle
API di generazione: la password attuale protegge intenzionalmente la sola area
Admin.
