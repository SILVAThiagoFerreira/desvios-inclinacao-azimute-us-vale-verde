/* =====================================================================
   Relatório por plano: apresentação em lâminas no modelo clean (paisagem,
   338,7 × 216,6 mm, como o PDF de referência). Cada lâmina tem título e
   subtítulo curto, logos no topo e só o conteúdo visual (gráficos, plantas,
   mapas, indicadores e tabela). Lâminas:
     1. Consolidado: indicadores de furos e conformidade por parâmetro
     2. Mapa de execução (planejado × executado)
     3. Mapa 3D de execução
     4. Aderência em planta (XY e Z) com os gráficos de aderência
     5. Ângulo frontal e direção dos furos
     6. Desvios de azimute e de profundidade por furo
     7. Distribuições e aderência por plano
     8. Tabela dos furos fora da tolerância (paginada)
   Gráficos, plantas e mapas são os do site, desenhados fora da tela para o
   plano: drawAngle/drawHist… e desenharMapaSvg (app.js), plantaParear,
   plantaItensDoPlano, drawPlantaCardCanvas e plantaChartConfig (planta.js) e
   map3dSnapshot (map3d.js). PDF: jsPDF (loadJsPdf), uma lâmina por página.
   PNG: uma imagem com as lâminas empilhadas, do mesmo layout.
   ===================================================================== */

const RELATORIO_MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const RELATORIO_LOGO_ENAEX_URL = "./assets/relatorio-logo-enaex.jpg";
const RELATORIO_LOGO_CLIENTE_URL = "./assets/relatorio-logo-vale-verde.jpg";
const RELATORIO_BUSCA_MIN = 8;                 // a partir deste número de planos aparece o campo de busca
const RELATORIO_CSS_PX_MM = 96 / 25.4;         // pixels CSS por mm (gráficos e plantas fora da tela)
const RELATORIO_DPR = 2;                       // densidade das imagens (gráficos, plantas, mapas)
const RELATORIO_PNG_PX_MM = 3000 / 338.7;      // PNG: cada lâmina com ~3000 px de largura
const RELATORIO_PX_MAX = 20000;                // altura máxima do PNG, em pixels
const RELATORIO_GAP_MM = 8;                    // espaço entre lâminas no PNG

