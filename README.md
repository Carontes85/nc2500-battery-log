# ChargeLog OCR — stato del progetto

App per fotografare il display dell'NC2500 Pro e registrare automaticamente le letture (corrente/tensione/mAh per slot), sostituendo il log manuale su foglio di calcolo descritto in `flusso-batterie-skyrc-nc2500pro.md`.

## Dove si trova

- **Versione Claude Artifact** (scatto singolo, la fotocamera live non funziona dentro Claude): https://claude.ai/artifact/6KiWCGc56QSRa7sPqFg5DK
- **Versione standalone per GitHub Pages** (scatto singolo + registrazione automatica della curva nel tempo, fotocamera live funzionante): pacchetto consegnato a Pier come zip, da caricare sul suo repository GitHub Pages. Contiene `index.html`, `landing.html` (pagina di vendita), `license-worker.js` (verifica licenze), `lcd-ocr.js` (motore di lettura).

## Motore di lettura del display (lcd-ocr.js)

Il display dell'NC2500 Pro usa un font a matrice di punti che Tesseract (OCR generico) non riesce a leggere in modo affidabile, anche con immagine pulita — è un problema di font non riconosciuto dal modello, non di luce/inquadratura (verificato empiricamente su foto reali). Sostituito con una pipeline su misura in JavaScript puro (nessuna libreria esterna, ~30KB invece degli ~8MB di Tesseract):

1. L'utente tocca i 4 angoli dello schermo (foto singola o video live) — sostituisce il vecchio ritaglio a 2 punti.
2. Correzione prospettica (raddrizza foto storte/in mano libera) via trasformazione proiettiva.
3. Pulizia immagine: scala di grigi, upscale 3x, autocontrasto, stima dello sfondo locale (illuminazione) tramite blur ampio, binarizzazione **adattiva** (pixel scuro rispetto al proprio sfondo locale, non rispetto a una soglia fissa uguale per tutta la foto) e "erosione" per fondere i puntini della matrice in tratti pieni.
4. Segmentazione in righe (una per slot C1–C6) e parole tramite proiezione orizzontale/verticale, con soglia adattiva (Otsu su scala logaritmica) invece di un numero fisso — necessario perché foto con riflessi/rumore diffuso possono avere un "pavimento" di rumore molto più alto negli spazi vuoti di quanto basti a una soglia fissa.
5. Riconoscimento di ogni carattere per confronto con modelli (template) ricavati da foto reali del display, tramite similarità di Jaccard.
6. L'intestazione (riga "BREAK_IN...") viene sempre saltata e la numerazione slot C1–C6 parte dalla prima riga con almeno un carattere riconosciuto con fiducia — non semplicemente "salta la prima banda", perché un riflesso proprio a cavallo tra intestazione e C1 può spezzare l'intestazione in più bande spurie, e saltarne solo una farebbe scivolare tutte le righe successive di slot.

Validato al 100% su 8 delle 9 foto reali fornite finora da Pier (modalità BREAK_IN), incluse diverse foto con riflessi/glare marcati che inizialmente mandavano in crisi la lettura in vari modi (l'intera immagine collassava in un'unica banda indistinta, i caratteri uscivano illeggibili, oppure l'intestazione frammentata dal riflesso faceva scivolare tutte le righe di uno-due slot). Risolto con soglie adattive locali invece che fisse, filtri per scartare rumore isolato senza perdere le righe vuote (C5/C6), e numerazione slot ancorata al primo contenuto riconosciuto con fiducia invece che a una posizione fissa. Template disponibili per: `. 0 1 2 3 4 5 6 9 : A C V h m` — **mancano ancora i template per le cifre 7 e 8** (nessuna foto reale le conteneva finora); il motore segnala i caratteri non riconosciuti con confidenza bassa invece di indovinare.

**Limiti noti residui**:
- Su foto molto rumorose, righe completamente vuote (es. C6 senza alcuna lettura) possono talvolta mostrare qualche carattere spurio dopo l'etichetta (es. "C6:???") per rumore/riflessi in quella zona — non compromette le letture reali, è solo un artefatto cosmetico.
- Una foto scattata con angolo di visuale sfavorevole rispetto al display (l'LCD del NC2500 Pro ha un contrasto molto sensibile all'angolo di visione) può risultare troppo "piatta" (poco contrasto testo/sfondo nell'intera immagine, non solo rumore locale) da leggere in modo affidabile qualunque soglia si usi — non ancora risolto, è un limite fisico della ripresa più che un bug della pipeline. Se capita, consigliare a Pier di rifare la foto guardando il display il più frontalmente possibile.

## Analisi AI — implementata poi rimossa (in pausa)

Era stata aggiunta una card "Analisi AI" nella scheda "Registro" (solo versione standalone GitHub Pages) che mandava le letture visibili all'API Messages di Anthropic in chiamata diretta dal browser (pattern "bring your own key", header `anthropic-dangerous-direct-browser-access`), con chiave dell'utente salvata in `localStorage` e fatturazione diretta Anthropic→utente (nessun costo/server per Pier).

Pier ha chiesto di **togliere la feature per ora** ("partiamo calmi") dopo aver discusso l'implicazione pratica: chi ha già un abbonamento Claude Pro/Max non può riusarlo per l'API, deve comunque creare un account API separato su console.anthropic.com con credito proprio — un attrito in più per l'utente finale di un'app che deve ancora consolidarsi. Rimossa il 17/09/2026: card HTML, blocco JS (`AI_KEY_STORAGE`, `runAiAnalysis`, ecc.) e chiamata `updateAiKeyUI()` nel boot, tutte eliminate da `index-standalone.html`; nessun'altra parte dell'app dipendeva da questo codice. Pacchetto GitHub Pages ri-zippato e riconsegnato senza la feature; verificato con smoke test che la pagina carica senza errori JS e le tab funzionano normalmente.

Se in futuro si volesse reintrodurla, si può ripartire dall'implementazione già scritta (conservata nella cronologia di questa sessione) oppure valutare l'alternativa con backend proxy + chiave unica di Pier (costi a suo carico, quindi da gating-are dietro PRO o con un tetto di richieste mensili).

## Monetizzazione (vedi anche `chargelog-ocr-app.md`)

App gratis (fino a 20 letture salvate, solo scatto singolo) + PRO a pagamento una tantum (illimitato + registrazione automatica + export CSV/TXT), venduta come web app diretta (non App Store), licenze via Gumroad verificate lato server con un Cloudflare Worker gratuito. Da completare quando Pier avrà creato l'account Gumroad e distribuito il Worker: aggiornare i placeholder `LICENSE_VERIFY_URL` e `BUY_URL` in `index.html`/`landing.html` con i valori reali.

## Prossimi passi

- Ricevere altre foto reali con cifre 7 e/o 8 visibili per completare i template.
- Testare la modalità IR (resistenza interna): il layout dei campi per quella modalità non è ancora confermato con una foto reale.
- Una volta che Pier ha Gumroad + Cloudflare Worker attivi, aggiornare i placeholder di licenza nel pacchetto GitHub Pages.
