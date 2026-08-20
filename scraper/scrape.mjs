/* საწვავის ფასების სკრეიპერი — Node 20, გარე დამოკიდებულებების გარეშე.
   უშვებს GitHub Actions ყოველ 3 საათში; წერს data/latest.json და data/history.json */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return await res.text();
}

/* კატეგორიის ამოცნობა პროდუქტის სახელიდან (ქართული და ლათინური სახელები) */
function categorize(name) {
  const n = name.toLowerCase();
  if (/(გაზ|gas|lpg|cng|ბუნებრივი|თხევადი)/.test(n)) return "gas";
  if (/(დიზელ|diesel|dizel)/.test(n)) return "diesel";
  if (/(სუპერ|super)/.test(n)) return "super";
  if (/(პრემიუმ|premium|avangard|ავანგარდ)/.test(n)) return "premium";
  if (/(რეგულარ|regular)/.test(n)) return "regular";
  if (/(ევრო|euro)/.test(n)) return "regular";
  return "other";
}

function sane(items, company) {
  const ok = items.filter(
    (p) => Number.isFinite(p.price) && p.price >= 0.5 && p.price <= 8
  );
  if (ok.length < 2) throw new Error(`${company}: მოულოდნელად ცოტა ფასი (${ok.length})`);
  return ok.map((p) => ({ ...p, category: categorize(p.name) }));
}

/* ---------------- პარსერები ---------------- */

const COMPANIES = [
  {
    id: "gulf",
    name: "Gulf",
    url: "https://gulf.ge/ge/fuel_prices",
    async parse() {
      let html = await fetchHtml(this.url);
      html = html.replace(/<!--[\s\S]*?-->/g, "");
      const names = [...html.matchAll(/<span class="normal">([^<]+)<\/span>/g)]
        .map((m) => m[1].trim())
        .slice(1); // პირველი სვეტი თარიღია
      const rowM = html.match(/<tr class="prices_cnt (?:odd|even)"[^>]*>([\s\S]*?)<\/tr>/);
      if (!rowM) throw new Error("gulf: ცხრილის რიგი ვერ მოიძებნა");
      const cells = [...rowM[1].matchAll(/<td[^>]*><span>([^<]*)<\/span>/g)].map((m) => m[1].trim());
      return names.map((n, i) => ({ name: n, price: parseFloat(cells[i + 1]) }));
    },
  },
  {
    id: "wissol",
    name: "Wissol",
    // /ge გვერდი სერვერზე გატეხილია (HTTP 500), /en მუშაობს
    url: "https://wissol.ge/en",
    async parse() {
      const html = await fetchHtml(this.url);
      return [...html.matchAll(/top-prices_item">[\s\S]*?<p[^>]*>\s*([^<]+?)\s*<\/p>\s*<p>\s*([\d.]+)/g)]
        .map((m) => ({ name: m[1].trim(), price: parseFloat(m[2]) }));
    },
  },
  {
    id: "rompetrol",
    name: "Rompetrol",
    url: "https://www.rompetrol.ge/",
    async parse() {
      const html = await fetchHtml(this.url);
      const blockM = html.match(/table-orange[\s\S]*?<\/table>/);
      if (!blockM) throw new Error("rompetrol: ცხრილი ვერ მოიძებნა");
      return [...blockM[0].matchAll(/<td>\s*([^<]+?)\s*<\/td>\s*<td>\s*(\d+\.\d+)\s*<\/td>/g)]
        .map((m) => ({ name: m[1].trim(), price: parseFloat(m[2]) }));
    },
  },
  {
    id: "socar",
    name: "SOCAR",
    // Next.js — ფასები escaped JSON-შია საწყის HTML-ში
    url: "https://sgp.ge/",
    async parse() {
      const html = await fetchHtml(this.url);
      return [...html.matchAll(
        /\\"FuelNameGeo\\":\\"(.*?)\\",\\"FuelNameEng\\":\\"(.*?)\\",\\"FuelUnitPrice\\":([\d.]+)/g
      )].map((m) => ({ name: m[1].trim(), price: parseFloat(m[3]) }));
    },
  },
  {
    id: "lukoil",
    name: "Lukoil",
    url: "https://www.lukoil.ge/",
    async parse() {
      const html = await fetchHtml(this.url);
      return [...html.matchAll(/<p>(\d+\.\d{2})<\/p>\s*<p[^>]*>\s*([^<]+?)\s*<\/p>/g)]
        .map((m) => ({ name: m[2], price: parseFloat(m[1]) }))
        .filter((p) => p.price > 0); // 0.00 = გაყიდვაში არაა
    },
  },
  {
    id: "portal",
    name: "Portal",
    // Next.js — fuelPricesData escaped JSON-შია; latestPrice = ფასი სადგურზე
    url: "https://portal.com.ge/ka/fuel-prices",
    async parse() {
      const html = await fetchHtml(this.url);
      const seen = new Map();
      for (const m of html.matchAll(
        /\\"name\\":\\"([^"\\]+)\\",\\"type\\":\\"([^"\\]+)\\",\\"octane\\":(?:[\d.]+|null),\\"latestPrice\\":\\"([\d.]+)\\"/g
      )) {
        if (!seen.has(m[1])) seen.set(m[1], { name: m[1].trim(), price: parseFloat(m[3]) });
      }
      return [...seen.values()];
    },
  },
];

/* ---------------- მთავარი ---------------- */

const results = [];
const errors = [];
const latestPathEarly = join(DATA, "latest.json");
const oldLatest = existsSync(latestPathEarly) ? JSON.parse(readFileSync(latestPathEarly, "utf8")) : null;

for (const c of COMPANIES) {
  try {
    const prices = sane(await c.parse(), c.id);
    results.push({ id: c.id, name: c.name, url: c.url, prices });
    console.log(`OK  ${c.name}: ${prices.length} ფასი`);
  } catch (e) {
    errors.push(`${c.name}: ${e.message}`);
    console.error(`ERR ${c.name}: ${e.message}`);
    /* დროებითი ჩავარდნისას (403 და მისთ.) ძველი ფასები რჩება — საიტიდან კომპანია არ ქრება */
    const prev = oldLatest?.companies?.find((x) => x.id === c.id);
    if (prev) {
      results.push(prev);
      console.log(`↻  ${c.name}: წინა მონაცემი შენარჩუნდა`);
    }
  }
}

if (results.length === 0) {
  console.error("ვერცერთი კომპანია ვერ წავიკითხე — ვწყვეტ.");
  process.exit(1);
}

const now = new Date();

/* ბაზრის კონტექსტი: Brent-ის ფასი და USD/GEL კურსი — ჯიხურის ფასების წინმსწრები ფაქტორები */
async function fetchMarket() {
  const marketPath = join(DATA, "market.json");
  const market = existsSync(marketPath) ? JSON.parse(readFileSync(marketPath, "utf8")) : [];
  const byDate = new Map(market.map((m) => [m.date, m]));
  try {
    const y = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/BZ=F?range=1mo&interval=1d", {
      headers: { "User-Agent": UA },
    }).then((r) => r.json());
    const res = y.chart.result[0];
    const ts = res.timestamp || [];
    const closes = res.indicators.quote[0].close || [];
    ts.forEach((t, i) => {
      if (closes[i] == null) return;
      const d = new Date(t * 1000).toISOString().slice(0, 10);
      const e = byDate.get(d) || { date: d };
      e.brent = Math.round(closes[i] * 100) / 100;
      byDate.set(d, e);
    });
  } catch (e) {
    console.error("brent:", e.message);
  }
  try {
    const n = await fetch("https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/ka/json/?currencies=USD").then((r) => r.json());
    const cur = n[0]?.currencies?.[0];
    if (cur?.rate) {
      const d = now.toISOString().slice(0, 10);
      const e = byDate.get(d) || { date: d };
      e.usdgel = cur.rate;
      byDate.set(d, e);
    }
  } catch (e) {
    console.error("nbg:", e.message);
  }
  const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-120);
  writeFileSync(marketPath, JSON.stringify(merged));
  console.log(`ბაზარი: ${merged.length} დღის კონტექსტი`);
}
await fetchMarket();

