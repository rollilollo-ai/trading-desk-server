const https = require('https');
const http = require('http');

// ── CREDENZIALI DA VARIABILI D'AMBIENTE RAILWAY ──
const TD_KEY     = process.env.TD_KEY;
const GMAIL_USER = process.env.GMAIL_USER || 'rollilollo@gmail.com';
const GMAIL_PASS = process.env.GMAIL_PASS;
const PORT       = process.env.PORT || 3737;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// ── SIMBOLI — formato Twelve Data per Europa ──
// Twelve Data: simbolo semplice + exchange separato
const SYMBOLS = {
  // DAX - Xetra
  SAP:   { sym:'SAP',   ex:'XETR' },
  SIE:   { sym:'SIE',   ex:'XETR' },
  BAS:   { sym:'BAS',   ex:'XETR' },
  ALV:   { sym:'ALV',   ex:'XETR' },
  DTE:   { sym:'DTE',   ex:'XETR' },
  MUV2:  { sym:'MUV2',  ex:'XETR' },
  BMW:   { sym:'BMW',   ex:'XETR' },
  VOW3:  { sym:'VOW3',  ex:'XETR' },
  DBK:   { sym:'DBK',   ex:'XETR' },
  MBG:   { sym:'MBG',   ex:'XETR' },
  BAYN:  { sym:'BAYN',  ex:'XETR' },
  ADS:   { sym:'ADS',   ex:'XETR' },
  // CAC - Euronext Paris
  BNP:   { sym:'BNP',   ex:'XPAR' },
  AI:    { sym:'AI',    ex:'XPAR' },
  MC:    { sym:'MC',    ex:'XPAR' },
  SAN:   { sym:'SAN',   ex:'XPAR' },
  TTE:   { sym:'TTE',   ex:'XPAR' },
  OR:    { sym:'OR',    ex:'XPAR' },
  SGO:   { sym:'SGO',   ex:'XPAR' },
  SU:    { sym:'SU',    ex:'XPAR' },
  KER:   { sym:'KER',   ex:'XPAR' },
  CAP:   { sym:'CAP',   ex:'XPAR' },
  ACA:   { sym:'ACA',   ex:'XPAR' },
  // FTSE 100 - London
  HSBA:  { sym:'HSBA',  ex:'XLON' },
  AZN:   { sym:'AZN',   ex:'XLON' },
  SHEL:  { sym:'SHEL',  ex:'XLON' },
  LSEG:  { sym:'LSEG',  ex:'XLON' },
  ULVR:  { sym:'ULVR',  ex:'XLON' },
  GSK:   { sym:'GSK',   ex:'XLON' },
  RIO:   { sym:'RIO',   ex:'XLON' },
  LLOY:  { sym:'LLOY',  ex:'XLON' },
  BP:    { sym:'BP',    ex:'XLON' },
  VOD:   { sym:'VOD',   ex:'XLON' },
  BARC:  { sym:'BARC',  ex:'XLON' },
  DGE:   { sym:'DGE',   ex:'XLON' },
  // FTSE MIB - Borsa Italiana
  ENI:   { sym:'ENI',   ex:'XMIL' },
  UCG:   { sym:'UCG',   ex:'XMIL' },
  ISP:   { sym:'ISP',   ex:'XMIL' },
  ENEL:  { sym:'ENEL',  ex:'XMIL' },
  STM:   { sym:'STM',   ex:'XMIL' },
  TIT:   { sym:'TIT',   ex:'XMIL' },
  G:     { sym:'G',     ex:'XMIL' },
  MB:    { sym:'MB',    ex:'XMIL' },
  LDO:   { sym:'LDO',   ex:'XMIL' },
  RACE:  { sym:'RACE',  ex:'XMIL' },
  // IBEX 35 - Madrid
  ITX:   { sym:'ITX',   ex:'XMAD' },
  IBE:   { sym:'IBE',   ex:'XMAD' },
  BBVA:  { sym:'BBVA',  ex:'XMAD' },
  BSAN:  { sym:'SAN',   ex:'XMAD' },
  TEF:   { sym:'TEF',   ex:'XMAD' },
  REP:   { sym:'REP',   ex:'XMAD' },
  ACS:   { sym:'ACS',   ex:'XMAD' },
  CLNX:  { sym:'CLNX',  ex:'XMAD' },
  // AEX - Amsterdam
  ASML:  { sym:'ASML',  ex:'XAMS' },
  ADYEN: { sym:'ADYEN', ex:'XAMS' },
  HEIA:  { sym:'HEIA',  ex:'XAMS' },
  PHIA:  { sym:'PHIA',  ex:'XAMS' },
  NN:    { sym:'NN',    ex:'XAMS' },
  AD:    { sym:'AD',    ex:'XAMS' },
  RAND:  { sym:'RAND',  ex:'XAMS' },
  WKL:   { sym:'WKL',   ex:'XAMS' },
  AGN:   { sym:'AGN',   ex:'XAMS' },
  AKZA:  { sym:'AKZA',  ex:'XAMS' },
  DSM:   { sym:'DSM',   ex:'XAMS' },
  UMG:   { sym:'UMG',   ex:'XAMS' }
};

