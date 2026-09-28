const EMPLOYEE_SHEET = "Employees";
const ZONE_SHEET = "Zones";
const EMPLOYEE_HEADERS = [
  "ID", "Name", "Designation", "Zone", "Category", "Phone", "Join Date",
  "Status", "Relieving Date", "Notes", "Created At", "Updated At"
];
const DEFAULT_ZONES = ["Hosur", "Shoolagiri", "Denkanikottai", "Veppanapalli"];

/**
 * First-time setup:
 * 1. Replace the two values below.
 * 2. Run configureRTS once from the Apps Script editor.
 * 3. Deploy as a Web app, executing as you, with access set to Anyone.
 */
function configureRTS() {
  const username = "kumar";
  const password = "Kumar@123456";
  if (password === "Kumar@123456") {
    throw new Error("Set a strong password in configureRTS before running it.");
  }
  PropertiesService.getScriptProperties().setProperties({
    RTS_ADMIN_USER: username,
    RTS_ADMIN_PASSWORD: password
  });
  ensureSheets_();
}

function doGet() {
  return json_({ ok: true, service: "RTS employee sheet service" });
}

function doPost(e) {
  try {
    ensureSheets_();
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (body.action === "login") return login_(body);
    requireSession_(body.token);
    switch (body.action) {
      case "bootstrap": return json_(bootstrap_());
      case "saveEmployee": return json_(withLock_(() => saveEmployee_(body.employee)));
      case "updateStatus": return json_(withLock_(() => updateStatus_(body.id, body.status)));
      case "deleteEmployee": return json_(withLock_(() => deleteEmployee_(body.id)));
      case "addZone": return json_(withLock_(() => addZone_(body.name)));
      case "importEmployees": return json_(withLock_(() => importEmployees_(body.employees)));
      default: throw new Error("Unknown action.");
    }
  } catch (error) {
    return json_({ ok: false, error: error.message || String(error) });
  }
}

function login_(body) {
  const properties = PropertiesService.getScriptProperties();
  const validUser = properties.getProperty("RTS_ADMIN_USER");
  const validPassword = properties.getProperty("RTS_ADMIN_PASSWORD");
  if (!validUser || !validPassword) throw new Error("Admin login is not configured.");
  if (String(body.username || "") !== validUser || String(body.password || "") !== validPassword) {
    throw new Error("Incorrect username or password.");
  }
  const token = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put("session_" + token, "1", 21600);
  return json_({ ok: true, token: token });
}

function requireSession_(token) {
  if (!token || CacheService.getScriptCache().get("session_" + token) !== "1") {
    throw new Error("Your session expired. Please sign in again.");
  }
}

function bootstrap_() {
  const employeeSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMPLOYEE_SHEET);
  const values = employeeSheet.getDataRange().getValues();
  const employees = values.slice(1).filter(row => row[0]).map(rowToEmployee_);
  const zoneSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ZONE_SHEET);
  const zones = zoneSheet.getLastRow() > 1
    ? zoneSheet.getRange(2, 1, zoneSheet.getLastRow() - 1, 1)
      .getDisplayValues().flat().map(String).map(s => s.trim()).filter(Boolean)
    : [];
  return { ok: true, employees: employees, zones: zones };
}

function saveEmployee_(employee) {
  employee = employee || {};
  if (!String(employee.name || "").trim()) throw new Error("Employee name is required.");
  if (!employee.id) employee.id = Utilities.getUuid();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMPLOYEE_SHEET);
  const ids = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().flat() : [];
  const index = ids.findIndex(id => id === String(employee.id));
  const rowNumber = index >= 0 ? index + 2 : sheet.getLastRow() + 1;
  const existingCreatedAt = index >= 0 ? sheet.getRange(rowNumber, 11).getValue() : "";
  const now = new Date();
  const row = [
    clean_(employee.id), clean_(employee.name), clean_(employee.designation), clean_(employee.zone),
    clean_(employee.category), clean_(employee.phone), dateOrBlank_(employee.joinDate),
    employee.status === "relieved" ? "relieved" : "active",
    employee.status === "relieved" ? dateOrBlank_(employee.relievingDate) : "",
    clean_(employee.notes), existingCreatedAt || now, now
  ];
  sheet.getRange(rowNumber, 1, 1, EMPLOYEE_HEADERS.length).setValues([row]);
  return { ok: true, id: employee.id };
}

function updateStatus_(id, status) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMPLOYEE_SHEET);
  const rowNumber = findEmployeeRow_(sheet, id);
  const normalized = status === "relieved" ? "relieved" : "active";
  sheet.getRange(rowNumber, 8).setValue(normalized);
  sheet.getRange(rowNumber, 9).setValue(normalized === "relieved" ? new Date() : "");
  sheet.getRange(rowNumber, 12).setValue(new Date());
  return { ok: true };
}

function deleteEmployee_(id) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMPLOYEE_SHEET);
  sheet.deleteRow(findEmployeeRow_(sheet, id));
  return { ok: true };
}

