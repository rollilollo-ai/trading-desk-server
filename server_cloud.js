const https = require('https');
const http = require('http');

const AV_KEY = '2XVXL4BE27PUEXD6';  // <-- da sostituire
const GMAIL_USER = 'rollilollo@gmail.com';
const GMAIL_PASS = 'vjbfhgzulcrlhrfe';
const PORT = process.env.PORT || 3737;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// Alpha Vantage usa simboli con suffisso borsa: SAP.DEX, ENI.MIL, BNP.PAR ecc.
// Mappa ticker interno -> simbolo Alpha Vantage
const SYMBOLS = {
  SAP:'SAP.DEX',   SIE:'SIE.DEX',   BAS:'BAS.DEX',   ALV:'ALV.DEX',
  DTE:'DTE.DEX',   MUV2:'MUV2.DEX', BMW:'BMW.DEX',   VOW3:'VOW3.DEX',
  DBK:'DBK.DEX',   MBG:'MBG.DEX',   BAYN:'BAYN.DEX', ADS:'ADS.DEX',
  BNP:'BNP.PAR',   AI:'AI.PAR',     MC:'MC.PAR',     SAN:'SAN.PAR',
  TTE:'TTE.PAR',   OR:'OR.PAR',     SGO:'SGO.PAR',   SU:'SU.PAR',
  KER:'KER.PAR',   CAP:'CAP.PAR',   ACA:'ACA.PAR',
  HSBA:'HSBA.LON', AZN:'AZN.LON',   SHEL:'SHEL.LON', LSEG:'LSEG.LON',
  ULVR:'ULVR.LON', GSK:'GSK.LON',   RIO:'RIO.LON',   LLOY:'LLOY.LON',
  BP:'BP.LON',     VOD:'VOD.LON',    BARC:'BARC.LON', DGE:'DGE.LON',
  ENI:'ENI.MIL',   UCG:'UCG.MIL',   ISP:'ISP.MIL',   ENEL:'ENEL.MIL',
  STM:'STM.MIL',   TIT:'TIT.MIL',   G:'G.MIL',       MB:'MB.MIL',
  LDO:'LDO.MIL',   RACE:'RACE.MIL',
  ITX:'ITX.MCD',   IBE:'IBE.MCD',   BBVA:'BBVA.MCD', BSAN:'SAN.MCD',
  TEF:'TEF.MCD',   REP:'REP.MCD',   ACS:'ACS.MCD',   CLNX:'CLNX.MCD',
  ASML:'ASML.AMS', ADYEN:'ADYEN.AMS',HEIA:'HEIA.AMS', PHIA:'PHIA.AMS',
  NN:'NN.AMS',     AD:'AD.AMS',     RAND:'RAND.AMS', WKL:'WKL.AMS',
  AGN:'AGN.AMS',   AKZA:'AKZA.AMS', DSM:'DSM.AMS',   UMG:'UMG.AMS'
};

