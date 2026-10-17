/* =====================================================================
   Relatório por plano: escolhe um plano e exporta todos os furos com
   desvio (ângulo, azimute ou profundidade fora do limite) em PDF ou PNG.
   Usa os mesmos limites de LIMITS, o mesmo filtro de Ano/Mês da página,
   o jsPDF carregado por loadJsPdf() e downloadPlantaBlob() (planta.js).
   O layout é montado uma vez em milímetros (A4 paisagem) e desenhado
   tanto no PDF (vetorial, com paginação) quanto no PNG (canvas único).
   ===================================================================== */

const RELATORIO_MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const RELATORIO_LOGO_URL = "./assets/enaex-logo-white.png";
const RELATORIO_BUSCA_MIN = 8;        // a partir deste número de planos aparece o campo de busca
const RELATORIO_PX_MM = 1400 / 297;   // resolução base do PNG (multiplicada por 2 para tela de alta densidade)
const RELATORIO_PX_MAX = 16000;       // altura máxima do canvas, em pixels

// Geometria e cores, em mm
const RL = {
  W: 297, H: 210, M: 12, LARGURA: 273,
  LINHA: 6, GRUPO_H: 6, SUB_H: 5.5,
  LIMITE: 193,      // última posição de linha antes do rodapé (PDF)
  RODAPE_Y: 199,
  PRETO: "#38424B", TEXTO2: "#4C555D", CINZA: "#6C747B",
  VERMELHO: "#E20613", VERM_CLARO: "#FDEBEC", ZEBRA: "#F3F5F6",
  REGRA: "#D9DEE2", REGRA_CLARA: "#E6E8EA", BRANCO: "#FFFFFF",
};

// Colunas da tabela. "grupo" agrupa o cabeçalho; "criterio" marca a célula em vermelho quando fora do limite.
const RL_COLUNAS = [
  { chave: "furo", titulo: "Furo", w: 15, align: "center" },
  { chave: "data", titulo: "Data", w: 22, align: "center" },
  { grupo: "Ângulo (°)", chave: "angPrev", titulo: "Previsto", w: 17, align: "right" },
  { grupo: "Ângulo (°)", chave: "angReal", titulo: "Real", w: 17, align: "right" },
  { grupo: "Ângulo (°)", chave: "angDesvio", titulo: "Desvio", w: 17, align: "right", criterio: "Ângulo" },
  { grupo: "Azimute (°)", chave: "azPrev", titulo: "Previsto", w: 18, align: "right" },
  { grupo: "Azimute (°)", chave: "azReal", titulo: "Real", w: 18, align: "right" },
  { grupo: "Azimute (°)", chave: "azDesvio", titulo: "Desvio", w: 18, align: "right", criterio: "Azimute" },
  { grupo: "Profundidade (m)", chave: "zPrev", titulo: "Previsto", w: 18, align: "right" },
  { grupo: "Profundidade (m)", chave: "zReal", titulo: "Real", w: 18, align: "right" },
  { grupo: "Profundidade (m)", chave: "zDesvio", titulo: "Desvio", w: 18, align: "right", criterio: "Profundidade" },
  { chave: "situacao", titulo: "Situação", w: 77, align: "left" },
];

const RELATORIO_ESTADO = { planos: [], plano: "", ocupado: false };
let RELATORIO_LOGO_PROMISE = null;
let RELATORIO_MEDIDOR = null;

const relatorioEl = (id) => document.getElementById(id);
const relBase = (meio, pt) => meio + pt * 0.3528 * 0.36; // linha de base para centralizar verticalmente

/* ---------- Dados ---------- */
function relatorioPeriodo() {
  const y = document.getElementById("filter-year")?.value || "";
  const mo = document.getElementById("filter-month")?.value || "";
  if (y && mo) return `${RELATORIO_MESES[+mo - 1]} de ${y}`;
  if (y) return y;
  if (mo) return `${RELATORIO_MESES[+mo - 1]} (todos os anos)`;
  return "Todos os períodos";
}

function relatorioRegistros(plano) {
  const y = document.getElementById("filter-year")?.value || "";
  const mo = document.getElementById("filter-month")?.value || "";
  return RECORDS
    .filter((r) => r.plano === plano &&
      (!y || String(r.ano) === y) &&
      (!mo || String(r.mes) === mo))
    .sort((a, b) => a.id - b.id ||
      (a.data ? a.data.getTime() : 0) - (b.data ? b.data.getTime() : 0));
}

