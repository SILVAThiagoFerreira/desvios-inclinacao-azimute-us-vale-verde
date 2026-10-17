/* =====================================================================
   Planta: collar previsto × collar realizado
   - Previsto (PLANO, Y, X, Z e DIAMETRO): planilha "Planejado - Coordenadas
     Previstas dos Furos (XYZ)", primeira aba.
   - Realizado: ponto do layer "Hole" de cada DXF (mesmo PLANO = nome-base
     do arquivo DXF). Usa as mesmas fontes de fetchDxfHoles() do mapa.
   Pareamento: para cada plano, cada collar previsto é ligado ao collar
   realizado mais próximo em planta (um para um, do menor para o maior
   desvio), até COLLAR_MATCH_MAX metros.
   Dois mapas em planta no bloco: XY (cor pelo desvio em planta) e Z (cor
   pela diferença de cota). Cada um tem zoom, arraste, tooltip e um botão
   que abre a janela com um bloco por plano, no mesmo eixo.
   Depende de app.js (RECORDS, fetchDxfHoles, parseGviz, norm, destroy,
   CHARTS, C, LIMITS, fmtNum, fmtInt).
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
// Tolerância Z do collar (metros): o mesmo limite de profundidade do site (LIMITS.depth,
// vindo de data/parametros.json ou da tabela de parâmetros), ±0,20 m por padrão.
const plantaTolZ = () => LIMITS.depth;
// Distância máxima para parear um collar previsto a um realizado (metros).
const COLLAR_MATCH_MAX = 2.0;

const PLANTA_NS = "http://www.w3.org/2000/svg";
const PLANTA_COLORS = {
  green: "#1f5b3a",   // cabeçalhos e barras de aderência
  gold: "#b8860b",    // linha de meta
  ok: "#2e8b57",      // dentro da tolerância do eixo
  red: "#e20613",     // fora da tolerância do eixo
  blue: "#2563a8",    // realizado sem previsto correspondente
  planned: "#7b858d", // collar previsto
  link: "#b9c0c6",    // linha entre previsto e realizado
};
const PLANTA_MODE_LABEL = {
  xy: { ok: "Dentro do XY", red: "Fora do XY" },
  z: { ok: "Dentro do Z", red: "Fora do Z" },
};
const PLANTA_MODE_TITLE = { xy: "Planta XY", z: "Planta Z" };
const PLANTA_LEGEND_ORDER = { "Aderência": 0, "Furos": 1, "Meta": 2 };

let PLANEJADO = null;          // Map(plano -> [{ x, y, z, d }])
let PLANEJADO_IGNORED = 0;     // linhas sem coordenadas completas
let PLANEJADO_ERROR = "";
let PLANEJADO_SIGNATURE = "";
let PLANTA_TOKEN = 0;

let PLANTA_ITEMS = [];         // itens do filtro atual (usados pelos mapas e pela janela)
let PLANTA_PLANS = new Map();  // plano -> métricas do filtro atual
let PLANTA_CHART_DATA = null;  // dados dos gráficos XY e Z do último desenho
let PLANTA_CARDS = [];         // cards da janela "Ver todos os planos" (para redimensionar)
let PLANTA_MAPS = null;        // { xy: PlantaMap, z: PlantaMap }
let PLANTA_DIALOG_MODE = "xy"; // eixo da janela aberta: "xy" ou "z"

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

/* Situação de um furo pareado no eixo pedido: "ok" dentro da tolerância, "red" fora. */
function plantaStatusFor(m, mode) {
  if (mode === "z") return Math.abs(m.dz) <= plantaTolZ() ? "ok" : "red";
  return m.dxy <= tolXY(m.p) ? "ok" : "red";
}

function plantaMetrics(matches) {
  const n = matches.length;
  const xy = matches.filter((m) => m.dxy <= tolXY(m.p)).length;
  const z = matches.filter((m) => Math.abs(m.dz) <= plantaTolZ()).length;
  return {
    n,
    xy,
    z,
    xyPct: n ? (xy / n) * 100 : null,
    zPct: n ? (z / n) * 100 : null,
  };
}

function plantaEl(name, attrs, parent) {
  const node = document.createElementNS(PLANTA_NS, name);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (parent) parent.appendChild(node);
  return node;
}

/* Posiciona o tooltip ao lado do ponteiro, sem sair da área do mapa (também no celular) */
function placePlantaTip(tip, wrap, e) {
  const box = wrap.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = e.clientX - box.left + 16;
  let top = e.clientY - box.top + 16;
  if (left + tw > box.width) left = e.clientX - box.left - tw - 16;
  if (top + th > box.height) top = e.clientY - box.top - th - 16;
  tip.style.left = `${Math.min(Math.max(0, left), Math.max(0, box.width - tw))}px`;
  tip.style.top = `${Math.min(Math.max(0, top), Math.max(0, box.height - th))}px`;
}

