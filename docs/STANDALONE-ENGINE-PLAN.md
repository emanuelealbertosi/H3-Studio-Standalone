# H3 Studio Standalone — piano motore incorporato

## Obiettivo

Distribuire H3 Studio come unica applicazione visibile. Il motore grafico viene
installato, avviato, verificato, aggiornato e arrestato dall'applicazione; non è
necessario aprire o configurare l'interfaccia ComfyUI.

Il repository originale `F:\H3-Studio` resta intatto. Lo sviluppo standalone
avviene in `F:\H3-Studio-Standalone`, branch `standalone-engine`, con push verso
il repository sorgente disabilitato.

## Strategia

La prima release incorpora una distribuzione ridotta e fissata del motore
ComfyUI. Non è un semplice collegamento a un'installazione dell'utente: runtime
Python, core, nodi e configurazione appartengono al pacchetto H3 Studio. Questa
scelta mantiene subito compatibilità con H3, Krea, Flux, Anima, Face e Upscale.

Il bridge parla con il motore soltanto su loopback. `EngineManager` ne controlla
processo, health check e directory dati. La modalità `external` rimane come
fallback per sviluppo, confronto e recupero.

## Layout previsto

```text
H3-Studio-Standalone/
  engine/runtime/          # Python + core, non versionati nel repository
  engine/manifest.json     # componenti e versioni fissate
  models/                  # libreria modelli condivisa/configurabile
  data/engine-input/
  data/engine-output/
  data/engine.log
```

## Milestone

1. **Process manager** — discovery, start/stop, health, log e ownership sicura.
2. **Bootstrap** — scaricamento con checksum, installazione atomica e rollback.
3. **Launcher unico** — avvio motore, bridge e web; chiusura coordinata.
4. **Wizard semplificato** — nessun URL Comfy richiesto in modalità embedded e
   possibilità di completare l'installazione con zero modelli.
5. **Model library** — importazione senza copia e catalogo Admin con download
   selettivo, URL suggeriti visibili/modificabili e checksum.
6. **Convalida funzionale** — Video standard/FAST, immagini, edit, Anima, Chat,
   Face, Upscale, Continue e timeline export.
7. **Packaging** — installer Windows, disinstallazione non distruttiva e update.

## Tempi stimati

- MVP locale: 7–12 giorni di lavoro.
- Alpha clonabile/installabile: 2–3 settimane.
- Distribuzione pubblica robusta: 4–6 settimane.

## Invarianti

- Nessuna modifica automatica a installazioni Comfy esterne.
- Nessun modello duplicato senza scelta esplicita dell'utente.
- Nessun peso scaricato automaticamente dal bootstrap, dal wizard o dagli update.
- Il processo manager termina soltanto processi che ha avviato.
- Runtime e modelli non entrano nel repository Git.
- Ogni componente distribuito conserva licenza, sorgente e attribuzione.
