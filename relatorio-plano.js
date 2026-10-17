/* =====================================================================
   Relatório por plano: relatório executivo de um plano, com o período
   (Ano/Mês) da página. Páginas A4 paisagem, montadas uma vez em mm:
     1. Consolidado: KPIs de conformidade, resumo por parâmetro e destaques
     2. Mapa de execução (planejado × executado)
     3. Mapa 3D de execução
     4. Aderência em planta (XY e Z) com os gráficos de aderência
     5. Ângulo frontal e direção dos furos
     6. Desvios de azimute e de profundidade por furo
     7. Distribuições, aderência por plano e como ler os gráficos
     8. Tabela detalhada dos furos fora da tolerância (paginada)
   Gráficos, plantas e mapas são os do site, desenhados fora da tela para o
   plano: drawAngle/drawHist… e desenharMapaSvg (app.js), plantaParear,
   plantaItensDoPlano, drawPlantaCardCanvas e plantaChartConfig (planta.js) e
   map3dSnapshot (map3d.js). PDF: jsPDF (loadJsPdf). PNG: uma imagem com as
   páginas empilhadas, do mesmo layout.
   ===================================================================== */

const RELATORIO_MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const RELATORIO_LOGO_URL = "./assets/enaex-logo-white.png";
const RELATORIO_BUSCA_MIN = 8;                 // a partir deste número de planos aparece o campo de busca
const RELATORIO_CSS_PX_MM = 96 / 25.4;         // pixels CSS por mm (gráficos e plantas fora da tela)
const RELATORIO_DPR = 2;                       // densidade das imagens (gráficos, plantas, mapas)
const RELATORIO_PNG_PX_MM = (1400 / 297) * 2;  // resolução do PNG: página de ~2800 px de largura
const RELATORIO_PX_MAX = 16000;                // altura máxima do PNG, em pixels
const RELATORIO_GAP_MM = 8;                    // espaço entre páginas no PNG