// Geometria e cores, em mm. Formato e cores seguem o PDF de referência (Enaex / US Vale Verde).
const RL = {
  W: 338.7, H: 216.6, M: 11.5, LARGURA: 315.7, COL: 153.85,   // COL: metade da largura, com espaço de 8 mm
  TOPO: 36,          // início do conteúdo, abaixo do subtítulo
  LIMITE: 196,       // última posição útil antes do rodapé (tabela)
  RODAPE_Y: 204.6,   // filete do rodapé
  LINHA: 6.5, GRUPO_H: 6, SUB_H: 5.5,
  GT: 54, GB: 190, GX: 16, GY: 12, CW: 149.85,  // grade de gráficos: início, fim, espaço entre colunas e linhas, largura de coluna
  TITULO: "#B5121B", PRETO: "#2B2B2B", TEXTO2: "#4D4D4D", CINZA: "#7A7A7A", CINZA_CLARO: "#8A9298",
  VERMELHO: "#B5121B", VERDE: "#2E7D32", AZUL_3D: "#1D2A9C",
  ZEBRA: "#F3F4F5", REGRA: "#C9CDD1", REGRA_CLARA: "#E3E6E9", BRANCO: "#FFFFFF",
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
let RELATORIO_LOGOS_PROMISE = null;
let RELATORIO_MEDIDOR = null;
let RELATORIO_CHAVE = 0;

const relatorioEl = (id) => document.getElementById(id);
const relBase = (meio, pt) => meio + pt * 0.3528 * 0.36; // linha de base para centralizar verticalmente

/* Tolerâncias em texto para os rótulos. Lidas do site na hora (LIMITS e planta.js), nunca fixas. */
const relTol = {
  get ang() { return `${fmtNum(LIMITS.angleMin, 1)}° a ${fmtNum(LIMITS.angleMax, 1)}°`; },
  get az() { return `±${relatorioNum(LIMITS.azimuth)}°`; },
  get z() { return `±${relatorioNum(LIMITS.depth)} m`; },
  get xy() { return `${PLANTA_DISP_FATOR} × Ø do furo`; },
  get meta() { return `meta ${LIMITS.meta}%`; },
};

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
const furoNome = (r) => (r.id ? String(r.id) : "s/ ID");
const relatorioNum = (v, d = 2) => (v == null || !isFinite(v) ? "-" : fmtNum(v, d));
const relatorioSinal = (v) => (v == null || !isFinite(v) ? "-" : (v > 0 ? "+" : "") + fmtNum(v, 2));
const relatorioData = (d) => (d instanceof Date && !isNaN(d) ? d.toLocaleDateString("pt-BR") : "-");

function relatorioLinha(r, fora) {
  const angExp = LIMITS.angleExpected;
  return {
    furo: furoNome(r),
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

/* ---------- Medição e texto ---------- */
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

/* Quebra um texto em linhas que cabem na largura (em mm). */
function relatorioQuebrar(texto, size, maxMm) {
  const linhas = [];
  let atual = "";
  String(texto).split(" ").forEach((p) => {
    const teste = atual ? `${atual} ${p}` : p;
    if (!atual || relatorioMedir(teste, size, false) <= maxMm) atual = teste;
    else {
      linhas.push(atual);
      atual = p;
    }
  });
  if (atual) linhas.push(atual);
  return linhas;
}

function relatorioLayoutColunas() {
  const total = RL_COLUNAS.reduce((s, c) => s + c.w, 0);
  const k = RL.LARGURA / total;
  let x = RL.M;
  return RL_COLUNAS.map((c) => {
    const pos = { ...c, x, w: c.w * k };
    x += pos.w;
    return pos;
  });
}

/* ---------- Blocos de layout (em mm) ---------- */
/* Texto com quebra de linha. y é a linha de base da primeira linha. Devolve a base da próxima linha. */
function relatorioTexto(ops, x, y, w, texto, size, cor, bold = false) {
  const lh = size * 0.3528 * 1.4;
  let yy = y;
  relatorioQuebrar(texto, size, w).forEach((linha) => {
    ops.push({ t: "text", s: linha, x, y: yy, size, bold, c: cor });
    yy += lh;
  });
  return yy;
}

/* Cabeçalho da lâmina, como no modelo: título e subtítulo à esquerda, logos à direita. */
function relatorioCabecalho(ops, meta, titulo, sub) {
  const { M, W, LARGURA } = RL;
  ops.push({ t: "text", s: relatorioCortar(titulo, 20, false, LARGURA - 90), x: M, y: 20, size: 20, c: RL.TITULO });
  if (sub) ops.push({ t: "text", s: relatorioCortar(sub, 10, false, LARGURA), x: M, y: 27, size: 10, c: RL.TEXTO2 });
  const logos = meta.logos || {};
  let x = W - M;
  [logos.cliente, logos.enaex].forEach((logo) => {
    if (!logo) return;
    const h = 12;
    const w = h * logo.ratio;
    x -= w;
    ops.push({ t: "img", x, y: 9, w, h, logo });
    x -= 8;
  });
}

/* Rótulo de gráfico ou tabela (sem filete). Devolve a posição do conteúdo. */
function relatorioRotulo(ops, x, y, w, texto) {
  ops.push({ t: "text", s: relatorioCortar(texto, 11, false, w), x, y, size: 11, c: RL.PRETO });
  return y + 5.6;
}

/* Aviso em caixa cinza (quando um gráfico ou planta não pode ser desenhado). */
function relatorioAviso(ops, x, y, w, h, texto) {
  const linhas = relatorioQuebrar(texto, 9, w - 10);
  const lh = 9 * 0.3528 * 1.4;
  let yy = y + (h - linhas.length * lh) / 2 + 3;
  linhas.forEach((l) => {
    ops.push({ t: "text", s: l, x: x + 5, y: yy, size: 9, c: RL.TEXTO2 });
    yy += lh;
  });
}

/* Legenda em uma linha. Itens: {t: "dot" | "ring" | "link" | "linha", c, texto}. */
function relatorioLegenda(ops, x, y, itens) {
  let cx = x;
  itens.forEach((it) => {
    const simbolo = it.t === "dot" || it.t === "ring";
    if (it.t === "dot") ops.push({ t: "circ", x: cx + 1.6, y: y - 0.9, r: 1.6, c: it.c, vazio: false });
    else if (it.t === "ring") ops.push({ t: "circ", x: cx + 1.6, y: y - 0.9, r: 1.6, c: it.c, vazio: true, lw: 0.35 });
    else ops.push({ t: "line", x1: cx, y1: y - 0.9, x2: cx + 5, y2: y - 0.9, c: it.c, lw: it.t === "link" ? 0.3 : 0.6 });
    const tx = cx + (simbolo ? 4.6 : 6.4);
    ops.push({ t: "text", s: it.texto, x: tx, y, size: 9, c: RL.TEXTO2 });
    cx = tx + relatorioMedir(it.texto, 9, false) + 8;
  });
  return cx;
}

/* Indicadores em cartões: rótulo, número grande e detalhe opcional. cartoes: [{k, v, c, dica?}] */
function relatorioCartoes(ops, y, h, cartoes) {
  const { M, LARGURA } = RL;
  const gap = 4;
  const cw = (LARGURA - gap * (cartoes.length - 1)) / cartoes.length;
  cartoes.forEach((cd, i) => {
    const x = M + i * (cw + gap);
    ops.push({ t: "text", s: relatorioCortar(cd.k, 9, false, cw - 8), x: x + 4, y: y + 7, size: 9, c: RL.TEXTO2 });
    ops.push({ t: "text", s: cd.v, x: x + 4, y: y + h - (cd.dica ? 9 : 6), size: 22, bold: true, c: cd.c });
    if (cd.dica) ops.push({ t: "text", s: relatorioCortar(cd.dica, 8, false, cw - 8), x: x + 4, y: y + h - 3.5, size: 8, c: RL.TEXTO2 });
  });
}

/* Tabela de conformidade por parâmetro, com a largura dada. Devolve a base após a tabela. */
function relatorioResumoTabela(ops, x, y, params, largura) {
  const cols = [
    { t: "Parâmetro", f: 0.38, al: "left" },
    { t: "Avaliados", f: 0.15, al: "center" },
    { t: "Dentro", f: 0.15, al: "center" },
    { t: "Fora", f: 0.14, al: "center" },
    { t: "Conformidade", f: 0.18, al: "center" },
  ];
  let cx = x;
  const colunas = cols.map((c) => {
    const pos = { ...c, x: cx, w: c.f * largura };
    cx += pos.w;
    return pos;
  });
  const cabH = 8, linhaH = 11;
  colunas.forEach((c) => {
    const tx = c.al === "left" ? c.x + 2 : c.x + c.w / 2;
    ops.push({ t: "text", s: c.t, x: tx, y: y + 5.2, size: 8, bold: true, c: RL.CINZA, align: c.al });
  });
  ops.push({ t: "line", x1: x, y1: y + cabH, x2: x + largura, y2: y + cabH, c: RL.REGRA, lw: 0.25 });
  let yy = y + cabH;
  params.forEach((p) => {
    const fora = p.total != null && p.ok != null ? p.total - p.ok : null;
    const valores = [
      p.nome,
      p.total != null ? fmtInt(p.total) : "—",
      p.ok != null ? fmtInt(p.ok) : "—",
      fora != null ? fmtInt(fora) : "—",
      p.pct != null ? `${relatorioNum(p.pct, 1)}%` : "—",
    ];
    colunas.forEach((c, j) => {
      const destaque = (j === 4 && p.pct != null) || (j === 3 && Boolean(fora));
      const cor = j === 4
        ? (p.pct == null ? RL.CINZA : p.pct >= LIMITS.meta ? RL.VERDE : RL.VERMELHO)
        : (j === 3 && fora ? RL.VERMELHO : RL.PRETO);
      const tx = c.al === "left" ? c.x + 2 : c.x + c.w / 2;
      ops.push({
        t: "text", s: relatorioCortar(valores[j], 9.5, destaque || j === 0, c.w - 4),
        x: tx, y: yy + 7.4, size: 9.5, bold: destaque || j === 0, c: cor, align: c.al,
      });
    });
    yy += linhaH;
  });
  return yy;
}

/* ---------- Rodapé (filete e aviso de confidencialidade, como no modelo) ---------- */
function relatorioRodape(ops) {
  const { M, W, RODAPE_Y } = RL;
  ops.push({ t: "line", x1: M, y1: RODAPE_Y, x2: W - M, y2: RODAPE_Y, c: RL.PRETO, lw: 0.35 });
  ops.push({ t: "text", s: "STRICTLY PRIVATE AND CONFIDENTIAL", x: W - M, y: RODAPE_Y + 5, size: 6.5, c: RL.TEXTO2, align: "right" });
}

/* Cabeçalho da tabela de furos: grupos com filete e subtítulos. Devolve a base após o cabeçalho. */
function relatorioCabecalhoTabela(ops, y) {
  const cols = relatorioLayoutColunas();
  const altura = RL.GRUPO_H + RL.SUB_H;
  let i = 0;
  while (i < cols.length) {
    const c = cols[i];
    if (!c.grupo) {
      const esquerda = c.align === "left";
      ops.push({ t: "text", s: c.titulo, x: esquerda ? c.x + 1.8 : c.x + c.w / 2, y: y + altura - 1.8, size: 7.5, bold: true, c: RL.CINZA, align: esquerda ? "left" : "center" });
      i += 1;
      continue;
    }
    let j = i;
    while (j < cols.length && cols[j].grupo === c.grupo) j += 1;
    const ultimo = cols[j - 1];
    const gx = c.x;
    const gw = ultimo.x + ultimo.w - c.x;
    ops.push({ t: "text", s: c.grupo, x: gx + gw / 2, y: y + 4.3, size: 7.5, bold: true, c: RL.CINZA, align: "center" });
    for (let k = i; k < j; k += 1) {
      const ck = cols[k];
      ops.push({ t: "text", s: ck.titulo, x: ck.x + ck.w / 2, y: y + altura - 1.8, size: 7, c: RL.CINZA, align: "center" });
    }
    i = j;
  }
  ops.push({ t: "line", x1: RL.M, y1: y + altura, x2: RL.M + RL.LARGURA, y2: y + altura, c: RL.REGRA, lw: 0.25 });
  return y + altura;
}

/* Linha da tabela de furos. Valor fora do limite fica em vermelho e negrito. */
function relatorioLinhaTabela(ops, y, valores, fora, colunas) {
  const h = RL.LINHA;
  colunas.forEach((c) => {
    const marcada = Boolean(c.criterio && fora.includes(c.criterio));
    const pad = 1.8;
    const texto = relatorioCortar(valores[c.chave] ?? "-", 8, marcada, c.w - pad * 2);
    const x = c.align === "center" ? c.x + c.w / 2 : c.align === "right" ? c.x + c.w - pad : c.x + pad;
    ops.push({
      t: "text", s: texto, x, y: relBase(y + h / 2, 8), size: 8,
      bold: marcada, c: marcada ? RL.VERMELHO : RL.PRETO, align: c.align,
    });
  });
}

/* ---------- Indicadores do plano ---------- */
/* Conformidade por parâmetro. pct é null quando não há dado (ex.: sem DXF para o collar). */
function relatorioParametros(d) {
  const { m, pm } = d;
  const pv = (v) => (v != null && isFinite(v) ? v : null);
  return [
    { nome: `Ângulo frontal (${relTol.ang})`, curto: "ângulo", rotuloCard: "Conformidade · ângulo", total: m.angleTotal, ok: m.angleOk, pct: pv(m.anglePct) },
    { nome: `Azimute (${relTol.az})`, curto: "azimute", rotuloCard: "Conformidade · azimute", total: m.azTotal, ok: m.azOk, pct: pv(m.azPct) },
    { nome: `Profundidade (${relTol.z})`, curto: "profundidade", rotuloCard: "Conformidade · profundidade", total: m.zTotal, ok: m.zOk, pct: pv(m.zPct) },
    { nome: `Collar em planta XY (${relTol.xy})`, curto: "collar em planta (XY)", rotuloCard: "Aderência · collar XY", total: pm && pm.xyN ? pm.xyN : null, ok: pm ? pm.xy : null, pct: pm ? pv(pm.xyPct) : null },
    { nome: `Planta Z · profundidade (${relTol.z})`, curto: "profundidade na planta (Z)", rotuloCard: "Aderência · planta Z", total: pm ? pm.zn : null, ok: pm ? pm.z : null, pct: pm ? pv(pm.zPct) : null },
  ];
}

/* ---------- Lâminas ---------- */
function relatorioPaginaConsolidado(ops, ctx) {
  const { res, params } = ctx;
  const { M, LARGURA } = RL;
  const pct = (res.nDesvios / res.total) * 100;
  relatorioCartoes(ops, RL.TOPO, 24, [
    { k: "Furos analisados", v: fmtInt(res.total), c: RL.PRETO },
    { k: "Furos com desvio", v: fmtInt(res.nDesvios), c: RL.VERMELHO, dica: `${relatorioNum(pct, 1)}% dos furos` },
    { k: "Fora do ângulo", v: fmtInt(res.porCriterio.Ângulo), c: res.porCriterio.Ângulo ? RL.VERMELHO : RL.PRETO },
    { k: "Fora do azimute", v: fmtInt(res.porCriterio.Azimute), c: res.porCriterio.Azimute ? RL.VERMELHO : RL.PRETO },
    { k: "Fora da profundidade", v: fmtInt(res.porCriterio.Profundidade), c: res.porCriterio.Profundidade ? RL.VERMELHO : RL.PRETO },
  ]);
  relatorioCartoes(ops, RL.TOPO + 30, 30, params.map((p) => ({
    k: p.rotuloCard,
    v: p.pct != null ? `${relatorioNum(p.pct, 1)}%` : "—",
    c: p.pct == null ? RL.CINZA : p.pct >= LIMITS.meta ? RL.VERDE : RL.VERMELHO,
    dica: p.pct == null
      ? (p.total != null ? "sem dado confiável no DXF" : "Sem DXF do plano")
      : `${fmtInt(p.ok)} de ${fmtInt(p.total)} furos · meta ${LIMITS.meta}%`,
  })));
  const yR = relatorioRotulo(ops, M, 111, LARGURA, "Conformidade por parâmetro");
  relatorioResumoTabela(ops, M, yR + 2, params, LARGURA);
}

function relatorioPaginaMapa(ops, ctx) {
  const { d } = ctx;
  const { M, LARGURA, TOPO } = RL;
  if (!d.mapa) {
    relatorioAviso(ops, M, TOPO, LARGURA, 20, "Sem desenho DXF com geometria para os furos do período: o mapa de execução não pode ser desenhado.");
    return;
  }
  const h = LARGURA * 500 / 1200;
  ops.push({ t: "bmp", x: M, y: TOPO, w: LARGURA, h, c: d.mapa });
  relatorioLegenda(ops, M, TOPO + h + 9, [
    { t: "linha", c: RL.CINZA_CLARO, texto: "Planejado" },
    { t: "linha", c: RL.VERMELHO, texto: "Executado" },
    { t: "dot", c: RL.PRETO, texto: "Emboque" },
  ]);
}

function relatorioPaginaMapa3d(ops, ctx) {
  const { d } = ctx;
  const { M, LARGURA, TOPO } = RL;
  const h = 150;
  if (!d.img3d) {
    relatorioAviso(ops, M, TOPO, LARGURA, 20, "Mapa 3D indisponível: é preciso um navegador com WebGL e um DXF com geometria para o plano.");
    return;
  }
  ops.push({ t: "bmp", x: M, y: TOPO, w: LARGURA, h, c: d.img3d });
  relatorioLegenda(ops, M, TOPO + h + 9, [
    { t: "linha", c: RL.CINZA_CLARO, texto: "Planejado (tubos translúcidos)" },
    { t: "linha", c: RL.VERMELHO, texto: "Executado" },
    { t: "dot", c: RL.AZUL_3D, texto: "Emboque" },
  ]);
}

function relatorioPaginaPlantas(ops, ctx) {
  const { d } = ctx;
  const { M, CW, GT, GY, GX, TOPO } = RL;
  const X2 = M + CW + GX;
  const H1 = 64;
  if (!d.plantaXY) {
    relatorioAviso(ops, M, TOPO, RL.LARGURA, 20, d.semDxf
      ? "Sem desenho DXF para o plano: a planta em XY e Z não pode ser desenhada."
      : "Coordenadas previstas indisponíveis para este plano: a planta não pode ser desenhada.");
    return;
  }
  const semXY = d.pm && d.pm.xyPct == null ? " · sem dado confiável" : "";
  const yP = relatorioRotulo(ops, M, GT, CW, `Planta XY · tolerância ${relTol.xy}${semXY}`);
  ops.push({ t: "bmp", x: M, y: yP, w: CW, h: H1, c: d.plantaXY });
  const yPZ = relatorioRotulo(ops, X2, GT, CW, `Planta Z · profundidade · tolerância ${relTol.z}`);
  ops.push({ t: "bmp", x: X2, y: yPZ, w: CW, h: H1, c: d.plantaZ });
  const yG = yP + H1 + GY;
  const yGb = relatorioRotulo(ops, M, yG, CW, `Aderência em planta por eixo (% dentro do limite) · ${relTol.meta}`);
  ops.push({ t: "bmp", x: M, y: yGb, w: CW, h: 48, c: d.gPlanta });
  const yT = relatorioRotulo(ops, X2, yG, CW, "Tolerâncias e legenda");
  let yy = yT + 3;
  [`Collar XY: ${relTol.xy}`, `Profundidade: ${relTol.z}`, `Meta de aderência: ${relTol.meta}`].forEach((t) => {
    ops.push({ t: "text", s: t, x: X2, y: yy, size: 9, c: RL.PRETO });
    yy += 5.2;
  });
  yy += 1.5;
  [
    { t: "dot", c: PLANTA_COLORS.ok, texto: "Dentro da tolerância" },
    { t: "dot", c: PLANTA_COLORS.red, texto: "Fora da tolerância" },
    { t: "dot", c: PLANTA_COLORS.blue, texto: "Realizado sem previsto" },
    { t: "ring", c: PLANTA_COLORS.planned, texto: "Collar previsto" },
    { t: "link", c: "#9AA2A9", texto: "Ligação previsto × realizado" },
  ].forEach((it) => {
    relatorioLegenda(ops, X2, yy, [it]);
    yy += 5.2;
  });
}

function relatorioPaginaAngulo(ops, ctx) {
  const { d } = ctx;
  const { M, CW, GT, GX } = RL;
  const X2 = M + CW + GX;
  const H = 128;
  const yA = relatorioRotulo(ops, M, GT, CW, `Ângulo frontal por furo (°) · faixa ${relTol.ang}`);
  ops.push({ t: "bmp", x: M, y: yA, w: CW, h: H, c: d.g.angulo });
  const yD = relatorioRotulo(ops, X2, GT, CW, `Direção dos furos · tolerância az ${relTol.az} × prof ${relTol.z}`);
  ops.push({ t: "bmp", x: X2, y: yD, w: CW, h: H, c: d.g.direcao });
}

function relatorioPaginaDesvios(ops, ctx) {
  const { d } = ctx;
  const { M, CW, GT, GX } = RL;
  const X2 = M + CW + GX;
  const H = 128;
  const yA = relatorioRotulo(ops, M, GT, CW, `Desvio de azimute por furo (°) · tolerância ${relTol.az}`);
  ops.push({ t: "bmp", x: M, y: yA, w: CW, h: H, c: d.g.desvioAz });
  const yB = relatorioRotulo(ops, X2, GT, CW, `Desvio de profundidade por furo (m) · tolerância ${relTol.z}`);
  ops.push({ t: "bmp", x: X2, y: yB, w: CW, h: H, c: d.g.desvioZ });
}

function relatorioPaginaDistribuicoes(ops, ctx) {
  const { d } = ctx;
  const { M, CW, GT, GY, GX } = RL;
  const X2 = M + CW + GX;
  const H1 = 58, H2 = 54;
  const yA = relatorioRotulo(ops, M, GT, CW, `Distribuição do desvio de azimute · tolerância ${relTol.az}`);
  ops.push({ t: "bmp", x: M, y: yA, w: CW, h: H1, c: d.g.histAz });
  const yB = relatorioRotulo(ops, X2, GT, CW, `Distribuição do desvio de profundidade · tolerância ${relTol.z}`);
  ops.push({ t: "bmp", x: X2, y: yB, w: CW, h: H1, c: d.g.histZ });
  const yR = yA + H1 + GY;
  const yC = relatorioRotulo(ops, M, yR, CW, `Distribuição do ângulo frontal · faixa ${relTol.ang}`);
  ops.push({ t: "bmp", x: M, y: yC, w: CW, h: H2, c: d.g.histAngulo });
  const yD = relatorioRotulo(ops, X2, yR, CW, `Aderência por parâmetro (%) · ${relTol.meta}`);
  ops.push({ t: "bmp", x: X2, y: yD, w: CW, h: H2, c: d.g.porPlano });
}

/* Tabela dos furos fora da tolerância, paginada (o cabeçalho se repete em cada lâmina). */
function relatorioPaginasTabela(ctx, nova) {
  const { res } = ctx;
  const colunas = relatorioLayoutColunas();
  const sub = `${fmtInt(res.nDesvios)} ${res.nDesvios === 1 ? "furo" : "furos"} com desvio, em ordem de número`;
  let ops = nova("FUROS FORA DA TOLERÂNCIA", sub);
  let y = relatorioCabecalhoTabela(ops, RL.TOPO);
  if (!res.desvios.length) {
    relatorioTexto(ops, RL.M, y + 8, RL.LARGURA, "Nenhum furo fora da tolerância no período.", 10, RL.TEXTO2);
  }
  res.desvios.forEach(({ r, fora }) => {
    if (y + RL.LINHA > RL.LIMITE) {
      ops = nova("FUROS FORA DA TOLERÂNCIA", sub);
      y = relatorioCabecalhoTabela(ops, RL.TOPO);
    }
    relatorioLinhaTabela(ops, y, relatorioLinha(r, fora), fora, colunas);
    y += RL.LINHA;
  });
}

/* Monta todas as lâminas do relatório (cada lâmina é uma lista de operações em mm). */
function relatorioMontar(meta, res, d) {
  const ctx = { meta, res, d, params: relatorioParametros(d) };
  const pages = [];
  const nova = (titulo, sub) => {
    const ops = [];
    pages.push(ops);
    relatorioCabecalho(ops, meta, titulo, sub);
    return ops;
  };
  relatorioPaginaConsolidado(nova("DESVIOS DE PERFURAÇÃO", meta.plano), ctx);
  relatorioPaginaMapa(nova("MAPA DE EXECUÇÃO", "Planejado × executado, com o emboque de cada furo do período"), ctx);
  relatorioPaginaMapa3d(nova("MAPA 3D DE EXECUÇÃO", meta.plano), ctx);
  relatorioPaginaPlantas(nova("ADERÊNCIA EM PLANTA", "Collar previsto × realizado em planta (XY) e desvio de profundidade por furo (Z)"), ctx);
  relatorioPaginaAngulo(nova("ÂNGULO FRONTAL E DIREÇÃO", "Inclinação executada de cada furo e posição em relação ao previsto"), ctx);
  relatorioPaginaDesvios(nova("AZIMUTE E PROFUNDIDADE POR FURO", "Desvio executado menos previsto, em cada furo do período"), ctx);
  relatorioPaginaDistribuicoes(nova("DISTRIBUIÇÕES E ADERÊNCIA POR PLANO", "Quantidade de furos por faixa de desvio e aderência do plano"), ctx);
  relatorioPaginasTabela(ctx, nova);
  pages.forEach((p) => relatorioRodape(p));
  return pages;
}

/* ---------- Coleta: gráficos, plantas e mapas do plano (fora da tela) ---------- */
/* Copia um canvas com fundo branco (o gráfico é destruído logo depois). */
function relatorioCopiar(origem) {
  const c = document.createElement("canvas");
  c.width = origem.width;
  c.height = origem.height;
  const ctx = c.getContext("2d");
  ctx.fillStyle = RL.BRANCO;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(origem, 0, 0);
  return c;
}

/* Desenha um gráfico do site fora da tela, no tamanho do bloco (mm), e devolve a imagem. */
function relatorioGrafico(w, h, desenhar) {
  const caixa = document.createElement("div");
  caixa.style.cssText = `position:fixed;left:-20000px;top:0;width:${w * RELATORIO_CSS_PX_MM}px;height:${h * RELATORIO_CSS_PX_MM}px;`;
  const cv = document.createElement("canvas");
  caixa.appendChild(cv);
  document.body.appendChild(caixa);
  const key = `relatorio-${++RELATORIO_CHAVE}`;
  try {
    desenhar(cv, key);
    const chart = CHARTS[key];
    return relatorioCopiar(chart ? chart.canvas : cv);
  } finally {
    destroy(key);
    delete CHARTS[key];
    caixa.remove();
  }
}

/* Rótulo "0,0%" em barras de valor zero (a barra some, mas o valor precisa aparecer). */
Chart.register({
  id: "relZeroLabel",
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.fmt) return;
    const { ctx } = chart;
    chart.data.datasets.forEach((ds, di) => {
      const meta = chart.getDatasetMeta(di);
      if (meta.hidden) return;
      meta.data.forEach((bar, i) => {
        if (ds.data[i] !== 0) return;
        ctx.save();
        ctx.font = "700 11px Arial, Helvetica, sans-serif";
        ctx.fillStyle = C.ink;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(opts.fmt(0), bar.x, bar.base - 3);
        ctx.restore();
      });
    });
  },
});

/* Eixo com folga para a faixa de tolerância (±lim) aparecer mesmo quando os dados ficam de um lado só. */
function relatorioAjustarFaixa(chart, lim) {
  if (!chart) return;
  chart.options.scales.y.suggestedMin = -lim * 1.5;
  chart.options.scales.y.suggestedMax = lim * 1.5;
  chart.update("none");
}

/* Ajusta um gráfico de barras já desenhado para o bloco do relatório: barras mais finas e eixo X horizontal. */
function relatorioAjustarBarras(chart) {
  if (!chart) return;
  chart.data.datasets.forEach((ds) => { ds.barPercentage = 0.55; ds.categoryPercentage = 0.7; });
  chart.options.scales.x.ticks.maxRotation = 0;
  chart.options.scales.x.ticks.minRotation = 0;
  chart.options.scales.y.ticks.stepSize = 20;
  chart.options.plugins.relZeroLabel = { fmt: (v) => fmtPct(v) };
  chart.update("none");
}

/* Aderência em planta do plano: uma barra para XY e outra para Z, com a meta como linha horizontal. */
function relatorioPlantaChart(cv, key, pm) {
  const pv = (v) => (v != null && isFinite(v) ? v : null);
  CHARTS[key] = new Chart(cv, aplicarAlvo({
    type: "bar",
    data: {
      labels: [pm.xyPct == null ? "Planta XY · sem dado" : "Planta XY", "Planta Z"],
      datasets: [{
        label: "Aderência", data: [pv(pm.xyPct), pv(pm.zPct)],
        backgroundColor: PLANTA_COLORS.green, borderWidth: 0, barPercentage: 0.5, categoryPercentage: 0.7,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `Aderência: ${fmtPct(c.raw)}` } },
        valueLabels: { display: true, formatter: (v) => fmtPct(v), minFontSize: 7, textColor: "#ffffff" },
        limitLines: { yLines: [LIMITS.meta], color: PLANTA_COLORS.gold, dash: [6, 4], width: 1.4 },
      },
      scales: {
        x: { ticks: { color: C.text }, grid: { display: false }, border: { color: C.gridStrong } },
        y: {
          min: 0, max: 100,
          ticks: { color: C.muted, stepSize: 20, callback: (v) => v + "%" },
          grid: { color: C.grid, drawTicks: false },
          border: { color: C.gridStrong },
        },
      },
    },
  }, { dpr: RELATORIO_DPR }));
}

