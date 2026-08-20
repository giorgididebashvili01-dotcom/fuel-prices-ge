/* მთავარი გვერდი — მიმოხილვა */

const G = { latest: null, history: [], changes: [], lastChange: new Map(), day: 0 };

const DAYS = [
  { off: 0, label: "დღეს" },
  { off: 1, label: "გუშინ" },
  { off: 2, label: "გუშინწინ" },
];

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
  document.getElementById("ticker").innerHTML = items.join("") + items.join("");
}

function renderTiles(latest, history, prev) {
  const best = countryBest(latest);
  const el = document.getElementById("tiles");
  el.innerHTML = CATEGORIES.filter(c => best[c.id]).map(cat => {
    const b = best[cat.id];
    const prevMin = prev ? snapCountryMin(prev, cat.id) : null;
    const sparkVals = history.map(h => snapCountryMin(h, cat.id));
    const ts = G.lastChange.get(`${b.company.id}|${b.name}`);
    return `<div class="tile">
      <div class="t-label">ყველაზე იაფი ${cat.label.toLowerCase()}</div>
      <div class="t-value">${fmtPrice(b.price)}<span class="gel">₾</span>${deltaChip(b.price, prevMin)}</div>
      <div class="t-note"><span class="dot" style="background:${seriesColor(b.company.id)}"></span>${b.company.name} · ${b.name}${ts ? "&nbsp;·&nbsp;" + changedAt(ts) : ""}</div>
      ${sparkline(sparkVals)}
    </div>`;
  }).join("");
}

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
      const ts = G.lastChange.get(`${c.id}|${m.name}`);
      return `<td class="${isBest ? "best" : ""}" title="${m.name}"><span class="cell-price">${fmtPrice(m.price)} ₾</span>${deltaChip(m.price, prevV)}${changedAt(ts)}</td>`;
    }).join("");
    return `<tr><td class="company"><span class="co-wrap"><span class="rank">${i + 1}</span>${companyAvatar(c.id, c.name)}<span class="co-name">${c.name}<small>${c.prices.length} პროდუქტი</small></span></span></td>${cells}</tr>`;
  }).join("");
}

/* ---------- ბარათები დღის გადამრთველით ---------- */

function renderDayFilters() {
  const el = document.getElementById("day-filters");
  el.innerHTML = DAYS.map(d =>
    `<button class="chip" role="tab" data-day="${d.off}" aria-selected="${d.off === G.day}">${d.label}</button>`
  ).join("");
  el.onclick = e => {
    const b = e.target.closest("[data-day]");
    if (!b) return;
    G.day = Number(b.dataset.day);
    el.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-selected", String(x === b)));
    renderCards();
  };
}

/* იმ დღის ცვლილების დრო პროდუქტზე (ბოლო ცვლილება იმ დღეს) */
function dayChangeTs(dateStr, cid, name) {
  let ts = null;
  for (const e of G.changes) {
    if (e.c === cid && e.n === name && e.t.slice(0, 10) === dateStr) ts = e.t;
  }
  return ts;
}

function renderCards() {
  const el = document.getElementById("cards");
  const note = document.getElementById("day-note");
  const todayStr = G.history.length ? G.history[G.history.length - 1].date : new Date().toISOString().slice(0, 10);

  if (G.day === 0) {
    /* დღეს — ცოცხალი ფასები */
    const prev = G.history.find(h => h.date === shiftDate(todayStr, -1)) || null;
    const best = countryBest(G.latest);
    note.textContent = `მიმდინარე ფასები · განახლდა ${fmtDateTime(G.latest.updated)}-ზე`;
    el.innerHTML = rankedCompanies(G.latest).map(c => {
      const rows = c.prices.map(p => {
        const isBest = best[p.category] && best[p.category].price === p.price && best[p.category].company.id === c.id;
        const prevV = prev?.products?.[c.id]?.[p.name];
        const ts = G.lastChange.get(`${c.id}|${p.name}`);
        return `<li class="${isBest ? "cheapest" : ""}"><span class="n">${p.name}</span><span class="p">${fmtPrice(p.price)} ₾${deltaChip(p.price, prevV)}${changedAt(ts)}</span></li>`;
      }).join("");
      return `<div class="card"><h3>${companyAvatar(c.id, c.name, 26)}${c.name}<span class="c-count">${c.prices.length} პროდუქტი</span></h3><ul>${rows}</ul></div>`;
    }).join("");
    return;
  }

  /* გუშინ / გუშინწინ — დღის ბოლოს მდგომარეობა ისტორიიდან */
  const targetDate = shiftDate(todayStr, -G.day);
  const snap = G.history.find(h => h.date === targetDate);
  if (!snap) {
    note.textContent = "";
    el.innerHTML = `<div class="chart-empty">ამ დღის (${fmtDate(targetDate)}) მონაცემები ჯერ არ არსებობს — ისტორია ${fmtDate(G.history[0]?.date || targetDate)}-იდან გროვდება.</div>`;
    return;
  }
  const prevSnap = G.history.find(h => h.date === shiftDate(targetDate, -1)) || null;
  note.textContent = `მდგომარეობა დღის ბოლოს — ${fmtDate(targetDate)}${snap.time ? ` (ბოლო ჩანაწერი ${fmtDateTime(snap.time)})` : ""} · ცვლილება წინა დღესთან`;

  /* კომპანიები დალაგებული იმ დღის რეგულარის მინიმუმით */
  const ids = Object.keys(snap.products || {}).sort((a, b) =>
    (snap.prices?.[a]?.regular ?? Infinity) - (snap.prices?.[b]?.regular ?? Infinity));

  el.innerHTML = ids.map(cid => {
    const name = snap.names?.[cid] || cid;
    const prods = Object.entries(snap.products[cid]);
    const rows = prods.map(([n, price]) => {
      const prevV = prevSnap?.products?.[cid]?.[n];
      const ts = dayChangeTs(targetDate, cid, n);
      return `<li><span class="n">${n}</span><span class="p">${fmtPrice(price)} ₾${deltaChip(price, prevV)}${changedAt(ts)}</span></li>`;
    }).join("");
    return `<div class="card"><h3>${companyAvatar(cid, name, 26)}${name}<span class="c-count">${prods.length} პროდუქტი</span></h3><ul>${rows}</ul></div>`;
  }).join("");
}

