/* =====================================================================
   Planta: collar previsto × collar realizado
   - Previsto (X, Y, Z): planilha "Planejado - Coordenadas Previstas dos
     Furos (XYZ)", aba PLANEJADO, colunas PLANO | Y | X | Z.
   - Realizado: ponto do layer "Hole" de cada DXF (mesmo PLANO = nome-base
     do arquivo DXF). Usa as mesmas fontes de fetchDxfHoles() do mapa.
   Pareamento: para cada plano, cada collar previsto é ligado ao collar
   realizado mais próximo em planta (um para um, do menor para o maior
   desvio), até COLLAR_MATCH_MAX metros.
   Este arquivo depende de app.js (RECORDS, fetchDxfHoles, parseGviz,
   norm, destroy, CHARTS, C, LIMITS, fmtNum, fmtInt).
   ===================================================================== */

// Planilha "Planejado - Coordenadas Previstas dos Furos (XYZ)". Lê a primeira aba
// (que deve se chamar PLANEJADO), por isso o parâmetro "sheet" não é enviado.
const PLANEJADO_SHEET_ID = "180XzsGaAuYqcvyZyFUTpTHtdFu97o8jmBrahzwYkBV0";
const PLANEJADO_GVIZ_URL = `https://docs.google.com/spreadsheets/d/${PLANEJADO_SHEET_ID}/gviz/tq?tqx=out:json&headers=1`;
// Tolerâncias do collar (metros). Valores padrão do painel; ajustar aqui se mudar a norma.
const COLLAR_TOL_XY = 0.5;
const COLLAR_TOL_Z = 0.5;
// Distância máxima para parear um collar previsto a um realizado (metros).
const COLLAR_MATCH_MAX = 2.0;

const PLANTA_COLORS = {
  green: "#1f5b3a",   // cabeçalhos e barras de aderência
  gold: "#b8860b",    // linha de meta
  ok: "#2e8b57",      // dentro da tolerância em XY e Z
  amber: "#c47b00",   // XY dentro, Z fora
  red: "#e20613",     // XY fora
  blue: "#2563a8",    // realizado sem previsto correspondente
  planned: "#7b858d", // collar previsto
  link: "#b9c0c6",    // linha entre previsto e realizado
};

const PLANTA_LEGEND_ORDER = { "Aderência": 0, "Furos": 1, "Meta": 2 };

let PLANEJADO = null;          // Map(plano -> [{ x, y, z }])
let PLANEJADO_IGNORED = 0;     // linhas sem coordenadas completas
let PLANEJADO_ERROR = "";
let PLANEJADO_SIGNATURE = "";
let PLANTA_TOKEN = 0;

const pct2 = (n) => n == null || !isFinite(n) ? "—" : fmtNum(n, 2) + "%";

function toNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v !== "string" || !v.trim()) return NaN;
  const t = v.trim();
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
}

function buildPlanejado(table) {
  const idx = {};
  table.cols.forEach((col, i) => { idx[norm(col.label)] = i; });
  const [iPlano, iY, iX, iZ] = ["PLANO", "Y", "X", "Z"].map((name) => idx[name]);
  if ([iPlano, iY, iX, iZ].some((i) => i === undefined)) {
    throw new Error("A aba PLANEJADO precisa das colunas PLANO, Y, X e Z.");
  }
  const plans = new Map();
  let ignored = 0;
  table.rows.forEach((row) => {
    const cell = (i) => row.c?.[i]?.v;
    const plano = String(cell(iPlano) ?? "").trim();
    if (!plano) return;
    const x = toNumber(cell(iX));
    const y = toNumber(cell(iY));
    const z = toNumber(cell(iZ));
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) { ignored++; return; }
    if (!plans.has(plano)) plans.set(plano, []);
    plans.get(plano).push({ x, y, z });
  });
  return { plans, ignored };
}