/* ცვლილებების მუდმივი ჟურნალი — ყოველი ფასის ცვლილება ზუსტი დროით */
const changesPath = join(DATA, "changes.json");
const latestPath = join(DATA, "latest.json");
const changes = existsSync(changesPath) ? JSON.parse(readFileSync(changesPath, "utf8")) : [];
if (existsSync(latestPath)) {
  const old = JSON.parse(readFileSync(latestPath, "utf8"));
  for (const c of results) {
    const oldCo = old.companies?.find((x) => x.id === c.id);
    if (!oldCo) continue;
    for (const p of c.prices) {
      const oldP = oldCo.prices.find((x) => x.name === p.name);
      if (oldP && Math.abs(oldP.price - p.price) >= 0.005) {
        changes.push({ t: now.toISOString(), c: c.id, n: p.name, cat: p.category, from: oldP.price, to: p.price });
      }
    }
  }
}
while (changes.length > 3000) changes.shift();
writeFileSync(changesPath, JSON.stringify(changes));

const latest = { updated: now.toISOString(), errors, companies: results };
writeFileSync(latestPath, JSON.stringify(latest, null, 2));

/* ისტორია: დღეში ერთი ჩანაწერი (ბოლო გაშვება იმარჯვებს), კატეგორიების მინიმუმებით */
const histPath = join(DATA, "history.json");
const history = existsSync(histPath) ? JSON.parse(readFileSync(histPath, "utf8")) : [];
const today = now.toISOString().slice(0, 10);

const snapPrices = {};
const snapNames = {};
const snapProducts = {};
for (const c of results) {
  snapNames[c.id] = c.name;
  const cats = {};
  const prods = {};
  for (const p of c.prices) {
    prods[p.name] = p.price;
    if (p.category === "other") continue;
    if (cats[p.category] == null || p.price < cats[p.category]) cats[p.category] = p.price;
  }
  snapPrices[c.id] = cats;
  snapProducts[c.id] = prods;
}

const idx = history.findIndex((h) => h.date === today);
const snap = { date: today, time: now.toISOString(), names: snapNames, prices: snapPrices, products: snapProducts };
if (idx >= 0) history[idx] = snap;
else history.push(snap);
history.sort((a, b) => a.date.localeCompare(b.date));

writeFileSync(histPath, JSON.stringify(history));
console.log(`ჩაწერილია: ${results.length} კომპანია, ისტორიაში ${history.length} დღე.`);