/* Copia um SVG para imagem, com os estilos calculados embutidos (o SVG vira imagem sem o CSS da página). */
const RELATORIO_PROPS_SVG = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "opacity", "fill-opacity", "stroke-opacity"];
function relatorioEstilosEmLinha(orig, copia) {
  const cs = getComputedStyle(orig);
  copia.setAttribute("style", RELATORIO_PROPS_SVG.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";"));
  for (let i = 0; i < orig.children.length; i += 1) relatorioEstilosEmLinha(orig.children[i], copia.children[i]);
}

async function relatorioSvgParaCanvas(svg, w, h) {
  const copia = svg.cloneNode(true);
  relatorioEstilosEmLinha(svg, copia);
  copia.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copia.setAttribute("width", w);
  copia.setAttribute("height", h);
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(copia));
  await img.decode();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = RL.BRANCO;
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

/* Mapa de execução do plano: o mesmo desenho da página (desenharMapaSvg), em imagem. */
async function relatorioImagemMapa(plano, holes, visibleIdsByPlan) {
  const caixa = document.createElement("div");
  caixa.style.cssText = "position:fixed;left:-20000px;top:0;width:1200px;height:500px;";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.style.cssText = "width:1200px;height:500px;display:block;";
  caixa.appendChild(svg);
  document.body.appendChild(caixa);
  try {
    if (!desenharMapaSvg(svg, [{ plano, holes }], visibleIdsByPlan, plano)) return null;
    const w = Math.round(RL.LARGURA * RELATORIO_CSS_PX_MM * RELATORIO_DPR);
    return await relatorioSvgParaCanvas(svg, w, Math.round(w * 500 / 1200));
  } catch (e) {
    console.warn("mapa de execução do relatório indisponível:", e);
    return null;
  } finally {
    caixa.remove();
  }
}

