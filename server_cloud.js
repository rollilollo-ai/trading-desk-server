const https = require('https');
const http = require('http');

const TD_KEY = '9fae1acbd8904db09894fd659ab6aa70';
const GMAIL_USER = 'rollilollo@gmail.com';
const GMAIL_PASS = 'vjbfhgzulcrlhrfe';
const PORT = process.env.PORT || 3737;

// ── CORS ──
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// ── TWELVE DATA ──
function tdFetch(path) {
  return new Promise((resolve, reject) => {
    const url = `https://api.twelvedata.com${path}&apikey=${TD_KEY}`;
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

const cache = {};
const CACHE_TTL = 60 * 60 * 1000;

const TICKER_MAP = {
  SAP:'XETRA',SIE:'XETRA',BAS:'XETRA',ALV:'XETRA',DTE:'XETRA',MUV2:'XETRA',
  BMW:'XETRA',VOW3:'XETRA',DBK:'XETRA',MBG:'XETRA',BAYN:'XETRA',ADS:'XETRA',
  BNP:'XPAR',AI:'XPAR',MC:'XPAR',SAN:'XPAR',TTE:'XPAR',OR:'XPAR',
  SGO:'XPAR',SU:'XPAR',KER:'XPAR',CAP:'XPAR',ACA:'XPAR',
  HSBA:'LSE',AZN:'LSE',SHEL:'LSE',LSEG:'LSE',ULVR:'LSE',GSK:'LSE',
  RIO:'LSE',LLOY:'LSE',BP:'LSE',VOD:'LSE',BARC:'LSE',DGE:'LSE',
  ENI:'XMIL',UCG:'XMIL',ISP:'XMIL',ENEL:'XMIL',STM:'XMIL',
  TIT:'XMIL',G:'XMIL',MB:'XMIL',LDO:'XMIL',RACE:'XMIL',
  ITX:'XMAD',IBE:'XMAD',BBVA:'XMAD',TEF:'XMAD',REP:'XMAD',
  ACS:'XMAD',CLNX:'XMAD',
  ASML:'XAMS',ADYEN:'XAMS',HEIA:'XAMS',PHIA:'XAMS',NN:'XAMS',
  AD:'XAMS',RAND:'XAMS',WKL:'XAMS',AGN:'XAMS',AKZA:'XAMS',DSM:'XAMS',UMG:'XAMS'
};

async function getQuotes() {
  const now = Date.now();
  const symbols = Object.entries(TICKER_MAP).map(([tk, ex]) => `${tk}:${ex}`);
  const toFetch = symbols.filter(s => {
    const tk = s.split(':')[0];
    return !cache[tk] || (now - cache[tk].ts) > CACHE_TTL;
  });

  const BATCH = 8;
  for (let i = 0; i < toFetch.length; i += BATCH) {
    const batch = toFetch.slice(i, i + BATCH);
    try {
      const data = await tdFetch(`/quote?symbol=${encodeURIComponent(batch.join(','))}`);
      const entries = data.symbol ? { [data.symbol]: data } : data;
      Object.entries(entries).forEach(([sym, q]) => {
        const tk = sym.split(':')[0];
        if (q && q.close && q.status !== 'error') {
          cache[tk] = {
            ts: now,
            price: parseFloat(q.close),
            changePct: parseFloat(q.percent_change || 0),
            change: parseFloat(q.change || 0),
            volume: parseInt(q.volume || 0),
            prevClose: parseFloat(q.previous_close || q.close),
            high: parseFloat(q.high || q.close),
            low: parseFloat(q.low || q.close),
          };
        }
      });
    } catch(e) { console.error('TD batch error:', e.message); }
    if (i + BATCH < toFetch.length) await new Promise(r => setTimeout(r, 7800));
  }

  const result = {};
  Object.keys(TICKER_MAP).forEach(tk => { if (cache[tk]) result[tk] = cache[tk]; });
  return result;
}

// ── EMAIL via Gmail SMTP (raw SMTP over TLS) ──
function sendEmail(to, subject, body) {
  return new Promise((resolve, reject) => {
    const { createConnection } = require('tls');
    let step = 0;
    const b64 = str => Buffer.from(str).toString('base64');
    const authStr = b64(`\0${GMAIL_USER}\0${GMAIL_PASS}`);
    const msg = [
      `From: Trading Desk <${GMAIL_USER}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      body
    ].join('\r\n');

    const socket = createConnection({ host: 'smtp.gmail.com', port: 465 });
    socket.setTimeout(15000);

    const send = (cmd) => { socket.write(cmd + '\r\n'); };

    socket.on('data', d => {
      const line = d.toString().trim();
      console.log('SMTP ←', line.substring(0, 60));
      if (step === 0 && line.startsWith('220')) { send('EHLO tradingdesk'); step++; }
      else if (step === 1 && line.includes('250') && line.includes('AUTH')) { send(`AUTH PLAIN ${authStr}`); step++; }
      else if (step === 1 && line.startsWith('250-') ) { /* multi-line ehlo, wait */ }
      else if (step === 1 && line.startsWith('250 ')) { send(`AUTH PLAIN ${authStr}`); step++; }
      else if (step === 2 && line.startsWith('235')) { send(`MAIL FROM:<${GMAIL_USER}>`); step++; }
      else if (step === 3 && line.startsWith('250')) { send(`RCPT TO:<${to}>`); step++; }
      else if (step === 4 && line.startsWith('250')) { send('DATA'); step++; }
      else if (step === 5 && line.startsWith('354')) { send(msg + '\r\n.'); step++; }
      else if (step === 6 && line.startsWith('250')) { send('QUIT'); step++; resolve({ ok: true }); }
      else if (line.startsWith('5')) { socket.destroy(); reject(new Error('SMTP error: ' + line)); }
    });
    socket.on('error', reject);
    socket.on('timeout', () => { socket.destroy(); reject(new Error('SMTP timeout')); });
  });
}

// ── ALERT CHECKER ──
// Salviamo gli alert in memoria (il client li manda al server)
let serverAlerts = [];

function checkAlerts(quotes) {
  const now = Date.now();
  serverAlerts.forEach(async (a) => {
    if (a.status !== 'active' || !a.email) return;
    const q = quotes[a.ticker];
    if (!q) return;
    const price = q.price;
    const tol = a.target * ((a.tol || 0.5) / 100);
    let triggered = false;
    if ((a.type === 'below' || a.type === 'stop' || a.type === 'support') && price <= a.target + tol) triggered = true;
    if ((a.type === 'above' || a.type === 'target' || a.type === 'resistance') && price >= a.target - tol) triggered = true;
    if (triggered && !a.notifiedAt) {
      a.notifiedAt = now;
      a.status = price <= a.target ? 'triggered-down' : 'triggered-up';
      const subject = `🔔 Alert ${a.ticker} — ${price.toFixed(2)} ${a.type === 'below' || a.type === 'stop' ? '↓' : '↑'} ${a.target}`;
      const body = [
        `Alert scattato: ${a.ticker} (${a.name || a.ticker})`,
        ``,
        `Prezzo attuale:  ${price.toFixed(4)}`,
        `Target alert:    ${a.target}`,
        `Tipo:            ${a.type}`,
        ``,
        a.emailmsg ? `Nota: ${a.emailmsg}` : '',
        ``,
        `Variazione giornaliera: ${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`,
        ``,
        `— Trading Desk · ${new Date().toLocaleString('it-IT')}`
      ].filter(l => l !== undefined).join('\n');
      try {
        await sendEmail(a.email, subject, body);
        console.log(`✉ Email inviata a ${a.email} per ${a.ticker}`);
      } catch(e) {
        console.error(`✗ Email fallita per ${a.ticker}:`, e.message);
      }
    }
  });
}

// Controlla prezzi e alert ogni 2 minuti
setInterval(async () => {
  if (serverAlerts.filter(a => a.status === 'active').length === 0) return;
  console.log(`[${new Date().toLocaleTimeString('it-IT')}] Controllo alert...`);
  try {
    const quotes = await getQuotes();
    checkAlerts(quotes);
  } catch(e) { console.error('Check error:', e.message); }
}, 2 * 60 * 1000);

// ── Prefetch all quotes in background on startup ──
let fetchInProgress = false;

async function prefetchAll() {
  if (fetchInProgress) return;
  fetchInProgress = true;
  console.log(`[${new Date().toLocaleTimeString('it-IT')}] Prefetch prezzi avviato...`);
  await getQuotes();
  fetchInProgress = false;
  console.log(`[${new Date().toLocaleTimeString('it-IT')}] Prefetch completato — ${Object.keys(cache).length} titoli in cache`);
}

// Prefetch immediato all'avvio
prefetchAll();
// Aggiorna ogni 5 minuti
setInterval(prefetchAll, 5 * 60 * 1000);

// ── HTTP SERVER ──
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // GET /ping
  // GET / — serve il file HTML dello screener
  if (url.pathname === '/' || url.pathname === '/screener') {
    const fs = require('fs');
    const path = require('path');
    const htmlPath = path.join(__dirname, 'screener_pullback_v4_dark.html');
    if (fs.existsSync(htmlPath)) {
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else {
      res.writeHead(404, CORS);
      res.end('File HTML non trovato. Carica screener_pullback_v4_dark.html nel repository.');
    }
    return;
  }

  if (url.pathname === '/ping') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, ts: Date.now(), alerts: serverAlerts.filter(a=>a.status==='active').length }));
    return;
  }

  // GET /quotes — risponde subito dalla cache
  if (url.pathname === "/quotes") {
    const result = {};
    Object.keys(TICKER_MAP).forEach(tk => { if (cache[tk]) result[tk] = cache[tk]; });
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, data: result, cached: Object.keys(result).length, fetching: fetchInProgress, ts: Date.now() }));
    return;
  }

  // POST /alerts — il client sincronizza i suoi alert
  if (url.pathname === '/alerts' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        serverAlerts = JSON.parse(body);
        console.log(`Alert sincronizzati: ${serverAlerts.filter(a=>a.status==='active').length} attivi`);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, active: serverAlerts.filter(a=>a.status==='active').length }));
      } catch(e) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'JSON invalido' }));
      }
    });
    return;
  }

  // GET /alerts/status — stato alert dal server
  if (url.pathname === '/alerts/status') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, alerts: serverAlerts }));
    return;
  }

  res.writeHead(404, CORS);
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   TRADING DESK — Cloud Server        ║`);
  console.log(`║   Porta: ${PORT}                        ║`);
  console.log(`║   Twelve Data: ...${TD_KEY.slice(-6)}        ║`);
  console.log(`║   Email: ${GMAIL_USER}  ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
  console.log(`Controllo alert ogni 2 minuti.`);
  console.log(`Prezzi in cache per 5 minuti.\n`);
});