async function loadPlanejado() {
  try {
    const res = await fetch(PLANEJADO_GVIZ_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("gviz HTTP " + res.status);
    const table = parseGviz(await res.text());
    if (!table || !Array.isArray(table.cols) || !Array.isArray(table.rows)) {
      throw new Error("planilha sem tabela legível");
    }
    const parsed = buildPlanejado(table);
    PLANEJADO = parsed.plans;
    PLANEJADO_IGNORED = parsed.ignored;
    PLANEJADO_ERROR = "";
    PLANEJADO_SIGNATURE = JSON.stringify([...PLANEJADO]);
  } catch (e) {
    console.warn("coordenadas previstas indisponíveis:", e);
    PLANEJADO = null;
    PLANEJADO_IGNORED = 0;
    PLANEJADO_ERROR = e.message && e.message.startsWith("A aba")
      ? e.message
      : "Não foi possível ler as coordenadas previstas (aba PLANEJADO). Confirme que a planilha está com acesso “Qualquer pessoa com o link”.";
    PLANEJADO_SIGNATURE = "ERR:" + PLANEJADO_ERROR;
  }
}

async function refreshPlanejadoIfChanged() {
  const before = PLANEJADO_SIGNATURE;
  await loadPlanejado();
  if (before !== PLANEJADO_SIGNATURE) await drawPlanta();
}

/* Pareamento um para um, do menor para o maior desvio em planta. */
function matchPlanCollars(planned, realized) {
  const pairs = [];
  realized.forEach((r, i) => planned.forEach((p, j) => {
    const d = Math.hypot(r.x - p.x, r.y - p.y);
    if (d <= COLLAR_MATCH_MAX) pairs.push({ d, i, j });
  }));
  pairs.sort((a, b) => a.d - b.d);
  const usedR = new Uint8Array(realized.length);
  const usedP = new Uint8Array(planned.length);
  const matches = [];
  for (const { d, i, j } of pairs) {
    if (usedR[i] || usedP[j]) continue;
    usedR[i] = 1;
    usedP[j] = 1;
    const r = realized[i];
    const p = planned[j];
    matches.push({ r, p, dxy: d, dz: r.z - p.z });
  }
  return {
    matches,
    unmatchedR: realized.filter((_, i) => !usedR[i]),
    unmatchedP: planned.filter((_, j) => !usedP[j]),
  };
}

function plantaTimeFilter() {
  const y = document.getElementById("filter-year")?.value || "";
  const mo = document.getElementById("filter-month")?.value || "";
  return { y, mo, active: Boolean(y || mo) };
}

function plantaVisibleIds(plano, tf) {
  return new Set(RECORDS
    .filter((r) => r.plano === plano &&
      (!tf.y || String(r.ano) === tf.y) &&
      (!tf.mo || String(r.mes) === tf.mo))
    .map((r) => String(Number(r.id))));
}

function plantaStatus(m) {
  if (m.dxy > COLLAR_TOL_XY) return "red";
  if (Math.abs(m.dz) > COLLAR_TOL_Z) return "amber";
  return "ok";
}

function plantaMetrics(matches) {
  const n = matches.length;
  const xy = matches.filter((m) => m.dxy <= COLLAR_TOL_XY).length;
  const z = matches.filter((m) => Math.abs(m.dz) <= COLLAR_TOL_Z).length;
  return {
    n,
    xy,
    z,
    xyPct: n ? (xy / n) * 100 : null,
    zPct: n ? (z / n) * 100 : null,
  };
}

/* ---------- Mapa de planta de um plano ---------- */
function plantaSvg(p) {
  const NS = "http://www.w3.org/2000/svg";
  const W = 600, H = 380, PAD = 28;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "planta-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Planta do plano ${p.plano}: collar previsto e realizado`);

  const pts = [];
  p.matches.forEach((m) => { pts.push(m.p, m.r); });
  p.unmatchedR.forEach((r) => pts.push(r));
  p.unmatchedP.forEach((q) => pts.push(q));
  if (!pts.length) {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", W / 2); t.setAttribute("y", H / 2);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("class", "planta-svg__empty");
    t.textContent = "Sem furos no filtro atual";
    svg.appendChild(t);
    return svg;
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  pts.forEach((q) => {
    if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
    if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y;
  });
  const rangeX = Math.max(maxX - minX, 1);
  const rangeY = Math.max(maxY - minY, 1);
  const scale = Math.min((W - PAD * 2) / rangeX, (H - PAD * 2) / rangeY);
  const offX = (W - rangeX * scale) / 2;
  const offY = (H - rangeY * scale) / 2;
  const tx = (x) => offX + (x - minX) * scale;
  const ty = (y) => H - (offY + (y - minY) * scale); // norte para cima

  const el = (name, attrs, parent) => {
    const node = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    if (parent) parent.appendChild(node);
    return node;
  };

  const links = el("g", { class: "planta-links" }, svg);
  p.matches.forEach((m) => {
    el("line", { x1: tx(m.p.x), y1: ty(m.p.y), x2: tx(m.r.x), y2: ty(m.r.y), stroke: PLANTA_COLORS.link, "stroke-width": 1 }, links);
  });

  const plannedG = el("g", { class: "planta-planned" }, svg);
  p.matches.forEach((m) => {
    el("circle", { cx: tx(m.p.x), cy: ty(m.p.y), r: 3.4, fill: "none", stroke: PLANTA_COLORS.planned, "stroke-width": 1.1 }, plannedG);
  });
  p.unmatchedP.forEach((q) => {
    const c = el("circle", { cx: tx(q.x), cy: ty(q.y), r: 3.4, fill: "none", stroke: PLANTA_COLORS.planned, "stroke-width": 1.1, "stroke-dasharray": "2 2" }, plannedG);
    const title = document.createElementNS(NS, "title");
    title.textContent = `${p.plano} · previsto sem furo realizado · X ${fmtNum(q.x, 2)} · Y ${fmtNum(q.y, 2)} · Z ${fmtNum(q.z, 2)}`;
    c.appendChild(title);
  });

  const realG = el("g", { class: "planta-real" }, svg);
  p.matches.forEach((m) => {
    const c = el("circle", { cx: tx(m.r.x), cy: ty(m.r.y), r: 3.6, fill: PLANTA_COLORS[plantaStatus(m)], stroke: "#ffffff", "stroke-width": 0.6 }, realG);
    const title = document.createElementNS(NS, "title");
    title.textContent = `${p.plano} · furo ${m.r.id || "s/ ID"} · ΔXY ${fmtNum(m.dxy, 2)} m · ΔZ ${fmtNum(m.dz, 2)} m`;
    c.appendChild(title);
  });
  p.unmatchedR.forEach((r) => {
    const c = el("circle", { cx: tx(r.x), cy: ty(r.y), r: 3.6, fill: PLANTA_COLORS.blue, stroke: "#ffffff", "stroke-width": 0.6 }, realG);
    const title = document.createElementNS(NS, "title");
    title.textContent = `${p.plano} · furo ${r.id || "s/ ID"} · sem collar previsto correspondente`;
    c.appendChild(title);
  });
  return svg;
}

function plantaCardEl(p, m) {
  const card = document.createElement("article");
  card.className = "planta-card";
  const head = document.createElement("header");
  head.className = "planta-card__head";
  const title = document.createElement("strong");
  title.textContent = p.plano;
  const meta = document.createElement("span");
  meta.className = "planta-card__meta";
  meta.textContent = `${fmtInt(m.n)} furos · XY ${pct2(m.xyPct)} · Z ${pct2(m.zPct)}`;
  head.append(title, meta);
  card.append(head, plantaSvg(p));
  return card;
}

/* ---------- Gráficos de aderência XY e Z ---------- */
const plantaLabelsPlugin = {
  id: "plantaLabels",
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts) return;
    const bars = chart.getDatasetMeta(0).data;
    const { ctx } = chart;
    const family = Chart.defaults.font.family;
    ctx.save();
    ctx.textAlign = "center";
    bars.forEach((bar, i) => {
      const pct = opts.pct[i];
      if (pct != null && isFinite(pct)) {
        ctx.font = `700 12px ${family}`;
        ctx.fillStyle = PLANTA_COLORS.green;
        ctx.textBaseline = "bottom";
        ctx.fillText(pct2(pct), bar.x, bar.y - 4);
      }
      const count = opts.furos[i];
      if (count > 0 && bar.base - bar.y > 18) {
        ctx.font = `700 11px ${family}`;
        ctx.fillStyle = "#ffffff";
        ctx.textBaseline = "bottom";
        ctx.fillText(fmtInt(count), bar.x, bar.base - 6);
      }
    });
    ctx.restore();
  },
};

