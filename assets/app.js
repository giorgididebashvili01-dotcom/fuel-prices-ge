/* მთავარი გვერდი — მიმოხილვა */

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

function renderMarks() {
  document.getElementById("brand-mark").innerHTML = borjgali(30);
  document.querySelectorAll(".b-mark").forEach(el => { el.innerHTML = borjgali(19); });
}

function renderTicker(latest, prev) {
  const items = [];
  for (const c of latest.companies) {
    const m = categoryMin(c, "regular") || categoryMin(c, "super");
    if (!m) continue;
    const prevV = prev?.prices?.[c.id]?.[m.category];
    items.push(`<span class="tick"><span class="dot" style="background:${seriesColor(c.id)}"></span>${c.name} · ${CATEGORIES.find(x => x.id === m.category)?.label || ""} <b>${fmtPrice(m.price)} ₾</b>${deltaChip(m.price, prevV)}</span>`);
  }
  if (!items.length) return;
  const bar = document.getElementById("ticker-bar");
  bar.hidden = false;
  /* მარკიზა ორმაგდება უწყვეტი მოძრაობისთვის */
  document.getElementById("ticker").innerHTML = items.join("") + items.join("");
}

function renderTiles(latest, history, prev) {
  const best = countryBest(latest);
  const el = document.getElementById("tiles");
  el.innerHTML = CATEGORIES.filter(c => best[c.id]).map(cat => {
    const b = best[cat.id];
    const prevMin = prev ? snapCountryMin(prev, cat.id) : null;
    const sparkVals = history.map(h => snapCountryMin(h, cat.id));
    return `<div class="tile">
      <div class="t-label">ყველაზე იაფი ${cat.label.toLowerCase()}</div>
      <div class="t-value">${fmtPrice(b.price)}<span class="gel">₾</span>${deltaChip(b.price, prevMin)}</div>
      <div class="t-note"><span class="dot" style="background:${seriesColor(b.company.id)}"></span>${b.company.name} · ${b.name}</div>
      ${sparkline(sparkVals)}
    </div>`;
  }).join("");
}

/* კომპანიები დალაგებული „რეიტინგით" — ვისაც რეგულარი ყველაზე იაფი აქვს */
function rankedCompanies(latest) {
  return latest.companies.slice().sort((a, b) => {
    const av = categoryMin(a, "regular")?.price ?? Infinity;
    const bv = categoryMin(b, "regular")?.price ?? Infinity;
    return av - bv;
  });
}

function renderTable(latest, prev) {
  const thead = document.querySelector("#cmp-table thead");
  const tbody = document.querySelector("#cmp-table tbody");
  thead.innerHTML = `<tr><th>#&nbsp;&nbsp;კომპანია</th>${CATEGORIES.map(c => `<th scope="col">${c.label}</th>`).join("")}</tr>`;

  const colMin = {};
  for (const cat of CATEGORIES) {
    const vals = latest.companies.map(c => categoryMin(c, cat.id)).filter(Boolean).map(m => m.price);
    colMin[cat.id] = vals.length ? Math.min(...vals) : null;
  }

  tbody.innerHTML = rankedCompanies(latest).map((c, i) => {
    const cells = CATEGORIES.map(cat => {
      const m = categoryMin(c, cat.id);
      if (!m) return `<td class="na">—</td>`;
      const prevV = prev?.prices?.[c.id]?.[cat.id];
      const isBest = m.price === colMin[cat.id];
      return `<td class="${isBest ? "best" : ""}" title="${m.name}"><span class="cell-price">${fmtPrice(m.price)} ₾</span>${deltaChip(m.price, prevV)}</td>`;
    }).join("");
    return `<tr><td class="company"><span class="co-wrap"><span class="rank">${i + 1}</span>${companyAvatar(c.id, c.name)}<span class="co-name">${c.name}<small>${c.prices.length} პროდუქტი</small></span></span></td>${cells}</tr>`;
  }).join("");
}