/* ---------- Mapa em planta de um eixo: zoom, arraste e tooltip ---------- */
class PlantaMap {
  constructor(svg, tip, mode) {
    this.svg = svg;
    this.tip = tip;
    this.mode = mode;
    this.wrap = svg.parentElement;
    this.content = plantaEl("g", { class: "planta-content" }, svg);
    this.view = null;                 // { x, y, w, h } da viewBox, em metros locais
    this.bounds = { w: 1, h: 1 };
    this.key = "";                    // chave do filtro; muda → refaz o enquadramento
    this.origin = { x: 0, y: 0 };
    this.sized = [];                  // [{ el, px }] marcadores com raio em pixels
    this.items = [];                  // itens indexados por data-idx
    this.drag = null;
    this.hover = null;
    svg.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    svg.addEventListener("pointerdown", (e) => this.onDown(e));
    svg.addEventListener("pointermove", (e) => this.onMove(e));
    svg.addEventListener("pointerup", (e) => this.onUp(e));
    svg.addEventListener("pointercancel", (e) => this.onUp(e));
    svg.addEventListener("pointerleave", () => this.hideTip());
    svg.addEventListener("dblclick", () => this.reset());
    // Os marcadores mantêm o tamanho em pixels quando a janela muda de largura
    window.addEventListener("resize", () => this.apply());
  }

  scale() {
    const r = this.svg.getBoundingClientRect();
    return Math.min(r.width / this.view.w, r.height / this.view.h) || 1;
  }

  apply() {
    if (!this.view) return;
    this.svg.setAttribute("viewBox", `${this.view.x} ${this.view.y} ${this.view.w} ${this.view.h}`);
    const s = this.scale();
    this.sized.forEach(({ el, px }) => el.setAttribute("r", (px / s).toFixed(4)));
  }

  fit() {
    const w = Math.max(this.bounds.w, 1);
    const h = Math.max(this.bounds.h, 1);
    const pad = Math.max(w, h) * 0.04;
    this.view = { x: -pad, y: -pad, w: w + pad * 2, h: h + pad * 2 };
    this.apply();
  }

  reset() {
    if (this.view) this.fit();
  }

  zoom(factor, clientX, clientY) {
    if (!this.view) return;
    let ax = this.view.x + this.view.w / 2;
    let ay = this.view.y + this.view.h / 2;
    if (clientX != null) {
      const p = this.svg.createSVGPoint();
      p.x = clientX;
      p.y = clientY;
      const loc = p.matrixTransform(this.svg.getScreenCTM().inverse());
      ax = loc.x;
      ay = loc.y;
    }
    const full = Math.max(this.bounds.w, this.bounds.h, 1);
    const nw = Math.min(Math.max(this.view.w * factor, 0.5), full * 8);
    const k = nw / this.view.w;
    this.view.x = ax - (ax - this.view.x) * k;
    this.view.y = ay - (ay - this.view.y) * k;
    this.view.w = nw;
    this.view.h *= k;
    this.apply();
  }

  onWheel(e) {
    e.preventDefault();
    this.hideTip();
    this.zoom(e.deltaY < 0 ? 0.85 : 1 / 0.85, e.clientX, e.clientY);
  }

  onDown(e) {
    if (!this.view) return;
    if (e.button !== 0 && e.button !== 1) return;
    this.drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
    try { this.svg.setPointerCapture(e.pointerId); } catch (_) { /* ponteiro já liberado */ }
    this.svg.classList.add("is-dragging");
    this.hideTip();
  }

  onMove(e) {
    if (this.drag && this.view) {
      const s = this.scale();
      this.view.x = this.drag.vx - (e.clientX - this.drag.x) / s;
      this.view.y = this.drag.vy - (e.clientY - this.drag.y) / s;
      this.apply();
      return;
    }
    this.showTip(e);
  }

  onUp(e) {
    if (!this.drag) return;
    try { this.svg.releasePointerCapture?.(e.pointerId); } catch (_) { /* ponteiro já liberado */ }
    this.svg.classList.remove("is-dragging");
    this.drag = null;
  }

  clearHover() {
    if (this.hover) this.hover.forEach((n) => n.classList.remove("is-hover"));
    this.hover = null;
  }

  hideTip() {
    this.clearHover();
    if (this.tip) this.tip.hidden = true;
  }

