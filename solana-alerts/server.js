'use strict';
/**
 * Solana (and friends) live price watcher.
 *  - polls several public exchange APIs, first one that answers wins
 *  - serves a mobile friendly dashboard (SSE live updates)
 *  - price alerts (above / below) that fire to Telegram
 *  - alerts can also be managed from Telegram itself (/above 120, /below 95, /list ...)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

/* ------------------------------------------------------------------ config */

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile(path.join(ROOT, '.env'));

const CFG = {
  token: (process.env.TELEGRAM_TOKEN || '').trim(),
  chatId: (process.env.TELEGRAM_CHAT_ID || '').trim(),
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '0.0.0.0',
  pollMs: Math.max(2000, Number(process.env.POLL_MS || 5000)),
  assets: (process.env.ASSETS || 'SOL').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
  fiat: (process.env.FIAT || 'GEL').trim().toUpperCase(),
  accessKey: (process.env.ACCESS_KEY || '').trim(),
  cooldownMs: Math.max(0, Number(process.env.COOLDOWN_MIN || 15)) * 60000,
};
const HISTORY_MAX = 720; // ~1h at 5s

/* ------------------------------------------------------------------- state */

const state = {
  nextId: 1,
  alerts: [],
  chatIds: [],
  lastUpdateId: 0,
};
const prices = {};   // ASSET -> {price, open24h, high24h, low24h, source, ts}
const history = {};  // ASSET -> [[ts, price], ...]
let fiatRate = null; // {code, rate, ts}
let lastError = null;

function loadState() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    Object.assign(state, j);
    state.alerts = Array.isArray(j.alerts) ? j.alerts : [];
    state.chatIds = Array.isArray(j.chatIds) ? j.chatIds : [];
  } catch { /* first run */ }
  if (CFG.chatId && !state.chatIds.includes(CFG.chatId)) state.chatIds.push(CFG.chatId);
}
let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }, 200);
}

/* ----------------------------------------------------------- price sources */

const KRAKEN_PAIR = { BTC: 'XBTUSD', SOL: 'SOLUSD', ETH: 'ETHUSD' };
const GECKO_ID = { SOL: 'solana', BTC: 'bitcoin', ETH: 'ethereum', XRP: 'ripple', DOGE: 'dogecoin', ADA: 'cardano', TON: 'the-open-network', AVAX: 'avalanche-2', LINK: 'chainlink', SUI: 'sui' };

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

const SOURCES = [
  {
    name: 'kraken',
    url: (a) => `https://api.kraken.com/0/public/Ticker?pair=${KRAKEN_PAIR[a] || a + 'USD'}`,
    parse: (j) => {
      const k = Object.keys(j.result || {})[0];
      if (!k) return null;
      const t = j.result[k];
      return { price: num(t.c[0]), open24h: num(t.o), high24h: num(t.h[1]), low24h: num(t.l[1]) };
    },
  },
  {
    name: 'okx',
    url: (a) => `https://www.okx.com/api/v5/market/ticker?instId=${a}-USDT`,
    parse: (j) => {
      const t = (j.data || [])[0];
      if (!t) return null;
      return { price: num(t.last), open24h: num(t.open24h), high24h: num(t.high24h), low24h: num(t.low24h) };
    },
  },
  {
    name: 'binance',
    url: (a) => `https://api.binance.com/api/v3/ticker/24hr?symbol=${a}USDT`,
    parse: (j) => (j.lastPrice ? { price: num(j.lastPrice), open24h: num(j.openPrice), high24h: num(j.highPrice), low24h: num(j.lowPrice) } : null),
  },
  {
    name: 'coinbase',
    url: (a) => `https://api.coinbase.com/v2/prices/${a}-USD/spot`,
    parse: (j) => (j.data && j.data.amount ? { price: num(j.data.amount) } : null),
  },
  {
    name: 'coingecko',
    url: (a) => `https://api.coingecko.com/api/v3/simple/price?ids=${GECKO_ID[a] || a.toLowerCase()}&vs_currencies=usd&include_24hr_change=true`,
    parse: (j, a) => {
      const d = j[GECKO_ID[a] || a.toLowerCase()];
      if (!d || !d.usd) return null;
      const ch = d.usd_24h_change;
      return { price: num(d.usd), open24h: ch ? d.usd / (1 + ch / 100) : null };
    },
  },
];
const sourceRank = Object.create(null); // asset -> index of source that worked last time

