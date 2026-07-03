/* =====================================================================
   Desvios de Perfuração — Inclinação, Azimute e Profundidade
   US Vale Verde · atualiza em tempo real via Google Sheets (gviz + CSV).
   Parâmetros da ferramenta ANALISE DE DESVIOS DE INCLINAÇÃO E AZIMUTE:
     ângulo frontal 12° a 18° (esperado 15°, tol. ±3°)
     Δ azimute ±5° (esperado 0°)
     Δ profundidade ±0,25 m (esperado 0,00 m)
     meta 80% de aderência
   ===================================================================== */

const SHEET_ID = "1ef7edY0Yye6arldVfOUYDcjI4GvY6g5U";
const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=1`;
const CSV_URL  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

const LIMITS = {
  angleMin: 12, angleMax: 18, angleExpected: 15,
  azimuth: 5,
  depth: 0.25,
  meta: 80,
};

const C = {
  ink: "#38424B",
  inkSoft: "rgba(56,66,75,0.85)",
  inkFill: "rgba(56,66,75,0.10)",
  red: "#E20613",
  redFill: "rgba(226,6,19,0.12)",
  grid: "rgba(56,66,75,0.08)",
  gridStrong: "rgba(56,66,75,0.18)",
  axis: "#6c747b",
  text: "#38424B",
  muted: "#6c747b",
  ok: "#107c10",
  amber: "#c47b00",
};

const norm = (s) =>
  (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();

const fmtInt = (n) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n || 0);
const fmtNum = (n, d = 2) =>
  n == null || !isFinite(n)
    ? "—"
    : new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const fmtPct = (n) => n == null || !isFinite(n) ? "—" : fmtNum(n, 1) + "%";
const escapeText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s) => escapeText(s).replace(/"/g, "&quot;");

const nowBR = () =>
  new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

let RECORDS = [];
let CHARTS = {};

/* ===================== Status ===================== */
function setStatus(kind, text) {
  const el = document.getElementById("status");
  el.classList.remove("is-loading", "is-ok", "is-error");
  if (kind) el.classList.add("is-" + kind);
  document.getElementById("status-text").textContent = text;
}

/* ===================== Carregamento ===================== */
async function loadSheet() {
  setStatus("loading", "Carregando dados da planilha…");
  let table;
  try {
    const res = await fetch(GVIZ_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("gviz HTTP " + res.status);
    table = parseGviz(await res.text());
  } catch (e) {
    console.warn("gviz falhou, tentando CSV:", e);
    try {
      const res = await fetch(CSV_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("csv HTTP " + res.status);
      table = parseCsv(await res.text());
    } catch (e2) {
      setStatus("error", "Não foi possível acessar a planilha. Verifique se o link está público.");
      throw e2;
    }
  }
  RECORDS = buildRecords(table);
  if (!RECORDS.length) {
    setStatus("error", "Planilha acessada, mas nenhum registro válido encontrado.");
    return;
  }
  populateFilters();
  setupExport();
  setStatus("ok", `${RECORDS.length} furos carregados.`);
  document.getElementById("last-update").textContent = "Atualizado em " + nowBR();
  render();
}

function parseGviz(txt) {
  const m = txt.match(/setResponse\((\{[\s\S]*\})\);?\s*$/);
  const json = JSON.parse(m ? m[1] : txt);
  return json.table;
}

function parseCsv(text) {
  const rows = csvToRows(text);
  const headers = rows.shift();
  const cols = headers.map((label) => ({ id: label, label, type: "string" }));
  const tableRows = rows.map((r) => ({ c: headers.map((h, i) => ({ v: r[i] ?? null })) }));
  return { cols, rows: tableRows };
}

function csvToRows(text) {
  const out = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
      else if (ch === "\r") { /* skip */ }
      else cur += ch;
    }
  }
  if (cur !== "" || row.length) { row.push(cur); out.push(row); }
  return out;
}

/* ===================== Records ===================== */
function buildRecords(table) {
  const idx = {};
  table.cols.forEach((c, i) => { idx[norm(c.label)] = i; });
  const g = (key) => { const i = idx[key]; return i === undefined ? -1 : i; };

  const f = {
    plano: g("PLANO"),
    id: g("ID"),
    angle: g("ANGULO FRONTAL (°)"),
    azPlan: g("AZIMUTE PLANEJADO (°)"),
    azExec: g("AZIMUTE EXECUTADO (°)"),
    azDelta: g("Δ AZIMUTE (°)"),
    depthPlan: g("PROFUNDIDADE PLANEJADA (M)"),
    depthExec: g("PROFUNDIDADE EXECUTADA (M)"),
    depthDelta: g("Δ PROFUNDIDADE (M)"),
    okAngle: g("ANGULO DENTRO DO LIMITE"),
    okAz: g("AZIMUTE DENTRO DO LIMITE"),
    okZ: g("Z DENTRO DO LIMITE"),
  };

  const recs = [];
  for (const r of table.rows) {
    const cell = (i) => (i < 0 ? null : (r.c[i] && r.c[i].v != null ? r.c[i].v : null));
    const num = (i) => {
      const v = cell(i);
      if (v == null || v === "") return null;
      const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
      return isFinite(n) ? n : null;
    };
    const plano = cell(f.plano);
    if (!plano) continue;
    const id = num(f.id);
    if (id == null) continue;

    recs.push({
      plano: String(plano).trim(),
      id,
      angle: num(f.angle),
      azPlan: num(f.azPlan),
      azExec: num(f.azExec),
      azDelta: num(f.azDelta),
      depthPlan: num(f.depthPlan),
      depthExec: num(f.depthExec),
      depthDelta: num(f.depthDelta),
    });
  }
  return recs;
}

/* ===================== Filtros ===================== */
function populateFilters() {
  const planos = [...new Set(RECORDS.map((r) => r.plano).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  const pSel = document.getElementById("filter-plan");
  pSel.innerHTML = `<option value="">Todos os planos</option>` +
    planos.map((p) => `<option value="${escapeAttr(p)}">${escapeText(p)}</option>`).join("");
  pSel.onchange = render;
  document.getElementById("filter-reset").onclick = () => {
    pSel.value = "";
    render();
  };
}

function filtered() {
  const p = document.getElementById("filter-plan").value;
  return RECORDS.filter((r) => !p || r.plano === p);
}

const FILTER_DEFS = [{ id: "filter-plan", label: "Plano" }];

function updateActiveFilters() {
  const box = document.getElementById("active-filters");
  const chips = [];
  FILTER_DEFS.forEach((fd) => {
    const sel = document.getElementById(fd.id);
    if (sel && sel.value) {
      chips.push(
        `<button class="chip" data-id="${fd.id}" type="button">` +
        `<span class="chip__k">${fd.label}:</span> <span class="chip__v">${escapeText(sel.value)}</span>` +
        `<span class="chip__x" aria-hidden="true">×</span></button>`
      );
    }
  });
  box.innerHTML = chips.join("");
  box.style.display = chips.length ? "flex" : "none";
  box.querySelectorAll(".chip").forEach((el) => {
    el.onclick = () => {
      document.getElementById(el.dataset.id).value = "";
      render();
    };
  });
}

/* ===================== Métricas ===================== */
function computeMetrics(data) {
  const angleVals = data.filter((r) => r.angle != null);
  const azVals = data.filter((r) => r.azDelta != null);
  const zVals = data.filter((r) => r.depthDelta != null);

  const angleOk = angleVals.filter((r) => r.angle >= LIMITS.angleMin && r.angle <= LIMITS.angleMax).length;
  const azOk = azVals.filter((r) => Math.abs(r.azDelta) <= LIMITS.azimuth).length;
  const zOk = zVals.filter((r) => Math.abs(r.depthDelta) <= LIMITS.depth).length;

  return {
    total: data.length,
    anglePct: angleVals.length ? (angleOk / angleVals.length) * 100 : NaN,
    azPct: azVals.length ? (azOk / azVals.length) * 100 : NaN,
    zPct: zVals.length ? (zOk / zVals.length) * 100 : NaN,
    angleOk, angleTotal: angleVals.length,
    azOk, azTotal: azVals.length,
    zOk, zTotal: zVals.length,
  };
}

function setKpiTone(cardId, pct) {
  const el = document.getElementById(cardId);
  el.classList.remove("kpi--ok", "kpi--alert");
  if (!isFinite(pct)) return;
  el.classList.add(pct >= LIMITS.meta ? "kpi--ok" : "kpi--alert");
}

/* ===================== Render ===================== */
function render() {
  const data = filtered();
  updateActiveFilters();
  const m = computeMetrics(data);

  document.getElementById("kpi-count").textContent = fmtInt(m.total);
  document.getElementById("kpi-count-hint").textContent =
    m.total ? `${fmtInt(m.azTotal)} com direção comparável` : "Nenhum furo no filtro";

  document.getElementById("kpi-angle").textContent = fmtPct(m.anglePct);
  document.getElementById("kpi-angle-hint").textContent =
    isFinite(m.anglePct) ? `${m.angleOk} de ${m.angleTotal} · meta ${LIMITS.meta}%` : "—";
  setKpiTone("kpi-angle-card", m.anglePct);

  document.getElementById("kpi-az").textContent = fmtPct(m.azPct);
  document.getElementById("kpi-az-hint").textContent =
    isFinite(m.azPct) ? `${m.azOk} de ${m.azTotal} · meta ${LIMITS.meta}%` : "—";
  setKpiTone("kpi-az-card", m.azPct);

  document.getElementById("kpi-z").textContent = fmtPct(m.zPct);
  document.getElementById("kpi-z-hint").textContent =
    isFinite(m.zPct) ? `${m.zOk} de ${m.zTotal} · meta ${LIMITS.meta}%` : "—";
  setKpiTone("kpi-z-card", m.zPct);

  drawAngle(data);
  drawDirection(data);
  drawAzByHole(data);
  drawDepthByHole(data);
  drawByPlan();
  drawHist("chart-hist-az", data.map((r) => r.azDelta).filter((v) => v != null), {
    unit: "°", limit: LIMITS.azimuth, bins: 20,
  });
  drawHist("chart-hist-depth", data.map((r) => r.depthDelta).filter((v) => v != null), {
    unit: " m", limit: LIMITS.depth, bins: 20, digits: 2,
  });
  drawHist("chart-hist-angle", data.map((r) => r.angle).filter((v) => v != null), {
    unit: "°", bins: 18, symmetricLimits: false,
    xMin: 0, xMax: 30, marks: [LIMITS.angleMin, LIMITS.angleMax],
  });
}

/* ===================== Charts ===================== */
Chart.defaults.font.family = '"Segoe UI", "Segoe UI Web", -apple-system, sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.color = C.muted;

const limitLinesPlugin = {
  id: "limitLines",
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !opts) return;
    ctx.save();
    ctx.setLineDash(opts.dash || [4, 4]);
    ctx.lineWidth = opts.width || 1.4;
    ctx.strokeStyle = opts.color || C.red;
    (opts.yLines || []).forEach((y) => {
      if (!scales.y) return;
      const py = scales.y.getPixelForValue(y);
      if (isFinite(py)) {
        ctx.beginPath();
        ctx.moveTo(chartArea.left, py);
        ctx.lineTo(chartArea.right, py);
        ctx.stroke();
      }
    });
    (opts.xLines || []).forEach((x) => {
      if (!scales.x) return;
      const px = scales.x.getPixelForValue(x);
      if (isFinite(px)) {
        ctx.beginPath();
        ctx.moveTo(px, chartArea.top);
        ctx.lineTo(px, chartArea.bottom);
        ctx.stroke();
      }
    });
    ctx.restore();
  },
};
Chart.register(limitLinesPlugin);

const toleranceBoxPlugin = {
  id: "toleranceBox",
  beforeDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !opts) return;
    const x0 = scales.x.getPixelForValue(opts.xMin);
    const x1 = scales.x.getPixelForValue(opts.xMax);
    const y0 = scales.y.getPixelForValue(opts.yMin);
    const y1 = scales.y.getPixelForValue(opts.yMax);
    ctx.save();
    ctx.fillStyle = opts.fill || "rgba(16,124,16,0.06)";
    ctx.strokeStyle = opts.stroke || "rgba(16,124,16,0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.rect(x0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0));
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  },
};
Chart.register(toleranceBoxPlugin);

function destroy(id) {
  if (CHARTS[id]) { CHARTS[id].destroy(); CHARTS[id] = null; }
}

function baseScales({ xTitle, yTitle, xMin, xMax, yMin, yMax } = {}) {
  return {
    x: {
      title: xTitle ? { display: true, text: xTitle, color: C.text, font: { weight: "600", size: 11 } } : undefined,
      min: xMin, max: xMax,
      ticks: { color: C.muted, maxRotation: 0, autoSkipPadding: 12 },
      grid: { color: C.grid, drawTicks: false },
      border: { color: C.gridStrong },
    },
    y: {
      title: yTitle ? { display: true, text: yTitle, color: C.text, font: { weight: "600", size: 11 } } : undefined,
      min: yMin, max: yMax,
      ticks: { color: C.muted },
      grid: { color: C.grid, drawTicks: false },
      border: { color: C.gridStrong },
    },
  };
}

/* --- 1. Ângulo frontal por furo --- */
function drawAngle(data) {
  destroy("angle");
  const points = data.filter((r) => r.angle != null).map((r) => ({ x: r.id, y: r.angle, plano: r.plano }));
  const ctx = document.getElementById("chart-angle");
  const colored = points.map((p) => ({
    ...p,
    ok: p.y >= LIMITS.angleMin && p.y <= LIMITS.angleMax,
  }));
  CHARTS.angle = new Chart(ctx, {
    type: "scatter",
    data: {
      datasets: [{
        label: "Ângulo executado",
        data: colored,
        pointRadius: 3.4,
        pointHoverRadius: 5,
        borderWidth: 0.6,
        backgroundColor: (ctx) => (ctx.raw && ctx.raw.ok ? C.ink : C.red),
        borderColor: (ctx) => (ctx.raw && ctx.raw.ok ? C.ink : C.red),
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => `${c.raw.plano} · furo ${c.raw.x}: ${fmtNum(c.raw.y, 2)}°`,
          },
        },
        limitLines: { yLines: [LIMITS.angleMin, LIMITS.angleMax], color: C.red, dash: [5, 4] },
      },
      scales: baseScales({ xTitle: "ID do furo", yTitle: "Ângulo frontal [°]", yMin: 0, yMax: 30 }),
    },
  });
}

/* --- 2. Direção dos furos (ΔAz × ΔProf) --- */
function drawDirection(data) {
  destroy("direction");
  const pts = data
    .filter((r) => r.azDelta != null && r.depthDelta != null)
    .map((r) => ({ x: r.azDelta, y: r.depthDelta, id: r.id, plano: r.plano }));
  const inBox = (p) => Math.abs(p.x) <= LIMITS.azimuth && Math.abs(p.y) <= LIMITS.depth;
  const xExt = Math.max(45, ...pts.map((p) => Math.abs(p.x))) * 1.05;
  const yExt = Math.max(1.0, ...pts.map((p) => Math.abs(p.y))) * 1.15;

  CHARTS.direction = new Chart(document.getElementById("chart-direction"), {
    type: "scatter",
    data: {
      datasets: [{
        label: "Furo",
        data: pts,
        pointRadius: 3.6,
        pointHoverRadius: 5.5,
        borderWidth: 0.6,
        backgroundColor: (c) => (c.raw && inBox(c.raw) ? C.ink : C.red),
        borderColor: (c) => (c.raw && inBox(c.raw) ? C.ink : C.red),
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => `${c.raw.plano} · furo ${c.raw.id}: ΔAz ${fmtNum(c.raw.x, 2)}° | ΔZ ${fmtNum(c.raw.y, 2)} m`,
          },
        },
        toleranceBox: {
          xMin: -LIMITS.azimuth, xMax: LIMITS.azimuth,
          yMin: -LIMITS.depth, yMax: LIMITS.depth,
        },
        limitLines: {
          xLines: [-LIMITS.azimuth, LIMITS.azimuth],
          yLines: [-LIMITS.depth, LIMITS.depth],
          color: C.red, dash: [5, 4],
        },
      },
      scales: baseScales({
        xTitle: "Δ Azimute [°]", yTitle: "Δ Profundidade [m]",
        xMin: -xExt, xMax: xExt, yMin: -yExt, yMax: yExt,
      }),
    },
  });
}

/* --- 3. Δ Azimute por furo (barras coloridas) --- */
function drawAzByHole(data) {
  destroy("az");
  const pts = data.filter((r) => r.azDelta != null);
  const labels = pts.map((_, i) => i + 1);
  CHARTS.az = new Chart(document.getElementById("chart-az"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: pts.map((r) => r.azDelta),
        backgroundColor: pts.map((r) => Math.abs(r.azDelta) <= LIMITS.azimuth ? C.inkSoft : C.red),
        borderWidth: 0,
        barPercentage: 1, categoryPercentage: 0.9,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (t) => `${pts[t[0].dataIndex].plano} · furo ${pts[t[0].dataIndex].id}`,
            label: (c) => `ΔAz ${fmtNum(c.raw, 2)}°`,
          },
        },
        limitLines: { yLines: [-LIMITS.azimuth, LIMITS.azimuth], color: C.red, dash: [5, 4] },
      },
      scales: {
        x: { ticks: { display: false }, grid: { display: false }, border: { display: false } },
        y: {
          title: { display: true, text: "Δ Azimute [°]", color: C.text, font: { weight: "600" } },
          ticks: { color: C.muted },
          grid: { color: C.grid, drawTicks: false },
          border: { color: C.gridStrong },
        },
      },
    },
  });
}

/* --- 4. Δ Profundidade por furo (barras coloridas) --- */
function drawDepthByHole(data) {
  destroy("depth");
  const pts = data.filter((r) => r.depthDelta != null);
  const labels = pts.map((_, i) => i + 1);
  CHARTS.depth = new Chart(document.getElementById("chart-depth"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: pts.map((r) => r.depthDelta),
        backgroundColor: pts.map((r) => Math.abs(r.depthDelta) <= LIMITS.depth ? C.inkSoft : C.red),
        borderWidth: 0,
        barPercentage: 1, categoryPercentage: 0.9,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (t) => `${pts[t[0].dataIndex].plano} · furo ${pts[t[0].dataIndex].id}`,
            label: (c) => `ΔProf ${fmtNum(c.raw, 2)} m`,
          },
        },
        limitLines: { yLines: [-LIMITS.depth, LIMITS.depth], color: C.red, dash: [5, 4] },
      },
      scales: {
        x: { ticks: { display: false }, grid: { display: false }, border: { display: false } },
        y: {
          title: { display: true, text: "Δ Profundidade [m]", color: C.text, font: { weight: "600" } },
          ticks: { color: C.muted },
          grid: { color: C.grid, drawTicks: false },
          border: { color: C.gridStrong },
        },
      },
    },
  });
}

/* --- 5. Aderência por plano (barras agrupadas) --- */
function drawByPlan() {
  destroy("byPlan");
  const groups = {};
  RECORDS.forEach((r) => {
    (groups[r.plano] ||= []).push(r);
  });
  const planos = Object.keys(groups).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  const anglePct = [], azPct = [], zPct = [];
  planos.forEach((p) => {
    const m = computeMetrics(groups[p]);
    anglePct.push(isFinite(m.anglePct) ? m.anglePct : null);
    azPct.push(isFinite(m.azPct) ? m.azPct : null);
    zPct.push(isFinite(m.zPct) ? m.zPct : null);
  });
  CHARTS.byPlan = new Chart(document.getElementById("chart-by-plan"), {
    type: "bar",
    data: {
      labels: planos,
      datasets: [
        { label: "Ângulo", data: anglePct, backgroundColor: C.ink, borderWidth: 0 },
        { label: "Azimute", data: azPct, backgroundColor: C.red, borderWidth: 0 },
        { label: "Profundidade (Z)", data: zPct, backgroundColor: "rgba(56,66,75,0.45)", borderWidth: 0 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { position: "top", align: "start", labels: { boxWidth: 10, boxHeight: 10, color: C.text } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtPct(c.raw)}` } },
        limitLines: { yLines: [LIMITS.meta], color: C.red, dash: [5, 4] },
      },
      scales: {
        x: {
          ticks: { color: C.muted, autoSkip: false, maxRotation: 55, minRotation: 45 },
          grid: { display: false },
          border: { color: C.gridStrong },
        },
        y: {
          min: 0, max: 100,
          title: { display: true, text: "% dentro do limite", color: C.text, font: { weight: "600" } },
          ticks: { color: C.muted, callback: (v) => v + "%" },
          grid: { color: C.grid, drawTicks: false },
          border: { color: C.gridStrong },
        },
      },
    },
  });
}