  showTip(e) {
    const node = e.target.closest?.("[data-idx]");
    if (!this.tip || !node || !this.svg.contains(node)) { this.hideTip(); return; }
    const idx = Number(node.dataset.idx);
    const item = this.items[idx];
    if (!item) { this.hideTip(); return; }
    if (!this.hover || !this.hover.includes(node)) {
      this.clearHover();
      this.hover = [...this.content.querySelectorAll(`[data-idx="${idx}"]`)];
      this.hover.forEach((n) => n.classList.add("is-hover"));
    }
    buildPlantaTooltip(this.tip, item, this.mode);
    this.tip.hidden = false;
    placePlantaTip(this.tip, this.wrap, e);
  }

  render(items, key) {
    this.content.replaceChildren();
    this.sized = [];
    this.items = items;
    this.hideTip();
    if (!items.length) {
      this.view = null;
      this.key = "";
      this.svg.setAttribute("viewBox", "0 0 600 380");
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const pushPt = (q) => {
      if (q.x < minX) minX = q.x;
      if (q.x > maxX) maxX = q.x;
      if (q.y < minY) minY = q.y;
      if (q.y > maxY) maxY = q.y;
    };
    items.forEach((it) => { if (it.p) pushPt(it.p); if (it.r) pushPt(it.r); });
    // A origem só muda quando o filtro muda; assim a vista não salta no auto-refresh.
    if (key !== this.key || !this.view) {
      this.key = key;
      this.origin = { x: minX, y: maxY };
      this.bounds = { w: maxX - minX, h: maxY - minY };
      this.fit();
    }
    plantaDrawItems(this.content, items, this.origin, this.sized, this.mode);
    this.apply();
  }
}

function setupPlantaMap() {
  if (PLANTA_MAPS) return;
  const xySvg = document.getElementById("planta-map-xy");
  const zSvg = document.getElementById("planta-map-z");
  if (!xySvg || !zSvg) return;
  PLANTA_MAPS = {
    xy: new PlantaMap(xySvg, document.getElementById("planta-tooltip-xy"), "xy"),
    z: new PlantaMap(zSvg, document.getElementById("planta-tooltip-z"), "z"),
  };
  const bind = (mode) => {
    const map = PLANTA_MAPS[mode];
    document.getElementById(`planta-${mode}-zoom-in`)?.addEventListener("click", () => map.zoom(0.8));
    document.getElementById(`planta-${mode}-zoom-out`)?.addEventListener("click", () => map.zoom(1.25));
    document.getElementById(`planta-${mode}-zoom-reset`)?.addEventListener("click", () => map.reset());
    document.getElementById(`planta-open-${mode}`)?.addEventListener("click", () => openPlantaDialog(mode));
  };
  bind("xy");
  bind("z");
  window.addEventListener("resize", () => PLANTA_CARDS.forEach((c) => c.apply()));
  document.getElementById("planta-dialog-close")?.addEventListener("click", () => document.getElementById("planta-dialog")?.close());
  document.getElementById("planta-dialog")?.addEventListener("close", closePlantaDialog);
  document.getElementById("planta-dialog-pdf")?.addEventListener("click", exportPlantaPdf);
  document.getElementById("planta-dialog-png")?.addEventListener("click", exportPlantaImagem);
  const dlgEl = document.getElementById("planta-dialog");
  dlgEl?.addEventListener("click", (e) => { if (e.target === dlgEl) dlgEl.close(); });
}

function plantaStatusText(item, mode) {
  if (item.kind === "planned") return "Previsto sem furo realizado";
  if (item.kind === "realized") return "Realizado sem previsto correspondente (fora do cálculo)";
  return PLANTA_MODE_LABEL[mode][plantaStatusFor(item, mode)];
}

function buildPlantaTooltip(tip, item, mode) {
  const head = document.createElement("strong");
  head.className = "planta-tooltip__title";
  const rows = [];
  const add = (label, value) => rows.push([label, value]);
  const xyz = (p) => `X ${fmtNum(p.x, 2)} · Y ${fmtNum(p.y, 2)} · Z ${fmtNum(p.z, 2)}`;
  const plan = PLANTA_PLANS.get(item.plano);
  if (item.kind === "planned") {
    head.textContent = `${item.plano} · previsto sem furo realizado`;
    add("Status", plantaStatusText(item, mode));
    add("Previsto", xyz(item.p));
    add("Diâmetro", item.p.d != null ? `${fmtDiam(item.p.d)} mm` : "não informado");
  } else if (item.kind === "realized") {
    head.textContent = `${item.plano} · furo ${item.id || "s/ ID"}`;
    add("Status", plantaStatusText(item, mode));
    add("Realizado", xyz(item.r));
  } else {
    head.textContent = `${item.plano} · furo ${item.id || "s/ ID"}`;
    add("Status", plantaStatusText(item, mode));
    add("Previsto", xyz(item.p));
    add("Realizado", xyz(item.r));
    const lim = tolXY(item.p);
    add("Δ XY", `${fmtNum(item.dxy, 3)} m (limite ${fmtNum(lim, 3)} m)`);
    add("Δ Z", `${item.dz >= 0 ? "+" : ""}${fmtNum(item.dz, 2)} m (limite ±${fmtNum(plantaTolZ(), 2)} m)`);
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

/* Desenho dos furos (ligações, previstos e realizados) colorido pelo eixo "mode". */
function plantaDrawItems(content, items, origin, sized, mode) {
  const lx = (q) => q.x - origin.x;
  const ly = (q) => origin.y - q.y;
  const links = plantaEl("g", { class: "planta-links" }, content);
  const planned = plantaEl("g", { class: "planta-planned" }, content);
  const real = plantaEl("g", { class: "planta-real" }, content);
  const ring = (q, idx, dashed) => {
    const el = plantaEl("circle", {
      cx: lx(q), cy: ly(q), r: 1,
      class: "planta-ring" + (dashed ? " planta-ring--dashed" : ""),
      "data-idx": idx,
    }, planned);
    sized.push({ el, px: 4.2 });
  };
  const dot = (q, color, idx) => {
    const el = plantaEl("circle", {
      cx: lx(q), cy: ly(q), r: 1, fill: color,
      class: "planta-dot", "data-idx": idx,
    }, real);
    sized.push({ el, px: 3.4 });
  };
  items.forEach((it, idx) => {
    if (it.kind === "match") {
      plantaEl("line", {
        x1: lx(it.p), y1: ly(it.p), x2: lx(it.r), y2: ly(it.r),
        stroke: PLANTA_COLORS.link, class: "planta-link",
      }, links);
      ring(it.p, idx, false);
      dot(it.r, PLANTA_COLORS[plantaStatusFor(it, mode)], idx);
    } else if (it.kind === "planned") {
      ring(it.p, idx, true);
    } else {
      dot(it.r, PLANTA_COLORS.blue, idx);
    }
  });
}

/* ---------- Janela "Ver todos os planos": um bloco por plano, com rolagem ---------- */
function buildPlantaCard(plano, items, mode) {
  const card = document.createElement("article");
  card.className = "planta-card";

  const head = document.createElement("header");
  head.className = "planta-card__head";
  const title = document.createElement("strong");
  title.textContent = plano;
  const m = PLANTA_PLANS.get(plano) || { n: 0, xyPct: null, zPct: null };
  const meta = document.createElement("span");
  meta.className = "planta-card__meta";
  meta.textContent = `${fmtInt(m.n)} furos · XY ${pct2(m.xyPct)} · Z ${pct2(m.zPct)}`;
  head.append(title, meta);

  const tools = document.createElement("div");
  tools.className = "planta-card__tools";
  const btn = (label, aria) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "filter-reset";
    b.textContent = label;
    if (aria) b.setAttribute("aria-label", aria);
    return b;
  };
  const bIn = btn("+", "Aproximar");
  const bOut = btn("−", "Afastar");
  const bReset = btn("Redefinir");
  tools.append(bIn, bOut, bReset);

  const wrap = document.createElement("div");
  wrap.className = "planta-card__map";
  const svg = plantaEl("svg", {
    class: "planta-card__svg",
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label": `${PLANTA_MODE_TITLE[mode]} do plano ${plano}: collar previsto e realizado`,
  });
  const content = plantaEl("g", { class: "planta-content" }, svg);
  const tip = document.createElement("div");
  tip.className = "planta-tooltip";
  tip.hidden = true;
  wrap.append(svg, tip);
  card.append(head, tools, wrap);

  const sized = [];
  let view = null;
  let bounds = { w: 1, h: 1 };
  let drag = null;
  let hover = null;

  if (!items.length) {
    const t = plantaEl("text", { x: 300, y: 190, "text-anchor": "middle", class: "planta-svg__empty" }, svg);
    t.textContent = "Sem furos no filtro atual";
    svg.setAttribute("viewBox", "0 0 600 380");
  } else {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const pushPt = (q) => {
      if (q.x < minX) minX = q.x;
      if (q.x > maxX) maxX = q.x;
      if (q.y < minY) minY = q.y;
      if (q.y > maxY) maxY = q.y;
    };
    items.forEach((it) => { if (it.p) pushPt(it.p); if (it.r) pushPt(it.r); });
    bounds = { w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
    plantaDrawItems(content, items, { x: minX, y: maxY }, sized, mode);
  }

  const scale = () => {
    const r = svg.getBoundingClientRect();
    return Math.min(r.width / view.w, r.height / view.h) || 1;
  };
  const apply = () => {
    if (!view) return;
    svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
    const s = scale();
    sized.forEach(({ el, px }) => el.setAttribute("r", (px / s).toFixed(4)));
  };
  const fit = () => {
    if (!items.length) return;
    const pad = Math.max(bounds.w, bounds.h) * 0.04;
    view = { x: -pad, y: -pad, w: bounds.w + pad * 2, h: bounds.h + pad * 2 };
    apply();
  };
  const zoomAt = (factor, clientX, clientY) => {
    if (!view) return;
    let ax = view.x + view.w / 2;
    let ay = view.y + view.h / 2;
    if (clientX != null) {
      const p = svg.createSVGPoint();
      p.x = clientX;
      p.y = clientY;
      const loc = p.matrixTransform(svg.getScreenCTM().inverse());
      ax = loc.x;
      ay = loc.y;
    }
    const full = Math.max(bounds.w, bounds.h, 1);
    const nw = Math.min(Math.max(view.w * factor, 0.5), full * 8);
    const k = nw / view.w;
    view.x = ax - (ax - view.x) * k;
    view.y = ay - (ay - view.y) * k;
    view.w = nw;
    view.h *= k;
    apply();
  };
  const clearHover = () => {
    if (hover) hover.forEach((n) => n.classList.remove("is-hover"));
    hover = null;
  };
  const hideTip = () => {
    tip.hidden = true;
    clearHover();
  };
  const showTip = (e) => {
    const node = e.target.closest?.("[data-idx]");
    if (!node || !svg.contains(node)) { hideTip(); return; }
    const item = items[Number(node.dataset.idx)];
    if (!item) { hideTip(); return; }
    if (!hover || !hover.includes(node)) {
      clearHover();
      hover = [...content.querySelectorAll(`[data-idx="${node.dataset.idx}"]`)];
      hover.forEach((n) => n.classList.add("is-hover"));
    }
    buildPlantaTooltip(tip, item, mode);
    tip.hidden = false;
    placePlantaTip(tip, wrap, e);
  };

  // Roda sem tecla rola a janela; Ctrl + roda dá zoom no plano
  svg.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    hideTip();
    zoomAt(e.deltaY < 0 ? 0.85 : 1 / 0.85, e.clientX, e.clientY);
  }, { passive: false });
  svg.addEventListener("pointerdown", (e) => {
    if (!view || (e.button !== 0 && e.button !== 1)) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    try { svg.setPointerCapture(e.pointerId); } catch (_) { /* ponteiro já liberado */ }
    svg.classList.add("is-dragging");
    hideTip();
  });
  svg.addEventListener("pointermove", (e) => {
    if (drag && view) {
      const s = scale();
      view.x = drag.vx - (e.clientX - drag.x) / s;
      view.y = drag.vy - (e.clientY - drag.y) / s;
      apply();
      return;
    }
    showTip(e);
  });
  const endDrag = (e) => {
    if (!drag) return;
    try { svg.releasePointerCapture?.(e.pointerId); } catch (_) { /* ponteiro já liberado */ }
    svg.classList.remove("is-dragging");
    drag = null;
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  svg.addEventListener("pointerleave", hideTip);
  svg.addEventListener("dblclick", fit);
  bIn.addEventListener("click", () => zoomAt(0.8));
  bOut.addEventListener("click", () => zoomAt(1.25));
  bReset.addEventListener("click", fit);

  PLANTA_CARDS.push({ apply: () => apply() });
  // o enquadramento inicial acontece quando o card já está no layout
  requestAnimationFrame(() => { fit(); });
  return card;
}

function renderPlanDialog() {
  const dlg = document.getElementById("planta-dialog");
  const body = document.getElementById("planta-dialog-body");
  const titulo = document.getElementById("planta-dialog-title");
  if (!dlg || !body || !dlg.open) return;
  if (titulo) titulo.textContent = `${PLANTA_MODE_TITLE[PLANTA_DIALOG_MODE]} · todos os planos`;
  const sub = document.getElementById("planta-dialog-sub");
  if (sub) sub.textContent = PLANTA_DIALOG_MODE === "z"
    ? `Cada furo colorido pela diferença de cota (realizado − previsto): verde dentro de ±${fmtNum(plantaTolZ(), 2)} m, vermelho fora. Mesmo filtro da página. Role a janela para ver todos os planos. Em cada plano: Ctrl + roda do mouse para zoom, arraste para mover, duplo clique para redefinir.`
    : "Cada furo colorido pela distância em planta entre o collar previsto e o realizado: verde dentro de 2 × diâmetro projetado, vermelho fora. Mesmo filtro da página. Role a janela para ver todos os planos. Em cada plano: Ctrl + roda do mouse para zoom, arraste para mover, duplo clique para redefinir.";
  PLANTA_CARDS = [];
  destroy("plantaDlgXY");
  destroy("plantaDlgZ");
  body.replaceChildren();
  if (!PLANTA_PLANS.size) {
    const empty = document.createElement("p");
    empty.className = "planta-dialog__empty";
    empty.textContent = "Nenhum plano com coordenadas previstas no filtro atual.";
    body.appendChild(empty);
    return;
  }
  const grid = document.createElement("div");
  grid.className = "planta-dialog__grid";
  [...PLANTA_PLANS.keys()].forEach((plano) => {
    const items = PLANTA_ITEMS.filter((it) => it.plano === plano);
    grid.appendChild(buildPlantaCard(plano, items, PLANTA_DIALOG_MODE));
  });
  body.appendChild(grid);
  if (PLANTA_CHART_DATA) body.appendChild(buildPlanDialogCharts());
}

/* Gráficos XY e Z no fim da janela */
function buildPlanDialogCharts() {
  const section = document.createElement("section");
  section.className = "planta-dialog__charts";
  const titles = [
    ["XY", "Furos com distância previsto × realizado em planta dentro da tolerância XY", "planta-dlg-chart-xy"],
    ["Z", "Furos com cota realizada dentro da tolerância Z em relação ao previsto", "planta-dlg-chart-z"],
  ];
  titles.forEach(([name, text, id]) => {
    const head = document.createElement("h3");
    head.className = "planta-dialog__chart-title";
    head.textContent = name;
    const sub = document.createElement("p");
    sub.className = "planta-dialog__chart-sub";
    sub.textContent = text;
    const box = document.createElement("div");
    box.className = "planta-dialog__chart-box";
    const scroll = document.createElement("div");
    scroll.className = "chart-scroll";
    const canvas = document.createElement("canvas");
    canvas.id = id;
    scroll.appendChild(canvas);
    box.appendChild(scroll);
    section.append(head, sub, box);
  });
  // os canvas já estão no documento quando os gráficos são criados
  queueMicrotask(() => {
    const { labels, xy, z, furos } = PLANTA_CHART_DATA;
    CHARTS.plantaDlgXY = new Chart(document.getElementById("planta-dlg-chart-xy"), plantaChartConfig(labels, xy, furos));
    CHARTS.plantaDlgZ = new Chart(document.getElementById("planta-dlg-chart-z"), plantaChartConfig(labels, z, furos));
  });
  return section;
}

function openPlantaDialog(mode) {
  const dlg = document.getElementById("planta-dialog");
  if (!dlg || dlg.open) return;
  PLANTA_DIALOG_MODE = mode === "z" ? "z" : "xy";
  dlg.showModal();
  renderPlanDialog();
}

function closePlantaDialog() {
  const body = document.getElementById("planta-dialog-body");
  PLANTA_CARDS = [];
  destroy("plantaDlgXY");
  destroy("plantaDlgZ");
  if (body) body.replaceChildren();
  setPlanDialogStatus("");
}

function setPlanDialogStatus(text) {
  const el = document.getElementById("planta-dialog-status");
  if (!el) return;
  el.textContent = text || "";
  el.hidden = !text;
}

function setPlantaStatus(text) {
  const el = document.getElementById("planta-status");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-visible", Boolean(text));
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

/* ---------- Desenho do bloco ---------- */
async function drawPlanta() {
  const charts = document.getElementById("planta-charts");
  const subtitle = document.getElementById("planta-subtitle");
  const token = ++PLANTA_TOKEN;

  const zLimite = document.getElementById("planta-z-limite");
  if (zLimite) zLimite.textContent = `±${fmtNum(plantaTolZ(), 2)} m`;
  if (subtitle) {
    subtitle.textContent = `Dois mapas em planta do mesmo filtro: XY (deslocamento de até 2 × diâmetro projetado do furo) e Z (±${fmtNum(plantaTolZ(), 2)} m) · cada collar previsto é pareado ao realizado mais próximo (até ${fmtNum(COLLAR_MATCH_MAX, 1)} m).`;
  }
  setupPlantaMap();

  const clearAll = () => {
    const ch = document.getElementById("planta-charts");
    if (ch) ch.hidden = true;
    PLANTA_PLANS = new Map();
    if (PLANTA_MAPS) {
      PLANTA_MAPS.xy.render([], "");
      PLANTA_MAPS.z.render([], "");
    }
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

  // Itens do filtro: cada collar previsto/realizado com o plano e a métrica
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
  PLANTA_ITEMS = items;

  const key = [selected, tf.y, tf.mo, planos.map((p) => p.plano).join(",")].join("|");
  PLANTA_MAPS.xy.render(items, key);
  PLANTA_MAPS.z.render(items, key);

  const rows = planos.map((p) => ({ plano: p.plano, ...PLANTA_PLANS.get(p.plano) }));
  const all = plantaMetrics(planos.flatMap((p) => p.matches));
  const labels = [...rows.map((r) => r.plano), "TOTAL"];
  const furos = [...rows.map((r) => r.n), all.n];
  PLANTA_CHART_DATA = { labels, xy: [...rows.map((r) => r.xyPct), all.xyPct], z: [...rows.map((r) => r.zPct), all.zPct], furos };
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
  if (document.getElementById("planta-dialog")?.open) renderPlanDialog();
}

/* ---------- Exportação: imagem (PNG) e PDF do eixo da janela aberta ---------- */
const PLANTA_JSPDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
let PLANTA_JSPDF_PROMISE = null;

function loadJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (!PLANTA_JSPDF_PROMISE) {
    PLANTA_JSPDF_PROMISE = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PLANTA_JSPDF_URL;
      s.onload = () => (window.jspdf && window.jspdf.jsPDF
        ? resolve(window.jspdf.jsPDF)
        : reject(new Error("Gerador de PDF indisponível")));
      s.onerror = () => {
        PLANTA_JSPDF_PROMISE = null;
        reject(new Error("Não foi possível carregar o gerador de PDF"));
      };
      document.head.appendChild(s);
    });
  }
  return PLANTA_JSPDF_PROMISE;
}

function plantaExportSubtitle() {
  const sel = (id) => {
    const el = document.getElementById(id);
    const opt = el && el.selectedOptions && el.selectedOptions[0];
    return opt && opt.value ? opt.text : "todos";
  };
  return `Ano: ${sel("filter-year")} · Mês: ${sel("filter-month")} · Plano: ${sel("filter-plan")} · Gerado em ${new Date().toLocaleString("pt-BR")}`;
}

function drawPlantaCardCanvas(ctx, x, y, w, h, plano, items, m, mode) {
  const HEAD_H = 40;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#e6e8ea";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = PLANTA_COLORS.green;
  ctx.fillRect(x, y, w, HEAD_H);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.font = "700 15px Arial";
  ctx.textAlign = "left";
  ctx.fillText(plano, x + 14, y + HEAD_H / 2);
  ctx.font = "11.5px Arial";
  ctx.textAlign = "right";
  ctx.fillText(`${fmtInt(m.n)} furos · XY ${pct2(m.xyPct)} · Z ${pct2(m.zPct)}`, x + w - 14, y + HEAD_H / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const mx = x, my = y + HEAD_H, mw = w, mh = h - HEAD_H;
  ctx.fillStyle = "#fbfbfc";
  ctx.fillRect(mx, my, mw, mh);
  if (!items.length) {
    ctx.fillStyle = "#6c747b";
    ctx.font = "13px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Sem furos no filtro atual", mx + mw / 2, my + mh / 2);
    ctx.textAlign = "left";
    return;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const pushPt = (q) => {
    if (q.x < minX) minX = q.x;
    if (q.x > maxX) maxX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.y > maxY) maxY = q.y;
  };
  items.forEach((it) => { if (it.p) pushPt(it.p); if (it.r) pushPt(it.r); });
  const pad = 28;
  const rangeX = Math.max(maxX - minX, 1);
  const rangeY = Math.max(maxY - minY, 1);
  const s = Math.min((mw - pad * 2) / rangeX, (mh - pad * 2) / rangeY);
  const ox = mx + (mw - rangeX * s) / 2;
  const oy = my + (mh - rangeY * s) / 2;
  const tx = (q) => ox + (q.x - minX) * s;
  const ty = (q) => oy + (maxY - q.y) * s;

  ctx.strokeStyle = PLANTA_COLORS.link;
  ctx.lineWidth = 1;
  items.forEach((it) => {
    if (it.kind !== "match") return;
    ctx.beginPath();
    ctx.moveTo(tx(it.p), ty(it.p));
    ctx.lineTo(tx(it.r), ty(it.r));
    ctx.stroke();
  });
  items.forEach((it) => {
    if (it.kind !== "match" && it.kind !== "planned") return;
    ctx.beginPath();
    ctx.arc(tx(it.p), ty(it.p), 4, 0, Math.PI * 2);
    ctx.strokeStyle = PLANTA_COLORS.planned;
    ctx.lineWidth = 1.2;
    ctx.setLineDash(it.kind === "planned" ? [3, 3] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  });
  items.forEach((it) => {
    if (it.kind !== "match" && it.kind !== "realized") return;
    const color = it.kind === "match" ? PLANTA_COLORS[plantaStatusFor(it, mode)] : PLANTA_COLORS.blue;
    ctx.beginPath();
    ctx.arc(tx(it.r), ty(it.r), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 0.6;
    ctx.stroke();
  });
}

/* Gera a imagem do eixo "mode": título, um bloco por plano e os gráficos XY e Z. Escala 2x. */
function buildPlantaExportCanvas(mode) {
  const DPR = 2;
  const M = 32, GAP = 24, CARD_W = 640, CARD_H = 400, COLS = 2, HEAD = 96;
  const CHART_H = 340;
  const plans = [...PLANTA_PLANS.keys()];
  const rows = Math.max(1, Math.ceil(plans.length / COLS));
  const gridH = rows * CARD_H + (rows - 1) * GAP;
  const W = M * 2 + CARD_W * COLS + GAP;
  const chartsTop = HEAD + gridH + 40;
  const chartsH = PLANTA_CHART_DATA ? 2 * (24 + CHART_H) + 36 : 0;
  const H = chartsTop + chartsH + M;

  const canvas = document.createElement("canvas");
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext("2d");
  ctx.scale(DPR, DPR);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#38424B";
  ctx.font = "700 20px Arial";
  ctx.fillText(`Aderência em planta · ${PLANTA_MODE_TITLE[mode]} · todos os planos`, M, M + 20);
  ctx.fillStyle = "#6c747b";
  ctx.font = "12px Arial";
  ctx.fillText(plantaExportSubtitle(), M, M + 42);

  plans.forEach((plano, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = M + col * (CARD_W + GAP);
    const y = HEAD + row * (CARD_H + GAP);
    const items = PLANTA_ITEMS.filter((it) => it.plano === plano);
    drawPlantaCardCanvas(ctx, x, y, CARD_W, CARD_H, plano, items, PLANTA_PLANS.get(plano), mode);
  });

  if (PLANTA_CHART_DATA) {
    const { labels, xy, z, furos } = PLANTA_CHART_DATA;
    const specs = [
      ["XY · furos com distância previsto × realizado dentro da tolerância XY", xy],
      ["Z · furos com cota realizada dentro da tolerância Z", z],
    ];
    let y = chartsTop;
    specs.forEach(([title, values]) => {
      ctx.fillStyle = "#38424B";
      ctx.font = "700 14px Arial";
      ctx.fillText(title, M, y + 14);
      const holder = document.createElement("div");
      holder.style.cssText = `position:fixed;left:-20000px;top:0;width:${W - M * 2}px;height:${CHART_H}px;`;
      const cv = document.createElement("canvas");
      holder.appendChild(cv);
      document.body.appendChild(holder);
      const cfg = plantaChartConfig(labels, values, furos);
      cfg.options.devicePixelRatio = DPR;
      cfg.options.animation = false;
      const chart = new Chart(cv, cfg);
      ctx.drawImage(chart.canvas, M, y + 24, W - M * 2, CHART_H);
      chart.destroy();
      holder.remove();
      y += 24 + CHART_H + 36;
    });
  }
  return canvas;
}

function downloadPlantaBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function exportPlantaImagem() {
  const mode = PLANTA_DIALOG_MODE;
  setPlanDialogStatus("Gerando imagem…");
  const canvas = buildPlantaExportCanvas(mode);
  canvas.toBlob((blob) => {
    if (!blob) { setPlanDialogStatus("Não foi possível gerar a imagem."); return; }
    downloadPlantaBlob(blob, `planta-${mode}-todos-os-planos.png`);
    setPlanDialogStatus("");
  }, "image/png");
}

async function exportPlantaPdf() {
  const mode = PLANTA_DIALOG_MODE;
  setPlanDialogStatus("Gerando PDF…");
  try {
    const JsPDF = await loadJsPdf();
    const canvas = buildPlantaExportCanvas(mode);
    const W = canvas.width / 2;
    const H = canvas.height / 2;
    const pdf = new JsPDF({ orientation: W >= H ? "landscape" : "portrait", unit: "px", format: [W, H], compress: true });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, W, H);
    pdf.save(`planta-${mode}-todos-os-planos.pdf`);
    setPlanDialogStatus("");
  } catch (e) {
    console.warn("exportação em PDF falhou:", e);
    setPlanDialogStatus(e.message || "Não foi possível gerar o PDF.");
  }
}
