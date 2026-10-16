/* =====================================================================
   Planta: collar previsto × collar realizado
   - Previsto (PLANO, Y, X, Z e DIAMETRO): planilha "Planejado - Coordenadas
     Previstas dos Furos (XYZ)", primeira aba.
   - Realizado: ponto do layer "Hole" de cada DXF (mesmo PLANO = nome-base
     do arquivo DXF). Usa as mesmas fontes de fetchDxfHoles() do mapa.
   Pareamento: para cada plano, cada collar previsto é ligado ao collar
   realizado mais próximo em planta (um para um, do menor para o maior
   desvio), até COLLAR_MATCH_MAX metros.
   Mapa 2D único com todos os planos do filtro, com zoom, arrastar e
   tooltip por furo. Depende de app.js (RECORDS, fetchDxfHoles, parseGviz,
   norm, destroy, CHARTS, C, LIMITS, fmtNum, fmtInt).
   ===================================================================== */

// Planilha "Planejado - Coordenadas Previstas dos Furos (XYZ)". Lê a primeira aba
// (que deve se chamar PLANEJADO), por isso o parâmetro "sheet" não é enviado.
const PLANEJADO_SHEET_ID = "180XzsGaAuYqcvyZyFUTpTHtdFu97o8jmBrahzwYkBV0";
const PLANEJADO_GVIZ_URL = `https://docs.google.com/spreadsheets/d/${PLANEJADO_SHEET_ID}/gviz/tq?tqx=out:json&headers=1`;
// Deslocamento XY aceito: 2 vezes o diâmetro projetado do furo. O diâmetro da planilha
// está em milímetros (ex.: 101,6 mm; 127 mm; 139,7 mm), por isso a conversão para metros.
const PLANTA_DISP_FATOR = 2;
const MM_EM_M = 0.001;
// Fallback para furos sem diâmetro na planilha (metros)
const COLLAR_TOL_XY = 0.5;
// Tolerância Z do collar (metros)
const COLLAR_TOL_Z = 0.5;
// Distância máxima para parear um collar previsto a um realizado (metros).
const COLLAR_MATCH_MAX = 2.0;

const PLANTA_NS = "http://www.w3.org/2000/svg";
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
const PLANTA_STATUS_LABEL = {
  ok: "Dentro nos dois eixos",
  amber: "Fora só em Z",
  red: "Fora em XY",
};
const PLANTA_LEGEND_ORDER = { "Aderência": 0, "Furos": 1, "Meta": 2 };

let PLANEJADO = null;          // Map(plano -> [{ x, y, z, d }])
let PLANEJADO_IGNORED = 0;     // linhas sem coordenadas completas
let PLANEJADO_ERROR = "";
let PLANEJADO_SIGNATURE = "";
let PLANTA_TOKEN = 0;

// Estado do mapa 2D (coordenadas locais: x = X - OX, y = OY - Y, em metros)
let PLANTA_SVG = null;
let PLANTA_CONTENT = null;
let PLANTA_VIEW = null;        // { x, y, w, h } da viewBox
let PLANTA_BOUNDS = null;      // { w, h } extensão total dos dados
let PLANTA_KEY = "";           // chave do filtro; muda → refaz o enquadramento
let PLANTA_ORIGIN = { x: 0, y: 0 };
let PLANTA_SIZED = [];         // [{ el, px }] círculos com raio em pixels
let PLANTA_ITEMS = [];         // itens do mapa, indexados por data-idx
let PLANTA_PLANS = new Map();  // plano -> métricas do filtro atual
let PLANTA_DRAG = null;
let PLANTA_HOVER = null;

const pct2 = (n) => n == null || !isFinite(n) ? "—" : fmtNum(n, 2) + "%";
const fmtDiam = (d) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(d);

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
  const iD = idx["DIAMETRO"]; // opcional
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
    const d = iD === undefined ? NaN : toNumber(cell(iD));
    if (!plans.has(plano)) plans.set(plano, []);
    plans.get(plano).push({ x, y, z, d: isFinite(d) && d > 0 ? d : null });
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
    // Mantém a última leitura válida; uma falha transitória não apaga o mapa.
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

/* Limite XY do furo, em metros: 2 × diâmetro projetado (mm) convertido para metros. */
function tolXY(p) {
  return p && p.d != null ? PLANTA_DISP_FATOR * p.d * MM_EM_M : COLLAR_TOL_XY;
}

function plantaStatus(m) {
  if (m.dxy > tolXY(m.p)) return "red";
  if (Math.abs(m.dz) > COLLAR_TOL_Z) return "amber";
  return "ok";
}