/* Parâmetros fora do limite de um furo: mesmos critérios de computeMetrics e da planilha. */
function relatorioForaDoLimite(r) {
  const fora = [];
  if (r.angle != null && (r.angle < LIMITS.angleMin || r.angle > LIMITS.angleMax)) fora.push("Ângulo");
  if (r.azDelta != null && Math.abs(r.azDelta) > LIMITS.azimuth) fora.push("Azimute");
  if (r.depthDelta != null && Math.abs(r.depthDelta) > LIMITS.depth) fora.push("Profundidade");
  return fora;
}

function relatorioResumo(plano) {
  const registros = relatorioRegistros(plano);
  const desvios = [];
  const porCriterio = { Ângulo: 0, Azimute: 0, Profundidade: 0 };
  registros.forEach((r) => {
    const fora = relatorioForaDoLimite(r);
    if (!fora.length) return;
    fora.forEach((c) => { porCriterio[c] += 1; });
    desvios.push({ r, fora });
  });
  return { plano, total: registros.length, desvios, nDesvios: desvios.length, porCriterio };
}

function relatorioPlanosDoPeriodo() {
  const y = document.getElementById("filter-year")?.value || "";
  const mo = document.getElementById("filter-month")?.value || "";
  const nomes = new Set(RECORDS
    .filter((r) => (!y || String(r.ano) === y) && (!mo || String(r.mes) === mo))
    .map((r) => r.plano));
  return [...nomes]
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }))
    .map(relatorioResumo);
}

/* ---------- Formatação ---------- */
const relatorioNum = (v, d = 2) => (v == null || !isFinite(v) ? "-" : fmtNum(v, d));
const relatorioSinal = (v) => (v == null || !isFinite(v) ? "-" : (v > 0 ? "+" : "") + fmtNum(v, 2));
const relatorioData = (d) => (d instanceof Date && !isNaN(d) ? d.toLocaleDateString("pt-BR") : "-");

function relatorioLinha(r, fora) {
  const angExp = LIMITS.angleExpected;
  return {
    furo: String(r.id),
    data: relatorioData(r.data),
    angPrev: relatorioNum(angExp),
    angReal: relatorioNum(r.angle),
    angDesvio: r.angle == null ? "-" : relatorioSinal(r.angle - angExp),
    azPrev: relatorioNum(r.azPlan),
    azReal: relatorioNum(r.azExec),
    azDesvio: relatorioSinal(r.azDelta),
    zPrev: relatorioNum(r.depthPlan),
    zReal: relatorioNum(r.depthExec),
    zDesvio: relatorioSinal(r.depthDelta),
    situacao: "Fora: " + fora.join(", "),
  };
}

function relatorioMedir(s, size, bold) {
  if (!RELATORIO_MEDIDOR) RELATORIO_MEDIDOR = document.createElement("canvas").getContext("2d");
  RELATORIO_MEDIDOR.font = `${bold ? "bold " : ""}${size * 100}px Arial, Helvetica, sans-serif`;
  // largura em pontos, convertida para mm (1 pt = 0,3528 mm)
  return (RELATORIO_MEDIDOR.measureText(String(s)).width / 100) * 0.3528;
}

function relatorioCortar(s, size, bold, maxMm) {
  let t = String(s);
  if (relatorioMedir(t, size, bold) <= maxMm) return t;
  while (t.length > 1 && relatorioMedir(t + "…", size, bold) > maxMm) t = t.slice(0, -1);
  return t + "…";
}

function relatorioLayoutColunas() {
  let x = RL.M;
  return RL_COLUNAS.map((c) => {
    const pos = { ...c, x };
    x += c.w;
    return pos;
  });
}

