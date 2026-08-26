# H3 Studio — report di collaudo autonomo

Data: 26 agosto 2026  
Ambiente: frontend `localhost:3000`, bridge `127.0.0.1:8787`, ComfyUI `127.0.0.1:9000`

## Esito

Il percorso principale è operativo end-to-end: libreria creativa Krea 2 → character sheet → inserimento automatico come reference → render H3 R2V → persistenza SQLite → output video → export timeline.

## Controlli superati

- Frontend HTTP 200; bridge online; ComfyUI connessa; workflow backend pronto con 23 nodi e nessuna classe mancante.
- Build Vinext completata con il runtime Node 24 richiesto dal progetto.
- ESLint completato senza errori.
- Test repository progetti: OK.
- Test libreria creativa e Krea 2 dry-run: OK.
- Test contratto nodi Krea 2 live, senza invio GPU: OK.
- Test export timeline con FFmpeg: OK; MP4 da 857.101 byte.
- Validazioni API: 6/6. T2V valido accettato; I2V/R2V/Continue senza media, seed negativo e nome progetto vuoto rifiutati correttamente.
- Dry-run completati per I2V, R2V, Keyframes, Video Extension e Video Editing.
- Strategie seed verificate: Fixed mantiene lo stesso seed, Base incrementa di uno, Random produce valori distinti.
- Persistenza verificata dopo riavvio del solo bridge: job, candidato, output, asset Krea e reference sono rimasti disponibili.

## Prova GPU reale Krea 2

- Asset: `TEST Elara Krea 2`
- Asset ID: `d99422f1-918e-4e55-8130-f0fd9c5b306f`
- Seed: `26082601`
- Output: `1536×1024`, RGB24.
- Tempo osservato: circa 99 secondi.
- Esito visivo: identità, capelli, occhi e outfit coerenti tra frontale, tre-quarti, profilo e close-up; sfondo pulito, nessun testo o persona extra. Scostamento minore: il profilo è tagliato circa a metà corpo invece di essere interamente full-body.

## Prova GPU reale H3 Reference

- Job ID: `b42bacd2-e68b-49ed-8ada-71d055e55b2d`
- Modello: `minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors`
- LoRA: `minimax_h3_turbo_v4_step600_ema_pruned_comfyui.safetensors`, strength 1.
- Impostazioni: 8 step, 5 s, 0,5 MP, 16:9, seed fisso `26082602`.
- Tempo osservato: circa 213 secondi, caricamento incluso.
- Output tecnico: H.264 960×544 a 24 fps, AAC, durata 5,167 s, 918.089 byte.
- Esito visivo sui quattro fotogrammi campionati: volto, capelli e giacca rimangono coerenti; camminata e tracking seguono il prompt; transizione naturale da campo medio a primo piano; nessun artefatto anatomico evidente nei campioni.

## Difetto trovato e corretto

Un candidato già `ready` restava etichettato come `Inviato a ComfyUI` quando il tracker WebSocket non aveva ricevuto l'evento terminale. Il bridge ora dà precedenza allo stato terminale ricavato dalla history di ComfyUI: `completed`, `Completato`, 100% esatto. La correzione è stata verificata anche dopo il riavvio del bridge.

## Limite del collaudo

Il test interattivo desktop/mobile nell'istanza Browser di Codex non è stato completabile perché il runtime del browser in-app è andato in crash all'avvio. L'app è comunque risultata raggiungibile via HTTP e le API, la build, i flussi reali GPU e la persistenza sono stati verificati. Resta consigliato un rapido controllo manuale delle viewport nel browser dell'utente.

## Artefatti diagnostici

- `data/test-artifacts/krea_sheet_test_elara.png`
- `data/test-artifacts/krea_sheet_test_elara_preview.jpg`
- `data/test-artifacts/r2v_elara_contact.jpg`

