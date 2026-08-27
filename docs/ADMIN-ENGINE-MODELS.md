# Modelli Engine nell’Admin

Le configurazioni dei quattro engine sono indipendenti:

- **MiniMax H3 standard** usa soltanto `settings.h3`;
- **FAST Alibaba PDD-Acc** usa soltanto `settings.fast` e abbina automaticamente
  la patch PDD compatibile;
- **Krea 2** usa soltanto `settings.krea`;
- **Flux.2 Klein Edit** usa soltanto `settings.imageEdit`.

Cambiare modello, encoder o VAE di Flux non deve modificare né la selezione né il
valore persistito di H3 o Krea.

Le tendine partono dall’elenco reale restituito da ComfyUI e applicano un filtro
per famiglia. Il valore corrente viene sempre mantenuto visibile, anche quando il
file non è momentaneamente rilevato, così la select non ricade visivamente sulla
prima voce di un altro engine.

La configurazione standard H3 predefinita è:

`minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors`
