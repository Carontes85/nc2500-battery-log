// Cloudflare Worker — verifica licenze ChargeLog OCR
//
// Cosa fa: riceve un codice licenza dall'app, lo passa all'API di Gumroad
// (server-to-server, niente problemi di CORS) e risponde solo {valid:true}
// o {valid:false, message:"..."}. Il codice Gumroad vero e proprio non
// viene mai esposto/verificato nel browser dell'utente: la app pubblica
// (su GitHub Pages) parla solo con questo Worker.
//
// Come si installa (nessuna riga di comando richiesta):
// 1. Vai su https://dash.cloudflare.com , crea un account gratuito se non
//    ce l'hai.
// 2. Nel menu a sinistra: "Workers e Pages" -> "Crea" -> "Crea Worker".
//    Dagli un nome (es. "chargelog-license") e clicca "Distribuisci" per
//    creare il worker vuoto.
// 3. Clicca "Modifica codice" (o "Quick edit"): si apre un editor nel
//    browser. Cancella il contenuto di esempio e incolla TUTTO questo
//    file al suo posto.
// 4. Sostituisci PRODUCT_PERMALINK qui sotto con la parte del link del tuo
//    prodotto Gumroad dopo "/l/" (es. se il link è
//    https://tuonome.gumroad.com/l/abcde, il permalink è "abcde").
// 5. Clicca "Distribuisci"/"Salva e distribuisci". Cloudflare ti darà un
//    indirizzo tipo https://chargelog-license.tuonome.workers.dev
// 6. In index.html, imposta LICENSE_VERIFY_URL su
//    https://chargelog-license.tuonome.workers.dev/verify (con /verify
//    alla fine) e ricarica il file su GitHub.
//
// Costo: il piano gratuito di Cloudflare Workers include 100.000 richieste
// al giorno — molto più di quanto un prodotto di nicchia come questo userà
// mai.

const PRODUCT_PERMALINK = 'PRODOTTO'; // <-- la parte dopo /l/ nel link del tuo prodotto Gumroad
const MAX_ACTIVATIONS = 3; // quante volte lo stesso codice può essere attivato (0 = nessun limite)
const ALLOW_ORIGIN = '*'; // per più sicurezza, in seguito puoi restringerlo a "https://tuonome.github.io"

function corsHeaders(){
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function json(body, status){
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders()),
  });
}

async function handleVerify(request){
  let body;
  try { body = await request.json(); }
  catch (e){ return json({ valid: false, message: 'Richiesta non valida.' }, 400); }

  const licenseKey = (body && body.license_key ? String(body.license_key) : '').trim();
  if (!licenseKey){
    return json({ valid: false, message: 'Codice mancante.' }, 400);
  }

  const params = new URLSearchParams();
  params.set('product_permalink', PRODUCT_PERMALINK);
  params.set('license_key', licenseKey);
  params.set('increment_uses_count', 'true');

  let gumroadResp;
  try {
    gumroadResp = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
  } catch (e){
    return json({ valid: false, message: 'Verifica non raggiungibile, riprova.' }, 502);
  }

  const data = await gumroadResp.json().catch(function(){ return null; });
  if (!data || !data.success){
    return json({ valid: false, message: 'Codice non valido.' });
  }
  if (data.purchase && data.purchase.refunded){
    return json({ valid: false, message: 'Questo acquisto risulta rimborsato.' });
  }
  if (data.purchase && data.purchase.chargebacked){
    return json({ valid: false, message: 'Questo pagamento risulta contestato.' });
  }
  if (data.purchase && data.purchase.subscription_cancelled_at){
    return json({ valid: false, message: 'Questo abbonamento risulta annullato.' });
  }
  if (MAX_ACTIVATIONS > 0 && typeof data.uses === 'number' && data.uses > MAX_ACTIVATIONS){
    return json({ valid: false, message: 'Questo codice ha già raggiunto il numero massimo di attivazioni (' + MAX_ACTIVATIONS + ').' });
  }

  return json({ valid: true });
}

export default {
  async fetch(request){
    if (request.method === 'OPTIONS'){
      return new Response(null, { headers: corsHeaders() });
    }
    const url = new URL(request.url);
    if (request.method === 'POST' && (url.pathname === '/verify' || url.pathname === '/')){
      return handleVerify(request);
    }
    return json({ valid: false, message: 'Endpoint non trovato.' }, 404);
  }
};