/* ---------- „ჩავასხა თუ მოვიცადო?" ინდიკატორი ---------- */

function renderSignal() {
  const rowsEl = document.getElementById("sig-rows");
  const stripEl = document.getElementById("market-strip");

  /* კატეგორიების ტრენდები ისტორიიდან */
  const rows = CATEGORIES.map(cat => {
    const series = G.history.map(h => snapCountryMin(h, cat.id)).filter(v => v != null);
    if (series.length < 4) return null;
    const win = series.slice(-7);
    const diff = win[win.length - 1] - win[0];
    const cur = series[series.length - 1];
    const min30 = Math.min(...series.slice(-30));
    const atLow = cur <= min30 + 0.005;

    let icon, cls, text;
    if (diff <= -0.02) {
      icon = "▼"; cls = "down";
      text = `კლების ტრენდია (${win.length} დღეში ${diff.toFixed(2)}) — თუ არ გეჩქარება, მოცდა ლოგიკურია`;
    } else if (diff >= 0.02) {
      icon = "▲"; cls = "up";
      text = `მატების ტრენდია (${win.length} დღეში +${diff.toFixed(2)}) — გადადება რისკიანია`;
    } else {
      icon = "▬"; cls = "flat";
      text = "სტაბილურია — დღეს თუ ხვალ, განსხვავება უმნიშვნელოა";
    }
    if (atLow) text += " · ფასი ბოლო 30 დღის მინიმუმთანაა ✦";
    return `<div class="sig-row"><span class="sig-cat">${cat.label}</span><span class="sig-verdict ${cls}">${icon} ${text}</span></div>`;
  }).filter(Boolean);

  rowsEl.innerHTML = rows.length
    ? rows.join("")
    : `<div class="chart-empty">ტრენდის დასადგენად მინიმუმ 4 დღის ისტორიაა საჭირო — ინდიკატორი რამდენიმე დღეში ჩაირთვება. ბაზრის კონტექსტი კი უკვე მუშაობს ↓</div>`;

  /* ბაზრის კონტექსტი: Brent + USD/GEL, 14-დღიანი ცვლილება */
  function ctx(key, label, unit) {
    const s = G.market.filter(m => m[key] != null);
    if (s.length < 2) return "";
    const last = s[s.length - 1];
    const cutoff = shiftDate(last.date, -14);
    const base = s.find(m => m.date >= cutoff) || s[0];
    const pct = ((last[key] - base[key]) / base[key]) * 100;
    const up = pct > 0.3, down = pct < -0.3;
    const cls = up ? "up" : down ? "down" : "flat";
    const arrow = up ? "▲" : down ? "▼" : "▬";
    return `<span class="m-item"><span class="m-label">${label}</span><b>${last[key].toFixed(2)}${unit}</b><span class="delta ${cls}">${arrow} ${Math.abs(pct).toFixed(1)}%</span></span>`;
  }
  const brent = ctx("brent", "ნავთობი Brent", "$");
  const gel = ctx("usdgel", "დოლარი", "₾");
  stripEl.innerHTML = (brent || gel)
    ? brent + gel + `<span class="m-note">14-დღიანი ცვლილება · ეს ფაქტორები ჯიხურის ფასს ~2–3 კვირაში აღწევს</span>`
    : "";
}

/* ---------- თიზერ-გრაფიკი ---------- */

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
  G.latest = data.latest;
  G.history = data.history;
  G.changes = data.changes;
  G.market = data.market;
  G.lastChange = lastChangeMap(data.changes);
  const prev = prevSnapshot(G.history);

  document.getElementById("updated").textContent =
    `ბოლო განახლება: ${renderUpdatedText(G.latest.updated)} (თბილისის დროით)`;
  renderTicker(G.latest, prev);
  renderTiles(G.latest, G.history, prev);
  renderSignal();
  renderTable(G.latest, prev);
  renderDayFilters();
  renderCards();
  renderTeaser(G.history);
}

main();