function addZone_(name) {
  name = clean_(name);
  if (!name) throw new Error("Zone name is required.");
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ZONE_SHEET);
  const existing = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().flat()
    : [];
  if (existing.some(zone => zone.toLowerCase() === name.toLowerCase())) throw new Error("That zone already exists.");
  sheet.appendRow([name]);
  return { ok: true };
}

function importEmployees_(incoming) {
  if (!Array.isArray(incoming) || !incoming.length) throw new Error("No employees were supplied for import.");
  if (incoming.length > 200) throw new Error("Import batches are limited to 200 employees.");

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(EMPLOYEE_SHEET);
  const existingValues = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, EMPLOYEE_HEADERS.length).getValues().filter(row => row[0])
    : [];
  const idToIndex = {};
  existingValues.forEach((row, index) => { idToIndex[String(row[0])] = index; });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const zonesToAdd = [];

  incoming.forEach(employee => {
    employee = employee || {};
    const name = clean_(employee.name);
    if (!name) { skipped++; return; }
    let id = clean_(employee.id);
    const existingIndex = id && Object.prototype.hasOwnProperty.call(idToIndex, id) ? idToIndex[id] : -1;
    if (!id) id = Utilities.getUuid();
    const now = new Date();
    const existingCreatedAt = existingIndex >= 0 ? existingValues[existingIndex][10] : "";
    const row = [
      id, name, clean_(employee.designation), clean_(employee.zone), clean_(employee.category),
      clean_(employee.phone), dateOrBlank_(employee.joinDate),
      employee.status === "relieved" ? "relieved" : "active",
      employee.status === "relieved" ? dateOrBlank_(employee.relievingDate) : "",
      clean_(employee.notes), existingCreatedAt || now, now
    ];
    if (existingIndex >= 0) {
      existingValues[existingIndex] = row;
      updated++;
    } else {
      idToIndex[id] = existingValues.length;
      existingValues.push(row);
      created++;
    }
    if (row[3]) zonesToAdd.push(row[3]);
  });

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, EMPLOYEE_HEADERS.length).clearContent();
  }
  if (existingValues.length) {
    sheet.getRange(2, 1, existingValues.length, EMPLOYEE_HEADERS.length).setValues(existingValues);
  }
  addMissingZones_(zonesToAdd);
  return { ok: true, created: created, updated: updated, skipped: skipped };
}

function addMissingZones_(zoneNames) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ZONE_SHEET);
  const existing = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().flat()
    : [];
  const seen = {};
  existing.forEach(zone => { seen[String(zone).trim().toLowerCase()] = true; });
  const additions = [];
  zoneNames.forEach(zone => {
    const value = clean_(zone);
    const key = value.toLowerCase();
    if (value && !seen[key]) { seen[key] = true; additions.push([value]); }
  });
  if (additions.length) sheet.getRange(sheet.getLastRow() + 1, 1, additions.length, 1).setValues(additions);
}

function findEmployeeRow_(sheet, id) {
  if (!id || sheet.getLastRow() < 2) throw new Error("Employee not found.");
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues().flat();
  const index = ids.findIndex(value => value === String(id));
  if (index < 0) throw new Error("Employee not found.");
  return index + 2;
}

function rowToEmployee_(row) {
  return {
    id: String(row[0] || ""), name: String(row[1] || ""), designation: String(row[2] || ""),
    zone: String(row[3] || ""), category: String(row[4] || ""), phone: String(row[5] || ""),
    joinDate: isoDate_(row[6]), status: String(row[7] || "active").toLowerCase(),
    relievingDate: isoDate_(row[8]), notes: String(row[9] || ""),
    createdAt: isoTimestamp_(row[10]), updatedAt: isoTimestamp_(row[11])
  };
}

function ensureSheets_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("This script must be created from the target Google Sheet.");
  let employees = spreadsheet.getSheetByName(EMPLOYEE_SHEET);
  if (!employees) employees = spreadsheet.insertSheet(EMPLOYEE_SHEET);
  if (employees.getLastRow() === 0) {
    employees.getRange(1, 1, 1, EMPLOYEE_HEADERS.length).setValues([EMPLOYEE_HEADERS]);
    employees.setFrozenRows(1);
    employees.getRange("A1:L1").setFontWeight("bold").setBackground("#1E3A5F").setFontColor("#FFFFFF");
  }
  let zones = spreadsheet.getSheetByName(ZONE_SHEET);
  if (!zones) zones = spreadsheet.insertSheet(ZONE_SHEET);
  if (zones.getLastRow() === 0) {
    zones.getRange(1, 1).setValue("Zone").setFontWeight("bold").setBackground("#1E3A5F").setFontColor("#FFFFFF");
    zones.getRange(2, 1, DEFAULT_ZONES.length, 1).setValues(DEFAULT_ZONES.map(zone => [zone]));
    zones.setFrozenRows(1);
  }
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return callback(); }
  finally { lock.releaseLock(); }
}

function clean_(value) { return String(value == null ? "" : value).trim(); }
function dateOrBlank_(value) {
  if (!value) return "";
  const date = new Date(String(value).slice(0, 10) + "T00:00:00");
  return isNaN(date.getTime()) ? "" : date;
}
function isoDate_(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(value).slice(0, 10);
}
function isoTimestamp_(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) return value.toISOString();
  return String(value);
}
function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
