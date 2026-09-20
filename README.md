# ChargeLog OCR — stato del progetto

App per fotografare il display dell'NC2500 Pro e registrare automaticamente le letture (corrente/tensione/mAh per slot), sostituendo il log manuale su foglio di calcolo descritto in `flusso-batterie-skyrc-nc2500pro.md`.

## Dove si trova

- **Versione Claude Artifact** (scatto singolo, la fotocamera live non funziona dentro Claude): https://claude.ai/artifact/6KiWCGc56QSRa7sPqFg5DK — non ancora aggiornata con i fix di questa sessione (vedi sezioni sotto), da ripubblicare quando si torna a lavorare su questo. Non può comunque avere la guida live all'inquadratura né il ritaglio automatico (vedi sotto), che richiedono la fotocamera live non disponibile dentro Claude.
- **Versione standalone per GitHub Pages** (scatto singolo + registrazione automatica della curva nel tempo, fotocamera live funzionante): pubblicata da Pier su https://carontes85.github.io/nc2500-battery-log/ (repo `Carontes85/nc2500-battery-log`, root del repo con `index.html`, `landing.html`, `lcd-ocr.js`, `frame-guide.js` — i vecchi file di Tesseract.js, non più usati, sono stati rimossi dal repo).

## Motore di lettura del display (lcd-ocr.js)

Il display dell'NC2500 Pro usa un font a matrice di punti che Tesseract (OCR generico) non riesce a leggere in modo affidabile, anche con immagine pulita — è un problema di font non riconosciuto dal modello, non di luce/inquadratura (verificato empiricamente su foto reali). Sostituito con una pipeline su misura in JavaScript puro (nessuna libreria esterna, ~30KB invece degli ~8MB di Tesseract):

1. Ritaglio dello schermo (oggi: automatico in tempo reale in "Registrazione automatica", vedi sezione dedicata più sotto; tocco manuale dei 4 angoli come ripiego, o unico meccanismo nello scatto singolo).
2. Correzione prospettica (raddrizza foto storte/in mano libera) via trasformazione proiettiva.
3. **Correzione fine dell'inclinazione residua** usando l'intestazione come riferimento — un affinamento oltre alla correzione prospettica del punto 2, utile soprattutto per le viste con più righe ravvicinate.
4. Pulizia immagine: scala di grigi, upscale 3x, autocontrasto, stima dello sfondo locale (illuminazione) tramite blur ampio, binarizzazione **adattiva** (pixel scuro rispetto al proprio sfondo locale, non rispetto a una soglia fissa uguale per tutta la foto) e "erosione" per fondere i puntini della matrice in tratti pieni.
5. Segmentazione in righe (una per slot C1–C6) e parole tramite proiezione orizzontale/verticale, con soglia adattiva (Otsu su scala logaritmica) invece di un numero fisso — necessario perché foto con riflessi/rumore diffuso possono avere un "pavimento" di rumore molto più alto negli spazi vuoti di quanto basti a una soglia fissa. **Raffinamento a passo costante** delle righe incerte usando come riferimento quelle lette con sicurezza.
6. Riconoscimento di ogni carattere per confronto con modelli (template) ricavati da foto reali del display, tramite similarità di Jaccard.
7. L'intestazione (riga "BREAK_IN...") viene sempre saltata e la numerazione slot C1–C6 parte dalla prima riga il cui primo carattere è riconosciuto con fiducia proprio come "C".

Validato al 100% su 8 delle 9 foto reali fornite finora da Pier in singola riga (modalità BREAK_IN con una sola cella inquadrata), incluse diverse foto con riflessi/glare marcati che inizialmente mandavano in crisi la lettura in vari modi. Risolto con soglie adattive locali invece che fisse, filtri per scartare rumore isolato senza perdere le righe vuote (C5/C6), e numerazione slot ancorata al primo contenuto riconosciuto con fiducia invece che a una posizione fissa.

