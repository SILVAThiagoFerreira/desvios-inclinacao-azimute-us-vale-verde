/*
 * Exportação Excel ENAEX v2
 *
 * Este módulo é carregado depois de app.js e substitui o exportador antigo.
 * Os gráficos são inseridos como objetos chart OOXML editáveis; nenhum canvas
 * ou PNG de gráfico é copiado para o arquivo final.
 */

const EXCEL_CLEAN_THEME = {
  red: "FFE20613",
  dark: "FF38424B",
  ink: "FF303941",
  muted: "FF6C747B",
  pale: "FFF3F5F6",
  border: "FFD9DEE2",
  white: "FFFFFFFF",
  green: "FF107C10",
  greenFill: "FFEAF5EA",
  alertFill: "FFFDEBEC",
  blue: "FF2E86AB",
  orange: "FFE76F51",
  teal: "FF2A9D8F",
  purple: "FF7B2CBF",
  yellow: "FFE9C46A",
};

function excelCleanFill(argb) {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function excelCleanStyleHeader(row) {
  row.height = 28;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: EXCEL_CLEAN_THEME.white } };
    cell.fill = excelCleanFill(EXCEL_CLEAN_THEME.dark);
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: EXCEL_CLEAN_THEME.border } },
      bottom: { style: "thin", color: { argb: EXCEL_CLEAN_THEME.border } },
    };
  });
}

function excelCleanStyleSection(row, totalColumns) {
  row.height = 22;
  for (let column = 1; column <= totalColumns; column += 1) {
    const cell = row.getCell(column);
    cell.fill = excelCleanFill(EXCEL_CLEAN_THEME.red);
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: EXCEL_CLEAN_THEME.white } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = { bottom: { style: "thin", color: { argb: EXCEL_CLEAN_THEME.red } } };
  }
}

function excelCleanStyleRows(sheet, firstRow, lastRow, totalColumns) {
  if (lastRow < firstRow) return;
  for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.font = { name: "Aptos", size: 10, color: { argb: EXCEL_CLEAN_THEME.ink } };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: column === 1 };
      cell.border = { bottom: { style: "hair", color: { argb: EXCEL_CLEAN_THEME.border } } };
      if (rowNumber % 2 === 0) cell.fill = excelCleanFill(EXCEL_CLEAN_THEME.pale);
    });
    for (let column = 1; column <= totalColumns; column += 1) {
      const cell = row.getCell(column);
      if (cell.value === "Sim") {
        cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: EXCEL_CLEAN_THEME.green } };
        cell.fill = excelCleanFill(EXCEL_CLEAN_THEME.greenFill);
      } else if (cell.value === "Não") {
        cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: EXCEL_CLEAN_THEME.red } };
        cell.fill = excelCleanFill(EXCEL_CLEAN_THEME.alertFill);
      } else if (cell.value === "N/A") {
        cell.font = { name: "Aptos", size: 10, italic: true, color: { argb: EXCEL_CLEAN_THEME.muted } };
      }
    }
  }
}

function excelCleanReportHeader(sheet, title, subtitle, totalColumns, logoId = null) {
  const columns = Math.max(totalColumns, 2);
  sheet.mergeCells(1, 1, 1, columns);
  sheet.mergeCells(2, 1, 2, columns);
  sheet.getCell(1, 1).value = title;
  sheet.getCell(2, 1).value = subtitle;
  for (let column = 1; column <= columns; column += 1) {
    const titleCell = sheet.getCell(1, column);
    titleCell.fill = excelCleanFill(EXCEL_CLEAN_THEME.red);
    titleCell.font = { name: "Aptos Display", size: 17, bold: true, color: { argb: EXCEL_CLEAN_THEME.white } };
    titleCell.alignment = { vertical: "middle", horizontal: "left" };
    const subtitleCell = sheet.getCell(2, column);
    subtitleCell.fill = excelCleanFill(EXCEL_CLEAN_THEME.dark);
    subtitleCell.font = { name: "Aptos", size: 10, italic: true, color: { argb: EXCEL_CLEAN_THEME.white } };
    subtitleCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  }
  sheet.getRow(1).height = 36;
  sheet.getRow(2).height = 26;
  sheet.getRow(3).height = 8;
  if (logoId != null && typeof sheet.addImage === "function") {
    sheet.addImage(logoId, {
      tl: { col: Math.max(columns - 3, 0.4), row: 0.24 },
      ext: { width: 56, height: 17 },
    });
  }
  sheet.views = [{ state: "frozen", ySplit: 4, showGridLines: false, zoomScale: 90 }];
}