/* ---------- Layout (em mm), independente do formato de saída ---------- */
function relatorioCapa(ops, meta, res) {
  const { M, W, LARGURA } = RL;
  ops.push({ t: "rect", x: 0, y: 0, w: W, h: 16, c: RL.VERMELHO });
  ops.push({ t: "text", s: "Relatório de desvios de perfuração", x: M, y: relBase(8, 14), size: 14, bold: true, c: RL.BRANCO });
  if (meta.logo) {
    const h = 7;
    const w = h * meta.logo.ratio;
    ops.push({ t: "img", x: W - M - w, y: (16 - h) / 2, w, h, logo: meta.logo });
  }

  ops.push({ t: "text", s: "PLANO", x: M, y: 24.5, size: 7, bold: true, c: RL.CINZA });
  ops.push({ t: "text", s: relatorioCortar(meta.plano, 17, true, 170), x: M, y: 32, size: 17, bold: true, c: RL.PRETO });
  ops.push({ t: "text", s: "GERADO EM", x: W - M, y: 24.5, size: 7, bold: true, c: RL.CINZA, align: "right" });
  ops.push({ t: "text", s: meta.geradoEm, x: W - M, y: 32, size: 10, c: RL.PRETO, align: "right" });
  ops.push({ t: "text", s: `Período: ${meta.periodo}`, x: M, y: 39, size: 8.5, c: RL.TEXTO2 });
  ops.push({
    t: "text",
    s: `Limites: ângulo ${relatorioNum(LIMITS.angleMin)}° a ${relatorioNum(LIMITS.angleMax)}° (previsto ${relatorioNum(LIMITS.angleExpected)}°) · azimute ±${relatorioNum(LIMITS.azimuth)}° · profundidade ±${relatorioNum(LIMITS.depth)} m`,
    x: M, y: 44, size: 7.5, c: RL.CINZA,
  });

  const pct = (res.nDesvios / res.total) * 100;
  const cards = [
    { k: "Furos analisados", v: fmtInt(res.total), c: RL.PRETO },
    { k: `Furos com desvio · ${relatorioNum(pct, 1)}%`, v: fmtInt(res.nDesvios), c: RL.VERMELHO },
    { k: "Fora do ângulo", v: fmtInt(res.porCriterio.Ângulo), c: res.porCriterio.Ângulo ? RL.VERMELHO : RL.PRETO },
    { k: "Fora do azimute", v: fmtInt(res.porCriterio.Azimute), c: res.porCriterio.Azimute ? RL.VERMELHO : RL.PRETO },
    { k: "Fora da profundidade", v: fmtInt(res.porCriterio.Profundidade), c: res.porCriterio.Profundidade ? RL.VERMELHO : RL.PRETO },
  ];
  const gap = 3;
  const cw = (LARGURA - gap * (cards.length - 1)) / cards.length;
  cards.forEach((card, i) => {
    const x = M + i * (cw + gap);
    ops.push({ t: "rect", x, y: 48, w: cw, h: 16, c: RL.ZEBRA });
    ops.push({ t: "text", s: card.k, x: x + 3, y: 54, size: 6.5, bold: true, c: RL.CINZA });
    ops.push({ t: "text", s: card.v, x: x + 3, y: 61.5, size: 15, bold: true, c: card.c });
  });

  ops.push({ t: "text", s: "FUROS FORA DA TOLERÂNCIA", x: M, y: 72, size: 8.5, bold: true, c: RL.VERMELHO });
  ops.push({ t: "text", s: "Vermelho: valor fora do limite · ordenado pelo número do furo", x: W - M, y: 72, size: 7, c: RL.CINZA, align: "right" });
  ops.push({ t: "line", x1: M, y1: 74, x2: W - M, y2: 74, c: RL.REGRA, lw: 0.2 });
  return 77;
}

function relatorioContinuacao(ops, meta) {
  ops.push({ t: "text", s: `Plano ${meta.plano} · relatório de desvios (continuação)`, x: RL.M, y: 7.5, size: 8, c: RL.CINZA });
  ops.push({ t: "line", x1: RL.M, y1: 10.5, x2: RL.W - RL.M, y2: 10.5, c: RL.REGRA, lw: 0.2 });
}