**Template cifre**: ora disponibili per `. 0 1 2 3 4 5 6 7 8 9 : A C V h m` — il set di cifre 0-9 è **completo**. Il motore segnala i caratteri non riconosciuti con confidenza bassa invece di indovinare.

**Limiti noti residui**:
- Su foto molto rumorose, righe completamente vuote (es. C6 senza alcuna lettura) possono talvolta mostrare qualche carattere spurio dopo l'etichetta per rumore/riflessi in quella zona — non compromette le letture reali, è solo un artefatto cosmetico.
- Le cifre "6" e "8" hanno forme molto simili (Jaccard ~0.52 tra i template): dopo l'aggiunta del template "8", alcune "6" con contorni leggermente sporchi possono risultare "incerte" invece che lette con sicurezza — prezzo accettato per correggere la lettura errata "8"→"0". La cifra "7" invece è molto ben distinta da tutte le altre (similarità massima ~0.28 con "0", ben sotto la soglia di ambiguità 0.45): nessun effetto collaterale osservato o atteso per la sua aggiunta.
- **Nella vista con più canali insieme ("Ripristino"/BREAK_IN con C1..C6 tutti elencati uno sotto l'altro), una foto scattata con angolo di ripresa marcato (telefono molto inclinato rispetto al display) può leggere bene solo le prime righe (vicine all'intestazione) e male quelle più lontane (es. C3/C4)** — confermato essere un limite della foto (angolo di ripresa), non della pipeline: con una foto dello stesso schermo presa più perpendicolare, tutti e 6 gli slot si leggono correttamente. Per questo è stata aggiunta la guida live all'inquadratura, e in seguito il ritaglio automatico come meccanismo predefinito (vedi sezioni dedicate più sotto), proprio nella modalità dove questo limite si sente di più.

## Vista "Ripristino" con più canali insieme (20/09/2026 sera)

Pier ha mandato una foto del charger in modalità BREAK_IN con tutti i 4 canali attivi mostrati insieme (schermata tabellare: intestazione + righe "C1:0.10A 1.3V 385mAh" .. "C6:" vuota), chiedendo "verifica foto".

**Primo fix (bug reale, indipendente dal problema principale)**: l'intestazione di questa schermata contiene un orario tipo "27:09:17" con cifre vere lette con piena fiducia. Il vecchio criterio "salta bande finché non trovi un carattere qualunque leggibile" si fermava sull'orario dell'intestazione scambiandolo per C1, disallineando tutti gli slot. Corretto cercando specificamente una banda il cui **primo carattere** è "C" (ogni riga di lettura vera comincia con "C1:".."C6:"), con il vecchio criterio tenuto come ripiego per foto molto scure dove anche la "C" iniziale risulta incerta.

**Svolta, idea di Pier — intestazione come riferimento per raddrizzare**: ha suggerito di usare l'allineamento dell'intestazione superiore (un rettangolo netto e largo quanto le righe sottostanti) come riferimento sia per raddrizzare la foto sia per dedurre le dimensioni delle righe. Implementato in `lcd-ocr.js`:

- Nuova funzione `estimateHeaderTilt()`: misura, in diversi punti lungo la larghezza dell'immagine, dove si trova il punto più scuro nella zona alta (dove sta sempre l'intestazione), poi calcola con una regressione lineare quanto quel punto si sposta verticalmente da sinistra a destra — cioè l'inclinazione residua rimasta dopo la correzione prospettica a 4 punti.
- Nuova funzione `deskewShear()`: sposta verticalmente ogni colonna dell'immagine della quantità giusta per compensare quell'inclinazione, prima di procedere con il resto della pipeline.
- **Controlli di sicurezza**: si procede solo se il punto scuro trovato è davvero scuro, se i punti misurati stanno bene allineati su una retta, e se l'inclinazione risultante è entro un limite plausibile — altrimenti non si tocca l'immagine. Per una foto già ben inquadrata questo non cambia nulla: verificato con un'immagine sintetica senza intestazione.
- **Risultato su questa foto**: da "solo etichette C1-C6 vuote, nessun dato" a **C1 e C2 lette perfettamente**, cifra per cifra: "C1:0.10A 1.3V 385mAh", "C2:0.10A 1.3V 379mAh". C5 e C6 (righe vuote) continuano a leggersi correttamente. C3 e C4 restano solo parzialmente lette.

