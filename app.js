/* =====================================================================
   Desvios de Perfuração — Inclinação, Azimute e Profundidade
   US Vale Verde · atualiza em tempo real via Google Sheets (gviz + CSV).
   Parâmetros atuais do sistema:
     ângulo frontal 15° ± 3,2° (faixa 11,8° a 18,2°)
     Δ azimute 0° ± 6,39°
     Δ profundidade 0,00 m ± 0,20 m (20 cm)
     meta 80% de aderência
   ===================================================================== */

const SHEET_ID = "1ef7edY0Yye6arldVfOUYDcjI4GvY6g5U";
const GVIZ_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=1`;
const CSV_URL  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

const LIMITS = {
  angleMin: 11.8, angleMax: 18.2, angleExpected: 15, angleTol: 3.2,
  azimuth: 6.39,
  depth: 0.20,
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
const DATA_QUALITY = { dateMismatches: 0 };

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
  const qualityNote = DATA_QUALITY.dateMismatches
    ? ` · ${DATA_QUALITY.dateMismatches} registro(s) com Ano/Mês corrigido(s) pela Data`
    : "";
  setStatus("ok", `${RECORDS.length} furos carregados${qualityNote}.`);
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
  DATA_QUALITY.dateMismatches = 0;
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
    ano: g("ANO"),
    mes: g("MES"),
    data: g("DATA"),
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

    let ano = num(f.ano);
    let mes = num(f.mes);
    const dt = parseDateCell(cell(f.data));
    if (dt) {
      const dateAno = dt.getFullYear();
      const dateMes = dt.getMonth() + 1;
      if ((ano != null && Math.round(ano) !== dateAno) || (mes != null && Math.round(mes) !== dateMes)) {
        DATA_QUALITY.dateMismatches += 1;
      }
      // A data completa é a fonte temporal mais precisa; Ano/Mês são
      // mantidos como fallback apenas quando a planilha não traz Data.
      ano = dateAno;
      mes = dateMes;
    }

    // Regra atual: mantém somente registros de nov/2025 em diante,
    // pulando nov/2026. Alterar aqui se a janela mudar.
    if (ano == null || mes == null) continue;
    const ymKey = ano * 12 + (mes - 1);
    const MIN_YM = 2025 * 12 + (11 - 1);  // nov/2025
    const SKIP_YM = 2026 * 12 + (11 - 1); // nov/2026
    if (ymKey < MIN_YM) continue;
    if (ymKey === SKIP_YM) continue;

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
      ano: ano != null ? Math.round(ano) : null,
      mes: mes != null ? Math.round(mes) : null,
      data: dt,
    });
  }
  return recs;
}

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/* Aceita "Date(2026,4,22)" (gviz JSON, mês 0-based) e "22/05/2026" (CSV, mês 1-based). */
function parseDateCell(v) {
  if (v == null || v === "") return null;
  const s = String(v);
  const gm = s.match(/Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?/);
  if (gm) {
    const dt = new Date(+gm[1], +gm[2], +gm[3], gm[4] ? +gm[4] : 0, gm[5] ? +gm[5] : 0, gm[6] ? +gm[6] : 0);
    return isNaN(dt.getTime()) ? null : dt;
  }
  const br = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (br) {
    const yr = +br[3] < 100 ? 2000 + +br[3] : +br[3];
    const dt = new Date(yr, +br[2] - 1, +br[1]);
    return isNaN(dt.getTime()) ? null : dt;
  }
  const isoDate = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (isoDate) {
    const dt = new Date(+isoDate[1], +isoDate[2] - 1, +isoDate[3]);
    return isNaN(dt.getTime()) ? null : dt;
  }
  const iso = new Date(s);
  return isNaN(iso.getTime()) ? null : iso;
}

/* ===================== Filtros ===================== */
function refreshDependentOptions() {
  const ySel = document.getElementById("filter-year");
  const mSel = document.getElementById("filter-month");
  const pSel = document.getElementById("filter-plan");
  const yVal = ySel.value, mVal = mSel.value, pVal = pSel.value;

  // Considera o filtro de ano/mês para restringir os planos disponíveis, e vice-versa.
  const byAll = (r) =>
    (!yVal || String(r.ano) === yVal) &&
    (!mVal || String(r.mes) === mVal) &&
    (!pVal || r.plano === pVal);

  const years = [...new Set(RECORDS
    .filter((r) => (!mVal || String(r.mes) === mVal) && (!pVal || r.plano === pVal))
    .map((r) => r.ano).filter((v) => v != null))].sort((a, b) => a - b);
  const months = [...new Set(RECORDS
    .filter((r) => (!yVal || String(r.ano) === yVal) && (!pVal || r.plano === pVal))
    .map((r) => r.mes).filter((v) => v != null))].sort((a, b) => a - b);
  const planos = [...new Set(RECORDS
    .filter((r) => (!yVal || String(r.ano) === yVal) && (!mVal || String(r.mes) === mVal))
    .map((r) => r.plano).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));

  ySel.innerHTML = `<option value="">Todos os anos</option>` +
    years.map((y) => `<option value="${y}">${y}</option>`).join("");
  ySel.value = years.map(String).includes(yVal) ? yVal : "";

  mSel.innerHTML = `<option value="">Todos os meses</option>` +
    months.map((m) => `<option value="${m}">${MESES[m - 1] || m}</option>`).join("");
  mSel.value = months.map(String).includes(mVal) ? mVal : "";

  pSel.innerHTML = `<option value="">Todos os planos</option>` +
    planos.map((p) => `<option value="${escapeAttr(p)}">${escapeText(p)}</option>`).join("");
  pSel.value = planos.includes(pVal) ? pVal : "";
}

function populateFilters() {
  refreshDependentOptions();
  ["filter-year", "filter-month", "filter-plan"].forEach((id) => {
    document.getElementById(id).onchange = () => {
      refreshDependentOptions();
      render();
    };
  });
  document.getElementById("filter-reset").onclick = () => {
    ["filter-year", "filter-month", "filter-plan"].forEach((id) => (document.getElementById(id).value = ""));
    refreshDependentOptions();
    render();
  };
}

function filtered() {
  const y = document.getElementById("filter-year").value;
  const mo = document.getElementById("filter-month").value;
  const p = document.getElementById("filter-plan").value;
  return RECORDS.filter((r) =>
    (!y || String(r.ano) === y) &&
    (!mo || String(r.mes) === mo) &&
    (!p || r.plano === p)
  );
}

const FILTER_DEFS = [
  { id: "filter-year", label: "Ano" },
  { id: "filter-month", label: "Mês", name: (v) => MESES[+v - 1] || v },
  { id: "filter-plan", label: "Plano" },
];

function updateActiveFilters() {
  const box = document.getElementById("active-filters");
  const chips = [];
  FILTER_DEFS.forEach((fd) => {
    const sel = document.getElementById(fd.id);
    if (sel && sel.value) {
      const display = fd.name ? fd.name(sel.value) : sel.value;
      chips.push(
        `<button class="chip" data-id="${fd.id}" type="button">` +
        `<span class="chip__k">${fd.label}:</span> <span class="chip__v">${escapeText(display)}</span>` +
        `<span class="chip__x" aria-hidden="true">×</span></button>`
      );
    }
  });
  box.innerHTML = chips.join("");
  box.style.display = chips.length ? "flex" : "none";
  box.querySelectorAll(".chip").forEach((el) => {
    el.onclick = () => {
      document.getElementById(el.dataset.id).value = "";
      refreshDependentOptions();
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
  drawByPlan(data);
  drawMap();
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

/* Rótulos discretos e centralizados para barras com espaço legível. */
const valueLabelsPlugin = {
  id: "valueLabels",
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || opts.display === false) return;
    const { ctx } = chart;
    const baseFontSize = opts.fontSize || 10;
    const minFontSize = opts.minFontSize || 7;
    const horizontalPadding = opts.horizontalPadding || 2;
    const verticalPadding = opts.verticalPadding || 2;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;
      meta.data.forEach((bar, index) => {
        const value = dataset.data[index];
        if (value == null || !isFinite(value)) return;
        const props = bar.getProps(["x", "y", "base", "width"], true);
        const left = props.x - props.width / 2;
        const top = Math.min(props.y, props.base);
        const barWidth = Math.max(0, props.width);
        const barHeight = Math.max(0, Math.abs(props.base - props.y));
        if (!barWidth || !barHeight) return;
        let label = opts.formatter ? opts.formatter(value, dataset, index) : String(value);
        let labelSize = Math.min(baseFontSize, barHeight - verticalPadding * 2);
        const maxTextWidth = Math.max(0, barWidth - horizontalPadding * 2);
        while (labelSize >= minFontSize) {
          ctx.font = `700 ${labelSize}px "Segoe UI", Arial, sans-serif`;
          if (ctx.measureText(label).width <= maxTextWidth) break;
          labelSize -= 0.5;
        }
        if (labelSize < minFontSize && opts.compactFormatter) {
          label = opts.compactFormatter(value, dataset, index);
          labelSize = Math.max(6, Math.min(minFontSize, barHeight - verticalPadding * 2));
          while (labelSize >= 6) {
            ctx.font = `700 ${labelSize}px "Segoe UI", Arial, sans-serif`;
            if (ctx.measureText(label).width <= maxTextWidth) break;
            labelSize -= 0.5;
          }
        }
        if (labelSize < 6 || ctx.measureText(label).width > maxTextWidth) return;
        const textColor = typeof opts.textColor === "function"
          ? opts.textColor(value, dataset, index, bar, datasetIndex)
          : opts.textColor;
        ctx.fillStyle = textColor || "#ffffff";
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, top, barWidth, barHeight);
        ctx.clip();
        ctx.fillText(label, props.x, top + barHeight / 2);
        ctx.restore();
      });
    });
    ctx.restore();
  },
};
Chart.register(valueLabelsPlugin);

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

function holeChartLabel(row) {
  return `${row.plano} · ${row.id}`;
}

/* --- 1. Ângulo frontal por furo --- */
function drawAngle(data) {
  destroy("angle");
  const points = data.filter((r) => r.angle != null).map((r, index) => ({ x: index + 1, y: r.angle, plano: r.plano, id: r.id, label: holeChartLabel(r) }));
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
            label: (c) => `${c.raw.label}: ${fmtNum(c.raw.y, 2)}°`,
          },
        },
        limitLines: { yLines: [LIMITS.angleMin, LIMITS.angleMax], color: C.red, dash: [5, 4] },
      },
      scales: baseScales({ xTitle: "Ordem dos furos filtrados", yTitle: "Ângulo frontal [°]", yMin: 0, yMax: 30 }),
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
  const labels = pts.map(holeChartLabel);
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
            title: (t) => holeChartLabel(pts[t[0].dataIndex]),
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
  const labels = pts.map(holeChartLabel);
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
            title: (t) => holeChartLabel(pts[t[0].dataIndex]),
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
function drawByPlan(data) {
  destroy("byPlan");
  const groups = {};
  (data || RECORDS).forEach((r) => {
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
        valueLabels: {
          display: true,
          formatter: (value) => fmtPct(value),
          compactFormatter: (value) => `${Math.round(value)}%`,
          minFontSize: 7,
          textColor: (_value, _dataset, _index, _bar, datasetIndex) => datasetIndex === 2 ? C.ink : "#ffffff",
        },
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
    const ext = Math.max(Math.max(...values.map((v) => Math.abs(v))), 0.1) * 1.05;
    min = -ext; max = ext;
  } else {
    min = Math.min(...values); max = Math.max(...values);
  }
  // Evita divisão por zero quando o filtro retorna valores constantes
  // (por exemplo, todos os desvios iguais a zero).
  if (!(max > min)) {
    const center = Number.isFinite(min) ? min : 0;
    const margin = Math.max(Math.abs(center) * 0.05, 0.5);
    min = center - margin;
    max = center + margin;
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
        valueLabels: { display: true, formatter: (value) => fmtInt(value), minFontSize: 7 },
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
  btn.onclick = () => exportToXlsx(btn);
}

/* Identidade visual ENAEX usada nas planilhas exportadas. */
const EXCEL_THEME = {
  red: "FFE20613",
  dark: "FF38424B",
  muted: "FF6C747B",
  pale: "FFF3F5F6",
  border: "FFD9DEE2",
  white: "FFFFFFFF",
  okFill: "FFEAF5EA",
  alertFill: "FFFDEBEC",
};

function excelSolidFill(argb) {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function styleExcelHeaderRow(row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: EXCEL_THEME.white } };
    cell.fill = excelSolidFill(EXCEL_THEME.dark);
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: EXCEL_THEME.border } },
      bottom: { style: "thin", color: { argb: EXCEL_THEME.border } },
    };
  });
}

function styleExcelSectionRow(row, totalColumns) {
  row.height = 22;
  for (let column = 1; column <= totalColumns; column += 1) {
    const cell = row.getCell(column);
    cell.fill = excelSolidFill(EXCEL_THEME.red);
    cell.font = { bold: true, color: { argb: EXCEL_THEME.white } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
  }
}

function styleExcelDataRows(sheet, firstRow, lastRow, totalColumns) {
  for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.alignment = { vertical: "middle", wrapText: column === 1 };
      cell.border = {
        bottom: { style: "hair", color: { argb: EXCEL_THEME.border } },
      };
      if (rowNumber % 2 === 0) cell.fill = excelSolidFill(EXCEL_THEME.pale);
    });
    for (let column = 1; column <= totalColumns; column += 1) {
      const cell = row.getCell(column);
      if (cell.value === "Sim") {
        cell.font = { bold: true, color: { argb: "FF107C10" } };
        cell.fill = excelSolidFill(EXCEL_THEME.okFill);
      } else if (cell.value === "Não") {
        cell.font = { bold: true, color: { argb: EXCEL_THEME.red } };
        cell.fill = excelSolidFill(EXCEL_THEME.alertFill);
      } else if (cell.value === "N/A") {
        cell.font = { italic: true, color: { argb: EXCEL_THEME.muted } };
      }
    }
  }
}

function styleExcelReportHeader(sheet, title, subtitle, totalColumns, workbook) {
  const columns = Math.max(totalColumns, 2);
  sheet.mergeCells(1, 2, 1, columns);
  sheet.mergeCells(2, 1, 2, columns);
  sheet.getCell(1, 2).value = title;
  sheet.getCell(2, 1).value = subtitle;
  for (let column = 1; column <= columns; column += 1) {
    const titleCell = sheet.getCell(1, column);
    titleCell.fill = excelSolidFill(EXCEL_THEME.red);
    titleCell.font = { bold: true, size: 16, color: { argb: EXCEL_THEME.white } };
    titleCell.alignment = { vertical: "middle", horizontal: column === 1 ? "center" : "left" };
    const subtitleCell = sheet.getCell(2, column);
    subtitleCell.fill = excelSolidFill(EXCEL_THEME.dark);
    subtitleCell.font = { italic: true, color: { argb: EXCEL_THEME.white } };
    subtitleCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  }
  sheet.getRow(1).height = 32;
  sheet.getRow(2).height = 24;
  sheet.getColumn(1).width = Math.max(sheet.getColumn(1).width || 10, 14);

  // O logo branco já faz parte do pacote estático e é opcional para não
  // impedir a exportação quando a página estiver offline/local.
  if (workbook.__enaexLogoId != null) {
    sheet.addImage(workbook.__enaexLogoId, {
      tl: { col: 0.15, row: 0.18 },
      ext: { width: 56, height: 22 },
    });
  }
  sheet.views = [{ state: "frozen", ySplit: 4 }];
}

async function loadExcelBrandLogo(workbook) {
  if (workbook.__enaexLogoId !== undefined) return workbook.__enaexLogoId;
  workbook.__enaexLogoId = null;
  try {
    const response = await fetch("./assets/enaex-logo-white.png", { cache: "force-cache" });
    if (!response.ok) return null;
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    workbook.__enaexLogoId = workbook.addImage({ base64: dataUrl, extension: "png" });
  } catch (error) {
    console.warn("Logo ENAEX não disponível para a planilha; seguindo sem a imagem.", error);
  }
  return workbook.__enaexLogoId;
}

function chartCanvasDataUrl(chartKey) {
  const chart = CHARTS[chartKey];
  if (!chart?.canvas || typeof chart.canvas.toDataURL !== "function") return null;
  try {
    return chart.canvas.toDataURL("image/png", 1);
  } catch (error) {
    console.warn(`Não foi possível capturar o gráfico ${chartKey} para o Excel.`, error);
    return null;
  }
}

function addExcelChartSheet(workbook, definition, data, filterLabel, logoId) {
  const sheet = workbook.addWorksheet(definition.sheetName);
  const columns = definition.headers.length;
  styleExcelReportHeader(
    sheet,
    definition.title,
    `Período/seleção atual · ${data.length} furo(s) · ${filterLabel}`,
    Math.max(columns, 6),
    workbook,
  );

  const imageData = chartCanvasDataUrl(definition.chartKey);
  if (imageData) {
    const imageId = workbook.addImage({ base64: imageData, extension: "png" });
    sheet.addImage(imageId, {
      tl: { col: 0, row: 3 },
      ext: { width: 920, height: 380 },
    });
  } else {
    sheet.getCell(4, 1).value = "Imagem do gráfico indisponível; os dados abaixo permanecem disponíveis para conferência.";
    sheet.getCell(4, 1).font = { italic: true, color: { argb: EXCEL_THEME.muted } };
  }

  const sectionRow = 30;
  sheet.mergeCells(sectionRow, 1, sectionRow, columns);
  sheet.getCell(sectionRow, 1).value = "Dados utilizados no gráfico";
  styleExcelSectionRow(sheet.getRow(sectionRow), columns);
  const headerRow = sectionRow + 1;
  sheet.getRow(headerRow).values = definition.headers;
  styleExcelHeaderRow(sheet.getRow(headerRow));
  const firstDataRow = headerRow + 1;
  data.forEach((row) => sheet.addRow(row));
  const lastDataRow = firstDataRow + Math.max(data.length - 1, 0);
  styleExcelDataRows(sheet, firstDataRow, lastDataRow, columns);
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: lastDataRow, column: columns },
  };
  definition.widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.getColumn(1).width = Math.max(sheet.getColumn(1).width || 12, 14);
  return sheet;
}

function buildExcelChartDefinitions(data) {
  const withinAngle = (value) => value != null && value >= LIMITS.angleMin && value <= LIMITS.angleMax;
  const withinAz = (value) => value != null && Math.abs(value) <= LIMITS.azimuth;
  const withinZ = (value) => value != null && Math.abs(value) <= LIMITS.depth;
  const dateValue = (value) => value instanceof Date && !isNaN(value) ? value : null;
  const groups = {};
  data.forEach((row) => (groups[row.plano] ||= []).push(row));
  const planos = Object.keys(groups).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));

  const histogramRows = (values, bins, min, max, digits) =>
    histogramBuckets(values, bins, min, max, digits).map(([faixa, quantidade]) => [faixa, quantidade]);
  const azValues = data.map((row) => row.azDelta).filter((value) => value != null);
  const zValues = data.map((row) => row.depthDelta).filter((value) => value != null);
  const angleValues = data.map((row) => row.angle).filter((value) => value != null);
  const azExtent = Math.max(...azValues.map((value) => Math.abs(value)), 1) * 1.05;
  const zExtent = Math.max(...zValues.map((value) => Math.abs(value)), 0.1) * 1.05;

  return [
    {
      chartKey: "angle", sheetName: "Gráfico Ângulo", title: "Ângulo frontal por furo",
      headers: ["Plano", "ID", "Data", "Ângulo frontal (°)", "Dentro do limite"],
      widths: [18, 10, 14, 20, 20],
      rows: data.filter((row) => row.angle != null).map((row) => [row.plano, row.id, dateValue(row.data), row.angle, withinAngle(row.angle) ? "Sim" : "Não"]),
    },
    {
      chartKey: "direction", sheetName: "Gráfico Direção", title: "Direção dos furos · Δ Azimute × Δ Profundidade",
      headers: ["Plano", "ID", "Data", "Δ Azimute (°)", "Δ Profundidade (m)", "Dentro da caixa"],
      widths: [18, 10, 14, 18, 23, 18],
      rows: data.filter((row) => row.azDelta != null && row.depthDelta != null).map((row) => [row.plano, row.id, dateValue(row.data), row.azDelta, row.depthDelta, withinAz(row.azDelta) && withinZ(row.depthDelta) ? "Sim" : "Não"]),
    },
    {
      chartKey: "az", sheetName: "Gráfico Δ Azimute", title: "Δ Azimute por furo",
      headers: ["Plano", "ID", "Data", "Δ Azimute (°)", "Dentro do limite"],
      widths: [18, 10, 14, 18, 20],
      rows: data.filter((row) => row.azDelta != null).map((row) => [row.plano, row.id, dateValue(row.data), row.azDelta, withinAz(row.azDelta) ? "Sim" : "Não"]),
    },
    {
      chartKey: "depth", sheetName: "Gráfico Δ Profundidade", title: "Δ Profundidade por furo",
      headers: ["Plano", "ID", "Data", "Δ Profundidade (m)", "Dentro do limite"],
      widths: [18, 10, 14, 23, 20],
      rows: data.filter((row) => row.depthDelta != null).map((row) => [row.plano, row.id, dateValue(row.data), row.depthDelta, withinZ(row.depthDelta) ? "Sim" : "Não"]),
    },
    {
      chartKey: "byPlan", sheetName: "Gráfico por Plano", title: "Aderência por plano",
      headers: ["Plano", "Furos", "Aderência Ângulo (%)", "Aderência Azimute (%)", "Aderência Z (%)"],
      widths: [22, 12, 23, 25, 20],
      rows: planos.map((plano) => {
        const metrics = computeMetrics(groups[plano]);
        return [plano, metrics.total, isFinite(metrics.anglePct) ? metrics.anglePct : null, isFinite(metrics.azPct) ? metrics.azPct : null, isFinite(metrics.zPct) ? metrics.zPct : null];
      }),
    },
    {
      chartKey: "chart-hist-az", sheetName: "Histograma Δ Azimute", title: "Distribuição do Δ Azimute",
      headers: ["Faixa Δ Azimute (°)", "Nº de furos"], widths: [24, 16],
      rows: histogramRows(azValues, 20, -azExtent, azExtent, 1),
    },
    {
      chartKey: "chart-hist-depth", sheetName: "Histograma Δ Prof", title: "Distribuição do Δ Profundidade",
      headers: ["Faixa Δ Profundidade (m)", "Nº de furos"], widths: [28, 16],
      rows: histogramRows(zValues, 20, -zExtent, zExtent, 2),
    },
    {
      chartKey: "chart-hist-angle", sheetName: "Histograma Ângulo", title: "Distribuição do ângulo frontal",
      headers: ["Faixa Ângulo (°)", "Nº de furos"], widths: [20, 16],
      rows: histogramRows(angleValues, 18, 0, 30, 1),
    },
  ];
}

async function exportToXlsx(btn = document.getElementById("export-xlsx")) {
  const originalLabel = btn?.textContent || "⤓ Excel";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Gerando Excel…";
  }
  try {
  if (typeof ExcelJS === "undefined" || typeof JSZip === "undefined") {
    throw new Error("As bibliotecas de exportação ainda não terminaram de carregar. Atualize a página e tente novamente.");
  }
  const data = filtered();
  if (!data.length) {
    throw new Error("Nenhum furo no filtro atual para exportar.");
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dataStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  const selectedYear = document.getElementById("filter-year")?.value || "Todos";
  const selectedMonth = document.getElementById("filter-month")?.value || "Todos";
  const ano = selectedYear === "Todos" ? "Todos" : selectedYear;
  const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
  const selectedMonthLabel = selectedMonth === "Todos"
    ? "Todos"
    : (meses[Number(selectedMonth) - 1] || selectedMonth);

  const withinAngle = (v) => v != null && v >= LIMITS.angleMin && v <= LIMITS.angleMax;
  const withinAz = (v) => v != null && Math.abs(v) <= LIMITS.azimuth;
  const withinZ = (v) => v != null && Math.abs(v) <= LIMITS.depth;

  const fmtDate = (d) => (d instanceof Date && !isNaN(d))
    ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
    : "";
  const rows = data.map((r) => ({
    "Ano": r.ano ?? "",
    "Mês": r.mes ?? "",
    "Data": fmtDate(r.data),
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

  // Aba de resumo com métricas
  const m = computeMetrics(data);
  const excelWb = new ExcelJS.Workbook();
  excelWb.creator = "ENAEX · Análise de Desvios";
  excelWb.created = now;
  await loadExcelBrandLogo(excelWb);

  const filterLabel = getActiveFilterLabel();
  const dataHeaders = Object.keys(rows[0]);
  const dataSheet = excelWb.addWorksheet("Desvios");
  styleExcelReportHeader(
    dataSheet,
    "Base calculada · Desvios de perfuração",
    `Período/seleção atual · ${data.length} furo(s) · ${filterLabel}`,
    dataHeaders.length,
    excelWb,
  );
  dataSheet.mergeCells(4, 1, 4, dataHeaders.length);
  dataSheet.getCell(4, 1).value = "Base completa dos furos filtrados";
  styleExcelSectionRow(dataSheet.getRow(4), dataHeaders.length);
  dataSheet.getRow(5).values = dataHeaders;
  styleExcelHeaderRow(dataSheet.getRow(5));
  rows.forEach((row) => dataSheet.addRow(dataHeaders.map((header) => row[header])));
  styleExcelDataRows(dataSheet, 6, 5 + rows.length, dataHeaders.length);
  dataSheet.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: 5 + rows.length, column: dataHeaders.length },
  };
  dataHeaders.forEach((header, index) => {
    dataSheet.getColumn(index + 1).width = Math.max(14, Math.min(28, header.length + 3));
  });
  dataSheet.views = [{ state: "frozen", ySplit: 5 }];

  const summarySheet = excelWb.addWorksheet("Resumo");
  styleExcelReportHeader(
    summarySheet,
    "Relatório de Desvios de Perfuração",
    `ENAEX · gerado em ${dataStr} · ${filterLabel}`,
    4,
    excelWb,
  );
  summarySheet.mergeCells(4, 1, 4, 4);
  summarySheet.getCell(4, 1).value = "Identificação e seleção exportada";
  styleExcelSectionRow(summarySheet.getRow(4), 4);
  summarySheet.addRows([
    ["Gerado em", dataStr],
    ["Ano selecionado", ano],
    ["Mês selecionado", selectedMonthLabel],
    ["Filtro aplicado", filterLabel],
  ]);
  summarySheet.mergeCells(9, 1, 9, 4);
  summarySheet.getCell(9, 1).value = "Indicadores de aderência";
  styleExcelSectionRow(summarySheet.getRow(9), 4);
  summarySheet.addRows([
    ["Furos analisados", m.total],
    ["Aderência Ângulo (%)", isFinite(m.anglePct) ? +m.anglePct.toFixed(2) : null],
    ["Aderência Azimute (%)", isFinite(m.azPct) ? +m.azPct.toFixed(2) : null],
    ["Aderência Z (%)", isFinite(m.zPct) ? +m.zPct.toFixed(2) : null],
    ["Meta (%)", LIMITS.meta],
  ]);
  summarySheet.mergeCells(15, 1, 15, 4);
  summarySheet.getCell(15, 1).value = "Parâmetros de controle";
  styleExcelSectionRow(summarySheet.getRow(15), 4);
  summarySheet.addRows([
    ["Ângulo mínimo (°)", LIMITS.angleMin],
    ["Ângulo máximo (°)", LIMITS.angleMax],
    ["Limite de azimute (°)", LIMITS.azimuth],
    ["Limite de profundidade (m)", LIMITS.depth],
  ]);
  styleExcelDataRows(summarySheet, 5, 8, 2);
  styleExcelDataRows(summarySheet, 10, 14, 2);
  styleExcelDataRows(summarySheet, 16, 19, 2);
  summarySheet.getColumn(1).width = 32;
  summarySheet.getColumn(2).width = 24;
  summarySheet.getColumn(3).width = 18;
  summarySheet.getColumn(4).width = 18;
  summarySheet.views = [{ state: "frozen", ySplit: 4 }];

  const chartsSheet = excelWb.addWorksheet("Gráficos");
  styleExcelReportHeader(
    chartsSheet,
    "Gráficos do período selecionado",
    `Os oito gráficos analíticos usam o mesmo filtro da tela · ${filterLabel}`,
    10,
    excelWb,
  );
  chartsSheet.getColumn(1).width = 24;
  const chartDataSheet = excelWb.addWorksheet("Dados gráficos");
  chartDataSheet.state = "hidden";
  const chartRefs = writeExcelChartData(chartDataSheet, data);
  buildExcelChartDefinitions(data).forEach((definition) => {
    addExcelChartSheet(excelWb, definition, definition.rows, filterLabel, excelWb.__enaexLogoId);
  });
  const buffer = await excelWb.xlsx.writeBuffer();
  const nativeBuffer = await addNativeExcelChartsV2(buffer, chartRefs, chartsSheet.id);
  const blob = new Blob([nativeBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `desvios-perfuracao_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  if (btn) btn.textContent = `Excel pronto · ${data.length} furos`;
  setTimeout(() => { if (btn) btn.textContent = originalLabel; }, 3500);
  } catch (error) {
    console.error("Falha ao exportar Excel", error);
    alert(`Não foi possível gerar o Excel com os gráficos. ${error.message || "Tente novamente."}`);
    if (btn) btn.textContent = originalLabel;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function addNativeExcelCharts(buffer, lastRow) {
  const zip = await JSZip.loadAsync(buffer);
  const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const cns = "http://schemas.openxmlformats.org/drawingml/2006/chart";
  const defs = [
    ["Ângulo frontal por furo", "line", "E", "F", "FF2E86AB"],
    ["Δ Azimute por furo", "line", "E", "I", "FFB5651D"],
    ["Δ Profundidade por furo", "line", "E", "L", "FF6A994E"],
    ["Direção / aderência", "scatter", "I", "L", "FF7B2CBF"],
    ["Aderência por plano", "bar", "E", "F", "FF264653"],
    ["Distribuição do azimute", "bar", "E", "I", "FFE76F51"],
    ["Distribuição da profundidade", "bar", "E", "L", "FF2A9D8F"],
    ["Distribuição do ângulo", "bar", "E", "F", "FFE9C46A"],
  ];
  const chartXml = (title, type, catCol, valCol, color, idx) => {
    const series = type === "scatter"
      ? `<c:xVal><c:numRef><c:f>'Desvios'!$${catCol}$2:$${catCol}$${lastRow}</c:f></c:numRef></c:xVal><c:yVal><c:numRef><c:f>'Desvios'!$${valCol}$2:$${valCol}$${lastRow}</c:f></c:numRef></c:yVal>`
      : `<c:cat><c:strRef><c:f>'Desvios'!$${catCol}$2:$${catCol}$${lastRow}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>'Desvios'!$${valCol}$2:$${valCol}$${lastRow}</c:f></c:numRef></c:val>`;
    const kind = type === "line" ? "lineChart" : type === "scatter" ? "scatterChart" : "barChart";
    const plot = type === "scatter" ? `<c:scatterStyle val="lineMarker"/>` : type === "bar" ? `<c:barDir val="col"/><c:grouping val="clustered"/>` : `<c:grouping val="standard"/>`;
    const axisIds = `<c:axId val="10"/><c:axId val="11"/>`;
    const axisDefinitions = type === "scatter"
      ? `<c:valAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/></c:valAx><c:valAx><c:axId val="11"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/></c:valAx>`
      : `<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/></c:catAx><c:valAx><c:axId val="11"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/></c:valAx>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${cns}" xmlns:a="${ns}"><c:chart><c:autoTitleDeleted val="0"/><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="pt-BR" sz="1400"/><a:t>${title}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/><c:${kind}>${plot}<c:varyColors val="0"/><c:ser><c:idx val="${idx}"/><c:order val="${idx}"/><c:tx><c:v>${title}</c:v></c:tx>${series}<c:spPr><a:solidFill><a:srgbClr val="${color.slice(2)}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${color.slice(2)}"/></a:solidFill></a:ln></c:spPr></c:ser>${axisIds}</c:${kind}>${axisDefinitions}</c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
  };
  const anchors = defs.map((d, i) => `<xdr:twoCellAnchor><xdr:from><xdr:col>${(i % 2) * 9}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${Math.floor(i / 2) * 18 + 3}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${(i % 2) * 9 + 8}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${Math.floor(i / 2) * 18 + 17}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Gráfico ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="${cns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`).join("");
  zip.file("xl/drawings/drawing1.xml", `<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${ns}">${anchors}</xdr:wsDr>`);
  zip.file("xl/drawings/_rels/drawing1.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${defs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${i + 1}.xml"/>`).join("")}</Relationships>`);
  defs.forEach((d, i) => zip.file(`xl/charts/chart${i + 1}.xml`, chartXml(...d, i)));
  zip.file("xl/worksheets/_rels/sheet3.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  let sheet = await zip.file("xl/worksheets/sheet3.xml").async("string");
  sheet = sheet.replace("</worksheet>", `<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></worksheet>`);
  zip.file("xl/worksheets/sheet3.xml", sheet);
  let types = await zip.file("[Content_Types].xml").async("string");
  types = types.replace("</Types>", defs.map((_, i) => `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join("") + `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  zip.file("[Content_Types].xml", types);
  return zip.generateAsync({ type: "arraybuffer" });
}

function histogramBuckets(values, bins, min, max, digits) {
  if (!values.length) return [];
  const observedMin = Math.min(...values);
  const observedMax = Math.max(...values);
  if (min == null) min = observedMin;
  if (max == null) max = observedMax;
  if (min === max) { min -= 0.5; max += 0.5; }
  const step = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  values.forEach((value) => {
    let index = Math.floor((value - min) / step);
    if (index < 0) index = 0;
    if (index >= bins) index = bins - 1;
    counts[index] += 1;
  });
  return counts.map((count, index) => [fmtNum(min + step * (index + 0.5), digits), count]);
}

function writeExcelChartData(sheet, data) {
  sheet.getRow(1).values = ["Plano", "ID", "Ângulo frontal (°)", "Δ Azimute (°)", "Δ Profundidade (m)"];
  data.forEach((r) => sheet.addRow([r.plano, r.id, r.angle, r.azDelta, r.depthDelta]));
  const holeStart = 2;
  const holeEnd = data.length + 1;
  const planStart = holeEnd + 3;
  sheet.getRow(planStart - 1).values = [null, null, null, null, null, null, "Plano", "Aderência Ângulo (%)", "Aderência Azimute (%)", "Aderência Z (%)"];
  const groups = {};
  data.forEach((r) => (groups[r.plano] ||= []).push(r));
  const planos = Object.keys(groups).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  const finiteOrNull = (value) => isFinite(value) ? value : null;
  planos.forEach((plano, index) => {
    const m = computeMetrics(groups[plano]);
    sheet.getRow(planStart + index).values = [null, null, null, null, null, null, plano, finiteOrNull(m.anglePct), finiteOrNull(m.azPct), finiteOrNull(m.zPct)];
  });
  const planEnd = planStart + Math.max(planos.length - 1, 0);
  const azValues = data.map((r) => r.azDelta).filter((v) => v != null);
  const zValues = data.map((r) => r.depthDelta).filter((v) => v != null);
  const angleValues = data.map((r) => r.angle).filter((v) => v != null);
  const azExtent = Math.max(...azValues.map((v) => Math.abs(v)), 1) * 1.05;
  const zExtent = Math.max(...zValues.map((v) => Math.abs(v)), 0.1) * 1.05;
  const azHist = histogramBuckets(azValues, 20, -azExtent, azExtent, 1);
  const zHist = histogramBuckets(zValues, 20, -zExtent, zExtent, 2);
  const angleHist = histogramBuckets(angleValues, 18, 0, 30, 1);
  const histStart = planEnd + 3;
  sheet.getRow(histStart - 1).values = [null, null, null, null, null, null, null, null, null, null, null, "Faixa Δ Azimute", "Nº de furos", null, "Faixa Δ Profundidade", "Nº de furos", null, "Faixa Ângulo", "Nº de furos"];
  const maxHistRows = Math.max(azHist.length, zHist.length, angleHist.length);
  for (let i = 0; i < maxHistRows; i++) {
    sheet.getRow(histStart + i).values = [null, null, null, null, null, null, null, null, null, null, null, azHist[i]?.[0] ?? null, azHist[i]?.[1] ?? null, null, zHist[i]?.[0] ?? null, zHist[i]?.[1] ?? null, null, angleHist[i]?.[0] ?? null, angleHist[i]?.[1] ?? null];
  }
  const histEnd = histStart + Math.max(maxHistRows - 1, 0);
  return { holeStart, holeEnd, planStart, planEnd, histStart, histEnd };
}

async function addNativeExcelChartsV2(buffer, refs, chartSheetId = 3) {
  const zip = await JSZip.loadAsync(buffer);
  const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const cns = "http://schemas.openxmlformats.org/drawingml/2006/chart";
  const dataSheet = "Dados gráficos";
  const xmlEscape = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const ref = (column, start, end) => `'${dataSheet}'!$${column}$${start}:$${column}$${end}`;
  const defs = [
    { title: "Ângulo frontal por furo", type: "line", cat: ["B", refs.holeStart, refs.holeEnd], series: [["Ângulo executado", "C", refs.holeStart, refs.holeEnd]], color: "FF2E86AB" },
    { title: "Δ Azimute por furo", type: "line", cat: ["B", refs.holeStart, refs.holeEnd], series: [["Δ Azimute", "D", refs.holeStart, refs.holeEnd]], color: "FFB5651D" },
    { title: "Δ Profundidade por furo", type: "line", cat: ["B", refs.holeStart, refs.holeEnd], series: [["Δ Profundidade", "E", refs.holeStart, refs.holeEnd]], color: "FF6A994E" },
    { title: "Direção / aderência", type: "scatter", x: ["D", refs.holeStart, refs.holeEnd], series: [["Furos", "E", refs.holeStart, refs.holeEnd]], color: "FF7B2CBF" },
    { title: "Aderência por plano", type: "bar", cat: ["G", refs.planStart, refs.planEnd], series: [["Ângulo", "H", refs.planStart, refs.planEnd], ["Azimute", "I", refs.planStart, refs.planEnd], ["Profundidade (Z)", "J", refs.planStart, refs.planEnd]], color: "FF264653" },
    { title: "Distribuição do azimute", type: "bar", cat: ["L", refs.histStart, refs.histEnd], series: [["Nº de furos", "M", refs.histStart, refs.histEnd]], color: "FFE76F51" },
    { title: "Distribuição da profundidade", type: "bar", cat: ["O", refs.histStart, refs.histEnd], series: [["Nº de furos", "P", refs.histStart, refs.histEnd]], color: "FF2A9D8F" },
    { title: "Distribuição do ângulo", type: "bar", cat: ["R", refs.histStart, refs.histEnd], series: [["Nº de furos", "S", refs.histStart, refs.histEnd]], color: "FFE9C46A" },
  ];
  const chartXml = (def) => {
    const kind = def.type === "line" ? "lineChart" : def.type === "scatter" ? "scatterChart" : "barChart";
    const plot = def.type === "scatter" ? `<c:scatterStyle val="lineMarker"/>` : def.type === "bar" ? `<c:barDir val="col"/><c:grouping val="clustered"/>` : `<c:grouping val="standard"/>`;
    const series = def.series.map(([name, valueColumn, start, end], index) => {
      const dataRef = ref(valueColumn, start, end);
      const dimensions = def.type === "scatter"
        ? `<c:xVal><c:numRef><c:f>${ref(def.x[0], def.x[1], def.x[2])}</c:f></c:numRef></c:xVal><c:yVal><c:numRef><c:f>${dataRef}</c:f></c:numRef></c:yVal>`
        : `<c:cat><c:strRef><c:f>${ref(def.cat[0], def.cat[1], def.cat[2])}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${dataRef}</c:f></c:numRef></c:val>`;
      return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${xmlEscape(name)}</c:v></c:tx>${dimensions}<c:spPr><a:solidFill><a:srgbClr val="${def.color.slice(2)}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${def.color.slice(2)}"/></a:solidFill></a:ln></c:spPr></c:ser>`;
    }).join("");
    const axes = `<c:axId val="10"/><c:axId val="11"/>`;
    const axisDefinitions = def.type === "scatter"
      ? `<c:valAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/></c:valAx><c:valAx><c:axId val="11"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/></c:valAx>`
      : `<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/></c:catAx><c:valAx><c:axId val="11"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/></c:valAx>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${cns}" xmlns:a="${ns}"><c:chart><c:autoTitleDeleted val="0"/><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="pt-BR" sz="1400"/><a:t>${xmlEscape(def.title)}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/><c:${kind}>${plot}<c:varyColors val="0"/>${series}${axes}</c:${kind}>${axisDefinitions}</c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
  };
  const anchors = defs.map((_, i) => `<xdr:twoCellAnchor><xdr:from><xdr:col>${(i % 2) * 9}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${Math.floor(i / 2) * 18 + 4}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${(i % 2) * 9 + 8}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${Math.floor(i / 2) * 18 + 18}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Gráfico ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="${cns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`).join("");
  zip.file("xl/drawings/drawing1.xml", `<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${ns}">${anchors}</xdr:wsDr>`);
  zip.file("xl/drawings/_rels/drawing1.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${defs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${i + 1}.xml"/>`).join("")}</Relationships>`);
  defs.forEach((def, i) => zip.file(`xl/charts/chart${i + 1}.xml`, chartXml(def)));
  zip.file(`xl/worksheets/_rels/sheet${chartSheetId}.xml.rels`, `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  let sheet = await zip.file(`xl/worksheets/sheet${chartSheetId}.xml`).async("string");
  sheet = sheet.replace("</worksheet>", `<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></worksheet>`);
  zip.file(`xl/worksheets/sheet${chartSheetId}.xml`, sheet);
  let types = await zip.file("[Content_Types].xml").async("string");
  types = types.replace("</Types>", defs.map((_, i) => `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join("") + `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  zip.file("[Content_Types].xml", types);
  return zip.generateAsync({ type: "arraybuffer" });
}

function getActiveFilterLabel() {
  return FILTER_DEFS.map((def) => {
    const value = document.getElementById(def.id)?.value;
    return value ? `${def.label}: ${def.name ? def.name(value) : value}` : null;
  }).filter(Boolean).join(" · ") || "Todos os registros";
}

/* ===================== Mapa de execução (DXF) ===================== */
/* A planilha fornece os dados dos furos; a geometria do mapa vem de um DXF
   versionado em ./data/<PLANO>.dxf. O manifesto evita 404 para planos que
   chegaram à planilha antes de o respectivo desenho ser disponibilizado. */

const DXF_CACHE = new Map();   // plano -> Promise<holes | null>
const DXF_MISS = new Set();    // planos sem DXF (evita re-tentar)
let DXF_MANIFEST_PROMISE = null;

async function loadDxfManifest() {
  if (!DXF_MANIFEST_PROMISE) {
    DXF_MANIFEST_PROMISE = fetch("./data/dxf-manifest.json", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : null)
      .then((items) => Array.isArray(items) ? new Set(items.map(String)) : null)
      .catch(() => null);
  }
  return DXF_MANIFEST_PROMISE;
}

async function fetchDxfHoles(plano) {
  if (DXF_MISS.has(plano)) return null;
  if (DXF_CACHE.has(plano)) return DXF_CACHE.get(plano);
  const promise = (async () => {
    try {
      const manifest = await loadDxfManifest();
      if (manifest && !manifest.has(plano)) {
        DXF_MISS.add(plano);
        return null;
      }
      const res = await fetch(`./data/${encodeURIComponent(plano)}.dxf`, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const txt = await res.text();
      return parseDxfHoles(txt);
    } catch (e) {
      DXF_MISS.add(plano);
      return null;
    }
  })();
  DXF_CACHE.set(plano, promise);
  return promise;
}

/* Parser DXF minimalista.
   Cada furo é composto por:
     POINT   layer "Hole"            -> emboque
     LINE    layer "Theoretical Hole"-> reta planejada
     POLYLINE layer "Real Hole"      -> polilinha executada
   Camadas com iniciais diferentes (ex. "hole" minúsculo) são tratadas por norm(). */
function parseDxfHoles(text) {
  const lines = text.replace(/\r/g, "").split("\n").map((s) => s.trim());
  const pairs = [];
  for (let i = 0; i < lines.length - 1; i += 2) pairs.push([lines[i], lines[i + 1]]);

  const entities = [];
  let inEntities = false, i = 0;
  while (i < pairs.length) {
    const [code, value] = pairs[i];
    if (code === "2" && value === "ENTITIES") { inEntities = true; i++; continue; }
    if (!inEntities) { i++; continue; }
    if (code === "0" && value === "ENDSEC") break;
    if (code === "0") {
      const entity = { type: value, raw: [] };
      i++;
      while (i < pairs.length && pairs[i][0] !== "0") { entity.raw.push(pairs[i]); i++; }
      if (entity.type === "POLYLINE") {
        entity.verts = [];
        while (i < pairs.length) {
          const [nc, nv] = pairs[i];
          if (nc === "0" && nv === "VERTEX") {
            const vraw = [];
            i++;
            while (i < pairs.length && pairs[i][0] !== "0") { vraw.push(pairs[i]); i++; }
            entity.verts.push(vraw);
            continue;
          }
          if (nc === "0" && nv === "SEQEND") {
            i++;
            while (i < pairs.length && pairs[i][0] !== "0") i++;
            break;
          }
          break;
        }
      }
      entities.push(entity);
      continue;
    }
    i++;
  }

  const gf = (raw, code, fb = "") => {
    const found = raw.find(([c]) => c === String(code));
    return found ? found[1] : fb;
  };
  const gn = (raw, code, fb = NaN) => {
    const v = parseFloat(gf(raw, code, ""));
    return isFinite(v) ? v : fb;
  };
  const layerOf = (e) => norm(gf(e.raw, 8, ""));
  const pt = (raw) => ({ x: gn(raw, 10), y: gn(raw, 20) });

  const holes = [];
  let cur = null;
  const push = () => { if (cur && (cur.planned || cur.real)) holes.push(cur); cur = null; };
  for (const e of entities) {
    const layer = layerOf(e);
    if (e.type === "POINT" && layer === "HOLE") {
      push();
      cur = { collar: pt(e.raw) };
      continue;
    }
    if (!cur) cur = {};
    if (e.type === "LINE" && layer === "THEORETICAL HOLE") {
      cur.planned = [
        { x: gn(e.raw, 10), y: gn(e.raw, 20) },
        { x: gn(e.raw, 11), y: gn(e.raw, 21) },
      ];
    } else if (e.type === "TEXT" && layer === "NUMBER") {
      cur.id = gf(e.raw, 1, "").trim();
    } else if (e.type === "POLYLINE" && layer === "REAL HOLE") {
      cur.real = e.verts.map(pt).filter((p) => isFinite(p.x) && isFinite(p.y));
    }
  }
  push();

  return holes.filter((h) => (h.planned && h.planned.every((p) => isFinite(p.x) && isFinite(p.y))) ||
                             (h.real && h.real.length >= 2));
}

let MAP_TOKEN = 0;

function currentMapFilterKey() {
  return ["filter-year", "filter-month", "filter-plan"]
    .map((id) => document.getElementById(id)?.value || "")
    .join("|");
}

async function drawMap() {
  const svg = document.getElementById("chart-map");
  const status = document.getElementById("map-status");
  const subtitle = document.getElementById("map-subtitle");
  if (!svg) return;

  const selected = document.getElementById("filter-plan").value;
  const y = document.getElementById("filter-year").value;
  const mo = document.getElementById("filter-month").value;
  const planosSet = new Set(
    RECORDS
      .filter((r) =>
        (!y || String(r.ano) === y) &&
        (!mo || String(r.mes) === mo) &&
        (!selected || r.plano === selected))
      .map((r) => r.plano)
  );
  const planos = [...planosSet].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));

  const token = ++MAP_TOKEN;
  const filterKey = currentMapFilterKey();
  svg.innerHTML = "";
  status.classList.add("is-visible");
  status.textContent = "Carregando geometria dos planos…";

  if (!planos.length) {
    status.textContent = "Nenhum plano no filtro atual.";
    subtitle.textContent = "Planejado em cinza, executado em vermelho e emboques marcados.";
    return;
  }

  subtitle.textContent = selected
    ? `Plano ${selected} — planejado em cinza, executado em vermelho, emboques marcados.`
    : `${planos.length} plano(s) sobrepostos — planejado em cinza, executado em vermelho, emboques marcados.`;

  const results = await Promise.all(planos.map((p) => fetchDxfHoles(p).then((h) => ({ plano: p, holes: h }))));
  // Re-rendering can start several asynchronous DXF loads in sequence. A
  // previous request may finish later, but it must not replace a newer
  // selection. Compare the actual filter values instead of relying only on a
  // mutable counter, which can become stale across browser event turns.
  if (filterKey !== currentMapFilterKey()) return;

  const withGeom = results.filter((r) => r.holes && r.holes.length);
  const missing = results.filter((r) => !r.holes || !r.holes.length).map((r) => r.plano);

  if (!withGeom.length) {
    status.classList.add("is-visible");
    status.textContent = selected
      ? `Sem DXF disponível para ${selected}. Os furos da planilha seguem carregados nos indicadores e gráficos; o mapa precisa do desenho do plano.`
      : "Nenhum DXF disponível para os planos do filtro. Os furos da planilha seguem carregados nos indicadores e gráficos; o mapa precisa do desenho do plano.";
    return;
  }
  status.classList.remove("is-visible");
  status.textContent = "";

  // Bounding box conjugado
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const pushPt = (p) => {
    if (!isFinite(p.x) || !isFinite(p.y)) return;
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  };
  const visibleIdsByPlan = new Map();
  planos.forEach((plano) => {
    visibleIdsByPlan.set(
      plano,
      new Set(RECORDS
        .filter((r) =>
          r.plano === plano &&
          (!y || String(r.ano) === y) &&
          (!mo || String(r.mes) === mo) &&
          (!selected || r.plano === selected))
        .map((r) => String(r.id))),
    );
  });

  withGeom.forEach(({ plano, holes }) => holes
    .filter((h) => !h.id || visibleIdsByPlan.get(plano)?.has(String(Number(h.id))) || visibleIdsByPlan.get(plano)?.has(String(h.id)))
    .forEach((h) => {
    if (h.collar) pushPt(h.collar);
    if (h.planned) h.planned.forEach(pushPt);
    if (h.real) h.real.forEach(pushPt);
  }));
  if (!isFinite(minX) || !isFinite(maxY)) {
    status.classList.add("is-visible");
    status.textContent = "Geometria vazia para os DXFs encontrados.";
    return;
  }

  const width = 1200, height = 500, pad = 32;
  const rangeX = Math.max(maxX - minX, 1);
  const rangeY = Math.max(maxY - minY, 1);
  const scale = Math.min((width - pad * 2) / rangeX, (height - pad * 2) / rangeY);
  const drawnW = rangeX * scale;
  const drawnH = rangeY * scale;
  const offX = (width - drawnW) / 2 - minX * scale;
  const offY = (height - drawnH) / 2;
  const tx = (x) => offX + x * scale;
  const ty = (y) => height - (offY + (y - minY) * scale); // inverte Y (norte para cima)

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const NS = "http://www.w3.org/2000/svg";
  const frag = document.createDocumentFragment();

  // Grid discreto
  const grid = document.createElementNS(NS, "g");
  grid.setAttribute("class", "map-grid");
  const gridStep = niceStep(Math.max(rangeX, rangeY) / 10);
  for (let gx = Math.ceil(minX / gridStep) * gridStep; gx <= maxX; gx += gridStep) {
    const line = document.createElementNS(NS, "line");
    line.setAttribute("x1", tx(gx)); line.setAttribute("x2", tx(gx));
    line.setAttribute("y1", 0); line.setAttribute("y2", height);
    grid.appendChild(line);
  }
  for (let gy = Math.ceil(minY / gridStep) * gridStep; gy <= maxY; gy += gridStep) {
    const line = document.createElementNS(NS, "line");
    line.setAttribute("y1", ty(gy)); line.setAttribute("y2", ty(gy));
    line.setAttribute("x1", 0); line.setAttribute("x2", width);
    grid.appendChild(line);
  }
  frag.appendChild(grid);

  // Linhas planejadas
  const plannedG = document.createElementNS(NS, "g");
  plannedG.setAttribute("class", "map-line--planned");
  // Linhas executadas
  const realG = document.createElementNS(NS, "g");
  realG.setAttribute("class", "map-line--real");
  // Emboques
  const collarG = document.createElementNS(NS, "g");
  collarG.setAttribute("class", "map-collar");

  withGeom.forEach(({ plano, holes }) => {
    holes
      .filter((h) => !h.id || visibleIdsByPlan.get(plano)?.has(String(Number(h.id))) || visibleIdsByPlan.get(plano)?.has(String(h.id)))
      .forEach((h) => {
      if (h.planned && h.planned.length >= 2) {
        const [a, b] = h.planned;
        const line = document.createElementNS(NS, "line");
        line.setAttribute("x1", tx(a.x)); line.setAttribute("y1", ty(a.y));
        line.setAttribute("x2", tx(b.x)); line.setAttribute("y2", ty(b.y));
        plannedG.appendChild(line);
      }
      if (h.real && h.real.length >= 2) {
        const pts = h.real.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" ");
        const pl = document.createElementNS(NS, "polyline");
        pl.setAttribute("points", pts);
        realG.appendChild(pl);
      }
      const c = h.collar || (h.planned && h.planned[0]) || (h.real && h.real[0]);
      if (c && isFinite(c.x) && isFinite(c.y)) {
        const dot = document.createElementNS(NS, "circle");
        dot.setAttribute("cx", tx(c.x));
        dot.setAttribute("cy", ty(c.y));
        dot.setAttribute("r", selected ? 2.6 : 1.9);
        collarG.appendChild(dot);
      }
      });
  });

  frag.appendChild(plannedG);
  frag.appendChild(realG);
  frag.appendChild(collarG);
  svg.appendChild(frag);

  if (missing.length) {
    const note = missing.length > 4 ? `${missing.slice(0, 4).join(", ")}, +${missing.length - 4}` : missing.join(", ");
    subtitle.textContent += ` · Sem DXF: ${note}.`;
  }
}

function niceStep(raw) {
  if (!isFinite(raw) || raw <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / pow;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * pow;
}

/* ===================== Boot ===================== */
loadSheet().catch((e) => console.error(e));