function relatorioCabecalhoTabela(ops, y) {
  const cols = relatorioLayoutColunas();
  const altura = RL.GRUPO_H + RL.SUB_H;
  let i = 0;
  while (i < cols.length) {
    const c = cols[i];
    if (!c.grupo) {
      ops.push({ t: "rect", x: c.x, y, w: c.w, h: altura, c: RL.PRETO });
      ops.push({ t: "text", s: c.titulo, x: c.x + c.w / 2, y: relBase(y + altura / 2, 7), size: 7, bold: true, c: RL.BRANCO, align: "center" });
      i += 1;
      continue;
    }
    let j = i;
    while (j < cols.length && cols[j].grupo === c.grupo) j += 1;
    const ultimo = cols[j - 1];
    const gw = ultimo.x + ultimo.w - c.x;
    ops.push({ t: "rect", x: c.x, y, w: gw, h: RL.GRUPO_H, c: RL.PRETO });
    ops.push({ t: "text", s: c.grupo, x: c.x + gw / 2, y: relBase(y + RL.GRUPO_H / 2, 7), size: 7, bold: true, c: RL.BRANCO, align: "center" });
    for (let k = i; k < j; k += 1) {
      const ck = cols[k];
      ops.push({ t: "rect", x: ck.x, y: y + RL.GRUPO_H, w: ck.w, h: RL.SUB_H, c: RL.TEXTO2 });
      ops.push({ t: "text", s: ck.titulo, x: ck.x + ck.w / 2, y: relBase(y + RL.GRUPO_H + RL.SUB_H / 2, 6.5), size: 6.5, c: RL.BRANCO, align: "center" });
    }
    i = j;
  }
  // Separadores: entre grupos vão do topo ao fim do cabeçalho; dentro do grupo, só na linha dos subtítulos
  cols.forEach((c, i) => {
    if (c.x <= RL.M) return;
    const inicioGrupo = !c.grupo || !cols[i - 1].grupo || cols[i - 1].grupo !== c.grupo;
    const topo = inicioGrupo ? y : y + RL.GRUPO_H;
    ops.push({ t: "line", x1: c.x, y1: topo, x2: c.x, y2: y + altura, c: RL.BRANCO, lw: 0.25 });
  });
  return y + altura;
}

function relatorioLinhaTabela(ops, y, valores, fora, zebra) {
  const h = RL.LINHA;
  if (zebra) ops.push({ t: "rect", x: RL.M, y, w: RL.LARGURA, h, c: RL.ZEBRA });
  relatorioLayoutColunas().forEach((c) => {
    const marcada = Boolean(c.criterio && fora.includes(c.criterio));
    if (marcada) ops.push({ t: "rect", x: c.x, y, w: c.w, h, c: RL.VERM_CLARO });
    const situacao = c.chave === "situacao";
    const pad = situacao ? 2.5 : 1.8;
    const texto = relatorioCortar(valores[c.chave] ?? "-", 7.5, marcada, c.w - pad * 2);
    const x = c.align === "center" ? c.x + c.w / 2 : c.align === "right" ? c.x + c.w - pad : c.x + pad;
    ops.push({
      t: "text", s: texto, x, y: relBase(y + h / 2, 7.5), size: 7.5,
      bold: marcada, c: marcada || situacao ? RL.VERMELHO : RL.PRETO, align: c.align,
    });
  });
  ops.push({ t: "line", x1: RL.M, y1: y + h, x2: RL.M + RL.LARGURA, y2: y + h, c: RL.REGRA, lw: 0.15 });
}

function relatorioRodape(ops, n, total, yLinha) {
  ops.push({ t: "line", x1: RL.M, y1: yLinha, x2: RL.W - RL.M, y2: yLinha, c: RL.REGRA_CLARA, lw: 0.2 });
  ops.push({ t: "text", s: "ENAEX · US Vale Verde · Desvios de perfuração", x: RL.M, y: yLinha + 4, size: 7, c: RL.CINZA });
  ops.push({ t: "text", s: `Página ${n} de ${total}`, x: RL.W - RL.M, y: yLinha + 4, size: 7, c: RL.CINZA, align: "right" });
}

