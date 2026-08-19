/* საწვავის ფასების დაშბოარდი — vanilla JS, გარე ბიბლიოთეკების გარეშე */

const CATEGORIES = [
  { id: "super",   label: "სუპერი" },
  { id: "premium", label: "პრემიუმი" },
  { id: "regular", label: "რეგულარი" },
  { id: "diesel",  label: "დიზელი" },
  { id: "gas",     label: "გაზი" },
];

const MONTHS_KA = ["იან", "თებ", "მარ", "აპრ", "მაი", "ივნ", "ივლ", "აგვ", "სექ", "ოქტ", "ნოე", "დეკ"];

function seriesColor(companyId) {
  const known = ["gulf", "wissol", "rompetrol", "socar", "lukoil", "portal"];
  return `var(--series-${known.includes(companyId) ? companyId : "other"})`;
}

function fmtPrice(p) {
  return p.toFixed(2);
}

function fmtDate(iso) {
  const d = new Date(iso + (iso.length === 10 ? "T12:00:00" : ""));
  return `${d.getDate()} ${MONTHS_KA[d.getMonth()]}`;
}

function categoryMin(company, catId) {
  const items = company.prices.filter(p => p.category === catId);
  if (!items.length) return null;
  return items.reduce((a, b) => (a.price <= b.price ? a : b));
}

async function main() {
  let latest, history;
  try {
    [latest, history] = await Promise.all([
      fetch("data/latest.json").then(r => r.json()),
      fetch("data/history.json").then(r => r.json()).catch(() => []),
    ]);
  } catch (e) {
    document.getElementById("updated").textContent = "მონაცემები ვერ ჩაიტვირთა.";
    return;
  }

  renderUpdated(latest);
  renderTiles(latest);
  renderTable(latest);
  renderCards(latest);
  initChart(history);
}

const MONTHS_KA_FULL = ["იანვარი", "თებერვალი", "მარტი", "აპრილი", "მაისი", "ივნისი",
  "ივლისი", "აგვისტო", "სექტემბერი", "ოქტომბერი", "ნოემბერი", "დეკემბერი"];

function renderUpdated(latest) {
  /* ka-GE ლოკალი ყველა ბრაუზერს არ აქვს — თვეს ხელით ვთარგმნით */
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tbilisi", day: "numeric", month: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(latest.updated));
  const get = t => parts.find(p => p.type === t)?.value;
  const t = `${get("day")} ${MONTHS_KA_FULL[Number(get("month")) - 1]}, ${get("hour")}:${get("minute")}`;
  document.getElementById("updated").textContent = `ბოლო განახლება: ${t} (თბილისის დროით)`;
}

/* ქვეყნის მასშტაბით ყველაზე იაფი თითო კატეგორიაში */
function countryBest(latest) {
  const best = {};
  for (const cat of CATEGORIES) {
    for (const c of latest.companies) {
      const m = categoryMin(c, cat.id);
      if (m && (!best[cat.id] || m.price < best[cat.id].price)) {
        best[cat.id] = { price: m.price, name: m.name, company: c };
      }
    }
  }
  return best;
}

function renderTiles(latest) {
  const best = countryBest(latest);
  const el = document.getElementById("tiles");
  el.innerHTML = CATEGORIES.filter(c => best[c.id]).map(cat => {
    const b = best[cat.id];
    return `<div class="tile">
      <div class="t-label">ყველაზე იაფი ${cat.label.toLowerCase()}</div>
      <div class="t-value">${fmtPrice(b.price)}<span class="gel"> ₾</span></div>
      <div class="t-note"><span class="dot" style="background:${seriesColor(b.company.id)}"></span>${b.company.name} · ${b.name}</div>
    </div>`;
  }).join("");
}

function renderTable(latest) {
  const thead = document.querySelector("#cmp-table thead");
  const tbody = document.querySelector("#cmp-table tbody");
  thead.innerHTML = `<tr><th>კომპანია</th>${CATEGORIES.map(c => `<th scope="col">${c.label}</th>`).join("")}</tr>`;

  const colMin = {};
  for (const cat of CATEGORIES) {
    const vals = latest.companies.map(c => categoryMin(c, cat.id)).filter(Boolean).map(m => m.price);
    colMin[cat.id] = vals.length ? Math.min(...vals) : null;
  }

  tbody.innerHTML = latest.companies.map(c => {
    const cells = CATEGORIES.map(cat => {
      const m = categoryMin(c, cat.id);
      if (!m) return `<td class="na">—</td>`;
      const isBest = m.price === colMin[cat.id];
      return `<td class="${isBest ? "best" : ""}" title="${m.name}">${fmtPrice(m.price)}</td>`;
    }).join("");
    return `<tr><td class="company"><span class="dot" style="background:${seriesColor(c.id)}"></span>${c.name}</td>${cells}</tr>`;
  }).join("");
}

function renderCards(latest) {
  const best = countryBest(latest);
  const el = document.getElementById("cards");
  el.innerHTML = latest.companies.map(c => {
    const rows = c.prices.map(p => {
      const isBest = best[p.category] && best[p.category].price === p.price && best[p.category].company.id === c.id;
      return `<li class="${isBest ? "cheapest" : ""}"><span>${p.name}</span><span class="p">${fmtPrice(p.price)} ₾</span></li>`;
    }).join("");
    return `<div class="card"><h3><span class="dot" style="background:${seriesColor(c.id)}"></span>${c.name}</h3><ul>${rows}</ul></div>`;
  }).join("");
}

