const CONFIG = {
  folderId: "1H2UP4hW77YYiwZqvfxjnFt3_DahNnBQI",
  spreadsheetId: "1ef7edY0Yye6arldVfOUYDcjI4GvY6g5U",
  sheetName: "DXF_INDEX",
};

const PLAN_ALIASES = { PC53: "PP53" };

function textResponse(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}

/*
 * CORS-safe DXF reader for the static GitHub Pages dashboard.
 * Only files that are direct children of the configured DXF folder can be
 * read, so this endpoint is not an open Drive proxy.
 */
function doGet(e) {
  const fileId = String((e && e.parameter && e.parameter.id) || "").trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(fileId)) return textResponse("DXF id inválido");

  try {
    const file = DriveApp.getFileById(fileId);
    const name = file.getName().trim();
    if (!/\.dxf$/i.test(name)) return textResponse("Arquivo não permitido");

    const parents = file.getParents();
    let isAllowed = false;
    while (parents.hasNext()) {
      if (parents.next().getId() === CONFIG.folderId) {
        isAllowed = true;
        break;
      }
    }
    if (!isAllowed) return textResponse("Arquivo fora da pasta configurada");
    return textResponse(file.getBlob().getDataAsString());
  } catch (error) {
    return textResponse("Não foi possível ler o DXF");
  }
}

function setup() {
  syncDxfIndex();
  ScriptApp.getProjectTriggers()
    .filter(function(trigger) { return trigger.getHandlerFunction() === "syncDxfIndex"; })
    .forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger("syncDxfIndex").timeBased().everyMinutes(5).create();
}

function syncDxfIndex() {
  const folder = DriveApp.getFolderById(CONFIG.folderId);
  const files = [];
  const iterator = folder.getFiles();
  while (iterator.hasNext()) {
    const file = iterator.next();
    const name = file.getName().trim();
    if (!/\.dxf$/i.test(name)) continue;
    const baseName = name.replace(/\.dxf$/i, "").trim().toUpperCase();
    const plan = PLAN_ALIASES[baseName] || baseName;
    files.push({
      plan: plan,
      name: name,
      fileId: file.getId(),
      url: "https://drive.usercontent.google.com/download?id=" + encodeURIComponent(file.getId()) + "&export=download",
      updatedAt: file.getLastUpdated().toISOString(),
      size: file.getSize(),
    });
  }

  const grouped = files.reduce(function(acc, item) {
    if (!acc[item.plan]) acc[item.plan] = [];
    acc[item.plan].push(item);
    return acc;
  }, {});
  const rows = [];
  Object.keys(grouped).sort(function(a, b) {
    return a.localeCompare(b, "pt-BR", { numeric: true });
  }).forEach(function(plan) {
    const items = grouped[plan].sort(function(a, b) {
      return b.updatedAt.localeCompare(a.updatedAt);
    });
    const status = items.length === 1 ? "OK" : "DUPLICATE";
    items.forEach(function(item) {
      rows.push([item.plan, item.name, item.fileId, item.url, item.updatedAt, status, item.size]);
    });
  });

  const spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(CONFIG.sheetName) || spreadsheet.insertSheet(CONFIG.sheetName);
  sheet.clearContents();
  const values = [["PLANO", "ARQUIVO", "FILE_ID", "URL_DOWNLOAD", "ATUALIZADO_EM", "STATUS", "TAMANHO_BYTES"]].concat(rows);
  sheet.getRange(1, 1, values.length, values[0].length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, values[0].length);
  return { plans: Object.keys(grouped).length, files: files.length, syncedAt: new Date().toISOString() };
}
