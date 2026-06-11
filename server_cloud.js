const https = require('https');
const http = require('http');

// ── CREDENZIALI DA VARIABILI D'AMBIENTE RAILWAY ──
const GMAIL_USER = process.env.GMAIL_USER || 'rollilollo@gmail.com';
const GMAIL_PASS = process.env.GMAIL_PASS;
const PORT       = process.env.PORT || 3737;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// ── SIMBOLI TradingView formato EXCHANGE:TICKER ──
const SYMBOLS = {
  // DAX - Xetra
  SAP:   'XETR:SAP',   SIE:   'XETR:SIE',   BAS:   'XETR:BAS',   ALV:   'XETR:ALV',
  DTE:   'XETR:DTE',   MUV2:  'XETR:MUV2',  BMW:   'XETR:BMW',   VOW3:  'XETR:VOW3',
  DBK:   'XETR:DBK',   MBG:   'XETR:MBG',   BAYN:  'XETR:BAYN',  ADS:   'XETR:ADS',
  // CAC + AEX - Euronext
  BNP:   'EURONEXT:BNP',  AI:    'EURONEXT:AI',    MC:    'EURONEXT:MC',   SAN:   'EURONEXT:SAN',
  TTE:   'EURONEXT:TTE',  OR:    'EURONEXT:OR',    SGO:   'EURONEXT:SGO',  SU:    'EURONEXT:SU',
  KER:   'EURONEXT:KER',  CAP:   'EURONEXT:CAP',   ACA:   'EURONEXT:ACA',
  ASML:  'EURONEXT:ASML', ADYEN: 'EURONEXT:ADYEN', HEIA:  'EURONEXT:HEIA', PHIA:  'EURONEXT:PHIA',
  NN:    'EURONEXT:NN',   AD:    'EURONEXT:AD',     RAND:  'EURONEXT:RAND', WKL:   'EURONEXT:WKL',
  AGN:   'EURONEXT:AGN',  AKZA:  'EURONEXT:AKZA',  DSM:   'EURONEXT:DSM',  UMG:   'EURONEXT:UMG',
  // FTSE 100 - London
  HSBA:  'LSE:HSBA',  AZN:   'LSE:AZN',    SHEL:  'LSE:SHEL',  LSEG:  'LSE:LSEG',
  ULVR:  'LSE:ULVR',  GSK:   'LSE:GSK',    RIO:   'LSE:RIO',   LLOY:  'LSE:LLOY',
  BP:    'LSE:BP',    VOD:   'LSE:VOD',    BARC:  'LSE:BARC',  DGE:   'LSE:DGE',
  // FTSE MIB - Borsa Italiana
  ENI:   'MIL:ENI',   UCG:   'MIL:UCG',    ISP:   'MIL:ISP',   ENEL:  'MIL:ENEL',
  STM:   'MIL:STM',   TIT:   'MIL:TIT',    G:     'MIL:G',     MB:    'MIL:MB',
  LDO:   'MIL:LDO',   RACE:  'MIL:RACE',
  // IBEX 35 - Madrid
  ITX:   'BME:ITX',   IBE:   'BME:IBE',    BBVA:  'BME:BBVA',  BSAN:  'BME:SAN',
  TEF:   'BME:TEF',   REP:   'BME:REP',    ACS:   'BME:ACS',   CLNX:  'BME:CLNX'
};

// ── TRADINGVIEW SCANNER ──
function tvScan() {
  return new Promise((resolve, reject) => {
    const tickers = Object.values(SYMBOLS);

    const payload = JSON.stringify({
      symbols: {
        tickers,
        query: { types: [] }
      },
      columns: [
        'name',
        'close',
        'change',
        'change_abs',
        'volume',
        'average_volume_10d_calc',
        'EMA50',
        'EMA200',
        'RSI',
        'High.1M',
        'Low.1M',
        'VWAP'
      ]
    });

    const req = https.request({
      hostname: 'scanner.tradingview.com',
      path: '/global/scan',
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin':        'https://www.tradingview.com',
        'Referer':       'https://www.tradingview.com/'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          if (!json.data) { resolve({}); return; }

          const result = {};
          // Mappa ticker TV → chiave interna
          const reverseMap = {};
          Object.entries(SYMBOLS).forEach(([k, v]) => reverseMap[v] = k);

          json.data.forEach(item => {
            const tvTicker = item.s;
            const tk = reverseMap[tvTicker];
            if (!tk) return;
            const [, close, change, changeAbs, volume, avgVol, ema50, ema200, rsi, high1m, low1m, vwap] = item.d;
            if (!close) return;
            const prevClose = close - (changeAbs || 0);
            result[tk] = {
              price:     close,
              changePct: change     || 0,
              change:    changeAbs  || 0,
              volume:    volume     || 0,
              avgVolume: avgVol     || 0,
              prevClose: prevClose  || close,
              high:      close,
              low:       close,
              ema50:     ema50      || null,
              ema200:    ema200     || null,
              rsi:       rsi        || null,
              high1m:    high1m     || null,
              low1m:     low1m      || null,
              vwap:      vwap       || null,
              ts:        Date.now()
            };
          });

          console.log(`  TV Scanner: ${Object.keys(result).length}/${tickers.length} titoli ricevuti`);
          resolve(result);
        } catch(e) {
          reject(new Error('JSON error: ' + d.substring(0, 200)));
        }
      });
    });

    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── CACHE ──
let cache = {};
let fetchInProgress = false;
const CACHE_TTL = 15 * 60 * 1000;

async function getQuotes() {
  try {
    const fresh = await tvScan();
    if (Object.keys(fresh).length > 0) {
      cache = fresh;
      console.log(`Cache aggiornata: ${Object.keys(cache).length} titoli`);
    } else {
      console.warn('TV Scanner ha restituito 0 titoli — mantengo cache precedente');
    }
  } catch(e) {
    console.error('tvScan error:', e.message);
  }
  return cache;
}

function buildResult() { return { ...cache }; }

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
    if (['below','stop','support'].includes(a.type)     && price <= a.target + tol) triggered = true;
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
    console.log(`[${new Date().toLocaleTimeString('it-IT')}] Prefetch OK — ${n} titoli`);
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
      source: 'tradingview'
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

  if (url.pathname === '/refresh' && req.method === 'POST') {
    // Endpoint per forzare refresh manuale dal frontend
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, message: 'Refresh avviato' }));
    setTimeout(prefetchAll, 100);
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
  console.log(`║  TRADING DESK — TradingView Scanner  ║`);
  console.log(`║  Porta: ${PORT}                        ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
  if (!GMAIL_PASS) console.warn('⚠ GMAIL_PASS non impostata');

  // Prefetch immediato + ogni 15 minuti
  setTimeout(() => {
    prefetchAll();
    setInterval(prefetchAll, 15 * 60 * 1000);
  }, 2000);
});