### Raffinamento a passo di riga costante — implementato, non risolve questa foto: causa reale individuata (20/09/2026 sera, stessa foto)

Pier ha fatto notare che il passo verticale tra le righe C1..C6 è fisso (si vede dal numero di pixel) e ha chiesto se si potesse migliorare C3/C4 sfruttando questo, dalla stessa foto già caricata, senza bisogno di nuove foto.

**Implementato**: nuova logica in `recognizeBoard()` che individua le righe lette con sicurezza (non solo "la C iniziale è confidente" — si è scoperto che l'etichetta "C3:"/"C4:" viene letta bene anche quando il resto della riga è sporco, quindi il criterio giusto è la frazione di caratteri incerti sull'intera riga, sotto il 20%), usa quelle come riferimento per un fit lineare (minimi quadrati) della posizione verticale di ogni riga in funzione dello slot, e ricalcola la finestra verticale delle sole righe non affidabili con quella formula invece di fidarsi del confine trovato localmente. Righe già lette bene non vengono mai toccate; se i riferimenti sono meno di 2, o già tutte le righe sono affidabili, il codice non fa nulla (comportamento identico a prima, quindi innocuo per tutte le foto già validate).

**Risultato su questa foto: nessun miglioramento** — stesso testo, identico carattere per carattere, sia con la finestra originale che con quella ricalcolata. Indagando il motivo con un confronto diretto pixel-per-pixel tra C1 (letta perfettamente) e C3 (letta male):

- L'immagine binarizzata (bianco/nero) di C3/C4 è visivamente **pulita e ben separata** dalle righe adiacenti — nessun contatto tra righe, contrariamente all'ipotesi iniziale. Anche la segmentazione in colonne/parole risulta praticamente identica a quella di C1 (stessi confini, stesso numero di parole).
- Il problema era invece nella **forma dei singoli caratteri**: ingrandendo l'immagine, i puntini della matrice in C3/C4 mostravano un pattern "a scaletta" (leggermente sfalsati riga per riga) assente in C1/C2 — visibile a occhio ma sufficiente a far crollare la somiglianza con i template rigidi (punteggi di confidenza 0.32-0.49 contro 0.65-0.81 di C1, a parità di soglia).
- Questo pattern peggiorava man mano che una riga era più lontana dall'intestazione (C1 perfetta → C2 quasi perfetta → C3/C4 chiaramente distorte) — segno di una distorsione geometrica residua **non lineare** (non una semplice rotazione costante, quella era già corretta) che cresce con l'angolo di ripresa complessivo della foto.

**Conferma diretta (foto successiva, stessa sera)**: Pier ha inviato una seconda foto dello stesso schermo, in modalità Ripristino, presa con il telefono tenuto più perpendicolare al display (angolo di ripresa nettamente meno estremo, verificabile a occhio confrontando le due foto). Su questa foto **tutti i 6 slot si leggono perfettamente**, C3/C4 compresi: "C1:0.10A 1.3V 515mAh", "C2:0.10A 1.3V 509mAh", "C3:0.10A 1.3V 527mAh", "C4:0.10A 1.3V 537mAh", C5/C6 vuote — zero caratteri incerti, corrispondenza esatta con quanto mostrato sullo schermo. Questo conferma pienamente la diagnosi: **il limite non è nell'algoritmo ma nell'angolo di ripresa della foto** — più il telefono è inclinato rispetto al display, più le righe lontane dall'intestazione risultano distorte e difficili da leggere con sicurezza.

Il raffinamento a passo costante resta comunque nel codice — verificato innocuo, e potrebbe aiutare in un caso futuro dove le righe si toccano davvero (un problema diverso da quello di questa foto, ma reale in linea di principio).

