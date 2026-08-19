/* ისტორიის გვერდი — ფილტრები, დიდი გრაფიკი, სტატისტიკა, ცვლილებების ჟურნალი */

const RANGES = [
  { id: "7",   label: "7 დღე",  days: 7 },
  { id: "30",  label: "1 თვე",  days: 30 },
  { id: "90",  label: "3 თვე",  days: 90 },
  { id: "all", label: "მთელი ისტორია", days: Infinity },
];

const state = {
  history: [],
  latest: null,
  cat: "regular",
  range: "all",
  companies: new Set(), // ცარიელი = ყველა
  allCompanies: [],     // [{id, name}]
};

function rangedHistory() {
  const r = RANGES.find(r => r.id === state.range);
  if (!r || r.days === Infinity) return state.history;
  const cutoff = new Date(Date.now() - r.days * 86400000).toISOString().slice(0, 10);
  return state.history.filter(h => h.date >= cutoff);
}

function activeCompanyIds() {
  return state.companies.size
    ? state.allCompanies.filter(c => state.companies.has(c.id)).map(c => c.id)
    : state.allCompanies.map(c => c.id);
}

/* ---------- ფილტრები ---------- */

function renderFilters() {
  const cf = document.getElementById("cat-filters");
  cf.innerHTML = CATEGORIES.map(c =>
    `<button class="chip" role="tab" data-cat="${c.id}" aria-selected="${c.id === state.cat}">${c.label}</button>`
  ).join("");
  cf.onclick = e => {
    const b = e.target.closest("[data-cat]");
    if (!b) return;
    state.cat = b.dataset.cat;
    cf.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-selected", String(x === b)));
    renderAll();
  };

  const rf = document.getElementById("range-filters");
  rf.innerHTML = RANGES.map(r =>
    `<button class="chip" role="tab" data-range="${r.id}" aria-selected="${r.id === state.range}">${r.label}</button>`
  ).join("");
  rf.onclick = e => {
    const b = e.target.closest("[data-range]");
    if (!b) return;
    state.range = b.dataset.range;
    rf.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-selected", String(x === b)));
    renderAll();
  };

  const compf = document.getElementById("company-filters");
  compf.innerHTML = state.allCompanies.map(c =>
    `<button class="chip company" data-co="${c.id}" aria-pressed="true">
      <span class="dot" style="background:${seriesColor(c.id)}"></span>${c.name}</button>`
  ).join("");
  compf.onclick = e => {
    const b = e.target.closest("[data-co]");
    if (!b) return;
    const id = b.dataset.co;
    if (state.companies.size === 0) {
      /* „ყველადან" პირველი დაჭერა — მხოლოდ ეს დარჩეს */
      state.companies = new Set([id]);
    } else if (state.companies.has(id)) {
      state.companies.delete(id);
      if (state.companies.size === 0) state.companies = new Set(); // ისევ ყველა
    } else {
      state.companies.add(id);
      if (state.companies.size === state.allCompanies.length) state.companies = new Set();
    }
    compf.querySelectorAll("[data-co]").forEach(x =>
      x.setAttribute("aria-pressed", String(state.companies.size === 0 || state.companies.has(x.dataset.co))));
    renderAll();
  };
}

/* ---------- სერიები ---------- */

function buildSeries() {
  const hist = rangedHistory();
  const ids = activeCompanyIds();
  const series = [];
  for (const id of ids) {
    const co = state.allCompanies.find(c => c.id === id);
    const points = [];
    for (const h of hist) {
      const v = h.prices?.[id]?.[state.cat];
      if (v != null) points.push({ date: h.date, price: v });
    }
    if (points.length) series.push({ id, name: co.name, points });
  }
  return series;
}

/* ---------- სტატისტიკა ---------- */

function renderStats(series) {
  const el = document.getElementById("stats");
  const hist = rangedHistory();
  if (!series.length || hist.length === 0) { el.innerHTML = ""; return; }

  const lastSnap = hist[hist.length - 1];
  const firstSnap = hist[0];
  const catLabel = CATEGORIES.find(c => c.id === state.cat)?.label || "";

  /* მიმდინარე მინიმუმი არჩეულ კომპანიებში */
  let curMin = null, curMinCo = null;
  for (const s of series) {
    const p = s.points[s.points.length - 1];
    if (p.date === lastSnap.date && (curMin == null || p.price < curMin)) { curMin = p.price; curMinCo = s.name; }
  }
  /* პერიოდის ცვლილება (მინიმუმებით) */
  const firstMin = Math.min(...series.map(s => s.points[0].price));
  const allVals = series.flatMap(s => s.points.map(p => p.price));
  const lo = Math.min(...allVals), hi = Math.max(...allVals);

  const stats = [];
  if (curMin != null) stats.push({
    label: `მიმდინარე მინ. ${catLabel}`,
    value: `${fmtPrice(curMin)} ₾`,
    sub: curMinCo || "",
  });
  if (series.length && hist.length >= 2) stats.push({
    label: "ცვლილება პერიოდში",
    value: deltaChip(curMin, firstMin, { pct: true }) || "0.00",
    sub: `${fmtDate(firstSnap.date)} → ${fmtDate(lastSnap.date)}`,
    raw: true,
  });
  stats.push({ label: "პერიოდის მინიმუმი", value: `${fmtPrice(lo)} ₾`, sub: "" });
  stats.push({ label: "პერიოდის მაქსიმუმი", value: `${fmtPrice(hi)} ₾`, sub: "" });

  el.innerHTML = stats.map(s => `<div class="stat">
    <div class="s-label">${s.label}</div>
    <div class="s-value">${s.value}</div>
    ${s.sub ? `<div class="s-sub">${s.sub}</div>` : ""}
  </div>`).join("");
}

