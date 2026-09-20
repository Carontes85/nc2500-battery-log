# ChargeLog OCR — stato del progetto

App per fotografare il display dell'NC2500 Pro e registrare automaticamente le letture (corrente/tensione/mAh per slot), sostituendo il log manuale su foglio di calcolo descritto in `flusso-batterie-skyrc-nc2500pro.md`.

## Dove si trova

- **Versione Claude Artifact** (scatto singolo, la fotocamera live non funziona dentro Claude): https://claude.ai/artifact/6KiWCGc56QSRa7sPqFg5DK
- **Versione standalone per GitHub Pages** (scatto singolo + registrazione automatica della curva nel tempo, fotocamera live funzionante): pubblicata da Pier su https://carontes85.github.io/nc2500-battery-log/ (repo `Carontes85/nc2500-battery-log`, root del repo con `index.html`, `landing.html`, `lcd-ocr.js` — i vecchi file di Tesseract.js, non più usati, sono stati rimossi dal repo).

## Motore di lettura del display (lcd-ocr.js)

Il display dell'NC2500 Pro usa un font a matrice di punti che Tesseract (OCR generico) non riesce a leggere in modo affidabile, anche con immagine pulita — è un problema di font non riconosciuto dal modello, non di luce/inquadratura (verificato empiricamente su foto reali). Sostituito con una pipeline su misura in JavaScript puro (nessuna libreria esterna, ~30KB invece degli ~8MB di Tesseract):

1. L'utente tocca i 4 angoli dello schermo (foto singola o video live) — sostituisce il vecchio ritaglio a 2 punti.
2. Correzione prospettica (raddrizza foto storte/in mano libera) via trasformazione proiettiva.
3. Pulizia immagine: scala di grigi, upscale 3x, autocontrasto, stima dello sfondo locale (illuminazione) tramite blur ampio, binarizzazione **adattiva** (pixel scuro rispetto al proprio sfondo locale, non rispetto a una soglia fissa uguale per tutta la foto) e "erosione" per fondere i puntini della matrice in tratti pieni.
4. Segmentazione in righe (una per slot C1–C6) e parole tramite proiezione orizzontale/verticale, con soglia adattiva (Otsu su scala logaritmica) invece di un numero fisso — necessario perché foto con riflessi/rumore diffuso possono avere un "pavimento" di rumore molto più alto negli spazi vuoti di quanto basti a una soglia fissa.
5. Riconoscimento di ogni carattere per confronto con modelli (template) ricavati da foto reali del display, tramite similarità di Jaccard.
6. L'intestazione (riga "BREAK_IN...") viene sempre saltata e la numerazione slot C1–C6 parte dalla prima riga con almeno un carattere riconosciuto con fiducia — non semplicemente "salta la prima banda", perché un riflesso proprio a cavallo tra intestazione e C1 può spezzare l'intestazione in più bande spurie, e saltarne solo una farebbe scivolare tutte le righe successive di slot.