function plantaMetrics(matches) {
  const n = matches.length;
  const xy = matches.filter((m) => m.dxy <= tolXY(m.p)).length;
  const z = matches.filter((m) => Math.abs(m.dz) <= COLLAR_TOL_Z).length;
  return {
    n,
    xy,
    z,
    xyPct: n ? (xy / n) * 100 : null,
    zPct: n ? (z / n) * 100 : null,
  };
}

/* ---------- Mapa 2D único: zoom, arrastar e tooltip ---------- */
function plantaEl(name, attrs, parent) {
  const node = document.createElementNS(PLANTA_NS, name);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (parent) parent.appendChild(node);
  return node;
}

function plantaScale() {
  const r = PLANTA_SVG.getBoundingClientRect();
  return Math.min(r.width / PLANTA_VIEW.w, r.height / PLANTA_VIEW.h) || 1;
}

function applyPlantaView() {
  PLANTA_SVG.setAttribute("viewBox", `${PLANTA_VIEW.x} ${PLANTA_VIEW.y} ${PLANTA_VIEW.w} ${PLANTA_VIEW.h}`);
  const s = plantaScale();
  PLANTA_SIZED.forEach(({ el, px }) => el.setAttribute("r", (px / s).toFixed(4)));
}

function fitPlantaView() {
  const w = Math.max(PLANTA_BOUNDS.w, 1);
  const h = Math.max(PLANTA_BOUNDS.h, 1);
  const pad = Math.max(w, h) * 0.04;
  PLANTA_VIEW = { x: -pad, y: -pad, w: w + pad * 2, h: h + pad * 2 };
}

function resetPlantaView() {
  if (!PLANTA_VIEW || !PLANTA_BOUNDS) return;
  fitPlantaView();
  applyPlantaView();
}

function zoomPlanta(factor, clientX, clientY) {
  if (!PLANTA_VIEW || !PLANTA_SVG) return;
  let ax = PLANTA_VIEW.x + PLANTA_VIEW.w / 2;
  let ay = PLANTA_VIEW.y + PLANTA_VIEW.h / 2;
  if (clientX != null) {
    const p = PLANTA_SVG.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    const loc = p.matrixTransform(PLANTA_SVG.getScreenCTM().inverse());
    ax = loc.x;
    ay = loc.y;
  }
  const full = Math.max(PLANTA_BOUNDS.w, PLANTA_BOUNDS.h, 1);
  const nw = Math.min(Math.max(PLANTA_VIEW.w * factor, 0.5), full * 8);
  const k = nw / PLANTA_VIEW.w;
  PLANTA_VIEW.x = ax - (ax - PLANTA_VIEW.x) * k;
  PLANTA_VIEW.y = ay - (ay - PLANTA_VIEW.y) * k;
  PLANTA_VIEW.w = nw;
  PLANTA_VIEW.h *= k;
  applyPlantaView();
}

function onPlantaWheel(e) {
  e.preventDefault();
  hidePlantaTooltip();
  zoomPlanta(e.deltaY < 0 ? 0.85 : 1 / 0.85, e.clientX, e.clientY);
}

function onPlantaDown(e) {
  if (!PLANTA_VIEW) return;
  if (e.button !== 0 && e.button !== 1) return;
  PLANTA_DRAG = { x: e.clientX, y: e.clientY, vx: PLANTA_VIEW.x, vy: PLANTA_VIEW.y };
  try { PLANTA_SVG.setPointerCapture(e.pointerId); } catch (_) { /* ponteiro já liberado */ }
  PLANTA_SVG.classList.add("is-dragging");
  hidePlantaTooltip();
}

function onPlantaMove(e) {
  if (PLANTA_DRAG && PLANTA_VIEW) {
    const s = plantaScale();
    PLANTA_VIEW.x = PLANTA_DRAG.vx - (e.clientX - PLANTA_DRAG.x) / s;
    PLANTA_VIEW.y = PLANTA_DRAG.vy - (e.clientY - PLANTA_DRAG.y) / s;
    applyPlantaView();
    return;
  }
  showPlantaTooltip(e);
}

function onPlantaUp(e) {
  if (!PLANTA_DRAG) return;
  try { PLANTA_SVG.releasePointerCapture?.(e.pointerId); } catch (_) { /* ponteiro já liberado */ }
  PLANTA_SVG.classList.remove("is-dragging");
  PLANTA_DRAG = null;
}

