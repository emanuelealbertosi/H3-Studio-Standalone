# Libreria Personaggi e Oggetti

## Scopo

La libreria conserva identità visive riutilizzabili indipendentemente dai singoli
progetti video. Ogni record può essere un `character` oppure un `object` e mantiene:

- nome, descrizione identitaria e prompt Krea 2;
- fino a 12 immagini reference ordinate;
- ruoli semantici (`primary`, `face`, `full_body`, `side`, `back`, `detail` e altri);
- cronologia delle generazioni Krea 2 con seed, promptId, stato e output;
- collegamento diretto alla modalità Reference dello Studio video.

I metadati sono persistiti in `data/h3-studio.sqlite`; i file rimangono nella
directory input/output di ComfyUI e sono serviti dal bridge senza duplicarli.

## Uso

1. Aprire **Assets** oppure **Libreria** dalla barra laterale.
2. Creare un record scegliendo Personaggio o Oggetto.
3. Compilare i dettagli invarianti: volto, capelli, corporatura e abito per un
   personaggio; forma, materiali, colori e proporzioni per un oggetto.
4. Trascinare le immagini disponibili nella dropzone. La prima diventa
   `primary`, le successive ricevono ruoli progressivi modificabili nel database.
5. Premere **Verifica** per preparare il prompt API senza avviare la GPU.
6. Premere **Genera con Krea 2** soltanto quando si vuole realmente accodare la
   character/object sheet.
7. Premere **Usa nel video**: tutte le reference vengono caricate nella modalità
   H3 Reference e `reference_roles` viene compilato automaticamente.

## Backend Krea 2

Il builder usa i componenti già installati nella ComfyUI NVMe:

- `krea2TurboFP8_krea2TURBO.safetensors`;
- `qwen3vl_4b_fp8_scaled.safetensors` in modalità `krea2`;
- `qwen_image_vae.safetensors`;
- Conditioning Krea2 Rebalance a 3.0;
- 1536×1024, 8 step, CFG 1, `er_sde` + `simple`;
- RCAS 0.55 e salvataggio PNG.

Il grafo API è intenzionalmente più piccolo del workflow UI originale: elimina
gruppi, switch, subgraph e rami I2I non necessari alla creazione della sheet.
Questo riduce i punti di rottura senza modificare `KREA2_ULTRA_WORKFLOW.json`.

## Semantica delle sheet

Il prompt forza quattro viste coerenti dello stesso soggetto: frontale,
tre-quarti, profilo e dettaglio. L'output composito viene aggiunto come reference
principale. Le fotografie importate rimangono immagini separate e quindi possono
fornire a H3 più informazioni del solo foglio composito.

Continue/Edit e i video esistenti non vengono modificati. La libreria prepara
soltanto le immagini Reference che il generatore video riceverà al run successivo.
