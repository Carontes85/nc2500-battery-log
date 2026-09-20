/* lcd-ocr.js — riconoscitore dedicato per il display a matrice di punti dello
 * SkyRC NC2500 Pro (e display simili), al posto di un motore OCR generico.
 *
 * Perché esiste: Tesseract (OCR generico, addestrato su font "normali") non
 * riesce a leggere in modo affidabile il font a matrice di punti di questo
 * specifico display, anche con immagine pulita e ben illuminata — è un
 * problema di font non riconosciuto dal modello, non di luce o inquadratura.
 * Questo modulo sostituisce l'OCR generico con una pipeline su misura,
 * validata su foto reali dell'apparecchio:
 *
 *   1. Correzione prospettica a 4 punti (l'utente tocca i 4 angoli dello
 *      schermo, anche a mano libera / foto storta va bene)
 *   2. Pulizia immagine (scala di grigi, upscale, autocontrasto, "erosione"
 *      per fondere i puntini della matrice in tratti pieni, soglia)
 *   3. Segmentazione in righe e parole tramite proiezione orizzontale/verticale
 *   4. Riconoscimento di ogni carattere per confronto con modelli (template)
 *      creati da foto reali, tramite similarità di Jaccard
 *
 * Il numero di riga (1=C1, 2=C2, ... 6=C6) è noto per posizione fissa sullo
 * schermo, quindi non dipende dal riconoscimento corretto della cifra "C1" —
 * quella cifra viene comunque riconosciuta e usata solo come controllo.
 */