function setupPlantaMap() {
  if (PLANTA_SVG) return;
  const svg = document.getElementById("planta-map");
  if (!svg) return;
  PLANTA_SVG = svg;
  PLANTA_CONTENT = plantaEl("g", { class: "planta-content" }, svg);
  svg.addEventListener("wheel", onPlantaWheel, { passive: false });
  svg.addEventListener("pointerdown", onPlantaDown);
  svg.addEventListener("pointermove", onPlantaMove);
  svg.addEventListener("pointerup", onPlantaUp);
  svg.addEventListener("pointercancel", onPlantaUp);
  svg.addEventListener("pointerleave", hidePlantaTooltip);
  svg.addEventListener("dblclick", resetPlantaView);
  // Os marcadores mantêm o tamanho em pixels quando a janela muda de largura
  window.addEventListener("resize", () => { if (PLANTA_VIEW) applyPlantaView(); });
  document.getElementById("planta-zoom-in")?.addEventListener("click", () => zoomPlanta(0.8));
  document.getElementById("planta-zoom-out")?.addEventListener("click", () => zoomPlanta(1.25));
  document.getElementById("planta-zoom-reset")?.addEventListener("click", resetPlantaView);
  document.getElementById("planta-open-dialog")?.addEventListener("click", openPlantaDialog);
  document.getElementById("planta-dialog-close")?.addEventListener("click", () => document.getElementById("planta-dialog")?.close());
  document.getElementById("planta-dialog")?.addEventListener("close", restorePlantaWrap);
}

function clearPlantaHover() {
  if (!PLANTA_HOVER) return;
  PLANTA_HOVER.forEach((node) => node.classList.remove("is-hover"));
  PLANTA_HOVER = null;
}

function hidePlantaTooltip() {
  clearPlantaHover();
  const tip = document.getElementById("planta-tooltip");
  if (tip) tip.hidden = true;
}

function plantaStatusText(item) {
  if (item.kind === "planned") return "Previsto sem furo realizado";
  if (item.kind === "realized") return "Realizado sem previsto correspondente (fora do cálculo)";
  return PLANTA_STATUS_LABEL[plantaStatus(item)];
}

function buildPlantaTooltip(tip, item) {
  const head = document.createElement("strong");
  head.className = "planta-tooltip__title";
  const rows = [];
  const add = (label, value) => rows.push([label, value]);
  const xyz = (p) => `X ${fmtNum(p.x, 2)} · Y ${fmtNum(p.y, 2)} · Z ${fmtNum(p.z, 2)}`;
  const plan = PLANTA_PLANS.get(item.plano);
  if (item.kind === "planned") {
    head.textContent = `${item.plano} · previsto sem furo realizado`;
    add("Status", plantaStatusText(item));
    add("Previsto", xyz(item.p));
    add("Diâmetro", item.p.d != null ? fmtNum(item.p.d, 0) : "não informado");
  } else if (item.kind === "realized") {
    head.textContent = `${item.plano} · furo ${item.id || "s/ ID"}`;
    add("Status", plantaStatusText(item));
    add("Realizado", xyz(item.r));
  } else {
    head.textContent = `${item.plano} · furo ${item.id || "s/ ID"}`;
    add("Status", plantaStatusText(item));
    add("Previsto", xyz(item.p));
    add("Realizado", xyz(item.r));
    const lim = tolXY(item.p);
    add("Δ XY", `${fmtNum(item.dxy, 3)} m (limite ${fmtNum(lim, 3)} m)`);
    add("Δ Z", `${item.dz >= 0 ? "+" : ""}${fmtNum(item.dz, 2)} m (limite ±${fmtNum(COLLAR_TOL_Z, 2)} m)`);
    add("Diâmetro", item.p.d != null ? `${fmtDiam(item.p.d)} mm` : "não informado (limite XY padrão)");
  }
  if (plan && plan.n) {
    add("Aderência do plano", `XY ${pct2(plan.xyPct)} · Z ${pct2(plan.zPct)} · ${fmtInt(plan.n)} furos`);
  }
  const dl = document.createElement("dl");
  dl.className = "planta-tooltip__list";
  rows.forEach(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.append(dt, dd);
  });
  tip.replaceChildren(head, dl);
}