/* Monta as páginas. Paginado (PDF): cada página tem altura A4. Não paginado (PNG): uma página só, da altura do conteúdo. */
function montarRelatorio(meta, res, paginado) {
  const pages = [];
  let ops = null;
  let y = 0;
  const abrirPagina = (primeira) => {
    ops = [];
    pages.push(ops);
    if (primeira) y = relatorioCapa(ops, meta, res);
    else {
      relatorioContinuacao(ops, meta);
      y = 14;
    }
    y = relatorioCabecalhoTabela(ops, y);
  };
  abrirPagina(true);
  res.desvios.forEach(({ r, fora }, i) => {
    if (paginado && y + RL.LINHA > RL.LIMITE) abrirPagina(false);
    relatorioLinhaTabela(ops, y, relatorioLinha(r, fora), fora, i % 2 === 1);
    y += RL.LINHA;
  });
  if (paginado) {
    pages.forEach((p, i) => relatorioRodape(p, i + 1, pages.length, RL.RODAPE_Y));
    return { pages };
  }
  const yRodape = y + 6;
  relatorioRodape(ops, 1, 1, yRodape);
  return { pages, altura: yRodape + 9 };
}

/* ---------- Desenho: PDF (jsPDF) e PNG (canvas) ---------- */
function relatorioRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relatorioDesenharPdf(doc, ops) {
  ops.forEach((o) => {
    if (o.t === "rect") {
      doc.setFillColor(...relatorioRgb(o.c));
      doc.rect(o.x, o.y, o.w, o.h, "F");
    } else if (o.t === "text") {
      doc.setFont("helvetica", o.bold ? "bold" : "normal");
      doc.setFontSize(o.size);
      doc.setTextColor(...relatorioRgb(o.c));
      doc.text(o.s, o.x, o.y, { align: o.align || "left" });
    } else if (o.t === "line") {
      doc.setDrawColor(...relatorioRgb(o.c));
      doc.setLineWidth(o.lw);
      doc.line(o.x1, o.y1, o.x2, o.y2);
    } else if (o.t === "img") {
      doc.addImage(o.logo.dataUrl, "PNG", o.x, o.y, o.w, o.h);
    }
  });
}

function relatorioDesenharCanvas(ctx, ops, k) {
  ops.forEach((o) => {
    if (o.t === "rect") {
      ctx.fillStyle = o.c;
      ctx.fillRect(o.x * k, o.y * k, o.w * k, o.h * k);
    } else if (o.t === "text") {
      ctx.font = `${o.bold ? "bold " : ""}${o.size * 0.3528 * k}px Arial, Helvetica, sans-serif`;
      ctx.fillStyle = o.c;
      ctx.textAlign = o.align || "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(o.s, o.x * k, o.y * k);
    } else if (o.t === "line") {
      ctx.strokeStyle = o.c;
      ctx.lineWidth = o.lw * k;
      ctx.beginPath();
      ctx.moveTo(o.x1 * k, o.y1 * k);
      ctx.lineTo(o.x2 * k, o.y2 * k);
      ctx.stroke();
    } else if (o.t === "img") {
      ctx.drawImage(o.logo.img, o.x * k, o.y * k, o.w * k, o.h * k);
    }
  });
}

/* Logo ENAEX (branco) para a faixa do topo. Se não carregar, o relatório sai sem logo. */
function relatorioCarregarLogo() {
  if (!RELATORIO_LOGO_PROMISE) {
    RELATORIO_LOGO_PROMISE = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext("2d").drawImage(img, 0, 0);
          resolve({ img, dataUrl: c.toDataURL("image/png"), ratio: img.naturalWidth / img.naturalHeight });
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = RELATORIO_LOGO_URL;
    });
  }
  return RELATORIO_LOGO_PROMISE;
}

function relatorioNomeArquivo(plano, ext) {
  const slug = plano.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plano";
  const d = new Date();
  const data = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `relatorio-desvios_${slug}_${data}.${ext}`;
}

async function exportarRelatorioPdf(meta, res) {
  const JsPDF = await loadJsPdf();
  const { pages } = montarRelatorio(meta, res, true);
  const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: `Relatório de desvios · ${meta.plano}`, creator: "ENAEX · Análise de Desvios" });
  pages.forEach((ops, i) => {
    if (i) doc.addPage("a4", "landscape");
    relatorioDesenharPdf(doc, ops);
  });
  doc.save(relatorioNomeArquivo(meta.plano, "pdf"));
}

async function exportarRelatorioPng(meta, res) {
  const { pages, altura } = montarRelatorio(meta, res, false);
  const k = Math.min(RELATORIO_PX_MM * 2, RELATORIO_PX_MAX / altura);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(RL.W * k);
  canvas.height = Math.round(altura * k);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = RL.BRANCO;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  relatorioDesenharCanvas(ctx, pages[0], k);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (b) => (b ? resolve(b) : reject(new Error("Não foi possível gerar a imagem."))), "image/png"));
  downloadPlantaBlob(blob, relatorioNomeArquivo(meta.plano, "png"));
}