async function getJSON(url, ms = 8000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'solana-alerts/1.0' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function fetchAsset(asset) {
  const order = [];
  const start = sourceRank[asset] || 0;
  for (let i = 0; i < SOURCES.length; i++) order.push(SOURCES[(start + i) % SOURCES.length]);
  let err = null;
  for (const src of order) {
    try {
      const parsed = src.parse(await getJSON(src.url(asset)), asset);
      if (parsed && parsed.price > 0) {
        sourceRank[asset] = SOURCES.indexOf(src);
        return { ...parsed, source: src.name, ts: Date.now() };
      }
    } catch (e) { err = e; }
  }
  throw err || new Error('no source answered');
}

async function fetchFiatRate() {
  if (!CFG.fiat || CFG.fiat === 'USD') return;
  try {
    const j = await getJSON('https://open.er-api.com/v6/latest/USD', 8000);
    const r = j && j.rates && j.rates[CFG.fiat];
    if (r) fiatRate = { code: CFG.fiat, rate: r, ts: Date.now() };
  } catch { /* keep old rate */ }
}

/* ------------------------------------------------------------------ alerts */

const fmt = (n, d = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

function condMet(alert, price) {
  return alert.type === 'above' ? price >= alert.price : price <= alert.price;
}

function checkAlerts() {
  let changed = false;
  const now = Date.now();
  for (const a of state.alerts) {
    if (!a.active) continue;
    const p = prices[a.asset];
    if (!p) continue;
    const met = condMet(a, p.price);
    if (!a.armed) {                 // waiting for the price to leave the zone first
      if (!met) { a.armed = true; changed = true; }
      continue;
    }
    if (!met) continue;
    if (a.cooldownUntil && now < a.cooldownUntil) continue;

    a.hits = (a.hits || 0) + 1;
    a.lastTriggered = now;
    a.lastPrice = p.price;
    if (a.repeat) { a.armed = false; a.cooldownUntil = now + CFG.cooldownMs; }
    else a.active = false;
    changed = true;

    const arrow = a.type === 'above' ? '🟢 ⬆️' : '🔴 ⬇️';
    const word = a.type === 'above' ? 'ზემოთ' : 'ქვემოთ';
    let msg = `${arrow} <b>${a.asset}</b> ${word} ${fmt(a.price)}$\n` +
              `ახლა: <b>${fmt(p.price)}$</b>${fiatRate ? ` (≈ ${fmt(p.price * fiatRate.rate)} ${fiatRate.code})` : ''}`;
    if (p.open24h) msg += `\n24სთ: ${pctStr(p)}`;
    if (a.note) msg += `\n📝 ${escapeHtml(a.note)}`;
    msg += `\n<i>${a.repeat ? 'გამეორებადი შეტყობინება' : 'ეს შეტყობინება ჩაქრა'}</i>`;
    broadcastTelegram(msg);
    pushEvent({ type: 'fired', alert: a });
  }
  if (changed) { saveState(); }
  return changed;
}

function pctStr(p) {
  if (!p.open24h) return '—';
  const pct = ((p.price - p.open24h) / p.open24h) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function addAlert({ asset, type, price, note, repeat }) {
  asset = String(asset || CFG.assets[0]).toUpperCase();
  type = type === 'below' ? 'below' : 'above';
  price = Math.round(Number(price) * 1e6) / 1e6;
  if (!(price > 0)) throw new Error('ფასი არასწორია');
  if (!CFG.assets.includes(asset)) throw new Error(`${asset} არ ითვლება (ASSETS: ${CFG.assets.join(', ')})`);
  const cur = prices[asset] ? prices[asset].price : null;
  const a = {
    id: state.nextId++,
    asset, type, price,
    note: (note || '').slice(0, 120),
    repeat: !!repeat,
    active: true,
    armed: cur === null ? true : !condMet({ type, price }, cur),
    created: Date.now(),
    createdPrice: cur,
    hits: 0,
  };
  state.alerts.push(a);
  saveState();
  pushEvent({ type: 'alerts' });
  return a;
}
function delAlert(id) {
  const i = state.alerts.findIndex((a) => a.id === Number(id));
  if (i < 0) return false;
  state.alerts.splice(i, 1);
  saveState();
  pushEvent({ type: 'alerts' });
  return true;
}

/* ---------------------------------------------------------------- telegram */

const tgApi = (m) => `https://api.telegram.org/bot${CFG.token}/${m}`;

async function sendTelegram(chatId, text, extra = {}) {
  if (!CFG.token) return;
  try {
    const r = await fetch(tgApi('sendMessage'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    if (!j.ok) lastError = 'telegram: ' + (j.description || 'error');
  } catch (e) { lastError = 'telegram: ' + e.message; }
}
function broadcastTelegram(text) {
  if (!state.chatIds.length) { lastError = 'telegram: chat id ჯერ არ არის — ბოტს მიწერე /start'; return; }
  for (const id of state.chatIds) sendTelegram(id, text);
}

const HELP = [
  '🤖 <b>SOL ფასის ბოტი</b>',
  '',
  '/price — მიმდინარე ფასი',
  '/above 120 — შემატყობინე როცა 120$-ზე ზემოთ გადავა',
  '/below 95 — შემატყობინე როცა 95$-ზე ქვემოთ ჩამოვა',
  '/above 120 r — <i>r</i> = გამეორებადი (არ ჩაქრება)',
  '/list — ჩემი შეტყობინებები',
  '/del 3 — შეტყობინება #3 წაშლა',
  '/clear — ყველას წაშლა',
  '',
  'მრავალი მონეტის შემთხვევაში: /above BTC 70000',
].join('\n');

function priceText() {
  const rows = CFG.assets.map((a) => {
    const p = prices[a];
    if (!p) return `${a}: —`;
    return `<b>${a}</b> ${fmt(p.price)}$${fiatRate ? ` · ${fmt(p.price * fiatRate.rate)} ${fiatRate.code}` : ''} · 24სთ ${pctStr(p)}`;
  });
  return rows.join('\n') + `\n<i>წყარო: ${prices[CFG.assets[0]] ? prices[CFG.assets[0]].source : '—'}</i>`;
}
function listText() {
  const act = state.alerts;
  if (!act.length) return 'შეტყობინებები არ არის. მაგ: /above 120';
  return act.map((a) => {
    const st = !a.active ? '✔️ ჩაქრა' : a.armed ? '⏳ აქტიური' : '⏸ ელოდება გამოსვლას';
    return `#${a.id} ${a.asset} ${a.type === 'above' ? '⬆️' : '⬇️'} ${fmt(a.price)}$ ${a.repeat ? '🔁' : ''} — ${st}${a.note ? ' · ' + escapeHtml(a.note) : ''}`;
  }).join('\n');
}

async function handleCommand(chatId, textRaw) {
  const text = String(textRaw || '').trim();
  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, '');

  const mkAlert = (type) => {
    let asset = CFG.assets[0], args = rest.slice();
    if (args.length && isNaN(Number(args[0]))) asset = args.shift().toUpperCase();
    const price = Number(String(args[0] || '').replace(',', '.'));
    const repeat = /^(r|rep|repeat|გამეორ)/i.test(args[1] || '');
    if (!(price > 0)) return sendTelegram(chatId, `გამოყენება: ${cmd} 120`);
    try {
      const a = addAlert({ asset, type, price, repeat, note: '' });
      const cur = prices[asset] ? `\nახლა: ${fmt(prices[asset].price)}$` : '';
      const extra = a.armed ? '' : '\n⚠️ ფასი უკვე ამ ზონაშია — გაგზავნის მერე, როცა გამოვა და ხელახლა გადაკვეთს.';
      sendTelegram(chatId, `✅ #${a.id} ${asset} ${type === 'above' ? '⬆️' : '⬇️'} ${fmt(price)}$${a.repeat ? ' 🔁' : ''}${cur}${extra}`);
    } catch (e) { sendTelegram(chatId, '❌ ' + e.message); }
  };

  switch (cmd) {
    case '/start':
      sendTelegram(chatId, HELP + '\n\n' + priceText());
      break;
    case '/help': sendTelegram(chatId, HELP); break;
    case '/price': case '/p': sendTelegram(chatId, priceText()); break;
    case '/above': case '/a': case '/up': mkAlert('above'); break;
    case '/below': case '/b': case '/down': mkAlert('below'); break;
    case '/list': case '/l': sendTelegram(chatId, listText()); break;
    case '/del': case '/d':
      sendTelegram(chatId, delAlert(rest[0]) ? `🗑 #${rest[0]} წაიშალა` : 'ვერ ვიპოვე');
      break;
    case '/clear':
      state.alerts = []; saveState(); pushEvent({ type: 'alerts' });
      sendTelegram(chatId, '🗑 ყველა შეტყობინება წაიშალა');
      break;
    default:
      sendTelegram(chatId, HELP);
  }
}

async function telegramLoop() {
  if (!CFG.token) return;
  for (;;) {
    try {
      const j = await getJSON(tgApi('getUpdates') + `?timeout=25&offset=${state.lastUpdateId + 1}`, 35000);
      for (const u of j.result || []) {
        state.lastUpdateId = u.update_id;
        const msg = u.message || u.edited_message;
        if (!msg || !msg.chat) continue;
        const chatId = String(msg.chat.id);
        if (!state.chatIds.includes(chatId)) { state.chatIds.push(chatId); pushEvent({ type: 'tg' }); }
        saveState();
        if (msg.text) await handleCommand(chatId, msg.text);
      }
      saveState();
    } catch (e) {
      if (!/timeout|aborted/i.test(e.message)) { lastError = 'telegram poll: ' + e.message; await sleep(5000); }
    }
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------------- http + sse */

const clients = new Set();
function snapshot() {
  return {
    ts: Date.now(),
    assets: CFG.assets,
    prices,
    fiat: fiatRate,
    alerts: state.alerts,
    telegram: { configured: !!CFG.token, chats: state.chatIds.length },
    cooldownMin: CFG.cooldownMs / 60000,
    error: lastError,
  };
}
function pushEvent(extra = {}) {
  const payload = JSON.stringify({ ...snapshot(), ...extra });
  for (const res of clients) {
    try { res.write(`data: ${payload}\n\n`); } catch { clients.delete(res); }
  }
}

function authed(req, u) {
  if (!CFG.accessKey) return true;
  const k = u.searchParams.get('key') || req.headers['x-key'] || '';
  return k === CFG.accessKey;
}
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  if (p === '/' || p === '/index.html') {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(html);
  }
  if (p === '/manifest.webmanifest') {
    return json(res, 200, { name: 'SOL Alerts', short_name: 'SOL', display: 'standalone', background_color: '#0b0f14', theme_color: '#0b0f14', start_url: '.', icons: [] });
  }
  if (p.startsWith('/api/')) {
    if (!authed(req, u)) return json(res, 401, { error: 'unauthorized' });

    if (p === '/api/state') return json(res, 200, snapshot());

    if (p === '/api/history') {
      const out = {};
      for (const a of CFG.assets) out[a] = history[a] || [];
      return json(res, 200, out);
    }
    if (p === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
      req.on('close', () => { clearInterval(ka); clients.delete(res); });
      return;
    }
    if (p === '/api/alerts' && req.method === 'POST') {
      const b = await readBody(req);
      try { return json(res, 200, addAlert(b)); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (p === '/api/alerts' && req.method === 'DELETE') {
      const b = await readBody(req);
      return json(res, 200, { ok: delAlert(b.id ?? u.searchParams.get('id')) });
    }
    if (p === '/api/alerts/clear' && req.method === 'POST') {
      state.alerts = []; saveState(); pushEvent({ type: 'alerts' });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/test' && req.method === 'POST') {
      if (!CFG.token) return json(res, 400, { error: 'TELEGRAM_TOKEN არ არის .env-ში' });
      if (!state.chatIds.length) return json(res, 400, { error: 'ბოტს მიწერე /start ტელეგრამში' });
      broadcastTelegram('🔔 ტესტი — შეტყობინებები მუშაობს.\n' + priceText());
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  }
  res.writeHead(404); res.end('not found');
});

/* ------------------------------------------------------------------- start */

async function tick() {
  const results = await Promise.allSettled(CFG.assets.map((a) => fetchAsset(a)));
  let ok = 0;
  results.forEach((r, i) => {
    const a = CFG.assets[i];
    if (r.status === 'fulfilled') {
      prices[a] = r.value;
      (history[a] = history[a] || []).push([r.value.ts, r.value.price]);
      if (history[a].length > HISTORY_MAX) history[a].shift();
      ok++;
    } else {
      lastError = `${a}: ${r.reason && r.reason.message}`;
    }
  });
  if (ok) lastError = null;
  checkAlerts();
  pushEvent({ type: 'tick' });
}

function localIPs() {
  const out = [];
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) for (const n of nets[name] || []) {
    if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  }
  return out;
}

loadState();
server.listen(CFG.port, CFG.host, () => {
  const key = CFG.accessKey ? `?key=${CFG.accessKey}` : '';
  console.log(`\n  SOL alerts გაშვებულია`);
  console.log(`  კომპიუტერზე:  http://localhost:${CFG.port}/${key}`);
  for (const ip of localIPs()) console.log(`  ტელეფონიდან:  http://${ip}:${CFG.port}/${key}`);
  console.log(`  მონეტები: ${CFG.assets.join(', ')} | Telegram: ${CFG.token ? 'ჩართული' : 'OFF (.env-ში ჩასვი TELEGRAM_TOKEN)'}\n`);
});
tick();
setInterval(tick, CFG.pollMs);
fetchFiatRate();
setInterval(fetchFiatRate, 3600000);
telegramLoop();

process.on('SIGINT', () => { saveState(); setTimeout(() => process.exit(0), 250); });