/* Mapa 3D do plano: snapshot do módulo map3d.js com os furos visíveis. */
async function relatorioImagem3d(plano, visiveis) {
  if (typeof window.map3dSnapshot !== "function" || !visiveis.length) return null;
  try {
    const lista = visiveis.map((h) => ({
      plano, id: h.id || null, collar: h.collar || null, planned: h.planned || null, real: h.real || null,
    }));
    const url = window.map3dSnapshot(lista,
      Math.round(RL.LARGURA * RELATORIO_CSS_PX_MM), Math.round(150 * RELATORIO_CSS_PX_MM));
    if (!url) return null;
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch (e) {
    console.warn("mapa 3D do relatório indisponível:", e);
    return null;
  }
}

/* Planta XY ou Z do plano: o mesmo cartão da janela "Ver todos os planos" (drawPlantaCardCanvas). */
function relatorioImagemPlanta(p, mode, larg, alt) {
  const cw = Math.round(larg * RELATORIO_CSS_PX_MM);
  const ch = Math.round(alt * RELATORIO_CSS_PX_MM);
  const cv = document.createElement("canvas");
  cv.width = cw * RELATORIO_DPR;
  cv.height = ch * RELATORIO_DPR;
  const ctx = cv.getContext("2d");
  ctx.scale(RELATORIO_DPR, RELATORIO_DPR);
  drawPlantaCardCanvas(ctx, 0, 0, cw, ch, p.plano, plantaItensDoPlano(p), plantaMetrics(p.matches), mode);
  return cv;
}

/* Dados e imagens do plano. Gráficos e plantas usam as funções de desenho do site. */
async function relatorioColetar(plano) {
  const registros = relatorioRegistros(plano);
  const dpr = RELATORIO_DPR;
  const visibleIdsByPlan = new Map([[plano, new Set(registros.map((r) => String(r.id)))]]);
  let holes = null;
  try { holes = await fetchDxfHoles(plano); } catch (e) { holes = null; }
  if (!PLANEJADO) {
    try { await loadPlanejado(); } catch (e) { /* sem coordenadas previstas: a planta não é desenhada */ }
  }
  const planta = holes && PLANEJADO ? plantaParear(plano, holes, plantaTimeFilter()) : null;
  const pm = planta ? plantaMetrics(planta.matches) : null;
  const visiveis = holes ? holes.filter((h) => holeVisivel(plano, h, visibleIdsByPlan)) : [];
  const mapa = holes ? await relatorioImagemMapa(plano, holes, visibleIdsByPlan) : null;
  const img3d = await relatorioImagem3d(plano, visiveis);
  const hs = histogramas(registros);

  const g = {
    angulo: relatorioGrafico(RL.CW, 128, (cv, key) => drawAngle(registros, { canvas: cv, key, dpr })),
    direcao: relatorioGrafico(RL.CW, 128, (cv, key) => drawDirection(registros, { canvas: cv, key, dpr })),
    histAngulo: relatorioGrafico(RL.CW, 54, (cv, key) => drawHist("", hs.angle.valores, { ...hs.angle.opts, canvas: cv, key, dpr })),
    desvioAz: relatorioGrafico(RL.CW, 128, (cv, key) => {
      drawAzByHole(registros, { canvas: cv, key, dpr });
      relatorioAjustarFaixa(CHARTS[key], LIMITS.azimuth);
    }),
    desvioZ: relatorioGrafico(RL.CW, 128, (cv, key) => {
      drawDepthByHole(registros, { canvas: cv, key, dpr });
      relatorioAjustarFaixa(CHARTS[key], LIMITS.depth);
    }),
    histAz: relatorioGrafico(RL.CW, 58, (cv, key) => drawHist("", hs.az.valores, { ...hs.az.opts, canvas: cv, key, dpr })),
    histZ: relatorioGrafico(RL.CW, 58, (cv, key) => drawHist("", hs.depth.valores, { ...hs.depth.opts, canvas: cv, key, dpr })),
    porPlano: relatorioGrafico(RL.CW, 54, (cv, key) => {
      drawByPlan(registros, { canvas: cv, key, dpr });
      relatorioAjustarBarras(CHARTS[key]);
    }),
  };
  const d = {
    registros,
    m: computeMetrics(registros),
    planta,
    pm,
    semDxf: !holes || !holes.length,
    mapa,
    nMapa: visiveis.length,
    img3d,
    g,
    plantaXY: null,
    plantaZ: null,
    gPlanta: null,
  };
  if (planta) {
    d.plantaXY = relatorioImagemPlanta(planta, "xy", RL.CW, 64);
    d.plantaZ = relatorioImagemPlanta(planta, "z", RL.CW, 64);
    d.gPlanta = relatorioGrafico(RL.CW, 48, (cv, key) => relatorioPlantaChart(cv, key, pm));
  }
  return d;
}

/* ---------- Desenho: PDF (jsPDF) e PNG (canvas) ---------- */
function relatorioRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const relatorioFonteUrl = (f) => (f instanceof HTMLCanvasElement ? f.toDataURL("image/png") : f.src);

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
    } else if (o.t === "circ") {
      if (o.vazio) {
        doc.setDrawColor(...relatorioRgb(o.c));
        doc.setLineWidth(o.lw || 0.3);
        doc.circle(o.x, o.y, o.r, "S");
      } else {
        doc.setFillColor(...relatorioRgb(o.c));
        doc.circle(o.x, o.y, o.r, "F");
      }
    } else if (o.t === "img") {
      doc.addImage(o.logo.dataUrl, "PNG", o.x, o.y, o.w, o.h);
    } else if (o.t === "bmp") {
      doc.addImage(relatorioFonteUrl(o.c), "PNG", o.x, o.y, o.w, o.h);
    }
  });
}

