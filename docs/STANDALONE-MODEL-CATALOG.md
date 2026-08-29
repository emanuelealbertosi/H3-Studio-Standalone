# Catalogo modelli standalone

## Requisito di installazione

L'installazione standalone deve completarsi senza scaricare alcun peso. Runtime,
custom node e modelli sono componenti separati: il bootstrap installa soltanto il
runtime e non può accodare automaticamente download di checkpoint, LoRA, encoder,
VAE, LLM, projector o modelli di post-processing.

Al primo avvio l'utente può scegliere una delle tre strade, senza che una sia
obbligatoria:

1. **Continua senza modelli** — apre H3 Studio e rimanda ogni scelta all'Admin;
2. **Collega una libreria esistente** — registra uno o più model root tramite
   `extra_model_paths.yaml`, senza copiare i file;
3. **Scegli cosa scaricare** — apre il catalogo Admin con tutti gli elementi
   inizialmente deselezionati.

La scelta predefinita è **Continua senza modelli**. Chi installa il solo runtime
deve poter usare Admin, diagnostica e importazione anche se nessun workflow è
ancora pronto.

Il pulsante **Salta per ora** deve restare disponibile anche quando il catalogo
propone modelli raccomandati o rileva dipendenze mancanti. Nessun avviso di
workflow incompleto può trasformare il download in un passaggio obbligatorio.

## Catalogo nell'Admin

La sezione **Admin → Modelli** deve mostrare per ogni voce:

- nome e famiglia del modello;
- workflow o funzione che lo richiede;
- obbligatorio, alternativo oppure opzionale;
- cartella e nome file di destinazione;
- dimensione prevista e spazio libero;
- licenza, pagina sorgente e note hardware;
- stato `Assente`, `Collegato`, `Download`, `Verifica`, `Pronto` o `Errore`;
- URL suggerito in un campo visibile e modificabile;
- checksum SHA-256 del file raccomandato, quando pubblicato dall'autore;
- azioni **Scarica**, **Interrompi**, **Riprendi**, **Riprova** e **Apri cartella**.

Gli URL raccomandati appartengono al catalogo versionato del progetto. Una
modifica fatta dall'utente è salvata soltanto in `data` e non riscrive il
catalogo Git. Deve essere sempre possibile ripristinare l'URL suggerito.

## Regole del downloader

- Nessun download parte al caricamento della pagina, durante il bootstrap o dopo
  un aggiornamento.
- **Scarica** apre una conferma con URL, destinazione, dimensione, licenza e
  spazio residuo previsto.
- Il backend accetta HTTPS; un URL personalizzato senza checksum richiede una
  conferma aggiuntiva e il file resta marcato `Non verificato`.
- Il download usa un file `.partial`, supporta resume e retry e diventa visibile
  al motore soltanto dopo controllo di dimensione/checksum e rename atomico.
- Nome file e cartella provengono da campi separati: l'URL non può decidere il
  percorso locale né uscire dai model root configurati.
- Token e query sensibili non vengono scritti nei log. Gli URL autenticati sono
  dati locali e non entrano in export diagnostici o repository.
- L'Admin può eliminare soltanto file scaricati e registrati da H3 Studio, dopo
  conferma. I file collegati o importati dall'utente non vengono mai cancellati
  automaticamente.
- Aggiornare app o runtime non modifica, riscarica o elimina i modelli.

## Contratto dati previsto

Il catalogo raccomandato sarà un manifest versionato separato dal manifest del
runtime, per esempio `engine/model-catalog.json`. Ogni elemento deve avere almeno
`id`, `label`, `family`, `requiredFor`, `folder`, `fileName`, `sizeBytes`,
`license`, `sourceUrl`, `suggestedUrls` e, quando disponibile, `sha256`.

Override URL, destinazioni scelte e download posseduti dall'app sono persistiti
in `data` e ignorati da Git. Il manifest runtime `engine/manifest.json` continua
a escludere `ComfyUI/models/` e non incorpora il catalogo come artefatto da
installare automaticamente.

## Criteri di accettazione

- Una macchina pulita completa il bootstrap con zero byte di modelli scaricati.
- Dopo il bootstrap l'Admin è raggiungibile anche con tutti i workflow non pronti.
- L'utente può chiudere il catalogo senza selezionare nulla.
- Il wizard espone **Salta per ora** e non nasconde né disabilita il comando
  quando mancano tutti i modelli.
- Un singolo modello può essere scaricato, interrotto, ripreso e verificato senza
  coinvolgere gli altri.
- Un URL raccomandato può essere modificato e poi ripristinato.
- Collegare una libreria esistente non duplica file.
- Un URL malevolo non può scrivere fuori dai model root.
- Update e rollback del runtime conservano modelli, override e file `.partial`.