function excelCleanHistogram(values, bins, min, max, digits) {
  if (!values.length) return [];
  if (min == null) min = Math.min(...values);
  if (max == null) max = Math.max(...values);
  if (!(max > min)) {
    const center = Number.isFinite(min) ? min : 0;
    const margin = Math.max(Math.abs(center) * 0.05, 0.5);
    min = center - margin;
    max = center + margin;
  }
  const step = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  values.forEach((value) => {
    let index = Math.floor((value - min) / step);
    if (index < 0) index = 0;
    if (index >= bins) index = bins - 1;
    counts[index] += 1;
  });
  return counts.map((count, index) => [Number((min + step * (index + 0.5)).toFixed(digits)), count]);
}

function excelCleanSetRow(sheet, rowNumber, startColumn, values) {
  values.forEach((value, index) => { sheet.getCell(rowNumber, startColumn + index).value = value; });
}

function excelCleanHoleLabel(row) {
  return `${row.plano} · ${row.id}`;
}

function writeExcelCleanChartData(sheet, data) {
  excelCleanSetRow(sheet, 1, 1, [
    "Plano", "Identificador do furo", "Ângulo frontal (°)", "Ângulo mín.", "Ângulo máx.",
    "Δ Azimute (°)", "Azimute mín.", "Azimute máx.", "Δ Profundidade (m)", "Z mín.", "Z máx.",
  ]);
  data.forEach((row) => sheet.addRow([
    row.plano, excelCleanHoleLabel(row), row.angle, LIMITS.angleMin, LIMITS.angleMax,
    row.azDelta, -LIMITS.azimuth, LIMITS.azimuth, row.depthDelta, -LIMITS.depth, LIMITS.depth,
  ]));
  const holeStart = 2;
  const holeEnd = data.length + 1;

  const groups = {};
  data.forEach((row) => (groups[row.plano] ||= []).push(row));
  const planos = Object.keys(groups).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  const planStart = holeEnd + 3;
  excelCleanSetRow(sheet, planStart - 1, 13, ["Plano", "Aderência Ângulo (%)", "Aderência Azimute (%)", "Aderência Z (%)"]);
  planos.forEach((plano, index) => {
    const metrics = computeMetrics(groups[plano]);
    excelCleanSetRow(sheet, planStart + index, 13, [
      plano,
      isFinite(metrics.anglePct) ? metrics.anglePct : null,
      isFinite(metrics.azPct) ? metrics.azPct : null,
      isFinite(metrics.zPct) ? metrics.zPct : null,
    ]);
  });
  const planEnd = planStart + Math.max(planos.length, 1) - 1;

  const azValues = data.map((row) => row.azDelta).filter((value) => value != null);
  const depthValues = data.map((row) => row.depthDelta).filter((value) => value != null);
  const angleValues = data.map((row) => row.angle).filter((value) => value != null);
  const azExtent = Math.max(...azValues.map((value) => Math.abs(value)), 1) * 1.05;
  const depthExtent = Math.max(...depthValues.map((value) => Math.abs(value)), 0.1) * 1.05;
  const azRows = excelCleanHistogram(azValues, 20, -azExtent, azExtent, 1);
  const depthRows = excelCleanHistogram(depthValues, 20, -depthExtent, depthExtent, 2);
  const angleRows = excelCleanHistogram(angleValues, 18, 0, 30, 1);
  const safeAzRows = azRows.length ? azRows : [[null, 0]];
  const safeDepthRows = depthRows.length ? depthRows : [[null, 0]];
  const safeAngleRows = angleRows.length ? angleRows : [[null, 0]];
  const histStart = planEnd + 3;
  excelCleanSetRow(sheet, histStart - 1, 18, ["Faixa Δ Azimute", "Nº de furos"]);
  excelCleanSetRow(sheet, histStart - 1, 21, ["Faixa Δ Profundidade", "Nº de furos"]);
  excelCleanSetRow(sheet, histStart - 1, 24, ["Faixa Ângulo", "Nº de furos"]);
  const maxHistRows = Math.max(safeAzRows.length, safeDepthRows.length, safeAngleRows.length);
  for (let index = 0; index < maxHistRows; index += 1) {
    excelCleanSetRow(sheet, histStart + index, 18, [safeAzRows[index]?.[0] ?? null, safeAzRows[index]?.[1] ?? 0]);
    excelCleanSetRow(sheet, histStart + index, 21, [safeDepthRows[index]?.[0] ?? null, safeDepthRows[index]?.[1] ?? 0]);
    excelCleanSetRow(sheet, histStart + index, 24, [safeAngleRows[index]?.[0] ?? null, safeAngleRows[index]?.[1] ?? 0]);
  }
  const histEnd = histStart + maxHistRows - 1;
  sheet.getColumn(2).numFmt = "@";
  [3, 4, 5, 6, 7, 8, 9, 10, 11].forEach((column) => { sheet.getColumn(column).numFmt = "0.00"; });
  [14, 15, 16].forEach((column) => { sheet.getColumn(column).numFmt = "0.0"; });
  [18, 21, 24].forEach((column) => { sheet.getColumn(column).numFmt = "0.0"; });
  sheet.views = [{ showGridLines: false }];
  return {
    holeStart, holeEnd, planStart, planEnd, histStart, histEnd,
    angle: { cat: "B", value: "C", min: "D", max: "E" },
    az: { cat: "B", value: "F", min: "G", max: "H" },
    depth: { cat: "B", value: "I", min: "J", max: "K" },
    plan: { cat: "M", angle: "N", az: "O", depth: "P" },
    histAz: { cat: "R", value: "S" },
    histDepth: { cat: "U", value: "V" },
    histAngle: { cat: "X", value: "Y" },
  };
}