/* ---------- ისტორიის გრაფიკი ---------- */

let chartState = { history: [], cat: "regular" };

function initChart(history) {
  chartState.history = history;
  const controls = document.getElementById("chart-controls");
  controls.innerHTML = CATEGORIES.map(c =>
    `<button role="tab" data-cat="${c.id}" aria-selected="${c.id === chartState.cat}">${c.label}</button>`
  ).join("");
  controls.addEventListener("click", e => {
    const btn = e.target.closest("button[data-cat]");
    if (!btn) return;
    chartState.cat = btn.dataset.cat;
    controls.querySelectorAll("button").forEach(b =>
      b.setAttribute("aria-selected", String(b === btn)));
    renderChart();
  });
  renderChart();
}

function chartSeries() {
  const { history, cat } = chartState;
  const byCompany = new Map();
  for (const snap of history) {
    for (const [cid, cats] of Object.entries(snap.prices || {})) {
      const v = cats[cat];
      if (v == null) continue;
      if (!byCompany.has(cid)) byCompany.set(cid, { id: cid, name: snap.names?.[cid] || cid, points: [] });
      byCompany.get(cid).points.push({ date: snap.date, price: v });
    }
  }
  return [...byCompany.values()].filter(s => s.points.length >= 1);
}

function renderChart() {
  const el = document.getElementById("chart");
  const legend = document.getElementById("legend");
  const series = chartSeries();
  const dates = [...new Set(chartState.history.map(h => h.date))].sort();

  if (!series.length || dates.length < 2) {
    el.innerHTML = `<div class="chart-empty">ისტორია დაგროვდება რამდენიმე დღეში — გრაფიკი მაშინ გამოჩნდება.</div>`;
    legend.innerHTML = "";
    return;
  }

  const W = 900, H = 340, PAD = { l: 46, r: 16, t: 14, b: 30 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;

  const all = series.flatMap(s => s.points.map(p => p.price));
  let lo = Math.min(...all), hi = Math.max(...all);
  const span = Math.max(hi - lo, 0.1);
  lo -= span * 0.12; hi += span * 0.12;

  const x = d => PAD.l + (dates.indexOf(d) / (dates.length - 1)) * iw;
  const y = v => PAD.t + (1 - (v - lo) / (hi - lo)) * ih;

  // Y ღერძის ჭდეები
  const ticks = 4;
  let grid = "", ylabels = "";
  for (let i = 0; i <= ticks; i++) {
    const v = lo + ((hi - lo) * i) / ticks;
    const yy = y(v);
    grid += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${yy}" y2="${yy}" stroke="var(--grid)" stroke-width="1"/>`;
    ylabels += `<text x="${PAD.l - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="var(--text-muted)">${v.toFixed(2)}</text>`;
  }

  // X ღერძის ჭდეები (მაქს. 6)
  const step = Math.max(1, Math.ceil(dates.length / 6));
  let xlabels = "";
  dates.forEach((d, i) => {
    if (i % step !== 0 && i !== dates.length - 1) return;
    xlabels += `<text x="${x(d)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--text-muted)">${fmtDate(d)}</text>`;
  });

  const paths = series.map(s => {
    const pts = s.points
      .slice().sort((a, b) => a.date.localeCompare(b.date))
      .map(p => `${x(p.date).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
    return `<polyline points="${pts}" fill="none" stroke="${seriesColor(s.id)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join("");

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="ფასების ისტორია">
    ${grid}
    <line x1="${PAD.l}" x2="${W - PAD.r}" y1="${PAD.t + ih}" y2="${PAD.t + ih}" stroke="var(--baseline)" stroke-width="1"/>
    ${ylabels}${xlabels}${paths}
    <line id="crosshair" y1="${PAD.t}" y2="${PAD.t + ih}" stroke="var(--baseline)" stroke-width="1" opacity="0"/>
    <g id="hoverdots"></g>
    <rect id="hover-capture" x="${PAD.l}" y="${PAD.t}" width="${iw}" height="${ih}" fill="transparent"/>
  </svg>
  <div class="tooltip" id="tooltip"></div>`;

  legend.innerHTML = series.map(s =>
    `<span class="item"><span class="dot" style="background:${seriesColor(s.id)}"></span>${s.name}</span>`
  ).join("");

  attachHover(series, dates, x, y, { W, H, PAD, ih });
}

function attachHover(series, dates, x, y, dims) {
  const svg = document.querySelector("#chart svg");
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
      dotsHtml += `<circle cx="${x(p.date)}" cy="${y(p.price)}" r="4" fill="${seriesColor(s.id)}" stroke="var(--surface-1)" stroke-width="2"/>`;
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

  function onLeave() {
    crosshair.setAttribute("opacity", "0");
    dots.innerHTML = "";
    tooltip.style.display = "none";
  }

  capture.addEventListener("mousemove", onMove);
  capture.addEventListener("mouseleave", onLeave);
}

main();