Validato al 100% su 8 delle 9 foto reali fornite finora da Pier (modalità BREAK_IN), incluse diverse foto con riflessi/glare marcati che inizialmente mandavano in crisi la lettura in vari modi (l'intera immagine collassava in un'unica banda indistinta, i caratteri uscivano illeggibili, oppure l'intestazione frammentata dal riflesso faceva scivolare tutte le righe di uno-due slot). Risolto con soglie adattive locali invece che fisse, filtri per scartare rumore isolato senza perdere le righe vuote (C5/C6), e numerazione slot ancorata al primo contenuto riconosciuto con fiducia invece che a una posizione fissa.

**Template cifre**: ora disponibili per `. 0 1 2 3 4 5 6 8 9 : A C V h m` (aggiunta la cifra "8" il 20/09/2026, vedi sezione dedicata sotto) — **manca ancora il template per la cifra 7** (nessuna foto reale l'ha ancora mostrata). Il motore segnala i caratteri non riconosciuti con confidenza bassa invece di indovinare.

**Limiti noti residui**:
- Su foto molto rumorose, righe completamente vuote (es. C6 senza alcuna lettura) possono talvolta mostrare qualche carattere spurio dopo l'etichetta (es. "C6:???") per rumore/riflessi in quella zona — non compromette le letture reali, è solo un artefatto cosmetico.
- Una foto scattata con angolo di visuale sfavorevole rispetto al display (l'LCD del NC2500 Pro ha un contrasto molto sensibile all'angolo di visione) può risultare troppo "piatta" (poco contrasto testo/sfondo nell'intera immagine, non solo rumore locale) da leggere in modo affidabile qualunque soglia si usi — non ancora risolto, è un limite fisico della ripresa più che un bug della pipeline. Se capita, consigliare a Pier di rifare la foto guardando il display il più frontalmente possibile.
- Le cifre "6" e "8" hanno forme molto simili nel font a matrice di punti di questo display (anche i template stessi hanno una similarità di Jaccard di ~0.52 tra loro): dopo l'aggiunta del template "8", alcune "6" con contorni leggermente sporchi possono ora risultare "incerte" (mostrate con "?") invece che lette con sicurezza come prima — è il prezzo accettato per correggere la lettura errata "8"→"0" (vedi sotto): il sistema preferisce segnalare incertezza piuttosto che indovinare male in silenzio.

## Foto molto scure ("il sistema non rileva l'immagine") — diagnosi del 20/09/2026

Pier ha segnalato che una foto scattata con ambiente quasi completamente buio (solo il display retroilluminato visibile, sfondo nero) non veniva "rilevata" dall'app. Investigato dando in pasto la foto direttamente al motore `lcd-ocr.js` (bypassando l'interfaccia) con angoli scelti a mano sui 4 vertici reali dello schermo: **il motore legge questa foto correttamente** (307/298/316/325mAh su C1-C4, tutti i valori esatti tranne un'imprecisione nota, vedi sotto) — quindi la pipeline di lettura in sé regge bene anche il contrasto altissimo di una foto scattata al buio.

Conclusione: il problema molto probabilmente non è la lettura OCR, ma la **fase di tocco dei 4 angoli** nell'app — in una foto quasi tutta nera con il display come piccolo rettangolo luminoso, è difficile toccare con precisione i 4 vertici esatti su uno schermo di telefono senza zoom, e angoli imprecisi producono poi una prospettiva corretta male e quindi una lettura fallita o inaffidabile. Questo conferma che la richiesta di Pier di migliorare l'interazione di selezione degli angoli (zoom, selezione più guidata) è la priorità corretta da affrontare subito dopo — non ancora implementata, in attesa di conferma/dettagli da Pier su come vuole gestirla (opzione tendina trascinabile menzionata da lui, o zoom classico pinch-to-zoom sulla foto prima di toccare gli angoli).

### Fix cifra "8" (dalla stessa foto)

Analizzando questa foto è emerso un bug reale e indipendente dalla fotocamera: la lettura "C2:0.10A 1.3V 298mAh" veniva riconosciuta come "290mAh" — la cifra "8" non aveva ancora un template dedicato (nota già presente in questo documento) e veniva sistematicamente confusa con "0" (le due forme sono le più simili disponibili nel set di template fino ad oggi). Estratto un template pulito della cifra "8" direttamente da questa foto (glifo netto, ben normalizzato) e aggiunto a `RAW_TEMPLATES` in `lcd-ocr.js`. Rieseguita l'intera suite di regressione esistente (12/12 righe su 3 foto del set principale, più i test dedicati con le foto da 69mAh, 114/115mAh e le 5 foto del batch glare) dopo la modifica: **nessuna regressione**, tutti gli stessi risultati di prima. Sulla nuova foto in questione, il valore "298mAh" ora è corretto; unico effetto collaterale osservato: una cifra "6" altrove nella stessa foto (C3: 316mAh) è passata da lettura sicura a "incerta" (mostrata come "31?mAh") per la maggiore vicinanza tra i template 6/8 — vedi nota nei limiti noti sopra.

Propagato il fix sia al pacchetto GitHub Pages (nuovo zip consegnato a Pier) sia alla versione Claude Artifact (Version 9, ripubblicata con lo stesso `lcd-ocr.js` aggiornato).

## Sblocco PRO locale per debug (`?admin=TOKEN`)

Dato che Gumroad e il Cloudflare Worker di verifica licenze non sono ancora attivi (`LICENSE_VERIFY_URL` è ancora un placeholder), Pier non aveva modo di testare le funzioni PRO (registrazione automatica della curva, export CSV/TXT illimitato) sul proprio dispositivo. Aggiunto un piccolo sblocco locale in `index-standalone.html`:

- Costante `ADMIN_UNLOCK_TOKEN = 'pier-admin-2026'` vicino alle altre costanti di licenza.
- Funzione `checkAdminUnlock()`, richiamata nel boot **prima** di `updateProUI()`: legge il parametro `?admin=` dall'URL della pagina, e se corrisponde al token marca il browser come PRO (stesso `localStorage` usato da una licenza vera attivata) **e attiva anche la "modalità debug"** (vedi sezione sotto, aggiunta il 20/09/2026 — stesso token, un solo sblocco da ricordare). Il parametro viene rimosso dall'URL subito dopo averlo letto (`history.replaceState`), così non resta visibile in cronologia/screenshot/link condivisi.
- Quindi per sbloccarsi basta aprire una volta `https://carontes85.github.io/nc2500-battery-log/?admin=pier-admin-2026`: da quel momento il dispositivo/browser resta PRO+debug come con l'attivazione normale (persiste in `localStorage`, sopravvive ai refresh).
- **Non è vera sicurezza**: gira tutto lato client, esattamente come il resto del gate PRO (che comunque si può già bypassare da console con `localStorage.setItem('nc2500_pro','1')`) — va trattato come una password semplice da non condividere pubblicamente, non come un vero controllo d'accesso. Pier può cambiare il token quando vuole modificando la costante nel codice.
- Testato con Playwright: token sbagliato non sblocca nulla; token corretto sblocca subito, ripulisce l'URL, e lo stato PRO resta dopo un reload; nessuna regressione sul resto dell'app.

## Modalità debug — raccolta foto durante la registrazione curva (20/09/2026)

Pier ha chiesto di poter salvare le foto scattate durante la "Registrazione curva nel tempo" per potermele poi mandare in chat e migliorare l'algoritmo di lettura — chiarito con lui che io non ho un collegamento diretto al suo telefono: l'unico modo è che sia l'app a salvarle localmente e lui a esportarle ed inviarmele manualmente, come già fa con le foto singole. Alla domanda su quali fotogrammi salvare (solo quelli con letture incerte, tutti, oppure un campione) ha scelto **tutti i fotogrammi**, dopo che gli avevo segnalato il rischio di occupare parecchio spazio su sessioni lunghe.

Implementazione in `index-standalone.html`, attiva solo in "modalità debug" (stesso sblocco `?admin=` sopra, per non mostrare questa funzione — pensata per questa fase di sviluppo, non per i futuri utenti — a chi non conosce il token):

- **Storage**: IndexedDB (non `localStorage`, troppo piccolo per contenere foto) in un database dedicato `nc2500_debug_photos`. Ogni fotogramma della registrazione (`recordTick()`) viene salvato come JPEG qualità 0.75, alla risoluzione della cattura video (nessun downscale: serve risoluzione sufficiente per poterci ancora estrarre template di caratteri, come fatto con la foto del fix cifra "8"), insieme a modalità, testo OCR letto e id sessione.
- **UI**: nuova card "Foto di debug (registrazione)" nella scheda "Registro" (visibile solo in modalità debug), con contatore foto salvate + spazio stimato, un pulsante "Esporta foto (zip)" e uno "Cancella foto salvate" (con conferma, non reversibile).
- **Export**: nessuna libreria esterna — scritto un mini generatore ZIP da zero (solo modalità "store", senza compressione: le foto sono già JPEG compressi) che impacchetta i file con nomi tipo `foto_<timestamp>_id<N>_<modalità>.jpg` e li fa scaricare come un file `.zip` tramite Blob + `<a download>` (stesso meccanismo già usato per l'export CSV/TXT su questa versione standalone).
- **Testato con Playwright**: sblocco/nascondimento card corretto con e senza `?admin=`; salvataggio multiplo di foto finte in IndexedDB con metadati corretti; contatore aggiornato correttamente; esportazione zip verificata scaricando il file reale e decomprimendolo con `unzip` (contenuto JPEG valido, dimensioni corrette); cancellazione verificata (svuota lo store, contatore torna a 0); nessuna regressione sul resto dell'app.
- **Avvertenza per Pier**: lo storage non ha un tetto automatico — su registrazioni molto lunghe/frequenti (intervallo 2-5s per ore) le foto possono accumularsi e occupare spazio importante sul telefono; conviene esportare e premere "Cancella foto salvate" periodicamente. Non ancora implementato un limite automatico o una rotazione: da valutare se diventa un problema pratico per lui.

## Analisi AI — implementata poi rimossa (in pausa)

Era stata aggiunta una card "Analisi AI" nella scheda "Registro" (solo versione standalone GitHub Pages) che mandava le letture visibili all'API Messages di Anthropic in chiamata diretta dal browser (pattern "bring your own key", header `anthropic-dangerous-direct-browser-access`), con chiave dell'utente salvata in `localStorage` e fatturazione diretta Anthropic→utente (nessun costo/server per Pier).

Pier ha chiesto di **togliere la feature per ora** ("partiamo calmi") dopo aver discusso l'implicazione pratica: chi ha già un abbonamento Claude Pro/Max non può riusarlo per l'API, deve comunque creare un account API separato su console.anthropic.com con credito proprio — un attrito in più per l'utente finale di un'app che deve ancora consolidarsi. Rimossa il 17/09/2026: card HTML, blocco JS (`AI_KEY_STORAGE`, `runAiAnalysis`, ecc.) e chiamata `updateAiKeyUI()` nel boot, tutte eliminate da `index-standalone.html`; nessun'altra parte dell'app dipendeva da questo codice.

Se in futuro si volesse reintrodurla, si può ripartire dall'implementazione già scritta (conservata nella cronologia di questa sessione) oppure valutare l'alternativa con backend proxy + chiave unica di Pier (costi a suo carico, quindi da gating-are dietro PRO o con un tetto di richieste mensili).

## Monetizzazione (vedi anche `chargelog-ocr-app.md`)

App gratis (fino a 20 letture salvate, solo scatto singolo) + PRO a pagamento una tantum (illimitato + registrazione automatica + export CSV/TXT), venduta come web app diretta (non App Store), licenze via Gumroad verificate lato server con un Cloudflare Worker gratuito. Da completare quando Pier avrà creato l'account Gumroad e distribuito il Worker: aggiornare i placeholder `LICENSE_VERIFY_URL` e `BUY_URL` in `index.html`/`landing.html` con i valori reali.

## Prossimi passi

- **Migliorare la selezione dei 4 angoli nella cattura**: zoom sulla foto prima/durante il tocco degli angoli, eventualmente un meccanismo più guidato (es. trascinare un rettangolo/tendina da un angolo all'altro invece di 4 tocchi indipendenti) — richiesto esplicitamente da Pier dopo la foto scattata al buio, dove il display piccolo e circondato da nero rende difficile toccare i vertici con precisione senza zoom. Non ancora implementato: da chiarire con Pier il meccanismo di interazione preciso che preferisce prima di implementare.
- Ricevere altre foto reali con la cifra 7 visibile per completare i template.
- Testare la modalità IR (resistenza interna): il layout dei campi per quella modalità non è ancora confermato con una foto reale.
- Una volta che Pier ha Gumroad + Cloudflare Worker attivi, aggiornare i placeholder di licenza nel pacchetto GitHub Pages (a quel punto lo sblocco `?admin=` diventa superfluo per l'uso normale, ma può restare comodo per debug futuro).
- Tenere d'occhio lo spazio occupato dalle foto di debug su registrazioni lunghe (nessun limite/rotazione automatica implementato finora).