/* ---------- გრაფიკი ---------- */

function renderChart(series) {
  const el = document.getElementById("chart");
  const legend = document.getElementById("legend");
  const dates = [...new Set(rangedHistory().map(h => h.date))].sort();

  if (!series.length || dates.length < 2) {
    el.innerHTML = `<div class="chart-empty">ამ არჩევანზე ისტორია ჯერ არ დაგროვილა — მონაცემები ყოველ 3 საათში ემატება, გრაფიკი რამდენიმე დღეში გაცოცხლდება.</div>`;
    legend.innerHTML = "";
    return;
  }

  const W = 1000, H = 420, PAD = { l: 50, r: 16, t: 18, b: 32 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;

  const all = series.flatMap(s => s.points.map(p => p.price));
  let lo = Math.min(...all), hi = Math.max(...all);
  const span = Math.max(hi - lo, 0.08);
  lo -= span * 0.15; hi += span * 0.12;

  const x = d => PAD.l + (dates.indexOf(d) / (dates.length - 1)) * iw;
  const y = v => PAD.t + (1 - (v - lo) / (hi - lo)) * ih;

  let grid = "", ylab = "";
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    grid += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>`;
    ylab += `<text x="${PAD.l - 9}" y="${y(v) + 4}" text-anchor="end" font-size="11.5" fill="var(--text-muted)">${v.toFixed(2)}</text>`;
  }
  const step = Math.max(1, Math.ceil(dates.length / 7));
  let xlab = "";
  dates.forEach((d, i) => {
    if (i % step !== 0 && i !== dates.length - 1) return;
    xlab += `<text x="${x(d)}" y="${H - 8}" text-anchor="middle" font-size="11.5" fill="var(--text-muted)">${fmtDate(d)}</text>`;
  });

  const single = series.length === 1;
  let body = "";
  for (const s of series) {
    const pts = s.points.slice().sort((a, b) => a.date.localeCompare(b.date));
    const line = pts.map(p => `${x(p.date).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
    const col = seriesColor(s.id);
    if (single) {
      /* ერთი კომპანია — „ბიტკოინური" area გრადიენტით */
      body += `<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${col}" stop-opacity="0.28"/>
        <stop offset="1" stop-color="${col}" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="${x(pts[0].date)},${PAD.t + ih} ${line} ${x(pts[pts.length - 1].date)},${PAD.t + ih}" fill="url(#ag)"/>`;
    }
    body += `<polyline points="${line}" fill="none" stroke="${col}" stroke-width="${single ? 2.5 : 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
    const lastP = pts[pts.length - 1];
    body += `<circle cx="${x(lastP.date)}" cy="${y(lastP.price)}" r="4.5" fill="${col}" stroke="var(--surface)" stroke-width="2"/>`;
  }

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="ფასების ისტორია">
    ${grid}
    <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${PAD.t + ih}" y2="${PAD.t + ih}" stroke="var(--baseline)"/>
    ${ylab}${xlab}${body}
    <line id="crosshair" y1="${PAD.t}" y2="${PAD.t + ih}" stroke="var(--baseline)" opacity="0"/>
    <g id="hoverdots"></g>
    <rect id="hover-capture" x="${PAD.l}" y="${PAD.t}" width="${iw}" height="${ih}" fill="transparent"/>
  </svg>`;

  legend.innerHTML = series.map(s =>
    `<span class="item"><span class="dot" style="background:${seriesColor(s.id)}"></span>${s.name}</span>`
  ).join("");

  attachHover(series, dates, x, y, { W });
}

function attachHover(series, dates, x, y, dims) {
  const svg = document.querySelector("#chart svg");
  if (!svg) return;
  const capture = svg.querySelector("#hover-capture");
  const crosshair = svg.querySelector("#crosshair");
  const dots = svg.querySelector("#hoverdots");
  const tooltip = document.getElementById("tooltip");
  const card = document.getElementById("chart-card");

  function onMove(evt) {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * dims.W;
    let nearest = dates[0], dist = Infinity;
    for (const d of dates) {
      const dd = Math.abs(x(d) - px);
      if (dd < dist) { dist = dd; nearest = d; }
    }
    const xx = x(nearest);
    crosshair.setAttribute("x1", xx);
    crosshair.setAttribute("x2", xx);
    crosshair.setAttribute("opacity", "1");

    const rows = [];
    let dotsHtml = "";
    for (const s of series) {
      const p = s.points.find(pt => pt.date === nearest);
      if (!p) continue;
      dotsHtml += `<circle cx="${x(p.date)}" cy="${y(p.price)}" r="4" fill="${seriesColor(s.id)}" stroke="var(--surface)" stroke-width="2"/>`;
      rows.push({ s, p });
    }
    dots.innerHTML = dotsHtml;
    rows.sort((a, b) => a.p.price - b.p.price);

    tooltip.innerHTML = `<div class="tt-date">${fmtDate(nearest)}</div>` + rows.map(r =>
      `<div class="tt-row"><span class="tt-name"><span class="dot" style="background:${seriesColor(r.s.id)}"></span>${r.s.name}</span><b>${fmtPrice(r.p.price)}</b></div>`
    ).join("");
    tooltip.style.display = "block";

    const cardRect = card.getBoundingClientRect();
    let tx = evt.clientX - cardRect.left + 14;
    if (tx + tooltip.offsetWidth > cardRect.width - 8) tx = evt.clientX - cardRect.left - tooltip.offsetWidth - 14;
    tooltip.style.left = `${tx}px`;
    tooltip.style.top = `${evt.clientY - cardRect.top - 10}px`;
  }

  capture.addEventListener("mousemove", onMove);
  capture.addEventListener("mouseleave", () => {
    crosshair.setAttribute("opacity", "0");
    dots.innerHTML = "";
    tooltip.style.display = "none";
  });
}

/* ---------- ცვლილებების ჟურნალი ---------- */

function renderChangelog() {
  const el = document.getElementById("changelog");
  const hist = rangedHistory();
  const ids = new Set(activeCompanyIds());
  const events = [];

  for (let i = 1; i < hist.length; i++) {
    const prev = hist[i - 1], cur = hist[i];
    for (const [cid, prods] of Object.entries(cur.products || {})) {
      if (!ids.has(cid)) continue;
      for (const [name, price] of Object.entries(prods)) {
        const prevP = prev.products?.[cid]?.[name];
        if (prevP == null || Math.abs(price - prevP) < 0.005) continue;
        /* კატეგორიის ფილტრი პროდუქტის სახელით — იგივე ლოგიკა, რაც სკრეიპერშია */
        if (state.cat !== catOfName(name)) continue;
        events.push({ date: cur.date, cid, co: cur.names?.[cid] || cid, name, from: prevP, to: price });
      }
    }
  }

  events.sort((a, b) => b.date.localeCompare(a.date));
  const top = events.slice(0, 20);

  if (!top.length) {
    el.innerHTML = `<li><span class="cl-prod">ცვლილებები ჯერ არ დაფიქსირებულა — ჟურნალი ისტორიასთან ერთად შეივსება.</span></li>`;
    return;
  }
  el.innerHTML = top.map(ev => {
    const d = ev.to - ev.from;
    const chip = deltaChip(ev.to, ev.from);
    return `<li>
      <span class="cl-date">${fmtDate(ev.date)}</span>
      <span class="cl-co"><span class="dot" style="background:${seriesColor(ev.cid)}"></span>${ev.co}</span>
      <span class="cl-prod">${ev.name}</span>
      <span class="cl-move">${fmtPrice(ev.from)} → <b>${fmtPrice(ev.to)}</b> ${chip}</span>
    </li>`;
  }).join("");
}

/* კატეგორია პროდუქტის სახელიდან (სკრეიპერის ლოგიკის ასლი) */
function catOfName(name) {
  const n = name.toLowerCase();
  if (/(გაზ|gas|lpg|cng|ბუნებრივი|თხევადი)/.test(n)) return "gas";
  if (/(დიზელ|diesel|dizel)/.test(n)) return "diesel";
  if (/(სუპერ|super)/.test(n)) return "super";
  if (/(პრემიუმ|premium|avangard|ავანგარდ)/.test(n)) return "premium";
  if (/(რეგულარ|regular)/.test(n)) return "regular";
  if (/(ევრო|euro)/.test(n)) return "regular";
  return "other";
}

/* ---------- მთავარი ---------- */

function renderAll() {
  const series = buildSeries();
  renderStats(series);
  renderChart(series);
  renderChangelog();
}

async function main() {
  document.getElementById("brand-mark").innerHTML = borjgali(30);
  document.querySelectorAll(".b-mark").forEach(el => { el.innerHTML = borjgali(19); });

  let data;
  try {
    data = await loadData();
  } catch (e) {
    document.getElementById("updated").textContent = "მონაცემები ვერ ჩაიტვირთა.";
    return;
  }
  state.latest = data.latest;
  state.history = data.history;
  state.allCompanies = data.latest.companies.map(c => ({ id: c.id, name: c.name }));

  document.getElementById("updated").textContent =
    `ბოლო განახლება: ${renderUpdatedText(data.latest.updated)} (თბილისის დროით)`;

  renderFilters();
  renderAll();
}

main();