function buildExcelCleanChartDefinitions(refs) {
  const holeSeries = (name, column, color, extra = {}) => ({ name, column, start: refs.holeStart, end: refs.holeEnd, color, ...extra });
  return [
    {
      title: "Ângulo frontal por furo", type: "line", cat: [refs.angle.cat, refs.holeStart, refs.holeEnd],
      xTitle: "Plano · ID do furo", yTitle: "Ângulo (°)",
      series: [holeSeries("Ângulo executado", refs.angle.value, EXCEL_CLEAN_THEME.blue), holeSeries("Limite mínimo", refs.angle.min, EXCEL_CLEAN_THEME.red, { dash: "dash" }), holeSeries("Limite máximo", refs.angle.max, EXCEL_CLEAN_THEME.red, { dash: "dash" })],
    },
    {
      title: "Δ Azimute por furo", type: "bar", cat: [refs.az.cat, refs.holeStart, refs.holeEnd],
      xTitle: "Plano · ID do furo", yTitle: "Desvio (°)",
      series: [holeSeries("Δ Azimute", refs.az.value, EXCEL_CLEAN_THEME.orange), holeSeries("Limite mínimo", refs.az.min, EXCEL_CLEAN_THEME.red, { dash: "dash" }), holeSeries("Limite máximo", refs.az.max, EXCEL_CLEAN_THEME.red, { dash: "dash" })],
    },
    {
      title: "Δ Profundidade por furo", type: "bar", cat: [refs.depth.cat, refs.holeStart, refs.holeEnd],
      xTitle: "Plano · ID do furo", yTitle: "Desvio (m)",
      series: [holeSeries("Δ Profundidade", refs.depth.value, EXCEL_CLEAN_THEME.teal), holeSeries("Limite mínimo", refs.depth.min, EXCEL_CLEAN_THEME.red, { dash: "dash" }), holeSeries("Limite máximo", refs.depth.max, EXCEL_CLEAN_THEME.red, { dash: "dash" })],
    },
    {
      title: "Direção dos furos · Δ Azimute × Δ Profundidade", type: "scatter", x: [refs.az.value, refs.holeStart, refs.holeEnd],
      xTitle: "Δ Azimute (°)", yTitle: "Δ Profundidade (m)", series: [holeSeries("Furos", refs.depth.value, EXCEL_CLEAN_THEME.purple)],
    },
    {
      title: "Aderência por plano", type: "bar", cat: [refs.plan.cat, refs.planStart, refs.planEnd], xTitle: "Plano", yTitle: "Aderência (%)",
      series: [
        { name: "Ângulo", column: refs.plan.angle, start: refs.planStart, end: refs.planEnd, color: EXCEL_CLEAN_THEME.blue },
        { name: "Azimute", column: refs.plan.az, start: refs.planStart, end: refs.planEnd, color: EXCEL_CLEAN_THEME.orange },
        { name: "Profundidade (Z)", column: refs.plan.depth, start: refs.planStart, end: refs.planEnd, color: EXCEL_CLEAN_THEME.teal },
      ],
    },
    { title: "Distribuição do Δ Azimute", type: "bar", cat: [refs.histAz.cat, refs.histStart, refs.histEnd], xTitle: "Faixa do desvio (°)", yTitle: "Nº de furos", series: [{ name: "Nº de furos", column: refs.histAz.value, start: refs.histStart, end: refs.histEnd, color: EXCEL_CLEAN_THEME.orange }] },
    { title: "Distribuição do Δ Profundidade", type: "bar", cat: [refs.histDepth.cat, refs.histStart, refs.histEnd], xTitle: "Faixa do desvio (m)", yTitle: "Nº de furos", series: [{ name: "Nº de furos", column: refs.histDepth.value, start: refs.histStart, end: refs.histEnd, color: EXCEL_CLEAN_THEME.teal }] },
    { title: "Distribuição do ângulo frontal", type: "bar", cat: [refs.histAngle.cat, refs.histStart, refs.histEnd], xTitle: "Faixa do ângulo (°)", yTitle: "Nº de furos", series: [{ name: "Nº de furos", column: refs.histAngle.value, start: refs.histStart, end: refs.histEnd, color: EXCEL_CLEAN_THEME.yellow }] },
  ];
}

