const https = require('https');
const http = require('http');

const GMAIL_USER = 'rollilollo@gmail.com';
const GMAIL_PASS = 'vjbfhgzulcrlhrfe';
const PORT = process.env.PORT || 3737;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// ── YAHOO FINANCE SYMBOLS ──
// Yahoo usa suffissi per le borse europee
const YAHOO_SYMBOLS = {
  // DAX
  SAP:   'SAP.DE',   SIE:  'SIE.DE',  BAS:  'BAS.DE',  ALV:  'ALV.DE',
  DTE:   'DTE.DE',   MUV2: 'MUV2.DE', BMW:  'BMW.DE',  VOW3: 'VOW3.DE',
  DBK:   'DBK.DE',   MBG:  'MBG.DE',  BAYN: 'BAYN.DE', ADS:  'ADS.DE',
  // CAC
  BNP:   'BNP.PA',   AI:   'AI.PA',   MC:   'MC.PA',   SAN:  'SAN.PA',
  TTE:   'TTE.PA',   OR:   'OR.PA',   SGO:  'SGO.PA',  SU:   'SU.PA',
  KER:   'KER.PA',   CAP:  'CAP.PA',  ACA:  'ACA.PA',
  // FTSE 100 (prezzi in pence GBX su Yahoo)
  HSBA:  'HSBA.L',   AZN:  'AZN.L',   SHEL: 'SHEL.L',  LSEG: 'LSEG.L',
  ULVR:  'ULVR.L',   GSK:  'GSK.L',   RIO:  'RIO.L',   LLOY: 'LLOY.L',
  BP:    'BP.L',     VOD:  'VOD.L',   BARC: 'BARC.L',  DGE:  'DGE.L',
  // FTSE MIB
  ENI:   'ENI.MI',   UCG:  'UCG.MI',  ISP:  'ISP.MI',  ENEL: 'ENEL.MI',
  STM:   'STM.MI',   TIT:  'TIT.MI',  G:    'G.MI',    MB:   'MB.MI',
  LDO:   'LDO.MI',   RACE: 'RACE.MI',
  // IBEX
  ITX:   'ITX.MC',   IBE:  'IBE.MC',  BBVA: 'BBVA.MC', BSAN: 'SAN.MC',
  TEF:   'TEF.MC',   REP:  'REP.MC',  ACS:  'ACS.MC',  CLNX: 'CLNX.MC',
  // AEX
  ASML:  'ASML.AS',  ADYEN:'ADYEN.AS',HEIA: 'HEIA.AS', PHIA: 'PHI.AS',
  NN:    'NN.AS',    AD:   'AD.AS',   RAND: 'RAND.AS',  WKL:  'WKL.AS',
  AGN:   'AGN.AS',   AKZA: 'AKZA.AS', DSM:  'DSM-FIRMENICH.AS', UMG: 'UMG.AS'
};