/* --- Histograma genérico --- */
function drawHist(canvasId, values, opts = {}) {
  const key = canvasId;
  destroy(key);
  if (!values.length) {
    CHARTS[key] = new Chart(document.getElementById(canvasId), {
      type: "bar", data: { labels: [], datasets: [] }, options: { responsive: true, maintainAspectRatio: false },
    });
    return;
  }
  const bins = opts.bins || 20;
  let min, max;
  if (opts.xMin != null && opts.xMax != null) {
    min = opts.xMin; max = opts.xMax;
  } else if (opts.symmetricLimits !== false) {
    const ext = Math.max(...values.map((v) => Math.abs(v))) * 1.05;
    min = -ext; max = ext;
  } else {
    min = Math.min(...values); max = Math.max(...values);
  }
  const step = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  values.forEach((v) => {
    let b = Math.floor((v - min) / step);
    if (b < 0) b = 0;
    if (b >= bins) b = bins - 1;
    counts[b] += 1;
  });
  const labels = counts.map((_, i) => min + step * (i + 0.5));
  const colors = labels.map((c) => {
    if (opts.limit != null && Math.abs(c) > opts.limit) return C.red;
    return C.ink;
  });
  const digits = opts.digits ?? 1;
  const unit = opts.unit || "";
  const marks = opts.marks || (opts.limit != null ? [-opts.limit, opts.limit] : []);

  CHARTS[key] = new Chart(document.getElementById(canvasId), {
    type: "bar",
    data: {
      labels: labels.map((v) => fmtNum(v, digits)),
      datasets: [{ data: counts, backgroundColor: colors, borderWidth: 0, barPercentage: 1, categoryPercentage: 0.98 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.raw} furo(s)`, title: (t) => `Faixa: ${t[0].label}${unit}` } },
        limitLines: {
          xLines: marks.map((m) => {
            // Chart.js "category" scale uses index; find closest bin center
            let bestIdx = 0, bestDist = Infinity;
            labels.forEach((v, i) => { const d = Math.abs(v - m); if (d < bestDist) { bestDist = d; bestIdx = i; } });
            return bestIdx;
          }),
          color: C.red, dash: [5, 4],
        },
      },
      scales: {
        x: {
          title: { display: true, text: opts.xTitle || "", color: C.text, font: { weight: "600" } },
          ticks: { color: C.muted, autoSkip: true, maxRotation: 0 },
          grid: { display: false },
          border: { color: C.gridStrong },
        },
        y: {
          title: { display: true, text: "Nº de furos", color: C.text, font: { weight: "600" } },
          ticks: { color: C.muted, precision: 0 },
          grid: { color: C.grid, drawTicks: false },
          border: { color: C.gridStrong },
        },
      },
    },
  });
}

/* ===================== Exportação Excel ===================== */
function setupExport() {
  const btn = document.getElementById("export-xlsx");
  if (!btn) return;
  btn.onclick = exportToXlsx;
}

function exportToXlsx() {
  if (typeof XLSX === "undefined") {
    alert("Biblioteca de exportação ainda carregando. Aguarde alguns segundos e tente novamente.");
    return;
  }
  const data = filtered();
  if (!data.length) {
    alert("Nenhum furo no filtro atual para exportar.");
    return;
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dataStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  const ano = now.getFullYear();
  const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const mes = meses[now.getMonth()];

  const withinAngle = (v) => v != null && v >= LIMITS.angleMin && v <= LIMITS.angleMax;
  const withinAz = (v) => v != null && Math.abs(v) <= LIMITS.azimuth;
  const withinZ = (v) => v != null && Math.abs(v) <= LIMITS.depth;

  const rows = data.map((r) => ({
    "Ano": ano,
    "Mês": mes,
    "Data": dataStr,
    "Plano": r.plano,
    "ID": r.id,
    "Ângulo frontal (°)": r.angle,
    "Azimute planejado (°)": r.azPlan,
    "Azimute executado (°)": r.azExec,
    "Δ Azimute (°)": r.azDelta,
    "Profundidade planejada (m)": r.depthPlan,
    "Profundidade executada (m)": r.depthExec,
    "Δ Profundidade (m)": r.depthDelta,
    "Ângulo dentro do limite": r.angle == null ? "" : (withinAngle(r.angle) ? "Sim" : "Não"),
    "Azimute dentro do limite": r.azDelta == null ? "" : (withinAz(r.azDelta) ? "Sim" : "Não"),
    "Z dentro do limite": r.depthDelta == null ? "" : (withinZ(r.depthDelta) ? "Sim" : "Não"),
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  // largura de coluna aproximada
  const cols = Object.keys(rows[0]).map((k) => ({
    wch: Math.max(k.length + 2, 12),
  }));
  ws["!cols"] = cols;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Desvios");

  // Aba de resumo com métricas
  const m = computeMetrics(data);
  const resumo = [
    ["Relatório de Desvios de Perfuração"],
    ["Gerado em", dataStr],
    ["Ano", ano],
    ["Mês", mes],
    [],
    ["Furos analisados", m.total],
    ["Aderência Ângulo (%)", isFinite(m.anglePct) ? +m.anglePct.toFixed(2) : ""],
    ["Aderência Azimute (%)", isFinite(m.azPct) ? +m.azPct.toFixed(2) : ""],
    ["Aderência Z (%)", isFinite(m.zPct) ? +m.zPct.toFixed(2) : ""],
    ["Meta (%)", LIMITS.meta],
  ];
  const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
  wsResumo["!cols"] = [{ wch: 28 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");

  const fname = `desvios-perfuracao_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.xlsx`;
  XLSX.writeFile(wb, fname);
}

/* ===================== Boot ===================== */
loadSheet().catch((e) => console.error(e));
