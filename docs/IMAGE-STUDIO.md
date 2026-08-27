# Image Studio

Image Studio porta immagini e video nello stesso progetto. Il selettore in alto
passa da **Video** a **Immagini** senza trasformare le immagini in una libreria
separata.

## Modalità

- **Genera** usa il profilo Krea 2 configurato nell’Admin.
- **Edit** usa Flux.2 Klein e richiede da una a quattro reference.
- Ogni batch può produrre da uno a quattro candidati con seed Random, Base +1
  oppure Bloccato.
- I preset 1:1, 16:9, 9:16, 4:3 e 3:4 restano sotto circa 1,8 megapixel e usano
  dimensioni multiple di 16.

I tag Personaggio, Oggetto e Sfondo sono metadati del progetto: servono a
classificare e riusare l’immagine, ma non cambiano da soli il render.

## Reference Flux.2 Klein

Le reference sono ordinate e limitate a quattro, come nel contratto ufficiale
del modello. Ogni input può avere ruolo Base, Soggetto, Stile, Posa, Sfondo o
Altro. H3 Studio aggiunge al prompt una mappa esplicita Image 1, Image 2 e così
via, quindi ordine e ruolo influenzano realmente l’istruzione inviata a Flux.

Un candidato completato può essere:

- aperto o scaricato;
- scelto come risultato del batch;
- riusato immediatamente come base di un Edit;
- aggiunto alle reference correnti;
- condiviso con altri progetti e taggato diversamente in ciascuno.

La condivisione è per singolo candidato: condividere una immagine di un batch
non espone le altre.

## Profilo raccomandato

Il profilo distribuito è **Flux.2 Klein 4B Distilled FP8** con Qwen 3 4B,
Flux2 VAE, Euler, quattro step e CFG 1. È il profilo adatto come default a una
GPU da 16 GB.

Flux KV Cache è disponibile come ottimizzazione sperimentale ma resta
disattivata per impostazione predefinita perché può modificare l’aderenza alle
reference. Il backend attention può essere Auto, PyTorch o Comfy Kitchen, ma
l’Admin mostra soltanto le opzioni realmente esposte dalla ComfyUI collegata.

Il vecchio workflow Multi Input Compact rimane utile come riferimento di
interfaccia, ma non è il profilo pubblico predefinito: usa uno stack 9B più
pesante, cinque reference e dipendenze aggiuntive. H3 Studio usa invece un
blueprint API core versionato. Il workflow scelto nell’Admin viene letto
realmente dal bridge; gli input dinamici, i modelli, i seed e la catena di
reference vengono poi ricostruiti e validati prima dell’invio.

## Persistenza e sicurezza

Job, candidati, seed, reference, prompt API e legami con i progetti sono
persistiti in SQLite. I file restano nell’output ComfyUI. Dopo un riavvio il
bridge recupera i prompt ancora attivi e il frontend riprende il polling.

Prima di abilitare Genera, l’interfaccia verifica workflow, modelli, VAE,
encoder e nodi richiesti. Un job non viene creato quando il motore selezionato
non è pronto.