/* oy: deslocamento vertical da página dentro da imagem (em mm). */
function relatorioDesenharCanvas(ctx, ops, k, oy = 0) {
  const Y = (y) => (y + oy) * k;
  ops.forEach((o) => {
    if (o.t === "rect") {
      ctx.fillStyle = o.c;
      ctx.fillRect(o.x * k, Y(o.y), o.w * k, o.h * k);
    } else if (o.t === "text") {
      ctx.font = `${o.bold ? "bold " : ""}${o.size * 0.3528 * k}px Arial, Helvetica, sans-serif`;
      ctx.fillStyle = o.c;
      ctx.textAlign = o.align || "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(o.s, o.x * k, Y(o.y));
    } else if (o.t === "line") {
      ctx.strokeStyle = o.c;
      ctx.lineWidth = o.lw * k;
      ctx.beginPath();
      ctx.moveTo(o.x1 * k, Y(o.y1));
      ctx.lineTo(o.x2 * k, Y(o.y2));
      ctx.stroke();
    } else if (o.t === "circ") {
      ctx.beginPath();
      ctx.arc(o.x * k, Y(o.y), o.r * k, 0, Math.PI * 2);
      if (o.vazio) {
        ctx.strokeStyle = o.c;
        ctx.lineWidth = (o.lw || 0.3) * k;
        ctx.stroke();
      } else {
        ctx.fillStyle = o.c;
        ctx.fill();
      }
    } else if (o.t === "img") {
      ctx.drawImage(o.logo.img, o.x * k, Y(o.y), o.w * k, o.h * k);
    } else if (o.t === "bmp") {
      ctx.drawImage(o.c, o.x * k, Y(o.y), o.w * k, o.h * k);
    }
  });
}

