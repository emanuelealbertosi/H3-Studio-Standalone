# Assets e passaggio allo Studio

## Scopo

La sezione **Assets** è una libreria visuale, non un secondo ambiente di
generazione. Raccoglie automaticamente:

- tutte le immagini concluse nello Studio immagini;
- le reference storiche di personaggi e oggetti già presenti nel database;
- tag, progetto di provenienza, prompt e dimensioni disponibili.

Le vecchie funzioni CRUD e la generazione Krea 2 interne ad Assets restano
supportate dal backend per compatibilità con i dati esistenti, ma non sono più
montate nell'interfaccia. Generazione ed edit si eseguono soltanto nello Studio.

## Uso delle immagini

1. Aprire **Assets** dalla barra laterale. La vista iniziale mostra **Tutti**.
2. Filtrare o cercare per nome, prompt, progetto o tag.
3. Selezionare fino a quattro immagini facendo clic sulle card oppure
   trascinandole nel box di selezione.
4. Premere **Manda a Studio**.

Le immagini vengono preparate contemporaneamente per i due contesti disponibili:

- nello Studio video sono allegate in modalità **Reference**, con la prima
  immagine come `picture 1`;
- nello Studio immagini aprono **Edit**, con la prima reference impostata come
  base e le successive come reference aggiuntive.

Il selettore Video/Immagini dello Studio permette quindi di scegliere il motore
senza ricaricare i file.

## Uso dei video

Ogni video nella **Libreria** espone **Manda a Studio**. Il comando apre lo
Studio video e allega il filmato, pronto per Continue, Edit o per le altre modalità
compatibili. Non crea un nuovo progetto e non duplica il file.

## Persistenza

I metadati restano in `data/h3-studio.sqlite`; i file rimangono nelle directory
input/output di ComfyUI e vengono serviti dal bridge. Il passaggio allo Studio usa
i riferimenti esistenti e non crea copie inutili.
