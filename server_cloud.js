const http = require('http');
const https = require('https');

const TD_KEY = '9fae1acbd8904db09894fd659ab6aa70';
const PORT = 3737;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

function fetchTwelveData(path) {
  return new Promise((resolve, reject) => {
    const url = `https://api.twelvedata.com${path}&apikey=${TD_KEY}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error')); }
      });
    }).on('error', reject);
  });
}

const cache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minuti

async function getQuotes(symbols) {
  const now = Date.now();
  const toFetch = symbols.filter(s => !cache[s] || (now - cache[s].ts) > CACHE_TTL);
  
  // Batch da 8 (limite free Twelve Data)
  const BATCH = 8;
  for (let i = 0; i < toFetch.length; i += BATCH) {
    const batch = toFetch.slice(i, i + BATCH);
    const symStr = batch.join(',');
    try {
      const data = await fetchTwelveData(`/quote?symbol=${encodeURIComponent(symStr)}`);
      // Risposta singola o multipla
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
            name: q.name || tk,
            exchange: q.exchange || ''
          };
        }
      });
    } catch(e) {
      console.error(`Batch error [${symStr}]:`, e.message);
    }
    if (i + BATCH < toFetch.length) await new Promise(r => setTimeout(r, 7800));
  }

  const result = {};
  symbols.forEach(s => { if (cache[s]) result[s] = cache[s]; });
  return result;
}

const TD_EXCHANGE = { dax:'XETRA', cac:'XPAR', ftse:'XLON', mib:'XMIL', ibex:'XMAD', aex:'XAMS' };
const TD_OVERRIDE = {
  HSBA:'LSE', AZN:'LSE', SHEL:'LSE', LSEG:'LSE', ULVR:'LSE',
  GSK:'LSE', RIO:'LSE', LLOY:'LSE', BP:'LSE', VOD:'LSE', BARC:'LSE', DGE:'LSE'
};

// Mappa tutti i ticker dello screener
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

// Nota: SAN appare sia in CAC (Sanofi) che IBEX (Santander) — usiamo XPAR come priorità

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/quotes') {
    try {
      const symbols = Object.entries(TICKER_MAP).map(([tk, ex]) => `${tk}:${ex}`);
      const data = await getQuotes(symbols);
      res.writeHead(200, CORS_HEADERS);
      res.end(JSON.stringify({ ok: true, data, cached: Object.keys(data).length, ts: Date.now() }));
    } catch(e) {
      res.writeHead(500, CORS_HEADERS);
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (url.pathname === '/ping') {
    res.writeHead(200, CORS_HEADERS);
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    return;
  }

  res.writeHead(404, CORS_HEADERS);
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n╔════════════════════════════════════╗`);
  console.log(`║   TRADING DESK — Proxy Server      ║`);
  console.log(`║   http://localhost:${PORT}          ║`);
  console.log(`║   Twelve Data key: ...${TD_KEY.slice(-6)} ║`);
  console.log(`╚════════════════════════════════════╝\n`);
  console.log(`Server avviato. Apri il file HTML nel browser.`);
  console.log(`Premi Ctrl+C per fermare.\n`);
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n⚠ Porta ${PORT} già in uso. Chiudi l'altra istanza e riprova.\n`);
  } else {
    console.error('Server error:', e);
  }
});