/* ---------- Janela ---------- */
function relatorioFormato() {
  const r = document.querySelector('input[name="relatorio-format"]:checked');
  return r ? r.value : "pdf";
}

function relatorioSelecionado() {
  return RELATORIO_ESTADO.planos.find((p) => p.plano === RELATORIO_ESTADO.plano) || null;
}

function mostrarRelatorioStatus(texto, erro = false) {
  const el = relatorioEl("relatorio-status");
  if (!el) return;
  el.textContent = texto || "";
  el.hidden = !texto;
  el.classList.toggle("is-error", erro);
}

function relatorioTextoContagem(res) {
  const furos = `${fmtInt(res.total)} ${res.total === 1 ? "furo" : "furos"}`;
  if (!res.nDesvios) return `sem desvios · ${furos}`;
  return `${fmtInt(res.nDesvios)} ${res.nDesvios === 1 ? "desvio" : "desvios"} de ${furos}`;
}

function renderRelatorioLista(preferido) {
  const lista = relatorioEl("relatorio-list");
  const vazio = relatorioEl("relatorio-empty");
  lista.replaceChildren();
  const planos = RELATORIO_ESTADO.planos;
  planos.forEach((res) => {
    const li = document.createElement("li");
    li.className = "relatorio-item" + (res.nDesvios ? "" : " is-vazio");
    li.dataset.nome = norm(res.plano);
    const label = document.createElement("label");
    label.className = "relatorio-item__label";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "relatorio-plan";
    input.value = res.plano;
    input.checked = res.plano === preferido;
    input.addEventListener("change", () => selecionarRelatorioPlano(res.plano));
    const nome = document.createElement("span");
    nome.className = "relatorio-item__name";
    nome.textContent = res.plano;
    const cont = document.createElement("span");
    cont.className = "relatorio-item__count";
    cont.textContent = relatorioTextoContagem(res);
    label.append(input, nome, cont);
    li.appendChild(label);
    lista.appendChild(li);
  });
  relatorioEl("relatorio-search-wrap").hidden = planos.length < RELATORIO_BUSCA_MIN;
  relatorioEl("relatorio-search").value = "";
  vazio.textContent = "Nenhum plano com registros no período selecionado.";
  vazio.hidden = planos.length > 0;
}

function filtrarRelatorioPlanos() {
  const q = norm(relatorioEl("relatorio-search").value);
  let visiveis = 0;
  document.querySelectorAll("#relatorio-list .relatorio-item").forEach((li) => {
    const ok = !q || li.dataset.nome.includes(q);
    li.hidden = !ok;
    if (ok) visiveis += 1;
  });
  const vazio = relatorioEl("relatorio-empty");
  if (RELATORIO_ESTADO.planos.length) {
    vazio.textContent = "Nenhum plano encontrado na busca.";
    vazio.hidden = visiveis > 0;
  }
}

function criarBloco(rotulo, valor, classeValor, detalhe) {
  const bloco = document.createElement("div");
  const k = document.createElement("p");
  k.className = "relatorio-summary__k";
  k.textContent = rotulo;
  const v = document.createElement("p");
  v.className = "relatorio-summary__v" + (classeValor ? " " + classeValor : "");
  v.textContent = valor;
  bloco.append(k, v);
  if (detalhe) {
    const d = document.createElement("p");
    d.className = "relatorio-summary__detail";
    d.textContent = detalhe;
    bloco.appendChild(d);
  }
  return bloco;
}