/* Logos do topo das lâminas (ENAEX e cliente). Se um não carregar, a lâmina sai sem ele. */
function relatorioCarregarImagem(url) {
  return new Promise((resolve) => {
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
    img.src = url;
  });
}

function relatorioCarregarLogos() {
  if (!RELATORIO_LOGOS_PROMISE) {
    RELATORIO_LOGOS_PROMISE = Promise.all([
      relatorioCarregarImagem(RELATORIO_LOGO_ENAEX_URL),
      relatorioCarregarImagem(RELATORIO_LOGO_CLIENTE_URL),
    ]).then(([enaex, cliente]) => ({ enaex, cliente }));
  }
  return RELATORIO_LOGOS_PROMISE;
}

function relatorioNomeArquivo(plano, ext) {
  const slug = plano.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "plano";
  const d = new Date();
  const data = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `relatorio-desvios_${slug}_${data}.${ext}`;
}

async function exportarRelatorioPdf(meta, pages) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: [RL.W, RL.H], compress: true });
  doc.setProperties({ title: `Relatório de desvios · ${meta.plano}`, creator: "ENAEX · Análise de Desvios" });
  pages.forEach((ops, i) => {
    if (i) doc.addPage([RL.W, RL.H], "landscape");
    relatorioDesenharPdf(doc, ops);
  });
  doc.save(relatorioNomeArquivo(meta.plano, "pdf"));
}

async function exportarRelatorioPng(meta, pages) {
  const { W, H } = RL;
  const altura = pages.length * H + (pages.length - 1) * RELATORIO_GAP_MM;
  const k = Math.min(RELATORIO_PNG_PX_MM, RELATORIO_PX_MAX / altura);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * k);
  canvas.height = Math.round(altura * k);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = RL.REGRA_CLARA;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  pages.forEach((ops, i) => {
    const oy = i * (H + RELATORIO_GAP_MM);
    ctx.fillStyle = RL.BRANCO;
    ctx.fillRect(0, oy * k, W * k, H * k);
    relatorioDesenharCanvas(ctx, ops, k, oy);
  });
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
    const logos = await relatorioCarregarLogos();
    mostrarRelatorioStatus("Desenhando gráficos, plantas e mapas do plano…");
    const d = await relatorioColetar(res.plano);
    const meta = { plano: res.plano, geradoEm: nowBR(), periodo: relatorioPeriodo(), logos };
    const pages = relatorioMontar(meta, res, d);
    if (formato === "png") await exportarRelatorioPng(meta, pages);
    else await exportarRelatorioPdf(meta, pages);
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
