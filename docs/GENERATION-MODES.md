# Modalità di generazione H3 Studio

Questo documento descrive il mapping verificato tra H3 Studio e il workflow
`FINAL-MiniMax H3 AIO AUTOPROMPT ULTRA - OFFICIAL SKILL EXPERIMENT`.

## Mapping

| Modalità Studio | Valore workflow | Asset minimi | Routing |
|---|---|---|---|
| Text to video | `T2V` | Nessuno | Il Media Loader viene svuotato intenzionalmente. |
| Image to video | `I2V` | Picture 1 | Picture 1 diventa il frame iniziale. |
| Reference | `R2V` | Almeno un'immagine, video o audio | Gli asset seguono l'ordine del Media Loader e i ruoli dichiarati. |
| Keyframes | `KEYFRAMES` | Almeno Picture 1 | Picture 1..N diventano anchor sulla timeline globale; posizioni `AUTO` o percentuali esplicite. |
| Continue video | `VIDEO EXTENSION` | Video 1, massimo 10 secondi nello Studio | Il router continua dall'ultimo frame decodificato. |
| Edit video | `VIDEO EDITING` | Video 1, massimo 10 secondi nello Studio | Video 1 è la sorgente diretta; il numero di clip interne viene determinato automaticamente. |

## Invarianti dello Studio

- Ogni candidato e ogni continuazione restano file video autonomi.
- `H3SaveContinuation.prepend_source_video` è sempre `false`.
- Continue salva esclusivamente il nuovo segmento, senza duplicare il video sorgente.
- Il montaggio concatena virtualmente le clip durante il playback; non modifica i file originali.
- Copy e Move fra progetti cambiano soltanto i riferimenti della timeline.
- Prompt, asset, ruoli, keyframe, seed e impostazioni FAST sono persistiti con il job.
- Gli upload usano la route ufficiale `/minimax_h3/upload` del Media Loader installato.

## Media state

Il bridge conserva il JSON ordinato del Media Loader. Ogni asset include almeno:

- `kind`: `picture`, `video` o `audio`;
- `file`: percorso annotato ComfyUI `[input]`, `[output]` o `[temp]`;
- `name` e `uid`;
- per i video, quando disponibile, durata, dimensioni, presenza audio e routing audio.

Il bridge rifiuta percorsi assoluti, traversal `..`, tipi sconosciuti e asset oltre
i limiti reali H3: 9 immagini, 3 video e 3 audio.

## Verifica senza GPU

La route `POST /api/jobs/dry-run` costruisce il prompt API completo senza
accodarlo. I sei modi sono verificati con asset reali già presenti in ComfyUI;
il dry-run espone anche `mediaAssetCount`, seed candidati e
`continuationOnly`.