async function addNativeExcelChartsClean(buffer, refs, chartSheetId) {
  const zip = await JSZip.loadAsync(buffer);
  const ns = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const cns = "http://schemas.openxmlformats.org/drawingml/2006/chart";
  const dataSheet = "Dados gráficos";
  const defs = buildExcelCleanChartDefinitions(refs);
  const escapeXml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
  const ref = (column, start, end) => `'${dataSheet}'!$${column}$${start}:$${column}$${end}`;
  const textXml = (value, size = 900, bold = false) => `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="pt-BR" sz="${size}"${bold ? " b=\"1\"" : ""}/><a:t>${escapeXml(value)}</a:t></a:r></a:p></c:rich></c:tx>`;
  const solid = (argb) => `<a:solidFill><a:srgbClr val="${argb.slice(2)}"/></a:solidFill>`;
  const chartSpPr = `<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="D9DEE2"/></a:solidFill></a:ln></c:spPr>`;
  const seriesSpPr = (item, type) => type === "bar"
    ? `<c:spPr>${solid(item.color)}<a:ln><a:solidFill><a:srgbClr val="${item.color.slice(2)}"/></a:solidFill></a:ln></c:spPr>`
    : `<c:spPr><a:noFill/><a:ln w="19050">${solid(item.color)}${item.dash ? `<a:prstDash val="${item.dash}"/>` : ""}</a:ln></c:spPr>`;
  const axesXml = (def) => {
    const xTitle = def.xTitle ? `<c:title>${textXml(def.xTitle, 850, true)}</c:title>` : "";
    const yTitle = def.yTitle ? `<c:title>${textXml(def.yTitle, 850, true)}</c:title>` : "";
    if (def.type === "scatter") return `<c:valAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${xTitle}<c:majorGridlines/><c:numFmt formatCode="0.00" sourceLinked="0"/><c:crossAx val="11"/><c:crosses val="autoZero"/></c:valAx><c:valAx><c:axId val="11"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>${yTitle}<c:majorGridlines/><c:numFmt formatCode="0.00" sourceLinked="0"/><c:crossAx val="10"/><c:crosses val="autoZero"/></c:valAx>`;
    const categoryCount = def.cat ? def.cat[2] - def.cat[1] + 1 : 0;
    const categorySkip = categoryCount > 100 ? 10 : categoryCount > 40 ? 5 : 1;
    const skipXml = categorySkip > 1 ? `<c:tickLblSkip val="${categorySkip}"/><c:tickMarkSkip val="${categorySkip}"/>` : "";
    return `<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${xTitle}<c:tickLblPos val="nextTo"/>${skipXml}<c:crossAx val="11"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="11"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>${yTitle}<c:majorGridlines/><c:numFmt formatCode="0.00" sourceLinked="0"/><c:crossAx val="10"/><c:crosses val="autoZero"/></c:valAx>`;
  };
  const chartXml = (def) => {
    const kind = def.type === "line" ? "lineChart" : def.type === "scatter" ? "scatterChart" : "barChart";
    const plot = def.type === "scatter"
      ? `<c:scatterStyle val="marker"/><c:varyColors val="0"/>`
      : def.type === "bar"
        ? `<c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>`
        : `<c:grouping val="standard"/><c:varyColors val="0"/>`;
    const series = def.series.map((item, index) => {
      const dataRef = ref(item.column, item.start, item.end);
      const dimensions = def.type === "scatter"
        ? `<c:xVal><c:numRef><c:f>${ref(def.x[0], def.x[1], def.x[2])}</c:f></c:numRef></c:xVal><c:yVal><c:numRef><c:f>${dataRef}</c:f></c:numRef></c:yVal>`
        : `<c:cat><c:strRef><c:f>${ref(def.cat[0], def.cat[1], def.cat[2])}</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>${dataRef}</c:f></c:numRef></c:val>`;
      const marker = def.type === "scatter" ? `<c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr>${solid(item.color)}<a:ln><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>` : "";
      return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${textXml(item.name)}${seriesSpPr(item, def.type)}${marker}${dimensions}</c:ser>`;
    }).join("");
    const axes = `<c:axId val="10"/><c:axId val="11"/>`;
    const plotTail = def.type === "bar" ? `<c:gapWidth val="55"/><c:overlap val="0"/>` : def.type === "line" ? `<c:marker val="1"/>` : "";
    const legend = def.series.length > 1 ? `<c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend>` : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="${cns}" xmlns:a="${ns}"><c:date1904 val="0"/><c:lang val="pt-BR"/><c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="0"/>${textXml(def.title, 1400, true)}<c:plotArea><c:layout/><c:${kind}>${plot}${series}${plotTail}${axes}</c:${kind}>${axesXml(def)}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>${chartSpPr}</c:chartSpace>`;
  };

  const chartRelType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
  const drawingRelType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
  defs.forEach((definition, index) => zip.file(`xl/charts/chart${index + 1}.xml`, chartXml(definition)));

  const worksheetPath = `xl/worksheets/sheet${chartSheetId}.xml`;
  const relsPath = `xl/worksheets/_rels/sheet${chartSheetId}.xml.rels`;
  let worksheet = await zip.file(worksheetPath).async("string");
  let rels = zip.file(relsPath) ? await zip.file(relsPath).async("string") : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  const drawingElement = worksheet.match(/<drawing\b[^>]*r:id="([^"]+)"[^>]*\/\s*>/);
  const existingDrawingRelId = drawingElement ? drawingElement[1] : null;
  const drawingRelationship = existingDrawingRelId
    ? [...rels.matchAll(/<Relationship\b[^>]*\/\s*>/g)].map((match) => match[0]).find((entry) => entry.includes(`Id="${existingDrawingRelId}"`) && entry.includes(`Type="${drawingRelType}"`))
    : null;
  const drawingTarget = drawingRelationship?.match(/Target="([^"]+)"/)?.[1];
  const existingDrawingPath = drawingTarget ? `xl/${drawingTarget.replace(/^(\.\.\/)+/, "")}` : null;
  let drawingName = existingDrawingPath?.startsWith("xl/drawings/") ? existingDrawingPath.slice("xl/drawings/".length) : null;
  if (drawingName && !zip.file(existingDrawingPath)) drawingName = null;
  if (existingDrawingRelId && !drawingName) throw new Error("Não foi possível localizar o desenho da aba de gráficos.");

  const allDrawingIndexes = zip.file(/xl\/drawings\/drawing\d+\.xml/).map((entry) => Number((entry.name.match(/drawing(\d+)\.xml$/) || [])[1])).filter(Number.isFinite);
  if (!drawingName) drawingName = `drawing${allDrawingIndexes.length ? Math.max(...allDrawingIndexes) + 1 : 1}.xml`;
  const drawingPath = `xl/drawings/${drawingName}`;
  const drawingRelsPath = `xl/drawings/_rels/${drawingName}.rels`;
  let drawingXml = zip.file(drawingPath) ? await zip.file(drawingPath).async("string") : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${ns}"></xdr:wsDr>`;
  let drawingRels = zip.file(drawingRelsPath) ? await zip.file(drawingRelsPath).async("string") : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  const drawingRelNumbers = [...drawingRels.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1])).filter(Number.isFinite);
  const chartRelStart = drawingRelNumbers.length ? Math.max(...drawingRelNumbers) + 1 : 1;
  const frameIds = [...drawingXml.matchAll(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g)].map((match) => Number(match[1])).filter(Number.isFinite);
  const frameIdStart = frameIds.length ? Math.max(...frameIds) + 1 : 100;
  const anchorXml = (index) => {
    const chartRelId = `rId${chartRelStart + index}`;
    return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${(index % 2) * 9}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${Math.floor(index / 2) * 18 + 4}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${(index % 2) * 9 + 8}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${Math.floor(index / 2) * 18 + 20}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="${frameIdStart + index}" name="Gráfico nativo ${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="${cns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${chartRelId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  };
  drawingXml = drawingXml.replace("</xdr:wsDr>", `${defs.map((_, index) => anchorXml(index)).join("")}</xdr:wsDr>`);
  drawingRels = drawingRels.replace("</Relationships>", `${defs.map((_, index) => `<Relationship Id="rId${chartRelStart + index}" Type="${chartRelType}" Target="../charts/chart${index + 1}.xml"/>`).join("")}</Relationships>`);
  zip.file(drawingPath, drawingXml);
  zip.file(drawingRelsPath, drawingRels);
  if (!existingDrawingRelId) {
    const sheetRelNumbers = [...rels.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1])).filter(Number.isFinite);
    const drawingRelId = `rId${sheetRelNumbers.length ? Math.max(...sheetRelNumbers) + 1 : 1}`;
    rels = rels.replace("</Relationships>", `<Relationship Id="${drawingRelId}" Type="${drawingRelType}" Target="../drawings/${drawingName}"/></Relationships>`);
    worksheet = worksheet.replace("</worksheet>", `<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${drawingRelId}"/></worksheet>`);
  }
  zip.file(relsPath, rels);
  zip.file(worksheetPath, worksheet);
  let contentTypes = await zip.file("[Content_Types].xml").async("string");
  const chartOverrides = defs.map((_, index) => contentTypes.includes(`PartName="/xl/charts/chart${index + 1}.xml"`) ? "" : `<Override PartName="/xl/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join("");
  const drawingOverride = contentTypes.includes(`PartName="/xl/drawings/${drawingName}"`) ? "" : `<Override PartName="/xl/drawings/${drawingName}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`;
  contentTypes = contentTypes.replace("</Types>", chartOverrides + drawingOverride + "</Types>");
  zip.file("[Content_Types].xml", contentTypes);
  let workbookXml = await zip.file("xl/workbook.xml").async("string");
  if (workbookXml.includes("<calcPr")) workbookXml = workbookXml.replace(/<calcPr[^>]*\/>/, `<calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>`);
  else workbookXml = workbookXml.replace("</workbook>", `<calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`);
  zip.file("xl/workbook.xml", workbookXml);
  return zip.generateAsync({ type: "arraybuffer" });
}