function renderRelatorioResumo() {
  const box = relatorioEl("relatorio-summary");
  box.replaceChildren();
  const res = relatorioSelecionado();
  if (!res) {
    const p = document.createElement("p");
    p.className = "relatorio-note";
    p.textContent = "Escolha um plano na lista para ver a contagem de furos e desvios.";
    box.appendChild(p);
    return;
  }
  const nome = document.createElement("p");
  nome.className = "relatorio-summary__plan";
  nome.textContent = res.plano;
  box.appendChild(nome);

  const grid = document.createElement("div");
  grid.className = "relatorio-summary__nums";
  grid.appendChild(criarBloco("Furos", fmtInt(res.total), "", ""));
  grid.appendChild(criarBloco("Desvios", fmtInt(res.nDesvios),
    res.nDesvios ? "relatorio-summary__v--alert" : "",
    res.nDesvios ? `${relatorioNum((res.nDesvios / res.total) * 100, 1)}% dos furos` : ""));
  box.appendChild(grid);

  const det = document.createElement("p");
  det.className = "relatorio-summary__detail";
  det.textContent = `Fora do limite por parâmetro: ângulo ${res.porCriterio.Ângulo} · azimute ${res.porCriterio.Azimute} · profundidade ${res.porCriterio.Profundidade}`;
  box.appendChild(det);

  if (!res.nDesvios) {
    const p = document.createElement("p");
    p.className = "relatorio-note";
    p.textContent = "Este plano não tem furos fora da tolerância no período selecionado, então não há desvios para exportar.";
    box.appendChild(p);
  }
}

function atualizarRelatorioBotao() {
  const btn = relatorioEl("relatorio-export");
  const res = relatorioSelecionado();
  btn.textContent = relatorioFormato() === "png" ? "Exportar PNG" : "Exportar PDF";
  btn.disabled = RELATORIO_ESTADO.ocupado || !res || !res.nDesvios;
}

function selecionarRelatorioPlano(plano) {
  RELATORIO_ESTADO.plano = plano;
  renderRelatorioResumo();
  atualizarRelatorioBotao();
  mostrarRelatorioStatus("");
}

function abrirRelatorio() {
  const dlg = relatorioEl("relatorio-dialog");
  if (!dlg || dlg.open || !RECORDS.length) return;
  const planos = relatorioPlanosDoPeriodo();
  const preferido = document.getElementById("filter-plan")?.value || "";
  RELATORIO_ESTADO.planos = planos;
  RELATORIO_ESTADO.plano = planos.some((p) => p.plano === preferido) ? preferido : "";
  relatorioEl("relatorio-periodo").textContent = relatorioPeriodo();
  renderRelatorioLista(RELATORIO_ESTADO.plano);
  renderRelatorioResumo();
  atualizarRelatorioBotao();
  mostrarRelatorioStatus("");
  dlg.showModal();
}

async function exportarRelatorio() {
  const res = relatorioSelecionado();
  if (!res) return;
  if (!res.nDesvios) {
    mostrarRelatorioStatus("Este plano não tem desvios para exportar.", true);
    return;
  }
  const formato = relatorioFormato();
  RELATORIO_ESTADO.ocupado = true;
  atualizarRelatorioBotao();
  mostrarRelatorioStatus(formato === "png" ? "Gerando imagem…" : "Gerando PDF…");
  try {
    const logo = await relatorioCarregarLogo();
    const meta = { plano: res.plano, geradoEm: nowBR(), periodo: relatorioPeriodo(), logo };
    if (formato === "png") await exportarRelatorioPng(meta, res);
    else await exportarRelatorioPdf(meta, res);
    mostrarRelatorioStatus("");
  } catch (e) {
    console.warn("relatório por plano falhou:", e);
    mostrarRelatorioStatus(e.message || "Não foi possível gerar o relatório.", true);
  } finally {
    RELATORIO_ESTADO.ocupado = false;
    atualizarRelatorioBotao();
  }
}

/* Liga o botão e a janela. Chamado por app.js quando a planilha carrega (RECORDS pronto). */
function setupRelatorio() {
  const btn = relatorioEl("relatorio-open");
  const dlg = relatorioEl("relatorio-dialog");
  if (!btn || !dlg) return;
  btn.disabled = false;
  btn.onclick = abrirRelatorio;
  relatorioEl("relatorio-close").onclick = () => dlg.close();
  relatorioEl("relatorio-export").onclick = exportarRelatorio;
  relatorioEl("relatorio-search").addEventListener("input", filtrarRelatorioPlanos);
  document.querySelectorAll('input[name="relatorio-format"]').forEach((r) =>
    r.addEventListener("change", atualizarRelatorioBotao));
  dlg.addEventListener("close", () => mostrarRelatorioStatus(""));
}
