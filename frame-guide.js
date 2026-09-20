/* frame-guide.js — guida live all'inquadratura per la fotocamera del
 * charger NC2500 Pro.
 *
 * Perché esiste: analizzando due foto reali della stessa schermata
 * "Ripristino" (vedi progetto), una presa con angolo di ripresa marcato e
 * una quasi perpendicolare, è emerso che la seconda legge tutti gli slot
 * perfettamente mentre la prima perde le righe più lontane
 * dall'intestazione (C3/C4) per via della distorsione prospettica residua
 * che l'algoritmo di lettura non può correggere del tutto. Questo modulo
 * dà all'utente un riscontro immediato, mentre inquadra con la fotocamera,
 * su quanto la foto che sta per scattare sia "dritta" — prima ancora di
 * arrivare alla lettura vera e propria.
 *
 * Non sostituisce il tocco manuale dei 4 angoli (che resta l'unico modo
 * per impostare davvero il ritaglio usato dall'OCR): è solo un aiuto
 * visivo, quindi un errore di rilevamento qui non deve mai bloccare né
 * alterare il flusso esistente — in caso di dubbio, il modulo segnala
 * "nessun rilevamento" invece di indovinare.
 *
 * Metodo: individua il rettangolo chiaro dello schermo (molto più
 * luminoso dello sfondo scuro del caricabatterie) su un fotogramma
 * ridotto per velocità, poi confronta la lunghezza dei lati opposti
 * (sinistra/destra, alto/basso): più sono simili, più la ripresa è
 * perpendicolare allo schermo — esattamente la stessa idea geometrica
 * verificata sulle due foto di riferimento del progetto.
 */