/* Sobrescreve o exportador global definido pelo app.js. */
async function exportToXlsx(btn = document.getElementById("export-xlsx")) {
  const originalLabel = btn?.textContent || "⤓ Excel";
  if (btn) { btn.disabled = true; btn.textContent = "Gerando Excel…"; }
  try {
    if (typeof ExcelJS === "undefined" || typeof JSZip === "undefined") throw new Error("As bibliotecas de exportação ainda não terminaram de carregar. Atualize a página e tente novamente.");
    const data = filtered();
    if (!data.length) throw new Error("Nenhum furo no filtro atual para exportar.");
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const dataStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const selectedYear = document.getElementById("filter-year")?.value || "Todos";
    const selectedMonth = document.getElementById("filter-month")?.value || "Todos";
    const months = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const selectedMonthLabel = selectedMonth === "Todos" ? "Todos" : (months[Number(selectedMonth) - 1] || selectedMonth);
    const periodYears = [...new Set(data.map((row) => row.ano).filter((value) => value != null))].sort((a, b) => a - b);
    const periodMonths = [...new Set(data.map((row) => row.mes).filter((value) => value != null))].sort((a, b) => a - b);
    let effectivePeriod = "Base consolidada";
    if (selectedYear !== "Todos" && selectedMonth !== "Todos") effectivePeriod = `${selectedYear} · ${selectedMonthLabel}`;
    else if (selectedYear !== "Todos") effectivePeriod = `${selectedYear} · ${periodMonths.map((value) => months[value - 1] || value).join(", ") || "sem mês"}`;
    else if (selectedMonth !== "Todos") effectivePeriod = `${periodYears.join(", ") || "Ano não identificado"} · ${selectedMonthLabel}`;
    else if (periodYears.length === 1 && periodMonths.length === 1) effectivePeriod = `${periodYears[0]} · ${months[periodMonths[0] - 1] || periodMonths[0]}`;
    const filterLabel = getActiveFilterLabel();
    const withinAngle = (value) => value != null && value >= LIMITS.angleMin && value <= LIMITS.angleMax;
    const withinAz = (value) => value != null && Math.abs(value) <= LIMITS.azimuth;
    const withinZ = (value) => value != null && Math.abs(value) <= LIMITS.depth;
    const rows = data.map((row) => ({
      "Ano": row.ano ?? "", "Mês": row.mes ?? "", "Data": row.data instanceof Date && !isNaN(row.data) ? new Date(row.data.getTime()) : null,
      "Plano": row.plano, "ID": row.id, "Ângulo frontal (°)": row.angle,
      "Azimute planejado (°)": row.azPlan, "Azimute executado (°)": row.azExec, "Δ Azimute (°)": row.azDelta,
      "Profundidade planejada (m)": row.depthPlan, "Profundidade executada (m)": row.depthExec, "Δ Profundidade (m)": row.depthDelta,
      "Ângulo dentro do limite": row.angle == null ? "" : (withinAngle(row.angle) ? "Sim" : "Não"),
      "Azimute dentro do limite": row.azDelta == null ? "" : (withinAz(row.azDelta) ? "Sim" : "Não"),
      "Z dentro do limite": row.depthDelta == null ? "" : (withinZ(row.depthDelta) ? "Sim" : "Não"),
    }));
    const headers = Object.keys(rows[0]);
    const metrics = computeMetrics(data);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "ENAEX · Análise de Desvios";
    workbook.company = "ENAEX";
    workbook.created = now;
    workbook.modified = now;
    const logoId = typeof loadExcelBrandLogo === "function" ? await loadExcelBrandLogo(workbook) : null;

    const summary = workbook.addWorksheet("Resumo");
    excelCleanReportHeader(summary, "Relatório de Desvios de Perfuração", `ENAEX · gerado em ${dataStr} · Período efetivo: ${effectivePeriod} · ${filterLabel}`, 4, logoId);
    summary.mergeCells(4, 1, 4, 4); summary.getCell(4, 1).value = "Identificação e seleção exportada"; excelCleanStyleSection(summary.getRow(4), 4);
    summary.addRows([["Gerado em", dataStr, "", ""], ["Ano selecionado", selectedYear, "", ""], ["Mês selecionado", selectedMonthLabel, "", ""], ["Período efetivo", effectivePeriod, "Filtro aplicado", filterLabel]]);
    summary.mergeCells(9, 1, 9, 4); summary.getCell(9, 1).value = "Indicadores de aderência"; excelCleanStyleSection(summary.getRow(9), 4);
    summary.addRows([
      ["Furos analisados", metrics.total, "—", "Registros incluídos no período/filtro"],
      ["Aderência Ângulo (%)", isFinite(metrics.anglePct) ? +metrics.anglePct.toFixed(2) : null, isFinite(metrics.anglePct) ? (metrics.anglePct >= LIMITS.meta ? "Sim" : "Não") : "N/A", `${metrics.angleOk} de ${metrics.angleTotal} dentro da faixa`],
      ["Aderência Azimute (%)", isFinite(metrics.azPct) ? +metrics.azPct.toFixed(2) : null, isFinite(metrics.azPct) ? (metrics.azPct >= LIMITS.meta ? "Sim" : "Não") : "N/A", `${metrics.azOk} de ${metrics.azTotal} dentro do limite`],
      ["Aderência Z (%)", isFinite(metrics.zPct) ? +metrics.zPct.toFixed(2) : null, isFinite(metrics.zPct) ? (metrics.zPct >= LIMITS.meta ? "Sim" : "Não") : "N/A", `${metrics.zOk} de ${metrics.zTotal} dentro do limite`],
      ["Meta de aderência (%)", LIMITS.meta, "—", "Referência operacional"],
    ]);
    summary.mergeCells(15, 1, 15, 4); summary.getCell(15, 1).value = "Parâmetros de controle"; excelCleanStyleSection(summary.getRow(15), 4);
    summary.addRows([["Ângulo mínimo (°)", LIMITS.angleMin, "", "Faixa objetiva: 11,8° a 18,2°"], ["Ângulo máximo (°)", LIMITS.angleMax, "", "Tolerância de ±3,2°"], ["Limite de azimute (°)", LIMITS.azimuth, "", "Limite simétrico: ±6,39°"], ["Limite de profundidade (m)", LIMITS.depth, "", "Limite simétrico: ±0,20 m"]]);
    excelCleanStyleRows(summary, 5, 8, 4); excelCleanStyleRows(summary, 10, 14, 4); excelCleanStyleRows(summary, 16, 19, 4);
    summary.getColumn(1).width = 31; summary.getColumn(2).width = 19; summary.getColumn(3).width = 14; summary.getColumn(4).width = 38;
    ["B11", "B12", "B13", "B14"].forEach((address) => { summary.getCell(address).numFmt = "0.0\"%\""; });
    ["B16", "B17", "B18", "B19"].forEach((address) => { summary.getCell(address).numFmt = "0.00"; });
    summary.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1 };

    const dataSheet = workbook.addWorksheet("Desvios");
    excelCleanReportHeader(dataSheet, "Base calculada · Desvios de perfuração", `Período efetivo: ${effectivePeriod} · ${data.length} furo(s) · ${filterLabel}`, headers.length, logoId);
    dataSheet.mergeCells(4, 1, 4, headers.length); dataSheet.getCell(4, 1).value = "Base completa dos furos filtrados · use os filtros do cabeçalho para conferência"; excelCleanStyleSection(dataSheet.getRow(4), headers.length);
    dataSheet.getRow(5).values = headers; excelCleanStyleHeader(dataSheet.getRow(5)); rows.forEach((row) => dataSheet.addRow(headers.map((header) => row[header])));
    excelCleanStyleRows(dataSheet, 6, 5 + rows.length, headers.length);
    dataSheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + rows.length, column: headers.length } };
    [9, 9, 13, 16, 9, 19, 22, 22, 17, 25, 25, 21, 22, 24, 20].forEach((width, index) => { dataSheet.getColumn(index + 1).width = width; });
    headers.forEach((header, index) => {
      const column = dataSheet.getColumn(index + 1);
      if (header === "Data") column.numFmt = "dd/mm/yyyy";
      if (["Ângulo frontal (°)", "Azimute planejado (°)", "Azimute executado (°)", "Δ Azimute (°)", "Profundidade planejada (m)", "Profundidade executada (m)", "Δ Profundidade (m)"].includes(header)) column.numFmt = "0.00";
    });
    dataSheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

    const chartsSheet = workbook.addWorksheet("Gráficos");
    excelCleanReportHeader(chartsSheet, "Gráficos do período selecionado", `Período efetivo: ${effectivePeriod} · Oito gráficos nativos e editáveis do Excel · ${data.length} furo(s) · ${filterLabel}`, 18, logoId);
    chartsSheet.mergeCells(4, 1, 4, 18); chartsSheet.getCell(4, 1).value = "PAINEL ANALÍTICO · clique em qualquer gráfico para editar séries, cores e eixos"; excelCleanStyleSection(chartsSheet.getRow(4), 18);
    for (let column = 1; column <= 18; column += 1) chartsSheet.getColumn(column).width = 11.5;
    for (let row = 5; row <= 75; row += 1) chartsSheet.getRow(row).height = 18;
    chartsSheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

    const chartData = workbook.addWorksheet("Dados gráficos");
    chartData.state = "hidden";
    const refs = writeExcelCleanChartData(chartData, data);
    const buffer = await workbook.xlsx.writeBuffer();
    const nativeBuffer = await addNativeExcelChartsClean(buffer, refs, chartsSheet.id);
    const blob = new Blob([nativeBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `desvios-perfuracao_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.xlsx`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    if (btn) btn.textContent = `Excel pronto · ${data.length} furos`;
    setTimeout(() => { if (btn) btn.textContent = originalLabel; }, 3500);
  } catch (error) {
    console.error("Falha ao exportar Excel", error);
    alert(`Não foi possível gerar o Excel com os gráficos. ${error.message || "Tente novamente."}`);
    if (btn) btn.textContent = originalLabel;
  } finally { if (btn) btn.disabled = false; }
}