(function (global) {
  'use strict';

  // ---- Template glyph (base64, bit-packed 24x34, MSB-first, row-major) ----
  // Generati da foto reali del display (vedi progetto: estrazione con
  // template-matching, validata al 100% su 218 caratteri di test).
  var TEMPLATE_W = 24, TEMPLATE_H = 34;
  var RAW_TEMPLATES = [["." ,"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8AAf8AAf8AAf8AAf8AAf8AAf8AAf8AAf8AAO4AAAAA",24],["0","Af2AB//AB//gB//gB//gf//+fAB+fAA+fAB+fAP+fAP+fAf+fAf+fAf+fD/+fHx+fHx+fHx+f/w+f8A+f8B+f8B+f8A+foA+fAB+fAB+fAB+f//+B//gB//gB//gB//AAAAAAAAA",28],["1","AAAAAHwAAHwAAHwAAHwAAfwAB/wAB/wAB/wAB/wAA/wAAHwAAHwAAHwAAHwAAHwAAHwAAHwAAHwAAHwAAHwAAHwAAHwAAHwAAHwAAHwAA/+AB//AB//AB//AB//AAbuAAAAA",15],["2","AAAAAAAAA//AB//gB//gB//gP//4fAB+fAA+fAA+fAA+OAA+AAA+AAB+AAB8AAP8AAfgAAfgAAfAAAfAAH4AAHwAAHwAAHwAB/wAB8AAB8AAB8AAP//8f//+f//+f//+f//+AAAA",11],["3","A4AAf//+f//+f//+f//+f//+AAfwAAfgAAfgAAfAAH/AAH4AAH4AAH4AAH/AAB/gAAfgAAfgAAfgAAP+AAB+AAA+AAA+eAA+fAA+fAB+fAB+fAB+f//8B//gB//gB//gB//AA7+A",11],["4","AAAAAAAAAAPAAAfAAAfAAAfAAD/AAH/AAH/AAH/AA//AB+fAB8fAB8fAB8fAfAfAfAfAfAfAfAfAf//8f//8f//8f//8f//8AAfgAAfAAAfAAAfAAAfAAAfAAAfAAAfAAAPAAAAA",15],["5","f//+/////////////////////AAA/AAA/AAAfAAA///g///w///g///g///+AAA/AAA/AAA/AAA/AAA/AAA/AAA/AAA/AAA//AA//AA//AA//AA////+B//gB//gD//gB//gB//g",3],["6","AD/AAH/gAH/gAH/gAH/gB//AB8AAB8AAB8AAD8AA/wAA/AAA/AAA+AAA///A///g///g///g///g///++AA++AA++AA++AA++AA++AA++AA++AA+///+D//gD//gB//gB//AB//A",3],["9","AAAAB//gB//gB//gB//gf//8fAA+fAA+fAA+fAA+fAA+fAB+fAA+fAB+f//+B//+B//+B//+B//+AAB+AAB+AAA+AAB+AAP8AAfgAAfgAAfgB//AB/wAB/wAB/wAB/wAAAAAAAAA",12],[":","AAAAAAAAAAAAAAAAAAAAAf8AAf+AAf+AAf+AAf+AAf+AAf+AAf+AAf+AAP8AAAAAAAAAAAAAAP8AAf8AAf+AAf+AAf+AAf+AAf+AAf+AAf+AAf+AAP8AAAAAAAAAAAAAAAAAAAAA",18],["A","AAAAA//AB//gB//gB//gP//8fgB+fAB+fAA+fAA+fAA+fAA+fAA+fAA+fAA+fAA+fAA+fAA+fAB+f//+f//+f//+f//+f//+f/n+fAA+fAB+fAA+fAA+fAA+fAA+fAA+fAA+OAA8",24],["C","B//AB//gB//gB//gD//gf//+/AA+/AA+/AA+/AA+/AAA/AAA/AAA/AAA/AAA/AAA/AAA/AAA/AAA/AAA/AAA/AAA/AA8/AA+/AA+/AA+/AB+///+f//8B//gB//gB//gB//AAAAA",18],["V","AAAAGAAAfAB+fAB+fAB+fAB+fAB+fAB+fAB+fAB+fAB+fAB+fAB+fAB+fAB+fAB+fAB+fAB+fAB+fAB+fAB+fAB+fAB+f4P+B8fgB8fgB8fgB8fgA//AAHwAAHwAAHwAAHwAAAAA",12],["h","AAAAAAAAAAAAfAAAfAAAfAAAfAAAfAAAfAAAfAAAfAAAfD/AfH/gfH/gfH/gfn/gf/v+f8A+f8B+f8B+f8A+fAA+fAA+fAB+fAA+fAA+fAA+fAA+fAA+fAA+fAA+fAA+fAA+fAA8",12],["m","AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8Pgf8fgf+fgf+fgf//8fH5+fH5+fH5+fHx+fHx+fHx+fHx+fHx+fDx+fAB+fAB+fAB+fAA+fAA+fAB+fAB+fAA+OAA8",12],["8","A//AA//AA//AA//AA/+APAA8PAB8PAB8PAA8PAA8PAA8PAA8PAA8PAA8A//AA//AA//AA//AA/+APAA8PAA8PAA8PAA8PAA8PgA8PgA8PgA8PAA8Gf/YA//AA//AA//AA//AAAAA",1],["7","AAP8P//8P//8P//8P//8AAA8AAA8AAA8AAA8AAPAAAPAAAPAAAPAADwAADwAADwAADwAAHwAA8AAA8AAA8AAA8AAA8AAA8AAA8AAA8AAA8AAA8AAA8AAA8AAAEAAAAAAAAAAAAAA",1]];
  // NOTA: le stringhe sopra sono placeholder rigenerati con il pacchettatore
  // JS (vedi pack_templates.js) — bit-compatibili con l'unpacker qui sotto.

  function base64ToBytes(b64){
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function unpackBits(b64, w, h){
    var bytes = base64ToBytes(b64);
    var out = new Uint8Array(w * h);
    var nbits = w * h;
    for (var i = 0; i < nbits; i++){
      var byte = bytes[i >> 3];
      var bit = (byte >> (7 - (i & 7))) & 1;
      out[i] = bit;
    }
    return out;
  }

  var TEMPLATES = RAW_TEMPLATES.map(function (t) {
    return { ch: t[0], bitmap: unpackBits(t[1], TEMPLATE_W, TEMPLATE_H), samples: t[2] };
  });

  // ================= geometria: mappatura prospettica =================

  function orderCorners(pts) {
    // Ritorna [alto-sx, alto-dx, basso-dx, basso-sx]
    var withSum = pts.map(function (p) { return { p: p, s: p.x + p.y, d: p.y - p.x }; });
    var tl = withSum.reduce(function (a, b) { return b.s < a.s ? b : a; });
    var br = withSum.reduce(function (a, b) { return b.s > a.s ? b : a; });
    var tr = withSum.reduce(function (a, b) { return b.d < a.d ? b : a; });
    var bl = withSum.reduce(function (a, b) { return b.d > a.d ? b : a; });
    return [tl.p, tr.p, br.p, bl.p];
  }

  // Mappa il quadrato unitario (0,0)-(1,0)-(1,1)-(0,1) sul quadrilatero dato
  // dai 4 angoli (Heckbert, "Fundamentals of Texture Mapping and Image
  // Warping"). Ritorna una funzione (u,v) -> {x,y} in pixel sorgente.
  function makeQuadMap(corners) {
    var q = orderCorners(corners);
    var x0 = q[0].x, y0 = q[0].y, x1 = q[1].x, y1 = q[1].y;
    var x2 = q[2].x, y2 = q[2].y, x3 = q[3].x, y3 = q[3].y;

    var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    var dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;

    var a1, a2, a3, a4, a5, a6, a7, a8;
    if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
      a7 = 0; a8 = 0;
      a1 = x1 - x0; a2 = x3 - x0; a3 = x0;
      a4 = y1 - y0; a5 = y3 - y0; a6 = y0;
    } else {
      var den = dx1 * dy2 - dx2 * dy1;
      a7 = (dx3 * dy2 - dx2 * dy3) / den;
      a8 = (dx1 * dy3 - dx3 * dy1) / den;
      a1 = x1 - x0 + a7 * x1; a2 = x3 - x0 + a8 * x3; a3 = x0;
      a4 = y1 - y0 + a7 * y1; a5 = y3 - y0 + a8 * y3; a6 = y0;
    }
    return function (u, v) {
      var denom = a7 * u + a8 * v + 1;
      return {
        x: (a1 * u + a2 * v + a3) / denom,
        y: (a4 * u + a5 * v + a6) / denom
      };
    };
  }

  function bilinearSample(imgData, x, y) {
    var w = imgData.width, h = imgData.height, data = imgData.data;
    if (x < 0) x = 0; if (y < 0) y = 0;
    if (x > w - 1) x = w - 1; if (y > h - 1) y = h - 1;
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
    var fx = x - x0, fy = y - y0;
    function px(xx, yy) {
      var i = (yy * w + xx) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    }
    var p00 = px(x0, y0), p10 = px(x1, y0), p01 = px(x0, y1), p11 = px(x1, y1);
    var out = [0, 0, 0];
    for (var c = 0; c < 3; c++) {
      var top = p00[c] * (1 - fx) + p10[c] * fx;
      var bot = p01[c] * (1 - fx) + p11[c] * fx;
      out[c] = top * (1 - fy) + bot * fy;
    }
    return out;
  }

  // Deforma l'immagine sorgente (canvas/img già disegnato su un canvas) in
  // un rettangolo WxH secondo i 4 angoli, e converte subito in scala di
  // grigi (luma ITU-R 601, come cv2.cvtColor BGR2GRAY / PIL 'L').
  function warpToGray(sourceCanvas, corners, W, H) {
    var sctx = sourceCanvas.getContext('2d');
    var srcData = sctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    var map = makeQuadMap(corners);
    var gray = new Float32Array(W * H);
    for (var py = 0; py < H; py++) {
      var v = py / H;
      for (var px = 0; px < W; px++) {
        var u = px / W;
        var s = map(u, v);
        var rgb = bilinearSample(srcData, s.x, s.y);
        gray[py * W + px] = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
      }
    }
    return { data: gray, width: W, height: H };
  }

  // ================= pulizia immagine =================

  function grayToCanvas(grayImg) {
    var c = document.createElement('canvas');
    c.width = grayImg.width; c.height = grayImg.height;
    var ctx = c.getContext('2d');
    var id = ctx.createImageData(grayImg.width, grayImg.height);
    for (var i = 0; i < grayImg.data.length; i++) {
      var v = grayImg.data[i];
      id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  function upscaleGray(grayImg, scale) {
    var srcCanvas = grayToCanvas(grayImg);
    var dw = grayImg.width * scale, dh = grayImg.height * scale;
    var dst = document.createElement('canvas');
    dst.width = dw; dst.height = dh;
    var dctx = dst.getContext('2d');
    dctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in dctx) dctx.imageSmoothingQuality = 'high';
    dctx.drawImage(srcCanvas, 0, 0, dw, dh);
    var id = dctx.getImageData(0, 0, dw, dh);
    var out = new Float32Array(dw * dh);
    for (var i = 0; i < out.length; i++) out[i] = id.data[i * 4];
    return { data: out, width: dw, height: dh };
  }

  function autocontrast(grayImg, cutoffPct) {
    var data = grayImg.data, n = data.length;
    var hist = new Uint32Array(256);
    for (var i = 0; i < n; i++) hist[Math.max(0, Math.min(255, Math.round(data[i])))]++;
    var cut = Math.floor(n * (cutoffPct / 100));
    var lo = 0, acc = 0;
    while (lo < 255) { acc += hist[lo]; if (acc > cut) break; lo++; }
    var hi = 255; acc = 0;
    while (hi > 0) { acc += hist[hi]; if (acc > cut) break; hi--; }
    if (hi <= lo) { hi = 255; lo = 0; }
    var scale = 255 / (hi - lo);
    var out = new Float32Array(n);
    for (var j = 0; j < n; j++) {
      var v = (data[j] - lo) * scale;
      out[j] = v < 0 ? 0 : (v > 255 ? 255 : v);
    }
    return { data: out, width: grayImg.width, height: grayImg.height };
  }

  // Filtro minimo (erosione dei chiari = dilatazione dell'inchiostro scuro),
  // separabile: passata orizzontale poi verticale, ognuna O(n) tramite una
  // coda monotona (sliding window minimum), con replica del bordo.
  function slidingMin1D(arr, n, k) {
    var half = Math.floor(k / 2);
    var out = new Float32Array(n);
    var dq = new Int32Array(n); // indici
    var dqHead = 0, dqTail = 0; // [head, tail)
    // finestra logica su indici estesi [-half, n-1+half], clampati a [0,n-1]
    for (var i = -half; i < n + half; i++) {
      var idx = i < 0 ? 0 : (i >= n ? n - 1 : i);
      var val = arr[idx];
      while (dqTail > dqHead && arr[dq[dqTail - 1] < 0 ? 0 : (dq[dqTail - 1] >= n ? n - 1 : dq[dqTail - 1])] >= val) dqTail--;
      dq[dqTail++] = i;
      while (dq[dqHead] <= i - k) dqHead++;
      var outIdx = i - half;
      if (outIdx >= 0 && outIdx < n) {
        var frontIdx = dq[dqHead];
        var frontClamped = frontIdx < 0 ? 0 : (frontIdx >= n ? n - 1 : frontIdx);
        out[outIdx] = arr[frontClamped];
      }
    }
    return out;
  }

  function minFilter2D(grayImg, k) {
    var w = grayImg.width, h = grayImg.height, data = grayImg.data;
    var tmp = new Float32Array(w * h);
    var row = new Float32Array(w);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) row[x] = data[y * w + x];
      var rowMin = slidingMin1D(row, w, k);
      for (var x2 = 0; x2 < w; x2++) tmp[y * w + x2] = rowMin[x2];
    }
    var out = new Float32Array(w * h);
    var col = new Float32Array(h);
    for (var x3 = 0; x3 < w; x3++) {
      for (var y2 = 0; y2 < h; y2++) col[y2] = tmp[y2 * w + x3];
      var colMin = slidingMin1D(col, h, k);
      for (var y3 = 0; y3 < h; y3++) out[y3 * w + x3] = colMin[y3];
    }
    return { data: out, width: w, height: h };
  }

  // Filtro massimo (l'opposto del filtro minimo sopra): usato come primo
  // passo di pulizia per cancellare puntini isolati di rumore (granulosità
  // JPEG, riflessi) su foto scattate in condizioni difficili, PRIMA di
  // infittire i tratti reali del testo con il filtro minimo. Un puntino di
  // rumore isolato, più piccolo della finestra, sparisce; un tratto di
  // testo vero, più esteso, resta.
  function slidingMax1D(arr, n, k) {
    var half = Math.floor(k / 2);
    var out = new Float32Array(n);
    var dq = new Int32Array(n);
    var dqHead = 0, dqTail = 0;
    for (var i = -half; i < n + half; i++) {
      var idx = i < 0 ? 0 : (i >= n ? n - 1 : i);
      var val = arr[idx];
      while (dqTail > dqHead && arr[dq[dqTail - 1] < 0 ? 0 : (dq[dqTail - 1] >= n ? n - 1 : dq[dqTail - 1])] <= val) dqTail--;
      dq[dqTail++] = i;
      while (dq[dqHead] <= i - k) dqHead++;
      var outIdx = i - half;
      if (outIdx >= 0 && outIdx < n) {
        var frontIdx = dq[dqHead];
        var frontClamped = frontIdx < 0 ? 0 : (frontIdx >= n ? n - 1 : frontIdx);
        out[outIdx] = arr[frontClamped];
      }
    }
    return out;
  }

  function maxFilter2D(grayImg, k) {
    var w = grayImg.width, h = grayImg.height, data = grayImg.data;
    var tmp = new Float32Array(w * h);
    var row = new Float32Array(w);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) row[x] = data[y * w + x];
      var rowMax = slidingMax1D(row, w, k);
      for (var x2 = 0; x2 < w; x2++) tmp[y * w + x2] = rowMax[x2];
    }
    var out = new Float32Array(w * h);
    var col = new Float32Array(h);
    for (var x3 = 0; x3 < w; x3++) {
      for (var y2 = 0; y2 < h; y2++) col[y2] = tmp[y2 * w + x3];
      var colMax = slidingMax1D(col, h, k);
      for (var y3 = 0; y3 < h; y3++) out[y3 * w + x3] = colMax[y3];
    }
    return { data: out, width: w, height: h };
  }

  function threshold(grayImg, t) {
    var n = grayImg.data.length;
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = grayImg.data[i] < t ? 1 : 0;
    return { data: out, width: grayImg.width, height: grayImg.height };
  }

  // Stima dello "sfondo" locale (illuminazione), tramite un blur molto
  // ampio ottenuto in modo economico: si rimpicciolisce l'immagine (la
  // resample con smoothing del canvas fa già da media locale) e poi la si
  // ringrandisce. Il risultato varia lentamente nello spazio — segue
  // riflessi/ombre — ma non i singoli tratti del testo. Serve per
  // binarizzare in modo adattivo invece che con una soglia fissa, perché
  // una foto con riflesso di luce su una parte dello schermo può rendere
  // inutile qualunque soglia globale (una parte diventa troppo chiara,
  // l'altra relativamente troppo scura).
  function localBackground(grayImg, smallDim) {
    var w = grayImg.width, h = grayImg.height;
    var srcCanvas = grayToCanvas(grayImg);
    var sw = Math.max(2, Math.round(w * smallDim / Math.max(w, h)));
    var sh = Math.max(2, Math.round(h * smallDim / Math.max(w, h)));
    var small = document.createElement('canvas');
    small.width = sw; small.height = sh;
    var sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in sctx) sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(srcCanvas, 0, 0, sw, sh);
    var big = document.createElement('canvas');
    big.width = w; big.height = h;
    var bctx = big.getContext('2d');
    bctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in bctx) bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(small, 0, 0, w, h);
    var id = bctx.getImageData(0, 0, w, h);
    var out = new Float32Array(w * h);
    for (var i = 0; i < out.length; i++) out[i] = id.data[i * 4];
    return { data: out, width: w, height: h };
  }

  // Soglia adattiva: un pixel è "inchiostro" se è più scuro dello sfondo
  // locale di almeno C livelli, invece di confrontarlo con un numero fisso
  // uguale per tutta l'immagine.
  function adaptiveThreshold(grayImg, bgImg, C) {
    var n = grayImg.data.length;
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = (bgImg.data[i] - grayImg.data[i]) > C ? 1 : 0;
    return { data: out, width: grayImg.width, height: grayImg.height };
  }

  // ================= segmentazione =================

  function rowInkSums(ink) {
    var w = ink.width, h = ink.height, data = ink.data;
    var m = Math.floor(w * 0.02);
    var sums = new Int32Array(h);
    for (var y = 0; y < h; y++) {
      var s = 0;
      for (var x = m; x < w - m; x++) s += data[y * w + x];
      sums[y] = s;
    }
    return sums;
  }

  // Soglia adattiva (Otsu) tra "riga di testo" e "spazio vuoto" sul profilo
  // di densità d'inchiostro. Un numero fisso (es. "somma > 5") funziona solo
  // su foto pulite: una foto con riflessi/rumore diffuso (granulosità,
  // moiré del display) può avere un pavimento di rumore di centinaia di
  // pixel anche negli spazi vuoti, quindi la soglia va ricalcolata caso per
  // caso confrontando il "livello basso" (spazi) col "livello alto" (testo)
  // di quella specifica foto.
  function otsuThreshold(values) {
    // Otsu su scala logaritmica: i profili di densità d'inchiostro hanno
    // spesso tre "livelli" ben distinti — vuoto (~0), testo scarno come
    // "C5:" senza cifre, testo pieno con molte cifre — con il livello
    // "pieno" spesso un ordine di grandezza sopra gli altri due (es. il
    // testo dell'intestazione può arrivare a migliaia). Su scala lineare
    // Otsu massimizza la varianza tra le due classi più separate, che
    // spesso sono "scarno" vs "pieno", lasciando fuori (sotto soglia) le
    // righe scarne ma comunque reali (es. C5/C6 vuote, con solo l'etichetta).
    // Su scala logaritmica le distanze si comprimono in modo da far
    // emergere invece la soglia giusta, quella tra "vuoto" e "qualsiasi
    // contenuto reale".
    var n = values.length;
    var logVals = new Float64Array(n);
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < n; i++) {
      var lv = Math.log(1 + Math.max(0, values[i]));
      logVals[i] = lv;
      if (lv < min) min = lv;
      if (lv > max) max = lv;
    }
    if (max <= min) return Math.exp(min) - 1;
    var BINS = 256;
    var hist = new Float64Array(BINS);
    var scale = (BINS - 1) / (max - min);
    for (var j = 0; j < n; j++) hist[Math.round((logVals[j] - min) * scale)]++;

    var total = n;
    var sumAll = 0;
    for (var b = 0; b < BINS; b++) sumAll += b * hist[b];
    var sumB = 0, wB = 0, best = -1, bestVar = -1;
    for (var t = 0; t < BINS; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      var wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      var mB = sumB / wB;
      var mF = (sumAll - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > bestVar) { bestVar = between; best = t; }
    }
    var threshLog = min + best / scale;
    return Math.exp(threshLog) - 1;
  }

  // Righe adiacenti sullo schermo (in particolare l'intestazione seguita
  // subito da C1) a volte hanno un varco di 1-2 px che, a seconda della
  // risoluzione della foto, può richiudersi e far fondere due bande in una
  // sola — disallineando tutte le righe successive. Per essere robusti
  // anche con angoli toccati in modo impreciso (quindi senza poter
  // assumere posizioni fisse), qui ri-separiamo qualunque banda molto più
  // alta delle altre, tagliandola nel punto di minor densità d'inchiostro.
  function splitOutlierBands(bands, sums) {
    if (bands.length < 2) return bands;
    var heights = bands.map(function (b) { return b[1] - b[0]; });
    var sorted = heights.slice().sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)];
    var out = [];
    bands.forEach(function (b, i) {
      var h = heights[i];
      if (h > median * 1.6 && h > 40) {
        var margin = Math.round(h * 0.2);
        var bestY = -1, bestVal = Infinity;
        for (var y = b[0] + margin; y < b[1] - margin; y++) {
          if (sums[y] < bestVal) { bestVal = sums[y]; bestY = y; }
        }
        if (bestY > 0 && bestVal < median) {
          out.push([b[0], bestY]);
          out.push([bestY, b[1]]);
          return;
        }
      }
      out.push(b);
    });
    return out;
  }

  function rowBands(ink) {
    var w = ink.width, h = ink.height;
    var m = Math.floor(w * 0.02), mh = Math.floor(h * 0.02);
    var sums = rowInkSums(ink);
    var inner = Array.prototype.slice.call(sums, mh, h - mh);
    var thresh = Math.max(5, otsuThreshold(inner));
    var bands = [];
    var inBand = false, start = 0;
    for (var y = mh; y < h - mh; y++) {
      var s = sums[y];
      if (s > thresh && !inBand) { inBand = true; start = y; }
      else if (s <= thresh && inBand) { inBand = false; bands.push([start, y]); }
    }
    if (inBand) bands.push([start, h - mh]);
    // Scarta bande larghe pochi pixel: rumore (bordo della cornice LCD,
    // antialiasing) mai abbastanza alto da essere una riga di testo reale.
    bands = bands.filter(function (b) { return (b[1] - b[0]) >= 30; });
    bands = splitOutlierBands(bands, sums);
    return bands;
  }

  function colBands(ink, y0, y1) {
    var w = ink.width, data = ink.data;
    var m = Math.floor(w * 0.02);
    var sums = new Int32Array(w);
    for (var x = m; x < w - m; x++) {
      var s = 0;
      for (var y = y0; y < y1; y++) s += data[y * w + x];
      sums[x] = s;
    }
    var thresh = Math.max(2, otsuThreshold(Array.prototype.slice.call(sums, m, w - m)));
    var bands = [];
    var inBand = false, start = 0;
    for (var x2 = m; x2 < w - m; x2++) {
      var sv = sums[x2];
      if (sv > thresh && !inBand) { inBand = true; start = x2; }
      else if (sv <= thresh && inBand) { inBand = false; bands.push([start, x2]); }
    }
    if (inBand) bands.push([start, w - m]);
    // Un varco larghissimo separa due caratteri distinti (di solito >=18px
    // a questa scala); un varco larghissimo di 1-2px in mezzo a una banda è
    // quasi sempre un taglio spurio dentro un solo carattere (es. la "A":
    // in certe foto una minuscola discontinuità nella soglia adattiva
    // spacca la gamba destra dalla sinistra) — quindi le ricongiungiamo
    // prima di applicare il filtro sulla larghezza minima.
    // Limite di larghezza per non fondere per sbaglio più caratteri veri
    // ravvicinati (succede in foto più rumorose, dove la soglia più
    // permissiva può quasi far toccare due cifre distinte): un carattere
    // singolo a questa scala non supera mai ~140px.
    var MAX_CHAR_W = 140;
    var merged = [];
    for (var bi = 0; bi < bands.length; bi++) {
      var last = merged.length ? merged[merged.length - 1] : null;
      if (last && bands[bi][0] - last[1] < 10 && (bands[bi][1] - last[0]) <= MAX_CHAR_W) {
        last[1] = bands[bi][1];
      } else {
        merged.push(bands[bi].slice());
      }
    }
    // Scarta bande di larghezza minima: un puntino di rumore isolato (bagliore,
    // granulosità) è molto più stretto di qualunque carattere reale a questa
    // scala (anche i più stretti, come "1" o ":", superano abbondantemente
    // questa soglia).
    return merged.filter(function (b) { return (b[1] - b[0]) >= 32; });
  }

  function groupWords(bands, gapThresh) {
    if (!bands.length) return [];
    var words = [[bands[0]]];
    for (var i = 1; i < bands.length; i++) {
      var gap = bands[i][0] - bands[i - 1][1];
      if (gap > gapThresh) words.push([bands[i]]);
      else words[words.length - 1].push(bands[i]);
    }
    return words;
  }

  // ================= riconoscimento glifi =================

  function normalizeGlyph(ink, y0, y1, x0, x1) {
    var w = x1 - x0, h = y1 - y0;
    var src = document.createElement('canvas');
    src.width = Math.max(1, w); src.height = Math.max(1, h);
    var sctx = src.getContext('2d');
    var id = sctx.createImageData(src.width, src.height);
    var iw = ink.width;
    for (var yy = 0; yy < h; yy++) {
      for (var xx = 0; xx < w; xx++) {
        var isInk = ink.data[(y0 + yy) * iw + (x0 + xx)];
        var v = isInk ? 0 : 255; // inchiostro nero su sfondo bianco
        var i = (yy * w + xx) * 4;
        id.data[i] = v; id.data[i + 1] = v; id.data[i + 2] = v; id.data[i + 3] = 255;
      }
    }
    sctx.putImageData(id, 0, 0);

    var scale = Math.min(TEMPLATE_W / w, TEMPLATE_H / h);
    var nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
    var dst = document.createElement('canvas');
    dst.width = TEMPLATE_W; dst.height = TEMPLATE_H;
    var dctx = dst.getContext('2d');
    dctx.fillStyle = '#fff';
    dctx.fillRect(0, 0, TEMPLATE_W, TEMPLATE_H);
    dctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in dctx) dctx.imageSmoothingQuality = 'high';
    var ox = Math.floor((TEMPLATE_W - nw) / 2), oy = Math.floor((TEMPLATE_H - nh) / 2);
    dctx.drawImage(src, 0, 0, w, h, ox, oy, nw, nh);

    var outId = dctx.getImageData(0, 0, TEMPLATE_W, TEMPLATE_H);
    var bitmap = new Uint8Array(TEMPLATE_W * TEMPLATE_H);
    for (var i2 = 0; i2 < bitmap.length; i2++) bitmap[i2] = outId.data[i2 * 4] < 128 ? 1 : 0;
    return bitmap;
  }

  function jaccard(a, b) {
    var inter = 0, union = 0;
    for (var i = 0; i < a.length; i++) {
      var av = a[i], bv = b[i];
      if (av || bv) { union++; if (av && bv) inter++; }
    }
    if (union === 0) return 1; // entrambi vuoti: considera identici (spazio bianco)
    return inter / union;
  }

  var MIN_SCORE = 0.45;
  var MIN_MARGIN = 0.03;

  function classifyGlyph(bitmap) {
    var best = null, bestScore = -1, second = -1;
    for (var i = 0; i < TEMPLATES.length; i++) {
      var s = jaccard(bitmap, TEMPLATES[i].bitmap);
      if (s > bestScore) { second = bestScore; bestScore = s; best = TEMPLATES[i].ch; }
      else if (s > second) { second = s; }
    }
    var margin = bestScore - (second < 0 ? 0 : second);
    var uncertain = bestScore < MIN_SCORE || margin < MIN_MARGIN;
    return { ch: best, score: bestScore, margin: margin, uncertain: uncertain };
  }

  // ================= pipeline completa =================

  var BOARD_W = 1000, BOARD_H = 560, SCALE = 3, GAP_SPACE_THRESH = 90;

  // Viste con più righe ravvicinate (es. "Ripristino" del caricabatterie,
  // che elenca C1..C6 tutti insieme) sono molto sensibili a un residuo di
  // rotazione/prospettiva mai perfettamente corretto dai 4 angoli toccati a
  // mano — anche pochi punti di inclinazione bastano a far "toccare"
  // verticalmente righe adiacenti, disallineando la lettura. L'intestazione
  // (la barra scura con "BREAK_IN"/orario) è però un rettangolo pulito e
  // molto più facile da individuare con precisione di una singola riga di
  // testo: la si usa come riferimento, misurando quanto la sua parte più
  // scura si sposta in verticale scorrendo da sinistra a destra, e si
  // raddrizza l'intera immagine di quella stessa quantità prima di
  // proseguire — la stessa idea di usare un elemento noto come riferimento
  // per raddrizzare E dedurre la spaziatura delle righe sotto, suggerita da
  // Pier il 20/09/2026. Per una foto già ben inquadrata (angoli precisi,
  // inclinazione ~0) questo non cambia nulla: i controlli di sicurezza
  // sotto fanno sì che una misura incerta o assente lasci l'immagine così
  // com'era.
  function estimateHeaderTilt(grayImg) {
    var w = grayImg.width, h = grayImg.height, data = grayImg.data;
    // L'intestazione sta sempre vicino alla cima (foto inquadrata dai 4
    // angoli dello schermo): si cerca lì, ma non a partire da y=0 — il
    // primissimo bordo può includere un filo di sfondo/cornice fuori dal
    // display se gli angoli toccati sconfinano di poco, molto più scuro
    // persino dell'intestazione e quindi fuorviante.
    var searchY0 = Math.round(h * 0.08);
    var searchY1 = Math.min(h, Math.round(h * 0.30));
    var margin = Math.floor(w * 0.05);
    var nSamples = 9;
    var pts = [];
    for (var i = 0; i < nSamples; i++) {
      var xc = Math.round(margin + (w - 2 * margin) * (i + 0.5) / nSamples);
      var halfWin = Math.max(10, Math.floor(w * 0.03));
      var x0 = Math.max(0, xc - halfWin), x1 = Math.min(w, xc + halfWin);
      var bestY = -1, bestV = Infinity;
      for (var y = searchY0; y < searchY1; y++) {
        var s = 0, c = 0;
        for (var x = x0; x < x1; x++) { s += data[y * w + x]; c++; }
        var mean = s / c;
        if (mean < bestV) { bestV = mean; bestY = y; }
      }
      pts.push([xc, bestY, bestV]);
    }
    // L'intestazione è nettamente più scura in media (blocco invertito) del
    // semplice sfondo bianco: se la maggior parte dei campioni non trova
    // nulla di così scuro, probabilmente non c'è un'intestazione di questo
    // tipo in questa vista (es. crop diverso) — meglio non correggere che
    // correggere sulla base di rumore.
    var darkEnough = pts.filter(function (p) { return p[2] < 190; });
    if (darkEnough.length < nSamples * 0.7) return 0;
    var n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    pts.forEach(function (p) { sx += p[0]; sy += p[1]; sxx += p[0] * p[0]; sxy += p[0] * p[1]; });
    var denom = (n * sxx - sx * sx);
    if (Math.abs(denom) < 1e-6) return 0;
    var slope = (n * sxy - sx * sy) / denom;
    var intercept = (sy - slope * sx) / n;
    // La stima è affidabile solo se i punti stanno bene allineati su una
    // retta: un'intestazione vera ha un bordo dritto, del rumore sparso no.
    var maxResidual = 0;
    pts.forEach(function (p) {
      var pred = slope * p[0] + intercept;
      maxResidual = Math.max(maxResidual, Math.abs(pred - p[1]));
    });
    if (maxResidual > 60) return 0;
    if (Math.abs(slope) > 0.25) return 0; // inclinazione implausibile: probabile misura errata
    return slope;
  }
  // Ricampiona ogni colonna spostandola in verticale in base all'inclinazione
  // misurata sopra, ruotando attorno alla colonna centrale (minimizza quanto
  // contenuto rischia di uscire dal bordo alto/basso rispetto a ruotare da
  // un'estremità).
  function deskewShear(grayImg, slope) {
    if (!slope) return grayImg;
    var w = grayImg.width, h = grayImg.height, data = grayImg.data;
    var cx = w / 2;
    var out = new Float32Array(w * h);
    for (var x = 0; x < w; x++) {
      var shift = Math.round(slope * (x - cx));
      for (var y = 0; y < h; y++) {
        var srcY = y + shift;
        out[y * w + x] = (srcY >= 0 && srcY < h) ? data[srcY * w + x] : 255;
      }
    }
    return { data: out, width: w, height: h };
  }

  function recognizeBoard(sourceCanvas, corners) {
    var warped = warpToGray(sourceCanvas, corners, BOARD_W, BOARD_H);
    var up = upscaleGray(warped, SCALE);
    var ac0 = autocontrast(up, 1);
    var ac = deskewShear(ac0, estimateHeaderTilt(ac0));
    var bg = localBackground(ac, 24);
    var denoised = maxFilter2D(ac, 3);
    var eroded = minFilter2D(minFilter2D(denoised, 5), 3);
    var ink = adaptiveThreshold(eroded, bg, 40);

    var bands = rowBands(ink);
    // Classifica il contenuto di una banda [y0,y1) in parole/caratteri.
    // Estratta in funzione a sé perché serve due volte: una prima passata
    // su tutte le bande così come trovate, e una seconda passata mirata
    // solo sulle righe che il raffinamento a passo costante (più sotto)
    // ricolloca a un'altezza diversa.
    function buildRow(y0, y1) {
      var cbands = colBands(ink, y0, y1);
      if (!cbands.length) return { words: [] };
      var wordGroups = groupWords(cbands, GAP_SPACE_THRESH);
      var words = wordGroups.map(function (wg) {
        var chars = wg.map(function (cb) {
          var bmp = normalizeGlyph(ink, y0, y1, cb[0], cb[1]);
          var cls = classifyGlyph(bmp);
          return cls;
        });
        var text = chars.map(function (c) { return c.uncertain ? '?' : c.ch; }).join('');
        return { chars: chars, text: text };
      });
      return { words: words };
    }
    var rows = bands.map(function (b, ri) {
      var row = buildRow(b[0], b[1]);
      row.bandIndex = ri;
      return row;
    });

    // Ricostruisci il testo per riga, forzando il numero di slot (C1..C6)
    // in base alla posizione della riga (nota e fissa), non al carattere
    // riconosciuto — più robusto di fidarsi della cifra letta.
    //
    // La riga 0 (intestazione) si salta sempre. Ma un riflesso/bagliore
    // proprio a cavallo tra intestazione e C1 può spezzare l'intestazione
    // in più bande spurie: in quel caso saltarne solo una non basta e tutte
    // le righe successive scivolerebbero di slot. In più, l'intestazione
    // include spesso un orario ("27:08:17") con cifre vere e proprie
    // (2,0,8,1...) lette con piena fiducia — quindi "contiene un carattere
    // leggibile" da solo NON basta più a distinguerla da una riga di
    // lettura vera, in viste con più canali dove l'intestazione arriva a
    // spezzarsi abbastanza da isolare quell'orario in una banda a sé.
    // Ogni riga di lettura vera comincia però sempre con l'etichetta
    // "C1:".."C6:" — qui si salta ogni banda finché non se ne trova una il
    // cui primo carattere è riconosciuto con fiducia proprio come "C".
    function looksLikeSlotRow(row) {
      if (!row.words.length) return false;
      var chars = row.words[0].chars;
      if (!chars.length) return false;
      return !chars[0].uncertain && chars[0].ch === 'C';
    }
    // Ripiego per foto molto scure/sfocate dove anche la "C" iniziale non
    // viene letta con fiducia: meglio il criterio più permissivo di prima
    // (un carattere qualunque leggibile) che nessuna lettura.
    function hasConfidentText(row) {
      return row.words.some(function (w) { return /[^?]/.test(w.text); });
    }
    var startIdx = 1;
    while (startIdx < rows.length && !looksLikeSlotRow(rows[startIdx])) startIdx++;
    if (startIdx >= rows.length) {
      startIdx = 1;
      while (startIdx < rows.length && !hasConfidentText(rows[startIdx])) startIdx++;
    }

    // Raffinamento a passo di riga costante (idea di Pier): sul display il
    // passo verticale tra C1..C6 è fisso, quindi le righe lette con
    // sicurezza (quelle il cui primo carattere è una "C" con fiducia)
    // servono da riferimento per calcolare dove dovrebbero trovarsi ESATTAMENTE
    // le righe incerte, invece di fidarsi del confine trovato localmente da
    // rowBands — che su righe che si toccano (o quasi) può cadere dentro un
    // carattere invece che nello spazio vuoto tra due righe, producendo
    // lettura sporca su entrambi i lati del taglio.
    //
    // Si usa un fit lineare (minimi quadrati) y0(slot) = intercetta + passo*slot
    // sulle sole righe di riferimento, poi si ricalcolano le bande di TUTTE
    // le righe non di riferimento in quella finestra di 6 slot con quella
    // formula, mantenendo l'altezza tipica delle righe di riferimento. Le
    // righe già lette con sicurezza non vengono mai toccate: nel peggiore dei
    // casi (fit poco affidabile, foto anomala) le guardie sotto fanno sì che
    // il raffinamento non si applichi affatto, tornando al comportamento
    // originale.
    // Una riga "affidabile" non basta che inizi con una "C" letta bene: la
    // sola etichetta ("C3:", "C4:") è una forma grande e semplice, quasi
    // sempre riconosciuta anche quando il resto della riga (i valori dopo)
    // è sporco per il contatto con la riga adiacente. Serve guardare la
    // riga per intero: se una frazione consistente dei suoi caratteri è
    // incerta, quella riga NON va usata come riferimento — ed è proprio
    // una candidata a essere corretta dal raffinamento.
    function isReliableRow(row) {
      if (!looksLikeSlotRow(row)) return false;
      var total = 0, uncertain = 0;
      row.words.forEach(function (w) {
        w.chars.forEach(function (c) { total++; if (c.uncertain) uncertain++; });
      });
      if (total === 0) return false;
      return (uncertain / total) < 0.2;
    }
    (function refineRowBandsByPitch() {
      var anchors = []; // { slot, y0, y1 }
      for (var s = 1, ix = startIdx; s <= 6 && ix < rows.length; s++, ix++) {
        if (isReliableRow(rows[ix])) {
          anchors.push({ slot: s, idx: ix, y0: bands[ix][0], y1: bands[ix][1] });
        }
      }
      // Servono almeno 2 righe di riferimento per un fit lineare, e ce ne
      // deve essere almeno una da correggere: altrimenti non c'è nulla da
      // fare (o nulla su cui basarsi).
      if (anchors.length < 2 || anchors.length >= Math.min(6, rows.length - startIdx)) return;

      var n = anchors.length, sumX = 0, sumY = 0;
      anchors.forEach(function (a) { sumX += a.slot; sumY += a.y0; });
      var meanX = sumX / n, meanY = sumY / n;
      var num = 0, den = 0;
      anchors.forEach(function (a) {
        num += (a.slot - meanX) * (a.y0 - meanY);
        den += (a.slot - meanX) * (a.slot - meanX);
      });
      if (den === 0) return;
      var pitch = num / den;
      // Il passo deve essere positivo e di un ordine di grandezza plausibile
      // per una riga di testo a questa scala (upscale ×3): una foto anomala
      // o riferimenti fuorvianti non devono produrre spostamenti assurdi.
      if (!(pitch > 60 && pitch < 500)) return;

      var heights = anchors.map(function (a) { return a.y1 - a.y0; }).sort(function (a, b) { return a - b; });
      var medHeight = heights[Math.floor(heights.length / 2)];

      for (var s2 = 1, ix2 = startIdx; s2 <= 6 && ix2 < rows.length; s2++, ix2++) {
        if (isReliableRow(rows[ix2])) continue; // riga di riferimento: non si tocca
        var fittedY0 = Math.round(intercept(meanX, meanY, pitch, s2));
        var fittedY1 = fittedY0 + medHeight;
        var origY0 = bands[ix2][0];
        // Diffida di un fit che sposterebbe la riga troppo lontano da dove
        // rowBands l'aveva già individuata: probabile segno di riferimenti
        // scarsi o di una foto con geometria diversa dal previsto.
        if (Math.abs(fittedY0 - origY0) > medHeight * 1.5) continue;
        var refined = buildRow(fittedY0, fittedY1);
        refined.bandIndex = rows[ix2].bandIndex;
        rows[ix2] = refined;
      }
      function intercept(mx, my, p, slot) { return (my - p * mx) + p * slot; }
    })();

    var lines = [];
    var slotTexts = {};
    for (var slot = 1, i = startIdx; slot <= 6 && i < rows.length; slot++, i++) {
      var row = rows[i];
      if (!row.words.length) continue;
      var w0 = row.words[0].text;
      // [\d?]* invece di \d*: se la cifra dello slot è stata riconosciuta
      // con poca fiducia resta un "?" al suo posto (es. "C?:0.09A") — va
      // comunque tolto insieme alla "C" e ai ":", non solo quando è una
      // cifra vera, altrimenti resta un "?:" spurio davanti al valore.
      var forcedW0 = 'C' + slot + ':' + w0.replace(/^C[\d?]*:?/, '');
      // Scarta parole interamente non riconosciute ("???"): su una riga
      // vuota (C5/C6 senza lettura) un residuo di rumore isolato può
      // formare una "parola" a sé, ma se nessun carattere al suo interno
      // è stato riconosciuto con fiducia è quasi certamente rumore, non
      // testo reale — un vero valore letto ha sempre almeno un carattere
      // leggibile.
      var extraWords = row.words.slice(1)
        .map(function (w) { return w.text; })
        .filter(function (t) { return !/^\?+$/.test(t); });
      var wordTexts = [forcedW0].concat(extraWords);
      var lineText = wordTexts.join(' ');
      lines.push(lineText);
      slotTexts[slot] = lineText;
    }

    return {
      text: lines.join('\n'),
      rows: rows,
      slotTexts: slotTexts
    };
  }

  global.LcdOcr = {
    recognizeBoard: recognizeBoard,
    orderCorners: orderCorners,
    _internal: { warpToGray: warpToGray, upscaleGray: upscaleGray, autocontrast: autocontrast, minFilter2D: minFilter2D, maxFilter2D: maxFilter2D, localBackground: localBackground, adaptiveThreshold: adaptiveThreshold, threshold: threshold, rowBands: rowBands, colBands: colBands, groupWords: groupWords, normalizeGlyph: normalizeGlyph, classifyGlyph: classifyGlyph, TEMPLATES: TEMPLATES }
  };
})(window);