function plantaChartConfig(labels, values, furos) {
  const furoMax = Math.max(0, ...furos.map((v) => v || 0));
  const y1Max = Math.max(500, Math.ceil((furoMax * 1.1) / 500) * 500);
  return {
    type: "bar",
    plugins: [plantaLabelsPlugin],
    data: {
      labels,
      datasets: [
        { label: "Aderência", data: values, backgroundColor: PLANTA_COLORS.green, borderWidth: 0, barPercentage: 0.62, categoryPercentage: 0.78, order: 1 },
        { type: "line", label: "Meta", data: labels.map(() => LIMITS.meta), borderColor: PLANTA_COLORS.gold, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, fill: false, order: 0 },
        { type: "line", label: "Furos", data: furos, yAxisID: "y1", borderColor: "transparent", backgroundColor: "transparent", pointRadius: 0, showLine: false, order: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: 24 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "top",
          align: "center",
          labels: {
            boxWidth: 12,
            boxHeight: 10,
            color: C.text,
            // Mesma ordem da legenda do design: Aderência, Furos, Meta
            sort: (a, b) => PLANTA_LEGEND_ORDER[a.text] - PLANTA_LEGEND_ORDER[b.text],
          },
        },
        // Os rótulos próprios do bloco substituem os rótulos globais de valor
        valueLabels: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => {
              if (c.dataset.label === "Furos") return `Furos: ${fmtInt(c.raw)}`;
              if (c.dataset.label === "Meta") return `Meta: ${fmtNum(c.raw, 0)}%`;
              return `Aderência: ${pct2(c.raw)}`;
            },
          },
        },
        plantaLabels: { pct: values, furos },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: C.text, font: { weight: "600" } },
          border: { color: C.gridStrong },
        },
        y: {
          min: 0, max: 100,
          ticks: { color: C.muted, stepSize: 10, callback: (v) => v + "%" },
          grid: { color: C.grid, drawTicks: false },
          border: { display: false },
        },
        y1: {
          position: "right",
          min: 0, max: y1Max,
          ticks: { color: C.muted, stepSize: 500, callback: (v) => fmtInt(v) },
          grid: { display: false },
          border: { display: false },
        },
      },
    },
  };
}