### Fix cifra "7" — template completato (stessa foto)

Pier ha notato che questa stessa foto contiene tre "7" leggibili (due nell'orario dell'intestazione "27:09:17", uno nel valore mAh di C2 "379mAh") e ha chiesto di estrarne un template, visto che era l'unica cifra ancora mancante. Estratto un glifo pulito dalla cifra "7" di "379mAh" (riga C2, la più affidabile perché già letta correttamente dopo il fix di de-skew sopra) con lo stesso procedimento usato in precedenza per la cifra "8", e aggiunto a `RAW_TEMPLATES`. Verificata la similarità di Jaccard contro tutti i template esistenti prima di aggiungerlo: il più vicino è "0" con appena 0.28 (ben sotto la soglia di ambiguità 0.45) — molto più distinto di quanto lo fossero "6"/"8" tra loro, quindi nessun effetto collaterale atteso su altre cifre. Testato sulla foto: "379mAh" ora si legge per intero, correttamente. Il set di cifre 0-9 è ora completo.

### Fix cifra "8" (foto precedente, scura)

Analizzando una foto scattata al buio è emerso un bug reale e indipendente dalla fotocamera: la lettura "C2:0.10A 1.3V 298mAh" veniva riconosciuta come "290mAh" — la cifra "8" non aveva ancora un template dedicato e veniva sistematicamente confusa con "0". Estratto un template pulito della cifra "8" direttamente da questa foto e aggiunto a `RAW_TEMPLATES` in `lcd-ocr.js`. Rieseguita l'intera suite di regressione esistente dopo la modifica: nessuna regressione. Effetto collaterale osservato: una cifra "6" altrove nella stessa foto è passata da lettura sicura a "incerta" per la maggiore vicinanza tra i template 6/8 — vedi nota nei limiti noti sopra.

## Guida live all'inquadratura (`frame-guide.js`, nuovo file — 20/09/2026 sera)

Dopo aver confermato che il limite di lettura di C3/C4 nella vista "Ripristino" dipende dall'angolo di ripresa (vedi sopra), Pier ha chiesto se si potesse mostrare all'utente, in sovrimpressione sulla fotocamera, un'indicazione di come tenere il telefono per una foto ben leggibile.

