# Chat locale

La voce **Chat** usa Gemma 4 Vision come assistente locale del progetto attivo.
La cronologia non viene condivisa con altri progetti e rimane in SQLite dopo il
riavvio di H3 Studio.

## Uso

- Scrivi normalmente per discutere un'idea, migliorare un prompt o chiedere
  consigli; nessun job parte se non chiedi esplicitamente di creare o modificare
  un media.
- Premi `+` oppure digita `@` alla fine del testo per aprire la Libreria. Le
  miniature mostrano immagini, video e media Esterni riutilizzabili.
- Con immagini allegate puoi chiedere un'analisi, un edit Flux.2 Klein, un I2V
  o un Reference H3. Gemma può osservare fino a quattro immagini per messaggio;
  il router accetta fino a otto media complessivi per un'azione.
- Chiedendo un'immagine anime viene usato Anima; una normale immagine usa Krea.
- Una richiesta esplicita di video usa 10 secondi, un candidato, 0,5 MP e FAST
  8-step. Per cambiare questi parametri apri poi il job nello Studio.

Le azioni compaiono come schede nella conversazione con il pulsante **Apri nello
Studio**. I prompt di produzione sono generati in inglese, mentre la risposta
dell'assistente resta in italiano.

## Runtime e memoria

Il nodo incluso non avvia LM Studio. Usa soltanto un `llama-server` compatibile
con Gemma 4 Vision e MTMD:

1. prima cerca `H3_CHAT_LLAMA_SERVER`;
2. poi `runtime/llama-server(.exe)` nella cartella del nodo;
3. poi il `PATH`;
4. infine i backend locali di LM Studio, scegliendo il CUDA 12 più recente.

Il modello e il `mmproj` si scelgono nell'Admin e devono appartenere alla stessa
famiglia. Il server ascolta soltanto su `127.0.0.1` e su una porta casuale. Resta
in memoria fra messaggi consecutivi per rendere la conversazione veloce, quindi
viene terminato automaticamente prima di Video, Image, Face o Upscale.

## Diagnostica

In Admin, **Gemma 4 Vision Chat** mostra `PRONTO`, `CARICATO` oppure `SETUP`.
`SETUP` indica che manca il nodo, il runtime, il GGUF o il projector. Dopo aver
installato/aggiornato il nodo occorre riavviare ComfyUI; non serve avviare LM
Studio. Il test di contratto del repository è `npm run test:chat`.