function renderCards(latest, prev) {
  const best = countryBest(latest);
  const el = document.getElementById("cards");
  el.innerHTML = rankedCompanies(latest).map(c => {
    const rows = c.prices.map(p => {
      const isBest = best[p.category] && best[p.category].price === p.price && best[p.category].company.id === c.id;
      const prevV = prev?.products?.[c.id]?.[p.name];
      return `<li class="${isBest ? "cheapest" : ""}"><span class="n">${p.name}</span><span class="p">${fmtPrice(p.price)} ₾${deltaChip(p.price, prevV)}</span></li>`;
    }).join("");
    return `<div class="card"><h3>${companyAvatar(c.id, c.name, 26)}${c.name}<span class="c-count">${c.prices.length} პროდუქტი</span></h3><ul>${rows}</ul></div>`;
  }).join("");
}

/* თიზერ-გრაფიკი: რეგულარის ქვეყნის მინიმუმი დროში (ბიტკოინის სტილის area) */
function renderTeaser(history) {
  const el = document.getElementById("teaser-chart");
  const pts = history
    .map(h => ({ date: h.date, v: snapCountryMin(h, "regular") }))
    .filter(p => p.v != null);

  if (pts.length < 2) {
    el.innerHTML = `<div class="chart-empty">ისტორია გროვდება — გრაფიკი რამდენიმე დღეში გაცოცხლდება. ფილტრები და დეტალები უკვე შიგნითაა →</div>`;
    return;
  }

  const W = 1000, H = 260, PAD = { l: 46, r: 14, t: 16, b: 26 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
  const span = Math.max(hi - lo, 0.06);
  lo -= span * 0.25; hi += span * 0.15;
  const x = i => PAD.l + (i / (pts.length - 1)) * iw;
  const y = v => PAD.t + (1 - (v - lo) / (hi - lo)) * ih;

  const trendDown = pts[pts.length - 1].v <= pts[0].v;
  const col = trendDown ? "var(--down)" : "var(--up)";
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");

  let grid = "", ylab = "";
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3;
    grid += `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/>`;
    ylab += `<text x="${PAD.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--text-muted)">${v.toFixed(2)}</text>`;
  }
  const step = Math.max(1, Math.ceil(pts.length / 6));
  let xlab = "";
  pts.forEach((p, i) => {
    if (i % step !== 0 && i !== pts.length - 1) return;
    xlab += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--text-muted)">${fmtDate(p.date)}</text>`;
  });

  const last = pts[pts.length - 1];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="რეგულარის ფასის ისტორია">
    <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${col}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${col}" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}${ylab}${xlab}
    <polygon points="${x(0)},${PAD.t + ih} ${line} ${x(pts.length - 1)},${PAD.t + ih}" fill="url(#tg)"/>
    <polyline points="${line}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(pts.length - 1)}" cy="${y(last.v)}" r="5" fill="${col}" stroke="var(--surface)" stroke-width="2"/>
  </svg>`;
  document.getElementById("teaser-note").textContent =
    `რეგულარი ქვეყნის მინიმუმზე: ${fmtPrice(last.v)} ₾ · ${fmtDate(pts[0].date)} — ${fmtDate(last.date)}`;
}

async function main() {
  renderMarks();
  let data;
  try {
    data = await loadData();
  } catch (e) {
    document.getElementById("updated").textContent = "მონაცემები ვერ ჩაიტვირთა.";
    return;
  }
  const { latest, history } = data;
  const prev = prevSnapshot(history);

  document.getElementById("updated").textContent =
    `ბოლო განახლება: ${renderUpdatedText(latest.updated)} (თბილისის დროით)`;
  renderTicker(latest, prev);
  renderTiles(latest, history, prev);
  renderTable(latest, prev);
  renderCards(latest, prev);
  renderTeaser(history);
}

main();