**Ambito scelto con Pier inizialmente** (chiarito con due domande prima di partire): la guida doveva essere solo un aiuto visivo, mostrato **solo nella modalità "Registrazione automatica"** (l'unica che oggi ha una vista fotocamera live dentro la pagina — lo scatto singolo usa la fotocamera nativa del telefono e non può mostrare overlay), mentre il tocco manuale dei 4 angoli restava l'unico meccanismo che contava davvero per il ritaglio. **Questo è cambiato la notte stessa** (vedi sezione successiva "Il ritaglio automatico diventa il meccanismo predefinito"): oggi il rettangolo rilevato da questa guida è la fonte di ritaglio effettiva in modalità automatica, non solo un consiglio.

**Come funziona**: circa 2-3 volte al secondo, mentre la fotocamera è attiva, un fotogramma del video viene ridotto e analizzato per trovare il rettangolo luminoso dello schermo (molto più chiaro dello sfondo scuro del caricabatterie) tramite soglia automatica (Otsu) e ricerca della macchia connessa più grande sopra soglia. Dai 4 angoli di quel rettangolo si confronta la lunghezza dei lati opposti (sinistra/destra, alto/basso): più sono simili, più la ripresa è perpendicolare allo schermo — la stessa idea geometrica verificata confrontando le due foto reali di cui sopra (quella buona aveva un'asimmetria tra lati opposti dell'~1%, quella con C3/C4 illeggibili del ~6%; le soglie di verde/giallo/rosso sono tarate su questi due numeri). In base a quale lato risulta più "vicino" (più lungo), il messaggio suggerisce la correzione: spostare il telefono a destra/sinistra o alzarlo/abbassarlo leggermente. Se lo schermo non viene trovato con sicurezza (es. non ancora inquadrato, o riflessi troppo forti), non mostra nulla invece di indovinare.

**Testato**:
- Le funzioni di rilevamento/valutazione isolate, con le due foto reali di riferimento — la foto con angolo marcato dà correttamente "rosso" con il suggerimento "Alza leggermente il telefono" (coerente con l'asimmetria misurata, alto/basso più marcata della sinistra/destra), la foto perpendicolare dà "verde"/"Ottimo, tieni fermo così".
- **End-to-end nell'app vera**, simulando una fotocamera reale in Chromium con le due foto come sorgente video (flag `--use-fake-device-for-media-stream`): navigazione fino alla scheda Registrazione automatica, avvio fotocamera, stessi risultati verdi/rossi visti nel banner effettivo della pagina.

**Limite noto/da verificare sul campo**: la direzione del suggerimento (che lato spostare) è dedotta dalla geometria prospettica standard (il lato "vicino" appare più lungo), verificata matematicamente sulle due foto reali ma non ancora testata con un vero telefono in mano da Pier — è una prima versione ragionevole ma da confermare/affinare con l'uso reale.

Incluso nel pacchetto GitHub Pages consegnato a Pier in questa sessione (nuovo file `frame-guide.js` da aggiungere al repo insieme agli altri).

## Il ritaglio automatico diventa il meccanismo predefinito (20/09/2026, notte)

Pier ha riferito di fare fatica a toccare con precisione i 4 angoli sullo schermo, mentre il riquadro colorato della guida live (vedi sezione sopra) individua lo schermo meglio di quanto riesca lui a mano. Ha chiesto esplicitamente di **rimuovere il tocco manuale come meccanismo predefinito e usare il ritaglio rettangolare automatico**, tenendo il tocco manuale solo come ripiego disponibile in caso il rilevamento automatico non trovi lo schermo.

**Implementato in `index-standalone.html`** (solo modalità "Registrazione automatica", l'unica con fotocamera live in pagina):

- Nuovo stato `cropMode` (`'auto'` di default, `'manual'` come ripiego). All'avvio della fotocamera si parte sempre in `'auto'`.
- In modalità `auto`, il ritaglio usato realmente dall'OCR è il rettangolo rilevato in tempo reale da `frame-guide.js` — non più solo un riquadro consigliato in sovrimpressione. Durante la "Registrazione automatica", ad ogni fotogramma catturato il rettangolo viene **ricalcolato al volo** (non più congelato alla posizione di inizio registrazione), cosa che tollera meglio piccoli spostamenti del telefono durante una registrazione lunga.
- Il pulsante "Avvia registrazione" si abilita da solo appena il rilevamento automatico trova uno schermo plausibile — non serve più toccare nulla prima di iniziare.
- **Ripiego manuale**: un pulsante ("Il rilevamento automatico non funziona? Tocca per selezionare gli angoli a mano") permette di passare a `manual` in ogni momento; inoltre **un semplice tocco sul video durante la modalità automatica passa da solo a manuale** (l'utente non deve prima premere il pulsante: se tocca per correggere, il sistema capisce l'intenzione). In modalità manuale si torna al comportamento di prima: 4 tocchi sugli angoli, posizione congelata per tutta la registrazione, pulsante per tornare all'automatico o "Reimposta angoli".
- Aggiornati i testi in pagina di conseguenza: spiegazione "il ritaglio è automatico, non serve toccare nulla" mostrata di default; l'avviso sul tocco manuale compare solo quando quella modalità è attiva.

**Testato end-to-end** con Chromium e fotocamera finta (le due foto reali come sorgente video, flag `--use-fake-device-for-media-stream`), sia sulle funzioni isolate che sull'app vera:
- Senza alcun tocco, il pulsante "Avvia registrazione" si abilita da solo con il rettangolo auto-rilevato, su entrambe le foto di riferimento.
- Un singolo tocco sul video passa correttamente e automaticamente a modalità manuale (testo del pulsante e avvisi si aggiornano di conseguenza).
- **Registrazione completa con la foto perpendicolare (quella che si legge bene)**: avviata la registrazione senza toccare nulla, dopo un ciclo la tabella live mostra le 4 letture corrette e complete — C1:515, C2:509, C3:527, C4:537 mAh, esattamente come attese — confermando che il rettangolo auto-rilevato ad ogni fotogramma produce lo stesso ritaglio corretto usato dall'OCR con successo.
- Verificato che passando a modalità manuale il cambio di stato/pulsanti funziona correttamente; la precisione della lettura in manuale dipende come sempre dalla precisione dei 4 tocchi (nessuna modifica alla logica di ritaglio manuale in sé, solo a come/quando viene attivata).

## Esportazione foto di debug: ora copre anche gli scatti singoli (20/09/2026, notte)

Pier ha segnalato di non trovare modo di esportare le foto per un'analisi successiva. Causa: il salvataggio delle foto di debug (`saveDebugPhoto()`, attivo solo in "modalità debug") veniva richiamato finora solo durante la "Registrazione automatica" (`recordTick()`), mai nel flusso di scatto singolo (`runOcr()`) — e Pier finora ha sempre usato lo scatto singolo per mandarmi le foto, quindi per lui la funzione risultava introvabile perché semplicemente non veniva mai attivata dal suo modo di usare l'app.

**Fix**: aggiunta la stessa chiamata `saveDebugPhoto()` anche nel flusso di scatto singolo, con un campo `source: 'single'` per distinguerle in futuro dai fotogrammi di registrazione se servisse. Aggiornati i testi della card nella scheda "Registro" (ora "Foto di debug", non più "Foto di debug (registrazione)"; descrizione estesa per menzionare anche gli scatti singoli). Meccanismo di export (zip) e cancellazione invariati.

## Sblocco PRO locale per debug (`?admin=TOKEN`)

Dato che Gumroad e il Cloudflare Worker di verifica licenze non sono ancora attivi (`LICENSE_VERIFY_URL` è ancora un placeholder), Pier non aveva modo di testare le funzioni PRO (registrazione automatica della curva, export CSV/TXT illimitato) sul proprio dispositivo. Aggiunto un piccolo sblocco locale in `index-standalone.html`:

- Costante `ADMIN_UNLOCK_TOKEN = 'pier-admin-2026'` vicino alle altre costanti di licenza.
- Funzione `checkAdminUnlock()`, richiamata nel boot **prima** di `updateProUI()`: legge il parametro `?admin=` dall'URL della pagina, e se corrisponde al token marca il browser come PRO (stesso `localStorage` usato da una licenza vera attivata) **e attiva anche la "modalità debug"** (stesso token, un solo sblocco da ricordare). Il parametro viene rimosso dall'URL subito dopo averlo letto.
- Per sbloccarsi basta aprire una volta `https://carontes85.github.io/nc2500-battery-log/?admin=pier-admin-2026`: da quel momento il dispositivo/browser resta PRO+debug (persiste in `localStorage`, sopravvive ai refresh).
- **Non è vera sicurezza**: gira tutto lato client — va trattato come una password semplice da non condividere pubblicamente. Pier può cambiare il token quando vuole modificando la costante nel codice.

## Modalità debug — raccolta foto (scatti singoli e registrazione)

Pier ha chiesto di poter salvare le foto scattate (inizialmente pensato per la "Registrazione curva nel tempo", poi esteso anche allo scatto singolo — vedi sezione sopra) per potermele poi mandare in chat e migliorare l'algoritmo di lettura — chiarito con lui che non ho un collegamento diretto al suo telefono: l'app le salva localmente e lui le esporta e me le invia manualmente. Alla domanda su quali fotogrammi salvare durante la registrazione ha scelto **tutti i fotogrammi**.

Implementazione in `index-standalone.html`, attiva solo in "modalità debug":

- **Storage**: IndexedDB in un database dedicato `nc2500_debug_photos`. Ogni foto (scatto singolo o fotogramma di registrazione) viene salvata come JPEG qualità 0.75, alla risoluzione della cattura, insieme a modalità, testo OCR letto e id sessione.
- **UI**: card "Foto di debug" nella scheda "Registro" (visibile solo in modalità debug), con contatore + "Esporta foto (zip)" + "Cancella foto salvate".
- **Export**: mini generatore ZIP scritto da zero (modalità "store", senza compressione).
- **Avvertenza per Pier**: nessun tetto automatico sullo storage — conviene esportare e cancellare periodicamente su registrazioni lunghe/frequenti.

## Analisi AI — implementata poi rimossa (in pausa)

Era stata aggiunta una card "Analisi AI" (solo versione standalone) che mandava le letture all'API Messages di Anthropic in chiamata diretta dal browser (chiave dell'utente in `localStorage`, fatturazione diretta Anthropic→utente). Pier ha chiesto di **togliere la feature per ora** ("partiamo calmi") dopo aver discusso che un abbonamento Claude Pro/Max non è riusabile per l'API — un attrito in più per un'app che deve ancora consolidarsi. Rimossa il 17/09/2026, nessun'altra parte dell'app dipendeva da questo codice. Se si volesse reintrodurla: implementazione conservata nella cronologia di questa sessione, o valutare backend proxy + chiave unica di Pier gating-ata dietro PRO.

## Monetizzazione (vedi anche `chargelog-ocr-app.md`)

App gratis (fino a 20 letture salvate, solo scatto singolo) + PRO a pagamento una tantum (illimitato + registrazione automatica + export CSV/TXT), venduta come web app diretta, licenze via Gumroad verificate lato server con un Cloudflare Worker gratuito. Da completare quando Pier avrà creato l'account Gumroad e distribuito il Worker: aggiornare i placeholder `LICENSE_VERIFY_URL` e `BUY_URL`.

## Nota sul collegamento GitHub (20/09/2026, notte)

Pier ha chiesto se, avendo collegato il proprio account GitHub a Claude, fosse possibile aggiornare direttamente i file sul suo repository da questa sessione. Verificato che questa sessione Cowork non ha né un connettore GitHub attivo né un collegamento al suo computer (device bridge): non esiste oggi un meccanismo per fare push diretto al repo da qui. Il flusso resta: consegna dello zip aggiornato in chat, Pier lo carica manualmente su GitHub Pages (o un collegamento futuro, se configurato, potrebbe automatizzare questo passaggio).

## Prossimi passi

- **Verificare sul campo il ritaglio automatico** appena introdotto: soprattutto con un vero telefono in mano, confermare che il rettangolo si aggancia bene allo schermo del charger in condizioni reali (luce, riflessi, leggero movimento) e che il passaggio automatico a "manuale" al primo tocco risulti intuitivo. Affinare soglie/messaggi se serve.
- Valutare se estendere ritaglio automatico e guida live anche allo scatto singolo, passando dalla fotocamera nativa del telefono a una vista fotocamera dentro la pagina (cambiamento più grande, per ora scartato da Pier a favore di partire con la sola Registrazione automatica).
- Testare la modalità IR (resistenza interna): layout dei campi non ancora confermato con una foto reale.
- Una volta che Pier ha Gumroad + Cloudflare Worker attivi, aggiornare i placeholder di licenza (a quel punto lo sblocco `?admin=` diventa superfluo per l'uso normale).
- Tenere d'occhio lo spazio occupato dalle foto di debug su registrazioni lunghe/scatti frequenti (nessun limite/rotazione automatica implementato finora).
- Ripubblicare l'Artifact Claude con i fix di questa sessione (rimasto indietro rispetto al pacchetto GitHub Pages) — guida live e ritaglio automatico non sono comunque riproducibili lì (niente fotocamera live dentro Claude).