(function (global) {
  'use strict';

  // ---- riduzione e scala di grigi ----

  function toGrayDownscaled(source, targetW) {
    var sw = source.videoWidth || source.naturalWidth || source.width;
    var sh = source.videoHeight || source.naturalHeight || source.height;
    if (!sw || !sh) return null;
    var scale = targetW / sw;
    var tw = Math.max(1, Math.round(sw * scale));
    var th = Math.max(1, Math.round(sh * scale));
    var canvas = document.createElement('canvas');
    canvas.width = tw; canvas.height = th;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, tw, th);
    var id = ctx.getImageData(0, 0, tw, th);
    var gray = new Uint8ClampedArray(tw * th);
    for (var i = 0, p = 0; i < gray.length; i++, p += 4) {
      // luma ITU-R 601, stessa formula usata in lcd-ocr.js (warpToGray)
      gray[i] = (id.data[p] * 0.299 + id.data[p + 1] * 0.587 + id.data[p + 2] * 0.114) | 0;
    }
    return { data: gray, width: tw, height: th, sourceWidth: sw, sourceHeight: sh };
  }

  // ---- soglia Otsu (chiaro/scuro), su scala lineare: qui la distinzione
  // tra display retroilluminato e corpo scuro del caricabatterie è netta,
  // non serve la variante logaritmica usata altrove per i profili di riga.
  function otsuThreshold(gray) {
    var hist = new Uint32Array(256);
    for (var i = 0; i < gray.length; i++) hist[gray[i]]++;
    var total = gray.length;
    var sumAll = 0;
    for (var t = 0; t < 256; t++) sumAll += t * hist[t];
    var sumB = 0, wB = 0, best = 127, bestVar = -1;
    for (var t2 = 0; t2 < 256; t2++) {
      wB += hist[t2];
      if (wB === 0) continue;
      var wF = total - wB;
      if (wF === 0) break;
      sumB += t2 * hist[t2];
      var mB = sumB / wB, mF = (sumAll - sumB) / wF;
      var between = wB * wF * (mB - mF) * (mB - mF);
      if (between > bestVar) { bestVar = between; best = t2; }
    }
    return best;
  }

  // ---- componente connessa più grande sopra soglia (flood-fill iterativo:
  // l'immagine è piccola, quindi anche l'approccio più semplice va bene) ----
  // Invece di accumulare tutti i pixel del componente (spreco di memoria per
  // un dato che serve solo per i 4 angoli), si tengono aggiornati durante la
  // visita i punti estremi di (x+y) e (y-x) — lo stesso metodo usato per
  // ricavare gli angoli dello schermo dalle foto reali nell'analisi del
  // progetto: il punto con (x+y) minimo è l'angolo in alto a sinistra, quello
  // con (x+y) massimo è in basso a destra, e così via con (y-x).
  function largestBrightComponent(gray, w, h, thresh) {
    var visited = new Uint8Array(w * h);
    var stackX = new Int32Array(w * h), stackY = new Int32Array(w * h);
    var best = null, bestSize = 0;
    for (var y0 = 0; y0 < h; y0++) {
      for (var x0 = 0; x0 < w; x0++) {
        var idx0 = y0 * w + x0;
        if (visited[idx0] || gray[idx0] <= thresh) continue;
        var sp = 0;
        stackX[sp] = x0; stackY[sp] = y0; sp++;
        visited[idx0] = 1;
        var count = 0;
        var minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
        var pMinSum, pMaxSum, pMinDiff, pMaxDiff;
        while (sp > 0) {
          sp--;
          var cx = stackX[sp], cy = stackY[sp];
          count++;
          var s = cx + cy, d = cy - cx;
          if (s < minSum) { minSum = s; pMinSum = { x: cx, y: cy }; }
          if (s > maxSum) { maxSum = s; pMaxSum = { x: cx, y: cy }; }
          if (d < minDiff) { minDiff = d; pMinDiff = { x: cx, y: cy }; }
          if (d > maxDiff) { maxDiff = d; pMaxDiff = { x: cx, y: cy }; }
          var nx, ny, nidx;
          if (cx + 1 < w) { nx = cx + 1; ny = cy; nidx = ny * w + nx; if (!visited[nidx] && gray[nidx] > thresh) { visited[nidx] = 1; stackX[sp] = nx; stackY[sp] = ny; sp++; } }
          if (cx - 1 >= 0) { nx = cx - 1; ny = cy; nidx = ny * w + nx; if (!visited[nidx] && gray[nidx] > thresh) { visited[nidx] = 1; stackX[sp] = nx; stackY[sp] = ny; sp++; } }
          if (cy + 1 < h) { nx = cx; ny = cy + 1; nidx = ny * w + nx; if (!visited[nidx] && gray[nidx] > thresh) { visited[nidx] = 1; stackX[sp] = nx; stackY[sp] = ny; sp++; } }
          if (cy - 1 >= 0) { nx = cx; ny = cy - 1; nidx = ny * w + nx; if (!visited[nidx] && gray[nidx] > thresh) { visited[nidx] = 1; stackX[sp] = nx; stackY[sp] = ny; sp++; } }
        }
        if (count > bestSize) {
          bestSize = count;
          best = { count: count, tl: pMinSum, br: pMaxSum, tr: pMinDiff, bl: pMaxDiff };
        }
      }
    }
    return best;
  }

  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

  // Soglie di asimmetria tarate sulle due foto reali confrontate nel
  // progetto (vedi documentazione): la foto perpendicolare che leggeva
  // tutti gli slot aveva un'asimmetria tra lati opposti dell'~1%, quella
  // che perdeva C3/C4 era intorno al 6%.
  var GOOD_ASYM = 0.02, WARN_ASYM = 0.05;
  var MIN_SIZE_FRAC = 0.25, MAX_SIZE_FRAC = 0.97;

  function assessFraming(c, frameW, frameH) {
    var leftLen = dist(c.tl, c.bl), rightLen = dist(c.tr, c.br);
    var topLen = dist(c.tl, c.tr), botLen = dist(c.bl, c.br);
    var hAsym = 1 - Math.min(leftLen, rightLen) / Math.max(leftLen, rightLen);
    var vAsym = 1 - Math.min(topLen, botLen) / Math.max(topLen, botLen);
    var avgW = (topLen + botLen) / 2;
    var sizeFrac = avgW / frameW;

    if (sizeFrac < MIN_SIZE_FRAC) {
      return { status: 'warn', message: 'Avvicina un po’ il telefono' };
    }
    if (sizeFrac > MAX_SIZE_FRAC) {
      return { status: 'warn', message: 'Allontana un po’ il telefono' };
    }

    var worst = Math.max(hAsym, vAsym);
    if (worst < GOOD_ASYM) {
      return { status: 'good', message: 'Ottimo, tieni fermo così' };
    }

    var status = worst < WARN_ASYM ? 'warn' : 'bad';
    var message;
    // Il lato più "grande" tra i due opposti è quello più vicino
    // all'obiettivo (effetto prospettico): riportarlo alla stessa distanza
    // dell'altro lato raddrizza l'inquadratura.
    if (hAsym >= vAsym) {
      message = rightLen > leftLen
        ? 'Sposta leggermente il telefono verso sinistra'
        : 'Sposta leggermente il telefono verso destra';
    } else {
      message = botLen > topLen
        ? 'Alza leggermente il telefono'
        : 'Abbassa leggermente il telefono';
    }
    return { status: status, message: message, metrics: { hAsym: hAsym, vAsym: vAsym, sizeFrac: sizeFrac } };
  }

  function analyzeFrame(source, opts) {
    opts = opts || {};
    var targetW = opts.targetW || 200;
    var g = toGrayDownscaled(source, targetW);
    if (!g) return { status: 'none', message: '', corners: null };

    var thresh = otsuThreshold(g.data);
    var comp = largestBrightComponent(g.data, g.width, g.height, thresh);
    var totalPx = g.width * g.height;

    if (!comp || comp.count < totalPx * 0.04) {
      return { status: 'none', message: 'Inquadra lo schermo del caricabatterie', corners: null };
    }
    if (comp.count > totalPx * 0.92) {
      // Quasi tutta l'immagine sopra soglia: scena troppo uniforme (o troppo
      // luminosa) per fidarsi della rilevazione — meglio tacere che sbagliare.
      return { status: 'none', message: '', corners: null };
    }

    var scaleX = g.sourceWidth / g.width, scaleY = g.sourceHeight / g.height;
    var corners = {
      tl: { x: comp.tl.x * scaleX, y: comp.tl.y * scaleY },
      tr: { x: comp.tr.x * scaleX, y: comp.tr.y * scaleY },
      br: { x: comp.br.x * scaleX, y: comp.br.y * scaleY },
      bl: { x: comp.bl.x * scaleX, y: comp.bl.y * scaleY }
    };
    var result = assessFraming(corners, g.sourceWidth, g.sourceHeight);
    result.corners = corners;
    result.frameWidth = g.sourceWidth;
    result.frameHeight = g.sourceHeight;
    return result;
  }

  global.FrameGuide = {
    analyzeFrame: analyzeFrame,
    _internal: {
      toGrayDownscaled: toGrayDownscaled,
      otsuThreshold: otsuThreshold,
      largestBrightComponent: largestBrightComponent,
      assessFraming: assessFraming
    }
  };
})(typeof window !== 'undefined' ? window : this);