// ── ALPHA VANTAGE — GLOBAL_QUOTE ──
function avFetch(symbol) {
  return new Promise((resolve, reject) => {
    const path = `/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${AV_KEY}`;
    const req = https.get({
      hostname: 'www.alphavantage.co',
      path,
      headers: { 'User-Agent': 'TradingDesk/1.0' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          const q = json['Global Quote'];
          if (!q || !q['05. price']) { resolve(null); return; }
          const price    = parseFloat(q['05. price']);
          const prevClose= parseFloat(q['08. previous close']);
          const change   = parseFloat(q['09. change']);
          const changePct= parseFloat(q['10. change percent']?.replace('%',''));
          const high     = parseFloat(q['03. high']);
          const low      = parseFloat(q['04. low']);
          const volume   = parseInt(q['06. volume']) || 0;
          if (!price || isNaN(price)) { resolve(null); return; }
          resolve({ price, changePct: changePct||0, change: change||0, volume, prevClose: prevClose||price, high: high||price, low: low||price });
        } catch(e) { reject(new Error('JSON error: ' + d.substring(0,150))); }
      });
    });
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

const cache = {};
const CACHE_TTL = 15 * 60 * 1000; // 15 minuti — il giro completo dura ~15 min con 25 req/giorno
const BATCH_SIZE = 25;             // Alpha Vantage free: 25 chiamate/giorno
let fetchInProgress = false;
let rotationIndex = 0;             // indice rotante: ogni run aggiorna 25 simboli diversi

async function getQuotes() {
  const now = Date.now();
  const allTickers = Object.keys(SYMBOLS);

  // Priorità: prima quelli mai fetchati, poi quelli più vecchi
  const expired = allTickers.filter(tk => !cache[tk] || (now - cache[tk].ts) > CACHE_TTL);
  const toFetch = expired.length > 0 ? expired : allTickers;

  // Prendi i prossimi BATCH_SIZE dalla posizione rotante
  const batch = [];
  for (let i = 0; i < BATCH_SIZE && i < toFetch.length; i++) {
    batch.push(toFetch[(rotationIndex + i) % toFetch.length]);
  }
  rotationIndex = (rotationIndex + BATCH_SIZE) % toFetch.length;

  if (!batch.length) { console.log('Cache valida'); return buildResult(); }

  console.log(`Fetch batch: ${batch.map(tk => SYMBOLS[tk]).join(', ')}`);
  let saved = 0;

  // Alpha Vantage free: max 5 req/min — una ogni 13 secondi per sicurezza
  for (let i = 0; i < batch.length; i++) {
    const tk = batch[i];
    const sym = SYMBOLS[tk];
    try {
      const q = await avFetch(sym);
      if (q) {
        cache[tk] = { ts: now, ...q };
        saved++;
        console.log(`  ✓ ${sym}: ${q.price.toFixed(2)} (${q.changePct.toFixed(2)}%)`);
      } else {
        console.log(`  [skip] ${sym}`);
      }
    } catch(e) {
      console.error(`  [err] ${sym}: ${e.message}`);
    }
    if (i < batch.length - 1) await new Promise(r => setTimeout(r, 13000)); // 13s tra chiamate
  }

  console.log(`Batch completato: ${saved}/${batch.length} salvati`);
  return buildResult();
}

function buildResult() {
  const r = {};
  Object.keys(SYMBOLS).forEach(tk => { if (cache[tk]) r[tk] = cache[tk]; });
  return r;
}

// ── EMAIL ──
function sendEmail(to, subject, body) {
  return new Promise((resolve, reject) => {
    const { createConnection } = require('tls');
    let step = 0;
    const b64 = s => Buffer.from(s).toString('base64');
    const auth = b64(`\0${GMAIL_USER}\0${GMAIL_PASS}`);
    const msg = [`From: Trading Desk <${GMAIL_USER}>`,`To: ${to}`,`Subject: ${subject}`,
      `MIME-Version: 1.0`,`Content-Type: text/plain; charset=utf-8`,``,body].join('\r\n');
    const socket = createConnection({ host: 'smtp.gmail.com', port: 465 });
    socket.setTimeout(15000);
    const send = c => socket.write(c + '\r\n');
    socket.on('data', d => {
      const l = d.toString().trim();
      if (step===0&&l.startsWith('220'))       { send('EHLO tradingdesk'); step++; }
      else if (step===1&&l.startsWith('250-')) { }
      else if (step===1&&l.startsWith('250 ')) { send(`AUTH PLAIN ${auth}`); step++; }
      else if (step===2&&l.startsWith('235'))  { send(`MAIL FROM:<${GMAIL_USER}>`); step++; }
      else if (step===3&&l.startsWith('250'))  { send(`RCPT TO:<${to}>`); step++; }
      else if (step===4&&l.startsWith('250'))  { send('DATA'); step++; }
      else if (step===5&&l.startsWith('354'))  { send(msg+'\r\n.'); step++; }
      else if (step===6&&l.startsWith('250'))  { send('QUIT'); step++; resolve({ok:true}); }
      else if (l.startsWith('5'))              { socket.destroy(); reject(new Error(l)); }
    });
    socket.on('error', reject);
    socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
  });
}

// ── ALERTS ──
let serverAlerts = [];
function checkAlerts(quotes) {
  serverAlerts.forEach(async a => {
    if (a.status !== 'active' || !a.email) return;
    const q = quotes[a.ticker]; if (!q) return;
    const price = q.price, tol = a.target * ((a.tol||0.5)/100);
    let triggered = false;
    if (['below','stop','support'].includes(a.type) && price <= a.target+tol) triggered = true;
    if (['above','target','resistance'].includes(a.type) && price >= a.target-tol) triggered = true;
    if (triggered && !a.notifiedAt) {
      a.notifiedAt = Date.now();
      a.status = price <= a.target ? 'triggered-down' : 'triggered-up';
      const subject = `🔔 Alert ${a.ticker} — ${price.toFixed(2)} ${['below','stop'].includes(a.type)?'↓':'↑'} ${a.target}`;
      const body = [`Alert: ${a.ticker}`,`Prezzo: ${price.toFixed(4)}`,`Target: ${a.target}`,
        a.emailmsg||'',`— Trading Desk · ${new Date().toLocaleString('it-IT')}`].filter(Boolean).join('\n');
      try { await sendEmail(a.email, subject, body); console.log(`✉ ${a.ticker} → ${a.email}`); }
      catch(e) { console.error(`✗ Email:`, e.message); }
    }
  });
}

// ── PREFETCH ──
async function prefetchAll() {
  if (fetchInProgress) return;
  fetchInProgress = true;
  console.log(`[${new Date().toLocaleTimeString('it-IT')}] Prefetch avviato...`);
  try {
    const quotes = await getQuotes();
    const n = Object.keys(quotes).length;
    console.log(`[${new Date().toLocaleTimeString('it-IT')}] Prefetch completato — ${n} titoli in cache`);
    if (serverAlerts.filter(a=>a.status==='active').length > 0) checkAlerts(quotes);
  } catch(e) { console.error('Prefetch error:', e.message); }
  fetchInProgress = false;
}

// ── HTTP SERVER ──
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/' || url.pathname === '/screener') {
    const fs = require('fs'), path = require('path');
    const f = path.join(__dirname, 'screener_pullback_v4_dark.html');
    if (fs.existsSync(f)) {
      res.writeHead(200, {'Content-Type':'text/html;charset=utf-8'});
      res.end(fs.readFileSync(f,'utf8'));
    } else {
      res.writeHead(404, CORS); res.end('HTML non trovato');
    }
    return;
  }

  if (url.pathname === '/ping') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ok:true, ts:Date.now(), cached:Object.keys(cache).length,
      alerts:serverAlerts.filter(a=>a.status==='active').length, source:'alphavantage'}));
    return;
  }

  if (url.pathname === '/quotes') {
    const result = buildResult();
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ok:true, data:result, cached:Object.keys(result).length,
      fetching:fetchInProgress, ts:Date.now()}));
    return;
  }

  if (url.pathname === '/alerts' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { serverAlerts = JSON.parse(body); res.writeHead(200, CORS); res.end(JSON.stringify({ok:true})); }
      catch(e) { res.writeHead(400, CORS); res.end(JSON.stringify({ok:false})); }
    });
    return;
  }

  res.writeHead(404, CORS);
  res.end(JSON.stringify({ok:false, error:'not found'}));
});

// ✅ SERVER PRIMA, PREFETCH DOPO
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  TRADING DESK — Alpha Vantage        ║`);
  console.log(`║  Porta: ${PORT}                        ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
  prefetchAll();
  setInterval(prefetchAll, 6 * 60 * 1000); // ogni 6 minuti aggiorna il prossimo batch da 25
});