// ── TWELVE DATA — batch fino a 120 simboli per chiamata ──
// Usiamo una sola chiamata con tutti i simboli separati da virgola
function tdFetchBatch(tickers) {
  return new Promise((resolve, reject) => {
    // Costruisce stringa "SYM/EX,SYM/EX,..."
    const symbolStr = tickers.map(tk => {
      const s = SYMBOLS[tk];
      return `${s.sym}:${s.ex}`;
    }).join(',');

    const path = `/price?symbol=${encodeURIComponent(symbolStr)}&apikey=${TD_KEY}`;

    const req = https.get({
      hostname: 'api.twelvedata.com',
      path,
      headers: { 'User-Agent': 'TradingDesk/2.0', 'Accept': 'application/json' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          // Rate limit o errore globale
          if (json.code === 429 || json.status === 'error') {
            console.log('  [TD] Errore API:', json.message || json.code);
            resolve({});
            return;
          }
          resolve(json);
        } catch(e) {
          reject(new Error('JSON error: ' + d.substring(0, 150)));
        }
      });
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// Fetch quote singola per avere anche changePct, volume, high, low
function tdFetchQuote(ticker) {
  return new Promise((resolve, reject) => {
    const s = SYMBOLS[ticker];
    const path = `/quote?symbol=${encodeURIComponent(s.sym)}&exchange=${s.ex}&apikey=${TD_KEY}`;
    const req = https.get({
      hostname: 'api.twelvedata.com',
      path,
      headers: { 'User-Agent': 'TradingDesk/2.0', 'Accept': 'application/json' }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const q = JSON.parse(d);
          if (q.status === 'error' || !q.close) { resolve(null); return; }
          const price     = parseFloat(q.close);
          const prevClose = parseFloat(q.previous_close) || price;
          const changePct = prevClose ? ((price - prevClose) / prevClose * 100) : 0;
          resolve({
            price,
            changePct,
            change:    price - prevClose,
            volume:    parseInt(q.volume) || 0,
            prevClose,
            high:      parseFloat(q.high)  || price,
            low:       parseFloat(q.low)   || price
          });
        } catch(e) { reject(e); }
      });
    });
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// ── CACHE ──
const cache = {};
const CACHE_TTL = 20 * 60 * 1000; // 20 minuti
let fetchInProgress = false;

async function getQuotes() {
  const now = Date.now();
  const allTickers = Object.keys(SYMBOLS);

  // Twelve Data free: 8 chiamate/minuto, 800/giorno
  // Delay 8s tra chiamate = rispetta rate limit
  // Il fetch gira in background, non blocca il server

  const expired = allTickers.filter(tk => !cache[tk] || (now - cache[tk].ts) > CACHE_TTL);
  if (expired.length === 0) {
    console.log('Cache valida, nessun fetch necessario');
    return buildResult();
  }

  console.log(`Fetch ${expired.length} simboli scaduti...`);
  let saved = 0;

  for (let i = 0; i < expired.length; i++) {
    const tk = expired[i];
    try {
      const q = await tdFetchQuote(tk);
      if (q) {
        cache[tk] = { ts: now, ...q };
        saved++;
        console.log(`  ✓ ${tk}: ${q.price.toFixed(2)} (${q.changePct.toFixed(2)}%)`);
      } else {
        console.log(`  [skip] ${tk}`);
      }
    } catch(e) {
      console.error(`  [err] ${tk}: ${e.message}`);
    }
    // 8 secondi tra chiamate = rispetta limite 8/minuto Twelve Data free
    if (i < expired.length - 1) await new Promise(r => setTimeout(r, 8000));
  }

  console.log(`Fetch completato: ${saved}/${expired.length} salvati`);
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
    const send = c => socket.write(c + '\r\n');

    socket.on('data', d => {
      const l = d.toString().trim();
      if      (step===0 && l.startsWith('220')) { send('EHLO tradingdesk'); step++; }
      else if (step===1 && l.startsWith('250-')) { }
      else if (step===1 && l.startsWith('250 ')) { send(`AUTH PLAIN ${auth}`); step++; }
      else if (step===2 && l.startsWith('235'))  { send(`MAIL FROM:<${GMAIL_USER}>`); step++; }
      else if (step===3 && l.startsWith('250'))  { send(`RCPT TO:<${to}>`); step++; }
      else if (step===4 && l.startsWith('250'))  { send('DATA'); step++; }
      else if (step===5 && l.startsWith('354'))  { send(msg + '\r\n.'); step++; }
      else if (step===6 && l.startsWith('250'))  { send('QUIT'); step++; resolve({ ok: true }); }
      else if (l.startsWith('5'))                { socket.destroy(); reject(new Error(l)); }
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
    const q = quotes[a.ticker];
    if (!q) return;
    const price = q.price;
    const tol   = a.target * ((a.tol || 0.5) / 100);
    let triggered = false;
    if (['below','stop','support'].includes(a.type)    && price <= a.target + tol) triggered = true;
    if (['above','target','resistance'].includes(a.type) && price >= a.target - tol) triggered = true;
    if (triggered && !a.notifiedAt) {
      a.notifiedAt = Date.now();
      a.status = price <= a.target ? 'triggered-down' : 'triggered-up';
      const dir     = ['below','stop'].includes(a.type) ? '↓' : '↑';
      const subject = `🔔 Alert ${a.ticker} — ${price.toFixed(2)} ${dir} ${a.target}`;
      const body    = [
        `Alert: ${a.ticker}`,
        `Prezzo: ${price.toFixed(4)}`,
        `Target: ${a.target}`,
        a.emailmsg || '',
        `— Trading Desk · ${new Date().toLocaleString('it-IT')}`
      ].filter(Boolean).join('\n');
      try {
        await sendEmail(a.email, subject, body);
        console.log(`✉ ${a.ticker} → ${a.email}`);
      } catch(e) {
        console.error(`✗ Email:`, e.message);
      }
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
    if (serverAlerts.filter(a => a.status === 'active').length > 0) checkAlerts(quotes);
  } catch(e) {
    console.error('Prefetch error:', e.message);
  }
  fetchInProgress = false;
}

// ── HTTP SERVER ──
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/' || url.pathname === '/screener') {
    const fs   = require('fs');
    const path = require('path');
    const f    = path.join(__dirname, 'screener_pullback_v4_dark.html');
    if (fs.existsSync(f)) {
      res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
      res.end(fs.readFileSync(f, 'utf8'));
    } else {
      res.writeHead(404, CORS);
      res.end('HTML non trovato');
    }
    return;
  }

  if (url.pathname === '/ping') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true, ts: Date.now(),
      cached: Object.keys(cache).length,
      alerts: serverAlerts.filter(a => a.status === 'active').length,
      source: 'twelvedata'
    }));
    return;
  }

  if (url.pathname === '/quotes') {
    const result = buildResult();
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true, data: result,
      cached: Object.keys(result).length,
      fetching: fetchInProgress,
      ts: Date.now()
    }));
    return;
  }

  if (url.pathname === '/alerts' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        serverAlerts = JSON.parse(body);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  res.writeHead(404, CORS);
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

// ── AVVIO ──
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  TRADING DESK — Twelve Data          ║`);
  console.log(`║  Porta: ${PORT}                        ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
  if (!TD_KEY)     console.warn('⚠ TD_KEY non impostata — imposta variabile Railway');
  if (!GMAIL_PASS) console.warn('⚠ GMAIL_PASS non impostata — imposta variabile Railway');

  // Prefetch in background dopo 3s — non blocca l'avvio del server
  setTimeout(() => {
    prefetchAll();
    // Ogni 25 minuti — compatibile con 800 chiamate/giorno Twelve Data free
    setInterval(prefetchAll, 25 * 60 * 1000);
  }, 3000);
});