// Geometria e cores, em mm
const RL = {
  W: 297, H: 210, M: 12, LARGURA: 273,
  LINHA: 6, GRUPO_H: 6, SUB_H: 5.5,
  LIMITE: 193,      // última posição de linha antes do rodapé (tabela)
  RODAPE_Y: 199,
  PRETO: "#38424B", TEXTO2: "#4C555D", CINZA: "#6C747B", CINZA_CLARO: "#8A9298",
  VERMELHO: "#E20613", VERM_CLARO: "#FDEBEC", VERDE: "#107C10",
  ZEBRA: "#F3F5F6", REGRA: "#D9DEE2", REGRA_CLARA: "#E6E8EA", BRANCO: "#FFFFFF",
  AZUL_3D: "#1D2A9C",
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
let RELATORIO_CHAVE = 0;

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
  let x = RL.M;
  return RL_COLUNAS.map((c) => {
    const pos = { ...c, x };
    x += c.w;
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

/* Lista com marcador vermelho. Devolve a base da próxima linha. */
function relatorioItens(ops, x, y, w, itens, size) {
  const lh = size * 0.3528 * 1.4;
  let yy = y;
  itens.forEach((texto) => {
    relatorioQuebrar(texto, size, w - 4).forEach((linha, i) => {
      if (i === 0) ops.push({ t: "circ", x: x + 1, y: yy - size * 0.1, r: 0.8, c: RL.VERMELHO, vazio: false });
      ops.push({ t: "text", s: linha, x: x + 4, y: yy, size, c: RL.PRETO });
      yy += lh;
    });
    yy += 1.4;
  });
  return yy;
}

/* Cabeçalho de seção: rótulo, título, subtítulo e filete. Devolve a altura ocupada. */
function relatorioSecao(ops, x, y, w, rotulo, titulo, sub) {
  ops.push({ t: "text", s: rotulo, x, y, size: 6.5, bold: true, c: RL.CINZA });
  ops.push({ t: "text", s: titulo, x, y: y + 6, size: 13, bold: true, c: RL.PRETO });
  let yy = y + 6;
  if (sub) {
    relatorioQuebrar(sub, 7.5, w).forEach((linha) => {
      yy += 4;
      ops.push({ t: "text", s: linha, x, y: yy, size: 7.5, c: RL.CINZA });
    });
  }
  ops.push({ t: "line", x1: x, y1: yy + 2.2, x2: x + w, y2: yy + 2.2, c: RL.REGRA, lw: 0.2 });
  return yy + 7;
}

/* Título de um gráfico ou planta do bloco. Devolve a altura em que a imagem começa. */
function relatorioTituloBloco(ops, x, y, w, titulo, sub) {
  ops.push({ t: "text", s: relatorioCortar(titulo, 9, true, w), x, y, size: 9, bold: true, c: RL.PRETO });
  if (sub) ops.push({ t: "text", s: relatorioCortar(sub, 7, false, w), x, y: y + 4, size: 7, c: RL.CINZA });
  return y + 7.5;
}

/* Aviso em caixa cinza (quando um gráfico ou planta não pode ser desenhado). */
function relatorioAviso(ops, x, y, w, texto) {
  const linhas = relatorioQuebrar(texto, 8, w - 8);
  const h = linhas.length * 8 * 0.3528 * 1.4 + 6;
  ops.push({ t: "rect", x, y, w, h, c: RL.ZEBRA });
  relatorioTexto(ops, x + 4, y + 5, w - 8, texto, 8, RL.TEXTO2);
  return y + h;
}

/* Legenda em uma linha. Itens: {t: "dot" | "ring" | "link" | "linha", c, texto}. */
function relatorioLegenda(ops, x, y, itens) {
  let cx = x;
  itens.forEach((it) => {
    const simbolo = it.t === "dot" || it.t === "ring" ? 1.4 : 0;
    if (it.t === "dot") ops.push({ t: "circ", x: cx + 1.4, y: y - 0.5, r: 1.4, c: it.c, vazio: false });
    else if (it.t === "ring") ops.push({ t: "circ", x: cx + 1.4, y: y - 0.5, r: 1.4, c: it.c, vazio: true, lw: 0.3 });
    else ops.push({ t: "line", x1: cx, y1: y - 0.5, x2: cx + 4.5, y2: y - 0.5, c: it.c, lw: it.t === "link" ? 0.3 : 0.5 });
    const tx = cx + (simbolo ? 3.6 : 5.6);
    ops.push({ t: "text", s: it.texto, x: tx, y, size: 7, c: RL.TEXTO2 });
    cx = tx + relatorioMedir(it.texto, 7, false) + 7;
  });
  return cx;
}

/* Cartões de indicador em uma linha. cartoes: [{k, v, c, dica?}] */
function relatorioCartoes(ops, y, h, cartoes) {
  const { M, LARGURA } = RL;
  const gap = 3;
  const cw = (LARGURA - gap * (cartoes.length - 1)) / cartoes.length;
  cartoes.forEach((cd, i) => {
    const x = M + i * (cw + gap);
    ops.push({ t: "rect", x, y, w: cw, h, c: RL.ZEBRA });
    ops.push({ t: "text", s: relatorioCortar(cd.k, 6.5, true, cw - 6), x: x + 3, y: y + 6, size: 6.5, bold: true, c: RL.CINZA });
    ops.push({ t: "text", s: cd.v, x: x + 3, y: y + (cd.dica ? 13 : 13.5), size: cd.dica ? 13 : 15, bold: true, c: cd.c });
    if (cd.dica) ops.push({ t: "text", s: relatorioCortar(cd.dica, 6.5, false, cw - 6), x: x + 3, y: y + 17.5, size: 6.5, c: RL.CINZA });
  });
}

/* Tabela de conformidade por parâmetro (largura fixa de 146 mm). Devolve a base após a tabela. */
function relatorioResumoTabela(ops, x, y, params) {
  const cols = [
    { t: "Parâmetro", w: 58, al: "left" },
    { t: "Avaliados", w: 22, al: "center" },
    { t: "Dentro", w: 20, al: "center" },
    { t: "Fora", w: 20, al: "center" },
    { t: "Conformidade", w: 26, al: "center" },
  ];
  const largura = cols.reduce((s, c) => s + c.w, 0);
  const cabH = 6, linhaH = 8;
  ops.push({ t: "rect", x, y, w: largura, h: cabH, c: RL.PRETO });
  let cx = x;
  cols.forEach((c) => {
    const tx = c.al === "left" ? cx + 2 : cx + c.w / 2;
    ops.push({ t: "text", s: c.t, x: tx, y: y + 4, size: 6.5, bold: true, c: RL.BRANCO, align: c.al });
    cx += c.w;
  });
  let yy = y + cabH;
  params.forEach((p, i) => {
    if (i % 2 === 1) ops.push({ t: "rect", x, y: yy, w: largura, h: linhaH, c: RL.ZEBRA });
    const fora = p.total != null && p.ok != null ? p.total - p.ok : null;
    const valores = [
      p.nome,
      p.total != null ? fmtInt(p.total) : "—",
      p.ok != null ? fmtInt(p.ok) : "—",
      fora != null ? fmtInt(fora) : "—",
      p.pct != null ? `${relatorioNum(p.pct, 1)}%` : "—",
    ];
    let x2 = x;
    cols.forEach((c, j) => {
      const atencao = j === 4 && p.pct != null;
      const cor = j === 4
        ? (p.pct == null ? RL.CINZA : p.pct >= LIMITS.meta ? RL.VERDE : RL.VERMELHO)
        : (j === 3 && fora ? RL.VERMELHO : RL.PRETO);
      const tx = c.al === "left" ? x2 + 2 : x2 + c.w / 2;
      ops.push({
        t: "text", s: relatorioCortar(valores[j], 7.5, atencao || j === 0, c.w - 4),
        x: tx, y: yy + 5, size: 7.5, bold: atencao || j === 0, c: cor, align: c.al,
      });
      x2 += c.w;
    });
    ops.push({ t: "line", x1: x, y1: yy + linhaH, x2: x + largura, y2: yy + linhaH, c: RL.REGRA, lw: 0.15 });
    yy += linhaH;
  });
  return yy;
}

/* ---------- Cabeçalho e rodapé das páginas ---------- */
function relatorioContinuacao(ops, meta, titulo) {
  ops.push({ t: "text", s: `Plano ${meta.plano} · ${titulo}`, x: RL.M, y: 7.5, size: 8, c: RL.CINZA });
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

/* ---------- Indicadores do plano ---------- */
/* Conformidade por parâmetro. pct é null quando não há dado (ex.: sem DXF para o collar). */
function relatorioParametros(d) {
  const { m, pm } = d;
  const pv = (v) => (v != null && isFinite(v) ? v : null);
  return [
    { nome: "Ângulo frontal", curto: "ângulo", rotuloCard: "Conformidade · ângulo", total: m.angleTotal, ok: m.angleOk, pct: pv(m.anglePct) },
    { nome: "Azimute", curto: "azimute", rotuloCard: "Conformidade · azimute", total: m.azTotal, ok: m.azOk, pct: pv(m.azPct) },
    { nome: `Profundidade (±${relatorioNum(LIMITS.depth)} m)`, curto: "profundidade", rotuloCard: "Conformidade · profundidade", total: m.zTotal, ok: m.zOk, pct: pv(m.zPct) },
    { nome: "Collar em planta (XY)", curto: "collar em planta (XY)", rotuloCard: "Aderência · collar XY", total: pm ? pm.n : null, ok: pm ? pm.xy : null, pct: pm ? pv(pm.xyPct) : null },
    { nome: "Cota do collar (Z)", curto: "cota do collar (Z)", rotuloCard: "Aderência · collar Z", total: pm ? pm.n : null, ok: pm ? pm.z : null, pct: pm ? pv(pm.zPct) : null },
  ];
}

/* Destaques em texto, calculados a partir dos dados do plano. */
function relatorioDestaques(ctx) {
  const { res, d, params } = ctx;
  const itens = [];
  const meta = LIMITS.meta;
  if (!res.nDesvios) itens.push(`Todos os ${fmtInt(res.total)} furos do período estão dentro das tolerâncias.`);
  else itens.push(`${fmtInt(res.nDesvios)} de ${fmtInt(res.total)} furos (${relatorioNum((res.nDesvios / res.total) * 100, 1)}%) estão fora de pelo menos uma tolerância.`);

  const comPct = params.filter((p) => p.pct != null);
  if (comPct.length) {
    const critico = comPct.reduce((a, b) => (b.pct < a.pct ? b : a));
    if (critico.pct >= meta) itens.push(`Todos os parâmetros avaliados atingem a meta de ${meta}%.`);
    else {
      itens.push(`Parâmetro mais crítico: ${critico.curto}, com ${relatorioNum(critico.pct, 1)}% de conformidade (${fmtInt(critico.total - critico.ok)} de ${fmtInt(critico.total)} furos fora do limite).`);
      const abaixo = comPct.filter((p) => p.pct < meta).map((p) => p.curto);
      itens.push(`Abaixo da meta de ${meta}%: ${abaixo.join(", ")}.`);
    }
  }

  const reg = d.registros;
  const exp = LIMITS.angleExpected;
  const maxAng = reg.filter((r) => r.angle != null)
    .reduce((a, r) => (!a || Math.abs(r.angle - exp) > Math.abs(a.angle - exp) ? r : a), null);
  if (maxAng) itens.push(`Maior desvio de ângulo: furo ${furoNome(maxAng)}, ${relatorioNum(maxAng.angle)}° (${relatorioSinal(maxAng.angle - exp)}° em relação ao previsto de ${relatorioNum(exp)}°).`);
  const maxAz = reg.filter((r) => r.azDelta != null)
    .reduce((a, r) => (!a || Math.abs(r.azDelta) > Math.abs(a.azDelta) ? r : a), null);
  if (maxAz) itens.push(`Maior desvio de azimute: furo ${furoNome(maxAz)}, ${relatorioSinal(maxAz.azDelta)}° (limite ±${relatorioNum(LIMITS.azimuth)}°).`);
  const maxZ = reg.filter((r) => r.depthDelta != null)
    .reduce((a, r) => (!a || Math.abs(r.depthDelta) > Math.abs(a.depthDelta) ? r : a), null);
  if (maxZ) itens.push(`Maior desvio de profundidade: furo ${furoNome(maxZ)}, ${relatorioSinal(maxZ.depthDelta)} m (limite ±${relatorioNum(LIMITS.depth)} m).`);

  if (d.planta && d.planta.matches.length) {
    const ms = d.planta.matches;
    const maxXY = ms.reduce((a, m) => (!a || m.dxy > a.dxy ? m : a), null);
    itens.push(`Maior afastamento do collar em planta: furo ${furoNome(maxXY.r)}, ${relatorioNum(maxXY.dxy, 2)} m (limite ${relatorioNum(tolXY(maxXY.p), 2)} m).`);
    const maxDz = ms.reduce((a, m) => (!a || Math.abs(m.dz) > Math.abs(a.dz) ? m : a), null);
    itens.push(`Maior diferença de cota do collar: furo ${furoNome(maxDz.r)}, ${relatorioSinal(maxDz.dz)} m (limite ±${relatorioNum(LIMITS.depth)} m).`);
  } else if (d.semDxf) {
    itens.push("Sem desenho DXF para o plano: a aderência do collar em planta não foi avaliada.");
  }

  const multi = res.desvios.filter((x) => x.fora.length > 1).length;
  if (multi) itens.push(`${fmtInt(multi)} ${multi === 1 ? "furo tem" : "furos têm"} desvio em mais de um parâmetro.`);
  return itens;
}

/* ---------- Páginas ---------- */
function relatorioPaginaConsolidado(ops, ctx) {
  const { meta, res, params } = ctx;
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

  // Indicadores de furos e desvios
  const pct = (res.nDesvios / res.total) * 100;
  relatorioCartoes(ops, 48, 16, [
    { k: "Furos analisados", v: fmtInt(res.total), c: RL.PRETO },
    { k: `Furos com desvio · ${relatorioNum(pct, 1)}%`, v: fmtInt(res.nDesvios), c: RL.VERMELHO },
    { k: "Fora do ângulo", v: fmtInt(res.porCriterio.Ângulo), c: res.porCriterio.Ângulo ? RL.VERMELHO : RL.PRETO },
    { k: "Fora do azimute", v: fmtInt(res.porCriterio.Azimute), c: res.porCriterio.Azimute ? RL.VERMELHO : RL.PRETO },
    { k: "Fora da profundidade", v: fmtInt(res.porCriterio.Profundidade), c: res.porCriterio.Profundidade ? RL.VERMELHO : RL.PRETO },
  ]);

  // Conformidade por parâmetro, com a meta
  relatorioCartoes(ops, 68, 20, params.map((p) => ({
    k: p.rotuloCard,
    v: p.pct != null ? `${relatorioNum(p.pct, 1)}%` : "—",
    c: p.pct == null ? RL.CINZA : p.pct >= LIMITS.meta ? RL.VERDE : RL.VERMELHO,
    dica: p.total != null ? `${fmtInt(p.ok)} de ${fmtInt(p.total)} furos · meta ${LIMITS.meta}%` : "Sem DXF ou coordenadas previstas",
  })));

  // Resumo por parâmetro (esquerda) e destaques (direita)
  const yS = 94;
  const TW = 146, XD = M + TW + 10, WD = W - M - XD;
  ops.push({ t: "text", s: "RESUMO POR PARÂMETRO", x: M, y: yS, size: 6.5, bold: true, c: RL.CINZA });
  ops.push({ t: "line", x1: M, y1: yS + 2.2, x2: M + TW, y2: yS + 2.2, c: RL.REGRA, lw: 0.2 });
  const yT = relatorioResumoTabela(ops, M, yS + 5, params);
  relatorioTexto(ops, M, yT + 4.5, TW, `Fora = furos fora do limite no parâmetro. Conformidade em verde atinge a meta de ${LIMITS.meta}%; em vermelho, fica abaixo dela.`, 6.8, RL.CINZA);

  ops.push({ t: "text", s: "DESTAQUES", x: XD, y: yS, size: 6.5, bold: true, c: RL.CINZA });
  ops.push({ t: "line", x1: XD, y1: yS + 2.2, x2: XD + WD, y2: yS + 2.2, c: RL.REGRA, lw: 0.2 });
  relatorioItens(ops, XD, yS + 9, WD, relatorioDestaques(ctx), 7.5);

  // Critérios de avaliação (esquerda, embaixo da tabela)
  const yC = 158;
  ops.push({ t: "text", s: "CRITÉRIOS DE AVALIAÇÃO", x: M, y: yC, size: 6.5, bold: true, c: RL.CINZA });
  ops.push({ t: "line", x1: M, y1: yC + 2.2, x2: M + TW, y2: yC + 2.2, c: RL.REGRA, lw: 0.2 });
  relatorioItens(ops, M, yC + 7, TW, [
    `Ângulo frontal: entre ${relatorioNum(LIMITS.angleMin)}° e ${relatorioNum(LIMITS.angleMax)}° (previsto ${relatorioNum(LIMITS.angleExpected)}°).`,
    `Azimute: desvio de até ±${relatorioNum(LIMITS.azimuth)}° em relação ao previsto.`,
    `Profundidade: desvio de até ±${relatorioNum(LIMITS.depth)} m em relação ao previsto.`,
    `Collar em planta (XY): distância de até ${PLANTA_DISP_FATOR} × diâmetro projetado do furo. Cada collar previsto é pareado ao realizado mais próximo (até ${relatorioNum(COLLAR_MATCH_MAX, 1)} m).`,
    `Collar em cota (Z): diferença de até ±${relatorioNum(LIMITS.depth)} m entre o realizado e o previsto.`,
    `Meta de aderência: ${LIMITS.meta}% dos furos dentro do limite de cada parâmetro.`,
  ], 6.8);
}

function relatorioPaginaMapa(ops, ctx) {
  const { d } = ctx;
  const { M, LARGURA } = RL;
  const y = relatorioSecao(ops, M, 16, LARGURA, "GEOMETRIA", "Mapa de execução",
    "Planejado em cinza, executado em vermelho e emboque (ponto) de cada furo do período. Coordenadas do desenho DXF do plano.");
  const h = LARGURA * 500 / 1200;
  if (!d.mapa) {
    relatorioAviso(ops, M, y + 4, LARGURA, "Sem desenho DXF com geometria para os furos do período: o mapa de execução não pode ser desenhado.");
    return;
  }
  ops.push({ t: "bmp", x: M, y: y + 1, w: LARGURA, h, c: d.mapa });
  const yL = y + h + 6;
  relatorioLegenda(ops, M, yL, [
    { t: "linha", c: RL.CINZA_CLARO, texto: "Planejado" },
    { t: "linha", c: RL.VERMELHO, texto: "Executado" },
    { t: "dot", c: RL.PRETO, texto: "Emboque" },
  ]);
  relatorioTexto(ops, M, yL + 8, LARGURA, `${fmtInt(d.nMapa)} ${d.nMapa === 1 ? "furo" : "furos"} do período com geometria no mapa.`, 7.5, RL.CINZA);
}

function relatorioPaginaMapa3d(ops, ctx) {
  const { d } = ctx;
  const { M, LARGURA } = RL;
  const y = relatorioSecao(ops, M, 16, LARGURA, "GEOMETRIA 3D", "Mapa 3D de execução",
    "Vista em perspectiva do plano, com os mesmos furos e o mesmo período do relatório.");
  if (!d.img3d) {
    relatorioAviso(ops, M, y + 4, LARGURA, "Mapa 3D indisponível: é preciso um navegador com WebGL e um DXF com geometria para o plano.");
    return;
  }
  const h = LARGURA * 150 / 273;
  ops.push({ t: "bmp", x: M, y: y + 1, w: LARGURA, h, c: d.img3d });
  relatorioLegenda(ops, M, y + h + 6, [
    { t: "linha", c: RL.CINZA_CLARO, texto: "Planejado (tubos translúcidos)" },
    { t: "linha", c: RL.VERMELHO, texto: "Executado" },
    { t: "dot", c: RL.AZUL_3D, texto: "Emboque" },
  ]);
}

function relatorioPaginaPlantas(ops, ctx) {
  const { d } = ctx;
  const { M, LARGURA } = RL;
  const W2 = 135, X2 = M + LARGURA - W2, H2 = 88;
  const y = relatorioSecao(ops, M, 16, LARGURA, "COLLAR PREVISTO × REALIZADO", "Aderência em planta",
    `XY: distância em planta entre o collar previsto e o realizado (limite de ${PLANTA_DISP_FATOR} × diâmetro projetado). Z: diferença de cota (limite de ±${relatorioNum(LIMITS.depth)} m).`);
  if (!d.plantaXY) {
    relatorioAviso(ops, M, y + 4, LARGURA, d.semDxf
      ? "Sem desenho DXF para o plano: a planta em XY e Z não pode ser desenhada."
      : "Coordenadas previstas indisponíveis para este plano: a planta não pode ser desenhada.");
    return;
  }
  ops.push({ t: "bmp", x: M, y, w: W2, h: H2, c: d.plantaXY });
  ops.push({ t: "bmp", x: X2, y, w: W2, h: H2, c: d.plantaZ });
  relatorioLegenda(ops, M, y + H2 + 6, [
    { t: "dot", c: PLANTA_COLORS.ok, texto: "Dentro da tolerância" },
    { t: "dot", c: PLANTA_COLORS.red, texto: "Fora da tolerância" },
    { t: "dot", c: PLANTA_COLORS.blue, texto: "Realizado sem previsto" },
    { t: "ring", c: PLANTA_COLORS.planned, texto: "Collar previsto" },
    { t: "link", c: "#9AA2A9", texto: "Ligação previsto × realizado" },
  ]);
  const yg = y + H2 + 13;
  const yT = relatorioTituloBloco(ops, M, yg, W2, "XY · aderência do collar em planta", "Percentual de furos dentro do limite XY, por plano");
  ops.push({ t: "bmp", x: M, y: yT, w: W2, h: 50, c: d.gPlantaXY });
  const yZ = relatorioTituloBloco(ops, X2, yg, W2, "Z · aderência da cota do collar", "Percentual de furos dentro do limite Z, por plano");
  ops.push({ t: "bmp", x: X2, y: yZ, w: W2, h: 50, c: d.gPlantaZ });
}

function relatorioPaginaAngulo(ops, ctx) {
  const { d } = ctx;
  const { M, LARGURA } = RL;
  const W2 = 135, X2 = M + LARGURA - W2;
  const y = relatorioSecao(ops, M, 16, LARGURA, "ÂNGULO E DIREÇÃO", "Ângulo frontal e direção dos furos",
    `Inclinação executada de cada furo e posição de cada furo em relação ao previsto. Zona de aderência: ângulo entre ${relatorioNum(LIMITS.angleMin)}° e ${relatorioNum(LIMITS.angleMax)}°, azimute de ±${relatorioNum(LIMITS.azimuth)}° e profundidade de ±${relatorioNum(LIMITS.depth)} m.`);
  const y1 = relatorioTituloBloco(ops, M, y, LARGURA, "Ângulo frontal por furo", `Limites ${relatorioNum(LIMITS.angleMin)}° e ${relatorioNum(LIMITS.angleMax)}° (linhas vermelhas)`);
  ops.push({ t: "bmp", x: M, y: y1, w: LARGURA, h: 60, c: d.g.angulo });
  const y2 = y1 + 60 + 6;
  const yA = relatorioTituloBloco(ops, M, y2, W2, "Direção dos furos", "Cada ponto é um furo; o retângulo é a zona de aderência");
  ops.push({ t: "bmp", x: M, y: yA, w: W2, h: 80, c: d.g.direcao });
  const yB = relatorioTituloBloco(ops, X2, y2, W2, "Distribuição do ângulo frontal", "Histograma da inclinação executada (°)");
  ops.push({ t: "bmp", x: X2, y: yB, w: W2, h: 80, c: d.g.histAngulo });
}

function relatorioPaginaDesvios(ops, ctx) {
  const { d } = ctx;
  const { M, LARGURA } = RL;
  const y = relatorioSecao(ops, M, 16, LARGURA, "AZIMUTE E PROFUNDIDADE", "Desvios por furo",
    "Cada barra é um furo do período. Barras vermelhas ficaram fora do limite.");
  const y1 = relatorioTituloBloco(ops, M, y, LARGURA, "Desvio de azimute por furo", `Executado menos previsto (°) · limites ±${relatorioNum(LIMITS.azimuth)}°`);
  ops.push({ t: "bmp", x: M, y: y1, w: LARGURA, h: 70, c: d.g.desvioAz });
  const y2 = relatorioTituloBloco(ops, M, y1 + 74, LARGURA, "Desvio de profundidade por furo", `Executado menos previsto (m) · limites ±${relatorioNum(LIMITS.depth)} m`);
  ops.push({ t: "bmp", x: M, y: y2, w: LARGURA, h: 70, c: d.g.desvioZ });
}

function relatorioPaginaDistribuicoes(ops, ctx) {
  const { d } = ctx;
  const { M, LARGURA } = RL;
  const W2 = 135, X2 = M + LARGURA - W2;
  const y = relatorioSecao(ops, M, 16, LARGURA, "DISTRIBUIÇÕES", "Histogramas e aderência por plano",
    "Quantos furos caem em cada faixa de desvio. Faixas vermelhas estão fora do limite.");
  const yA = relatorioTituloBloco(ops, M, y, W2, "Distribuição do desvio de azimute", "Quantidade de furos por faixa de desvio em planta");
  ops.push({ t: "bmp", x: M, y: yA, w: W2, h: 72, c: d.g.histAz });
  const yB = relatorioTituloBloco(ops, X2, y, W2, "Distribuição do desvio de profundidade", "Quantidade de furos por faixa de desvio (m)");
  ops.push({ t: "bmp", x: X2, y: yB, w: W2, h: 72, c: d.g.histZ });
  const y3 = yA + 72 + 8;
  const yC = relatorioTituloBloco(ops, M, y3, W2, "Aderência por plano", "% de furos dentro do limite: ângulo, azimute e profundidade");
  ops.push({ t: "bmp", x: M, y: yC, w: W2, h: 60, c: d.g.porPlano });
  const yL = relatorioTituloBloco(ops, X2, y3, W2, "Como ler os gráficos", "Resumo do que cada gráfico mostra");
  relatorioItens(ops, X2, yL + 3, W2, [
    "Cada ponto ou barra é um furo do período; vermelho indica fora do limite.",
    `A zona de aderência é a faixa de -${relatorioNum(LIMITS.azimuth)}° a +${relatorioNum(LIMITS.azimuth)}° de azimute e de -${relatorioNum(LIMITS.depth)} m a +${relatorioNum(LIMITS.depth)} m de profundidade.`,
    "Os histogramas agrupam os furos por faixa: quanto mais furos concentrados no centro, mais aderente o plano.",
    `Em aderência por plano, a linha tracejada vermelha marca a meta de ${LIMITS.meta}%.`,
    d.planta ? "Nas plantas, o círculo é o collar previsto e o ponto, o collar realizado." : "Sem DXF, a aderência do collar em planta não foi avaliada.",
  ], 7.5);
}

/* Tabela dos furos fora da tolerância, paginada (o cabeçalho se repete em cada página). */
function relatorioPaginasTabela(ctx, nova) {
  const { res } = ctx;
  let ops = nova(null);
  let y = relatorioSecao(ops, RL.M, 16, RL.LARGURA, "DETALHAMENTO", "Furos fora da tolerância",
    `${fmtInt(res.nDesvios)} ${res.nDesvios === 1 ? "furo" : "furos"} com desvio, em ordem de número. Vermelho: valor fora do limite.`);
  y = relatorioCabecalhoTabela(ops, y + 1);
  if (!res.desvios.length) {
    relatorioTexto(ops, RL.M, y + 8, RL.LARGURA, "Nenhum furo fora da tolerância no período.", 9, RL.TEXTO2);
  }
  res.desvios.forEach(({ r, fora }, i) => {
    if (y + RL.LINHA > RL.LIMITE) {
      ops = nova("Detalhe dos furos (continuação)");
      y = relatorioCabecalhoTabela(ops, 14);
    }
    relatorioLinhaTabela(ops, y, relatorioLinha(r, fora), fora, i % 2 === 1);
    y += RL.LINHA;
  });
}

/* Monta todas as páginas do relatório (cada página é uma lista de operações em mm). */
function relatorioMontar(meta, res, d) {
  const ctx = { meta, res, d, params: relatorioParametros(d) };
  const pages = [];
  const nova = (titulo) => {
    const ops = [];
    pages.push(ops);
    if (titulo) relatorioContinuacao(ops, meta, titulo);
    return ops;
  };
  relatorioPaginaConsolidado(nova(null), ctx);
  relatorioPaginaMapa(nova("Mapa de execução"), ctx);
  relatorioPaginaMapa3d(nova("Mapa 3D de execução"), ctx);
  relatorioPaginaPlantas(nova("Aderência em planta"), ctx);
  relatorioPaginaAngulo(nova("Ângulo frontal e direção"), ctx);
  relatorioPaginaDesvios(nova("Desvios por furo"), ctx);
  relatorioPaginaDistribuicoes(nova("Histogramas e aderência por plano"), ctx);
  relatorioPaginasTabela(ctx, nova);
  pages.forEach((p, i) => relatorioRodape(p, i + 1, pages.length, RL.RODAPE_Y));
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

/* Gráfico de aderência de um plano. A meta vira linha horizontal (limitLines) porque uma série
   de meta com um único rótulo não desenha segmento. */
function relatorioPlantaChart(cv, key, plano, pct, n) {
  const cfg = plantaChartConfig([plano], [pct], [n]);
  cfg.data.datasets = cfg.data.datasets.filter((ds) => ds.label !== "Meta");
  cfg.options.plugins.limitLines = { yLines: [LIMITS.meta], color: PLANTA_COLORS.gold, dash: [6, 4], width: 1.4 };
  CHARTS[key] = new Chart(cv, aplicarAlvo(cfg, { dpr: RELATORIO_DPR }));
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
    angulo: relatorioGrafico(273, 60, (cv, key) => drawAngle(registros, { canvas: cv, key, dpr })),
    direcao: relatorioGrafico(135, 80, (cv, key) => drawDirection(registros, { canvas: cv, key, dpr })),
    histAngulo: relatorioGrafico(135, 80, (cv, key) => drawHist("", hs.angle.valores, { ...hs.angle.opts, canvas: cv, key, dpr })),
    desvioAz: relatorioGrafico(273, 70, (cv, key) => drawAzByHole(registros, { canvas: cv, key, dpr })),
    desvioZ: relatorioGrafico(273, 70, (cv, key) => drawDepthByHole(registros, { canvas: cv, key, dpr })),
    histAz: relatorioGrafico(135, 74, (cv, key) => drawHist("", hs.az.valores, { ...hs.az.opts, canvas: cv, key, dpr })),
    histZ: relatorioGrafico(135, 74, (cv, key) => drawHist("", hs.depth.valores, { ...hs.depth.opts, canvas: cv, key, dpr })),
    porPlano: relatorioGrafico(135, 66, (cv, key) => drawByPlan(registros, { canvas: cv, key, dpr })),
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
    gPlantaXY: null,
    gPlantaZ: null,
  };
  if (planta) {
    d.plantaXY = relatorioImagemPlanta(planta, "xy", 135, 88);
    d.plantaZ = relatorioImagemPlanta(planta, "z", 135, 88);
    d.gPlantaXY = relatorioGrafico(135, 50, (cv, key) => relatorioPlantaChart(cv, key, plano, pm.xyPct, pm.n));
    d.gPlantaZ = relatorioGrafico(135, 50, (cv, key) => relatorioPlantaChart(cv, key, plano, pm.zPct, pm.n));
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

async function exportarRelatorioPdf(meta, pages) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: `Relatório de desvios · ${meta.plano}`, creator: "ENAEX · Análise de Desvios" });
  pages.forEach((ops, i) => {
    if (i) doc.addPage("a4", "landscape");
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
    const logo = await relatorioCarregarLogo();
    mostrarRelatorioStatus("Desenhando gráficos, plantas e mapas do plano…");
    const d = await relatorioColetar(res.plano);
    const meta = { plano: res.plano, geradoEm: nowBR(), periodo: relatorioPeriodo(), logo };
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
