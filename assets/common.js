/* საერთო ლოგიკა — მონაცემები, კატეგორიები, ფერები, დელტები, სპარკლაინები */

const CATEGORIES = [
  { id: "super",   label: "სუპერი" },
  { id: "premium", label: "პრემიუმი" },
  { id: "regular", label: "რეგულარი" },
  { id: "diesel",  label: "დიზელი" },
  { id: "gas",     label: "გაზი" },
];

const MONTHS_KA = ["იან", "თებ", "მარ", "აპრ", "მაი", "ივნ", "ივლ", "აგვ", "სექ", "ოქტ", "ნოე", "დეკ"];
const MONTHS_KA_FULL = ["იანვარი", "თებერვალი", "მარტი", "აპრილი", "მაისი", "ივნისი",
  "ივლისი", "აგვისტო", "სექტემბერი", "ოქტომბერი", "ნოემბერი", "დეკემბერი"];

const SERIES = {
  gulf:      "#3987e5",
  wissol:    "#d95926",
  rompetrol: "#199e70",
  socar:     "#c98500",
  lukoil:    "#d55181",
  portal:    "#9085e9",
  other:     "#8b93a7",
};

function seriesColor(id) { return SERIES[id] || SERIES.other; }

function fmtPrice(p) { return p.toFixed(2); }

function fmtDate(iso) {
  const d = new Date(iso + (iso.length === 10 ? "T12:00:00" : ""));
  return `${d.getDate()} ${MONTHS_KA[d.getMonth()]}`;
}

async function loadData() {
  const [latest, history] = await Promise.all([
    fetch("data/latest.json").then(r => r.json()),
    fetch("data/history.json").then(r => r.json()).catch(() => []),
  ]);
  history.sort((a, b) => a.date.localeCompare(b.date));
  return { latest, history };
}

/* წინა დღის ჩანაწერი (ბოლო ჩანაწერამდე) */
function prevSnapshot(history) {
  return history.length >= 2 ? history[history.length - 2] : null;
}

/* დელტა-ჩიპის HTML: მოკლება მწვანეა, მომატება — წითელი */
function deltaChip(cur, prev, { pct = false } = {}) {
  if (prev == null || cur == null) return "";
  const d = cur - prev;
  if (Math.abs(d) < 0.005) return `<span class="delta flat" title="უცვლელია">0.00</span>`;
  const up = d > 0;
  const arrow = up ? "▲" : "▼";
  const cls = up ? "up" : "down";
  const pctTxt = pct ? ` (${up ? "+" : "−"}${Math.abs((d / prev) * 100).toFixed(1)}%)` : "";
  return `<span class="delta ${cls}" title="${up ? "გაძვირდა" : "გაიაფდა"} გუშინდელთან შედარებით">${arrow}${Math.abs(d).toFixed(2)}${pctTxt}</span>`;
}

/* კომპანიის კატეგორიის მინიმუმი latest-იდან */
function categoryMin(company, catId) {
  const items = company.prices.filter(p => p.category === catId);
  if (!items.length) return null;
  return items.reduce((a, b) => (a.price <= b.price ? a : b));
}

/* ქვეყნის მინიმუმი კატეგორიაში, ისტორიის ერთი snapshot-იდან */
function snapCountryMin(snap, catId) {
  let min = null;
  for (const cats of Object.values(snap.prices || {})) {
    const v = cats[catId];
    if (v != null && (min == null || v < min)) min = v;
  }
  return min;
}

/* სპარკლაინი: values[] -> პატარა SVG. ფერი ტრენდით (კლება მწვანე) */
function sparkline(values, w = 132, h = 40) {
  const pts = values.filter(v => v != null);
  if (pts.length < 2) return "";
  let lo = Math.min(...pts), hi = Math.max(...pts);
  if (hi - lo < 0.01) { lo -= 0.02; hi += 0.02; }
  const pad = (hi - lo) * 0.15;
  lo -= pad; hi += pad;
  const x = i => (i / (pts.length - 1)) * (w - 4) + 2;
  const y = v => h - 4 - ((v - lo) / (hi - lo)) * (h - 8);
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const trend = pts[pts.length - 1] - pts[0];
  const color = trend > 0.004 ? "var(--up)" : trend < -0.004 ? "var(--down)" : "var(--text-muted)";
  const gid = "sg" + Math.random().toString(36).slice(2, 8);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity="0.25"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="2,${h - 2} ${line} ${w - 2},${h - 2}" fill="url(#${gid})"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

/* ბორჯღალი — შვიდმხივიანი მზე */
function borjgali(size = 30) {
  let arms = "";
  for (let i = 0; i < 7; i++) {
    arms += `<path d="M0 -3 C 7 -6, 11 -13, 9 -21" transform="rotate(${(360 / 7) * i})"
      fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>`;
  }
  return `<svg viewBox="-24 -24 48 48" width="${size}" height="${size}" aria-hidden="true" class="borjgali">
    <circle r="4.6" fill="currentColor"/>${arms}</svg>`;
}

function renderUpdatedText(iso) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tbilisi", day: "numeric", month: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const get = t => parts.find(p => p.type === t)?.value;
  return `${get("day")} ${MONTHS_KA_FULL[Number(get("month")) - 1]}, ${get("hour")}:${get("minute")}`;
}
