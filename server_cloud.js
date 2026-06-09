const http = require('http');
const PORT = process.env.PORT || 3737;

const GMAIL_USER = 'rollilollo@gmail.com';
const GMAIL_PASS = 'vjbfhgzulcrlhrfe';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// ── YAHOO SYMBOLS ──
const YAHOO_SYMBOLS = {
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

// ── CACHE ──
const cache = {};
const CACHE_TTL = 60 * 60 * 1000; // 1 ora
let yf = null;
let fetchInProgress = false;

async function initYF() {
  if (!yf) {
    yf = (await import('yahoo-finance2')).default;
    // Disabilita notifiche di validazione
    yf.setGlobalConfig({ validation: { logErrors: false } });
  }
  return yf;
}

async function getQuotes() {
  const now = Date.now();
  const lib = await initYF();
  const allSymbols = Object.values(YAHOO_SYMBOLS);
  const toFetch = allSymbols.filter(ys => {
    const tk = Object.keys(YAHOO_SYMBOLS).find(k => YAHOO_SYMBOLS[k] === ys);
    return !cache[tk] || (now - cache[tk].ts) > CACHE_TTL;
  });

  if (!toFetch.length) {
    console.log('Cache valida');
    return buildResult();
  }

  console.log(`Fetch ${toFetch.length} simboli...`);
  const BATCH = 10;
  for (let i = 0; i < toFetch.length; i += BATCH) {
    const batch = toFetch.slice(i, i + BATCH);
    try {
      const results = await lib.quote(batch);
      const arr = Array.isArray(results) ? results : [results];
      let saved = 0;
      arr.forEach(q => {
        if (!q || !q.regularMarketPrice) return;
        const tk = Object.keys(YAHOO_SYMBOLS).find(k => YAHOO_SYMBOLS[k] === q.symbol);
        if (!tk) return;
        cache[tk] = {
          ts: now,
          price: q.regularMarketPrice,
          changePct: q.regularMarketChangePercent || 0,
          change: q.regularMarketChange || 0,
          volume: q.regularMarketVolume || 0,
          prevClose: q.regularMarketPreviousClose || q.regularMarketPrice,
          high: q.regularMarketDayHigh || q.regularMarketPrice,
          low: q.regularMarketDayLow || q.regularMarketPrice,
        };
        saved++;
      });
      console.log(`  Batch ${Math.floor(i/BATCH)+1}: ${saved}/${batch.length} salvati`);
    } catch(e) {
      console.error(`  Batch error:`, e.message);
    }
    if (i + BATCH < toFetch.length) await new Promise(r => setTimeout(r, 300));
  }

  return buildResult();
}

function buildResult() {
  const r = {};
  Object.keys(YAHOO_SYMBOLS).forEach(tk => { if (cache[tk]) r[tk] = cache[tk]; });
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
      if (step===0&&l.startsWith('220'))      { send('EHLO tradingdesk'); step++; }
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

// ── ALERT CHECKER ──
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
      const body = [`Alert: ${a.ticker}`,`Prezzo: ${price.toFixed(4)}`,`Target: ${a.target}`,`Variazione: ${q.changePct>=0?'+':''}${q.changePct.toFixed(2)}%`,``,a.emailmsg||'',`— Trading Desk · ${new Date().toLocaleString('it-IT')}`].filter(Boolean).join('\n');
      try { await sendEmail(a.email, subject, body); console.log(`✉ Email → ${a.email} per ${a.ticker}`); }
      catch(e) { console.error(`✗ Email fallita:`, e.message); }
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

prefetchAll();
setInterval(prefetchAll, 60 * 60 * 1000);

// ── SERVER ──
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
    res.end(JSON.stringify({ok:true, ts:Date.now(), cached:Object.keys(cache).length, alerts:serverAlerts.filter(a=>a.status==='active').length}));
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

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════╗`);
  console.log(`║  TRADING DESK — Yahoo Finance    ║`);
  console.log(`║  Porta: ${PORT} — nessun limite   ║`);
  console.log(`╚══════════════════════════════════╝\n`);
});