function setPlantaStatus(text) {
  const el = document.getElementById("planta-status");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-visible", Boolean(text));
}

/* ---------- Desenho do bloco ---------- */
async function drawPlanta() {
  const grid = document.getElementById("planta-grid");
  const charts = document.getElementById("planta-charts");
  const subtitle = document.getElementById("planta-subtitle");
  if (!grid) return;
  const token = ++PLANTA_TOKEN;

  if (subtitle) {
    subtitle.textContent = `Tolerância XY ±${fmtNum(COLLAR_TOL_XY, 2)} m · Z ±${fmtNum(COLLAR_TOL_Z, 2)} m · cada collar previsto é pareado ao realizado mais próximo (até ${fmtNum(COLLAR_MATCH_MAX, 1)} m).`;
  }
  grid.innerHTML = "";
  if (charts) charts.hidden = true;

  if (!PLANEJADO) {
    setPlantaStatus(PLANEJADO_ERROR || "Carregando coordenadas previstas…");
    destroy("plantaXY");
    destroy("plantaZ");
    return;
  }

  const selected = document.getElementById("filter-plan")?.value || "";
  const tf = plantaTimeFilter();
  let candidatos = [...PLANEJADO.keys()];
  if (selected) candidatos = candidatos.filter((p) => p === selected);
  if (tf.active) {
    const comRegistro = new Set(RECORDS
      .filter((r) => (!tf.y || String(r.ano) === tf.y) && (!tf.mo || String(r.mes) === tf.mo))
      .map((r) => r.plano));
    candidatos = candidatos.filter((p) => comRegistro.has(p));
  }
  candidatos.sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));

  if (!candidatos.length) {
    setPlantaStatus("Nenhum plano com coordenadas previstas no filtro atual.");
    destroy("plantaXY");
    destroy("plantaZ");
    return;
  }
  setPlantaStatus("Carregando geometria dos planos…");

  const results = await Promise.all(candidatos.map((p) => fetchDxfHoles(p).then((h) => ({ plano: p, holes: h }))));
  if (token !== PLANTA_TOKEN) return;

  const planos = [];
  const semDxf = [];
  results.forEach(({ plano, holes }) => {
    if (!holes || !holes.length) { semDxf.push(plano); return; }
    const realized = [];
    holes.forEach((h) => {
      const c = h.collar || (h.real && h.real[0]);
      if (!c || !isFinite(c.x) || !isFinite(c.y) || !isFinite(c.z)) return;
      const num = Number(h.id);
      const id = h.id ? (isFinite(num) ? String(num) : String(h.id).trim()) : null;
      realized.push({ x: c.x, y: c.y, z: c.z, id });
    });
    const { matches, unmatchedR, unmatchedP } = matchPlanCollars(PLANEJADO.get(plano) || [], realized);
    const ids = tf.active ? plantaVisibleIds(plano, tf) : null;
    const visivel = (r) => !ids || !r.id || ids.has(r.id);
    planos.push({
      plano,
      matches: matches.filter((m) => visivel(m.r)),
      unmatchedR: unmatchedR.filter(visivel),
      unmatchedP: tf.active ? [] : unmatchedP,
    });
  });

  if (!planos.length) {
    setPlantaStatus(semDxf.length
      ? `Sem DXF disponível para: ${semDxf.join(", ")}.`
      : "Nenhum plano com geometria disponível.");
    destroy("plantaXY");
    destroy("plantaZ");
    return;
  }

  const rows = planos.map((p) => ({ p, m: plantaMetrics(p.matches) }));
  rows.forEach(({ p, m }) => grid.appendChild(plantaCardEl(p, m)));

  const all = plantaMetrics(planos.flatMap((p) => p.matches));
  const labels = [...rows.map(({ p }) => p.plano), "TOTAL"];
  const furos = [...rows.map(({ m }) => m.n), all.n];
  destroy("plantaXY");
  destroy("plantaZ");
  CHARTS.plantaXY = new Chart(document.getElementById("planta-chart-xy"),
    plantaChartConfig(labels, [...rows.map(({ m }) => m.xyPct), all.xyPct], furos));
  CHARTS.plantaZ = new Chart(document.getElementById("planta-chart-z"),
    plantaChartConfig(labels, [...rows.map(({ m }) => m.zPct), all.zPct], furos));
  if (charts) charts.hidden = false;

  const partes = [];
  if (PLANEJADO_IGNORED) partes.push(`${PLANEJADO_IGNORED} linha(s) da planilha sem coordenadas completas foram ignoradas`);
  if (semDxf.length) partes.push(`sem DXF: ${semDxf.join(", ")}`);
  setPlantaStatus(partes.join(" · "));
}
