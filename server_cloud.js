const https = require('https');
const http = require('http');

const FINNHUB_KEY = 'd8kbs9hr01qjgd6u048gd8kbs9hr01qjgd6u0490';
const GMAIL_USER = 'rollilollo@gmail.com';
const GMAIL_PASS = 'vjbfhgzulcrlhrfe';
const PORT = process.env.PORT || 3737;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// Finnhub usa simboli con suffisso borsa (es. SAP.DE, ENI.MI, ASML.AS)
const SYMBOLS = {
  SAP:'SAP.DE', SIE:'SIE.DE', BAS:'BAS.DE', ALV:'ALV.DE',
  DTE:'DTE.DE', MUV2:'MUV2.DE', BMW:'BMW.DE', VOW3:'VOW3.DE',
  DBK:'DBK.DE', MBG:'MBG.DE', BAYN:'BAYN.DE', ADS:'ADS.DE',
  BNP:'BNP.PA', AI:'AI.PA', MC:'MC.PA', SAN:'SAN.PA',
  TTE:'TTE.PA', OR:'OR.PA', SGO:'SGO.PA', SU:'SU.PA',
  KER:'KER.PA', CAP:'CAP.PA', ACA:'ACA.PA',
  HSBA:'HSBA.L', AZN:'AZN.L', SHEL:'SHEL.L', LSEG:'LSEG.L',
  ULVR:'ULVR.L', GSK:'GSK.L', RIO:'RIO.L', LLOY:'LLOY.L',
  BP:'BP.L', VOD:'VOD.L', BARC:'BARC.L', DGE:'DGE.L',
  ENI:'ENI.MI', UCG:'UCG.MI', ISP:'ISP.MI', ENEL:'ENEL.MI',
  STM:'STM.MI', TIT:'TIT.MI', G:'G.MI', MB:'MB.MI',
  LDO:'LDO.MI', RACE:'RACE.MI',
  ITX:'ITX.MC', IBE:'IBE.MC', BBVA:'BBVA.MC', BSAN:'SAN.MC',
  TEF:'TEF.MC', REP:'REP.MC', ACS:'ACS.MC', CLNX:'CLNX.MC',
  ASML:'ASML.AS', ADYEN:'ADYEN.AS', HEIA:'HEIA.AS', PHIA:'PHIA.AS',
  NN:'NN.AS', AD:'AD.AS', RAND:'RAND.AS', WKL:'WKL.AS',
  AGN:'AGN.AS', AKZA:'AKZA.AS', DSM:'DSM.AS', UMG:'UMG.AS'
};

// ── FINNHUB — una chiamata per simbolo, ma 60 req/min sul piano free ──
function finnhubQuote(symbol) {
  return new Promise((resolve, reject) => {
    const path = `/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
    https.get({ hostname: 'finnhub.io', path, headers: { 'User-Agent': 'TradingDesk/1.0' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const q = JSON.parse(d);
          // q.c = current price, q.dp = change%, q.d = change, q.v = volume, q.pc = prev close, q.h = high, q.l = low
          if (!q.c || q.c === 0) { resolve(null); return; }
          resolve({
            price: q.c,
            changePct: q.dp || 0,
            change: q.d || 0,
            volume: q.v || 0,
            prevClose: q.pc || q.c,
            high: q.h || q.c,
            low: q.l || q.c,
          });
        } catch(e) {
          reject(new Error('JSON error: ' + d.substring(0, 100)));
        }
      });
    }).on('error', reject);
  });
}

const cache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minuti — Finnhub gratuito, 60 req/min
let fetchInProgress = false;

async function getQuotes() {
  const now = Date.now();
  const tickers = Object.keys(SYMBOLS).filter(tk => !cache[tk] || (now - cache[tk].ts) > CACHE_TTL);

  if (!tickers.length) { console.log('Cache valida'); return buildResult(); }

  console.log(`Fetch ${tickers.length} simboli Finnhub...`);
  let saved = 0;

  // Finnhub free: 60 req/min = 1 req/sec con margine — processiamo a ~1.1s per chiamata
  for (let i = 0; i < tickers.length; i++) {
    const tk = tickers[i];
    const sym = SYMBOLS[tk];
    try {
      const q = await finnhubQuote(sym);
      if (q) {
        cache[tk] = { ts: now, ...q };
        saved++;
      } else {
        console.log(`  [skip] ${sym} — prezzo vuoto`);
      }
    } catch(e) {
      console.error(`  [err] ${sym}: ${e.message}`);
    }
    // Pausa 1.1 secondi tra ogni chiamata per rispettare il rate limit 60/min
    if (i < tickers.length - 1) await new Promise(r => setTimeout(r, 1100));
  }

  console.log(`Fetch completato: ${saved}/${tickers.length} salvati`);
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
    const msg = [`From: Trading Desk <${GMAIL_USER}>`,`To: ${to}`,`Subject: ${subject}`,`MIME-Version: 1.0`,`Content-Type: text/plain; charset=utf-8`,``,body].join('\r\n');
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
      const body = [`Alert: ${a.ticker}`,`Prezzo: ${price.toFixed(4)}`,`Target: ${a.target}`,a.emailmsg||'',`— Trading Desk · ${new Date().toLocaleString('it-IT')}`].filter(Boolean).join('\n');
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
    console.log(`[${new Date().toLocaleTimeString('it-IT')}] Prefetch completato — ${n} titoli`);
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
    if (fs.existsSync(f)) { res.writeHead(200, {'Content-Type':'text/html;charset=utf-8'}); res.end(fs.readFileSync(f,'utf8')); }
    else { res.writeHead(404, CORS); res.end('HTML non trovato'); }
    return;
  }

  if (url.pathname === '/ping') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ok:true, ts:Date.now(), cached:Object.keys(cache).length, alerts:serverAlerts.filter(a=>a.status==='active').length, source:'finnhub'}));
    return;
  }

  if (url.pathname === '/quotes') {
    const result = buildResult();
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ok:true, data:result, cached:Object.keys(result).length, fetching:fetchInProgress, ts:Date.now()}));
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

// ✅ FIX RAILWAY: server parte PRIMA, prefetch parte DOPO
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  TRADING DESK — Finnhub              ║`);
  console.log(`║  Porta: ${PORT}                        ║`);
  console.log(`╚══════════════════════════════════════╝\n`);

  // Prefetch avviato DOPO che il server è in ascolto
  prefetchAll();
  // Aggiornamento ogni 5 minuti
  setInterval(prefetchAll, 5 * 60 * 1000);
});