// ── YAHOO FETCH ──
function yahooFetch(symbols) {
  return new Promise((resolve, reject) => {
    const syms = symbols.join(',');
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(syms)}&fields=regularMarketPrice,regularMarketPreviousClose,regularMarketChangePercent,regularMarketChange,regularMarketVolume,regularMarketDayHigh,regularMarketDayLow`;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      }
    };
    https.get(url, options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(new Error('JSON parse error: ' + d.substring(0, 100))); }
      });
    }).on('error', reject);
  });
}

// ── CACHE ──
const cache = {};
const CACHE_TTL = 60 * 60 * 1000; // 1 ora

async function getQuotes() {
  const now = Date.now();
  const allYahooSyms = Object.values(YAHOO_SYMBOLS);
  const toFetch = allYahooSyms.filter(ys => {
    const tk = Object.keys(YAHOO_SYMBOLS).find(k => YAHOO_SYMBOLS[k] === ys);
    return !cache[tk] || (now - cache[tk].ts) > CACHE_TTL;
  });

  if (!toFetch.length) {
    console.log('Cache valida — nessun fetch necessario');
    return buildResult();
  }

  // Yahoo supporta batch grandi — usiamo 20 per volta
  const BATCH = 20;
  console.log(`Fetch ${toFetch.length} simboli Yahoo...`);

  for (let i = 0; i < toFetch.length; i += BATCH) {
    const batch = toFetch.slice(i, i + BATCH);
    try {
      const data = await yahooFetch(batch);
      const quotes = data?.quoteResponse?.result || [];
      let saved = 0;
      quotes.forEach(q => {
        // Trova il ticker interno dal simbolo Yahoo
        const tk = Object.keys(YAHOO_SYMBOLS).find(k => YAHOO_SYMBOLS[k] === q.symbol);
        if (!tk) return;
        const price = q.regularMarketPrice;
        const prevClose = q.regularMarketPreviousClose || price;
        if (price > 0) {
          cache[tk] = {
            ts: now,
            price,
            changePct: q.regularMarketChangePercent || 0,
            change: q.regularMarketChange || 0,
            volume: q.regularMarketVolume || 0,
            prevClose,
            high: q.regularMarketDayHigh || price,
            low: q.regularMarketDayLow || price,
          };
          saved++;
        }
      });
      console.log(`  Batch ${Math.floor(i/BATCH)+1}: ${saved}/${batch.length} salvati`);
    } catch(e) {
      console.error('Yahoo batch error:', e.message);
    }
    if (i + BATCH < toFetch.length) await new Promise(r => setTimeout(r, 500));
  }

  const result = buildResult();
  console.log(`Cache totale: ${Object.keys(result).length} titoli`);
  return result;
}

function buildResult() {
  const result = {};
  Object.keys(YAHOO_SYMBOLS).forEach(tk => { if (cache[tk]) result[tk] = cache[tk]; });
  return result;
}

// ── EMAIL Gmail SMTP ──
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
    const send = cmd => socket.write(cmd + '\r\n');

    socket.on('data', d => {
      const line = d.toString().trim();
      if (step === 0 && line.startsWith('220'))             { send('EHLO tradingdesk'); step++; }
      else if (step === 1 && line.startsWith('250-'))       { /* multi-line, wait */ }
      else if (step === 1 && line.startsWith('250 '))       { send(`AUTH PLAIN ${authStr}`); step++; }
      else if (step === 2 && line.startsWith('235'))        { send(`MAIL FROM:<${GMAIL_USER}>`); step++; }
      else if (step === 3 && line.startsWith('250'))        { send(`RCPT TO:<${to}>`); step++; }
      else if (step === 4 && line.startsWith('250'))        { send('DATA'); step++; }
      else if (step === 5 && line.startsWith('354'))        { send(msg + '\r\n.'); step++; }
      else if (step === 6 && line.startsWith('250'))        { send('QUIT'); step++; resolve({ ok: true }); }
      else if (line.startsWith('5'))                        { socket.destroy(); reject(new Error('SMTP: ' + line)); }
    });
    socket.on('error', reject);
    socket.on('timeout', () => { socket.destroy(); reject(new Error('SMTP timeout')); });
  });
}

// ── ALERT CHECKER ──
let serverAlerts = [];

function checkAlerts(quotes) {
  serverAlerts.forEach(async (a) => {
    if (a.status !== 'active' || !a.email) return;
    const q = quotes[a.ticker];
    if (!q) return;
    const price = q.price;
    const tol = a.target * ((a.tol || 0.5) / 100);
    let triggered = false;
    if (['below','stop','support'].includes(a.type) && price <= a.target + tol) triggered = true;
    if (['above','target','resistance'].includes(a.type) && price >= a.target - tol) triggered = true;
    if (triggered && !a.notifiedAt) {
      a.notifiedAt = Date.now();
      a.status = price <= a.target ? 'triggered-down' : 'triggered-up';
      const subject = `🔔 Alert ${a.ticker} — ${price.toFixed(2)} ${['below','stop'].includes(a.type) ? '↓' : '↑'} ${a.target}`;
      const body = [
        `Alert scattato: ${a.ticker} (${a.name || a.ticker})`,
        ``,
        `Prezzo attuale:  ${price.toFixed(4)}`,
        `Target alert:    ${a.target}`,
        `Tipo:            ${a.type}`,
        ``,
        a.emailmsg ? `Nota: ${a.emailmsg}` : '',
        `Variazione:      ${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`,
        ``,
        `— Trading Desk · ${new Date().toLocaleString('it-IT')}`
      ].filter(Boolean).join('\n');
      try {
        await sendEmail(a.email, subject, body);
        console.log(`✉ Email inviata a ${a.email} per ${a.ticker}`);
      } catch(e) {
        console.error(`✗ Email fallita per ${a.ticker}:`, e.message);
      }
    }
  });
}

// ── BACKGROUND PREFETCH ──
let fetchInProgress = false;

async function prefetchAll() {
  if (fetchInProgress) return;
  fetchInProgress = true;
  console.log(`[${new Date().toLocaleTimeString('it-IT')}] Prefetch prezzi avviato...`);
  try {
    const quotes = await getQuotes();
    if (serverAlerts.filter(a => a.status === 'active').length > 0) checkAlerts(quotes);
  } catch(e) { console.error('Prefetch error:', e.message); }
  fetchInProgress = false;
  console.log(`[${new Date().toLocaleTimeString('it-IT')}] Prefetch completato — ${Object.keys(cache).length} titoli in cache`);
}

prefetchAll();
setInterval(prefetchAll, 60 * 60 * 1000); // ogni ora

// ── HTTP SERVER ──
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Serve HTML
  if (url.pathname === '/' || url.pathname === '/screener') {
    const fs = require('fs'), path = require('path');
    const htmlPath = path.join(__dirname, 'screener_pullback_v4_dark.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(htmlPath, 'utf8'));
    } else {
      res.writeHead(404, CORS);
      res.end('File HTML non trovato');
    }
    return;
  }

  // Ping
  if (url.pathname === '/ping') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, ts: Date.now(), alerts: serverAlerts.filter(a=>a.status==='active').length }));
    return;
  }

  // Quotes — risposta immediata dalla cache
  if (url.pathname === '/quotes') {
    const result = buildResult();
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, data: result, cached: Object.keys(result).length, fetching: fetchInProgress, ts: Date.now() }));
    return;
  }

  // Sync alerts
  if (url.pathname === '/alerts' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        serverAlerts = JSON.parse(body);
        console.log(`Alert sincronizzati: ${serverAlerts.filter(a=>a.status==='active').length} attivi`);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'JSON invalido' }));
      }
    });
    return;
  }

  res.writeHead(404, CORS);
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   TRADING DESK — Yahoo Finance       ║`);
  console.log(`║   Porta: ${PORT}  — nessun limite API  ║`);
  console.log(`║   Email: ${GMAIL_USER}  ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});