function showPlantaTooltip(e) {
  const tip = document.getElementById("planta-tooltip");
  const node = e.target.closest?.("[data-idx]");
  if (!tip || !node || !PLANTA_SVG.contains(node)) { hidePlantaTooltip(); return; }
  const idx = Number(node.dataset.idx);
  const item = PLANTA_ITEMS[idx];
  if (!item) { hidePlantaTooltip(); return; }
  if (!PLANTA_HOVER || !PLANTA_HOVER.includes(node)) {
    clearPlantaHover();
    PLANTA_HOVER = [...PLANTA_CONTENT.querySelectorAll(`[data-idx="${idx}"]`)];
    PLANTA_HOVER.forEach((n) => n.classList.add("is-hover"));
  }
  buildPlantaTooltip(tip, item);
  tip.hidden = false;
  const box = PLANTA_SVG.parentElement.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = e.clientX - box.left + 16;
  let top = e.clientY - box.top + 16;
  if (left + tw > box.width) left = e.clientX - box.left - tw - 16;
  if (top + th > box.height) top = e.clientY - box.top - th - 16;
  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = `${Math.max(0, top)}px`;
}

function renderPlantaMap(items, key) {
  setupPlantaMap();
  if (!PLANTA_SVG) return;
  PLANTA_CONTENT.replaceChildren();
  PLANTA_SIZED = [];
  PLANTA_ITEMS = items;
  hidePlantaTooltip();

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const pushPt = (q) => {
    if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
    if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y;
  };
  items.forEach((it) => {
    if (it.p) pushPt(it.p);
    if (it.r) pushPt(it.r);
  });
  if (!items.length) {
    PLANTA_VIEW = null;
    PLANTA_KEY = "";
    return;
  }
  // A origem só muda quando o filtro muda; assim a vista não salta no auto-refresh.
  if (key !== PLANTA_KEY || !PLANTA_VIEW) {
    PLANTA_KEY = key;
    PLANTA_ORIGIN = { x: minX, y: maxY };
    PLANTA_BOUNDS = { w: maxX - minX, h: maxY - minY };
    fitPlantaView();
  }
  const lx = (q) => q.x - PLANTA_ORIGIN.x;
  const ly = (q) => PLANTA_ORIGIN.y - q.y;

  const links = plantaEl("g", { class: "planta-links" }, PLANTA_CONTENT);
  const planned = plantaEl("g", { class: "planta-planned" }, PLANTA_CONTENT);
  const real = plantaEl("g", { class: "planta-real" }, PLANTA_CONTENT);
  const ring = (q, idx, dashed) => {
    const el = plantaEl("circle", {
      cx: lx(q), cy: ly(q), r: 1,
      class: "planta-ring" + (dashed ? " planta-ring--dashed" : ""),
      "data-idx": idx,
    }, planned);
    PLANTA_SIZED.push({ el, px: 4.2 });
  };
  const dot = (q, color, idx) => {
    const el = plantaEl("circle", {
      cx: lx(q), cy: ly(q), r: 1, fill: color,
      class: "planta-dot", "data-idx": idx,
    }, real);
    PLANTA_SIZED.push({ el, px: 3.4 });
  };

  items.forEach((it, idx) => {
    if (it.kind === "match") {
      plantaEl("line", {
        x1: lx(it.p), y1: ly(it.p), x2: lx(it.r), y2: ly(it.r),
        stroke: PLANTA_COLORS.link, class: "planta-link",
      }, links);
      ring(it.p, idx, false);
      dot(it.r, PLANTA_COLORS[plantaStatus(it)], idx);
    } else if (it.kind === "planned") {
      ring(it.p, idx, true);
    } else {
      dot(it.r, PLANTA_COLORS.blue, idx);
    }
  });
  applyPlantaView();
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
        ctx.font = `700 9px ${family}`;
        ctx.fillStyle = PLANTA_COLORS.green;
        ctx.textBaseline = "bottom";
        ctx.fillText(pct2(pct), bar.x, bar.y - 3);
      }
      const count = opts.furos[i];
      if (count > 0 && bar.base - bar.y > 14) {
        ctx.font = `700 9px ${family}`;
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
      layout: { padding: { top: 34 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "top",
          align: "center",
          labels: {
            boxWidth: 10,
            boxHeight: 8,
            color: C.text,
            font: { size: 11 },
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
          ticks: {
            color: C.text,
            font: { size: 10, weight: "600" },
            maxRotation: 45,
            minRotation: 45,
            autoSkip: false,
          },
          border: { color: C.gridStrong },
        },
        y: {
          // Folga acima de 100% para os rótulos das barras não encostarem na legenda
          min: 0, max: 112,
          ticks: { color: C.muted, font: { size: 10 }, stepSize: 10, callback: (v) => (v <= 100 ? v + "%" : "") },
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
  const charts = document.getElementById("planta-charts");
  const subtitle = document.getElementById("planta-subtitle");
  const token = ++PLANTA_TOKEN;

  if (subtitle) {
    subtitle.textContent = `Todos os planos do filtro em uma só planta · deslocamento XY até 2 × diâmetro projetado do furo · Z ±${fmtNum(COLLAR_TOL_Z, 2)} m · cada collar previsto é pareado ao realizado mais próximo (até ${fmtNum(COLLAR_MATCH_MAX, 1)} m).`;
  }
  setupPlantaMap();

  const clearAll = () => {
    const ch = document.getElementById("planta-charts");
    if (ch) ch.hidden = true;
    PLANTA_PLANS = new Map();
    renderPlantaMap([], "");
    destroy("plantaXY");
    destroy("plantaZ");
  };

  if (!PLANEJADO) {
    setPlantaStatus(PLANEJADO_ERROR || "Carregando coordenadas previstas…");
    clearAll();
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
    clearAll();
    return;
  }
  setPlantaStatus("Carregando geometria dos planos…");

  // Falha ao obter o DXF de um plano vira "sem DXF" e não derruba o bloco inteiro
  const results = await Promise.all(candidatos.map((p) => fetchDxfHoles(p)
    .then((h) => ({ plano: p, holes: h }))
    .catch(() => ({ plano: p, holes: null }))));
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
    clearAll();
    return;
  }

  // Itens do mapa: cada collar previsto/realizado com o plano e a métrica
  const items = [];
  PLANTA_PLANS = new Map();
  planos.forEach((p) => {
    PLANTA_PLANS.set(p.plano, plantaMetrics(p.matches));
    p.matches.forEach((m) => items.push({
      kind: "match", plano: p.plano, id: m.r.id, p: m.p, r: m.r, dxy: m.dxy, dz: m.dz,
    }));
    p.unmatchedR.forEach((r) => items.push({ kind: "realized", plano: p.plano, id: r.id, r }));
    p.unmatchedP.forEach((q) => items.push({ kind: "planned", plano: p.plano, p: q }));
  });

  const key = [selected, tf.y, tf.mo, planos.map((p) => p.plano).join(",")].join("|");
  renderPlantaMap(items, key);

  const rows = planos.map((p) => ({ plano: p.plano, ...PLANTA_PLANS.get(p.plano) }));
  const all = plantaMetrics(planos.flatMap((p) => p.matches));
  const labels = [...rows.map((r) => r.plano), "TOTAL"];
  const furos = [...rows.map((r) => r.n), all.n];
  destroy("plantaXY");
  destroy("plantaZ");
  CHARTS.plantaXY = new Chart(document.getElementById("planta-chart-xy"),
    plantaChartConfig(labels, [...rows.map((r) => r.xyPct), all.xyPct], furos));
  CHARTS.plantaZ = new Chart(document.getElementById("planta-chart-z"),
    plantaChartConfig(labels, [...rows.map((r) => r.zPct), all.zPct], furos));
  if (charts) charts.hidden = false;

  const partes = [];
  if (PLANEJADO_ERROR) partes.push(`${PLANEJADO_ERROR} (mostrando a última leitura)`);
  if (PLANEJADO_IGNORED) partes.push(`${PLANEJADO_IGNORED} linha(s) da planilha sem coordenadas completas foram ignoradas`);
  if (semDxf.length) partes.push(`sem DXF: ${semDxf.join(", ")}`);
  setPlantaStatus(partes.join(" · "));
}

/* ---------- Janela ampliada: o mesmo mapa é movido para o diálogo ---------- */
function openPlantaDialog() {
  const dlg = document.getElementById("planta-dialog");
  const body = document.getElementById("planta-dialog-body");
  const wrap = document.querySelector("#planta-card .planta-map-wrap");
  const slot = document.getElementById("planta-map-slot");
  if (!dlg || !body || !wrap || !slot || dlg.open) return;
  slot.textContent = "Mapa aberto na janela ampliada.";
  slot.hidden = false;
  body.appendChild(wrap);
  dlg.showModal();
  requestAnimationFrame(() => { if (PLANTA_VIEW) applyPlantaView(); });
}

function restorePlantaWrap() {
  const body = document.getElementById("planta-dialog-body");
  const wrap = body?.querySelector(".planta-map-wrap");
  const slot = document.getElementById("planta-map-slot");
  hidePlantaTooltip();
  if (wrap && slot) slot.parentNode.insertBefore(wrap, slot);
  if (slot) { slot.hidden = true; slot.textContent = ""; }
  requestAnimationFrame(() => { if (PLANTA_VIEW) applyPlantaView(); });
}
