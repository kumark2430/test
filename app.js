const DEFAULT_ZONES = ["Hosur", "Shoolagiri", "Denkanikottai", "Veppanapalli"];
const CATEGORIES = ["Wellness", "Sports", "RS"];
const THEME_KEY = "rts_theme_v1";
const SESSION_KEY = "rts_sheet_session_v1";
const API_URL = String(window.RTS_CONFIG?.apiUrl || "").trim();

let employees = [];
let ZONES = DEFAULT_ZONES.slice();
let selectedZone = "all";
let selectedCategory = "all";
let statusFilter = "all";
let searchTerm = "";
let editingId = null;
let confirmDeleteId = null;
let authToken = sessionStorage.getItem(SESSION_KEY) || "";

function configured(){
  return API_URL === "/api/sheets" || /^https:\/\/script\.google\.com\/.+\/exec(?:\?.*)?$/.test(API_URL);
}

function setSync(message, state = "ok"){
  const el = document.getElementById("syncStatus");
  el.textContent = message;
  el.className = "sync-status" + (state === "ok" ? "" : " " + state);
}

async function api(action, payload = {}){
  if(!configured()) throw new Error("Google Sheet connection is not configured yet.");
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, token: authToken, ...payload }),
    redirect: "follow"
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); }
  catch { throw new Error("The Google Sheet service returned an invalid response."); }
  if(!response.ok || !result.ok) throw new Error(result.error || "The request failed.");
  return result;
}

async function refreshData(){
  setSync("Syncing…", "loading");
  const result = await api("bootstrap");
  employees = Array.isArray(result.employees) ? result.employees : [];
  ZONES = Array.isArray(result.zones) && result.zones.length ? result.zones : DEFAULT_ZONES.slice();
  populateZoneSelect();
  render();
  setSync("Synced with Google Sheet");
}

function genId(){
  if(window.crypto?.randomUUID) return crypto.randomUUID();
  return "id_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}

function escapeHtml(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;"
  }[c]));
}

function fmtDate(d){
  if(!d) return "—";
  const parts = String(d).slice(0, 10).split("-");
  if(parts.length !== 3) return d;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return parts[2] + " " + months[parseInt(parts[1], 10) - 1] + " " + parts[0];
}

function renderZoneTabs(){
  const el = document.getElementById("zoneTabs");
  el.innerHTML = ["all", ...ZONES].map(z => {
    const label = z === "all" ? "All zones" : z;
    return `<button class="zone-tab ${selectedZone === z ? "active" : ""}" data-zone="${escapeHtml(z)}">${escapeHtml(label)}</button>`;
  }).join("") + '<button class="zone-tab-add" id="addZoneBtn" type="button">+ Add zone</button>';
  el.querySelectorAll(".zone-tab").forEach(btn => btn.addEventListener("click", () => {
    selectedZone = btn.dataset.zone;
    render();
  }));
  document.getElementById("addZoneBtn").addEventListener("click", openZoneModal);
}

function renderCatTabs(){
  const el = document.getElementById("catTabs");
  el.innerHTML = ["all", ...CATEGORIES].map(c => {
    const label = c === "all" ? "All categories" : c;
    return `<button class="cat-tab ${selectedCategory === c ? "active" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(label)}</button>`;
  }).join("");
  el.querySelectorAll(".cat-tab").forEach(btn => btn.addEventListener("click", () => {
    selectedCategory = btn.dataset.cat;
    render();
  }));
}

function getFiltered(){
  return employees.filter(e => {
    if(selectedZone !== "all" && e.zone !== selectedZone) return false;
    if(selectedCategory !== "all" && e.category !== selectedCategory) return false;
    if(statusFilter !== "all" && e.status !== statusFilter) return false;
    const hay = `${e.name || ""} ${e.designation || ""} ${e.phone || ""}`.toLowerCase();
    return !searchTerm || hay.includes(searchTerm.toLowerCase());
  }).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

function renderStats(){
  const cards = [
    { n: employees.length, l: "Total employees" },
    { n: employees.filter(e => e.status === "active").length, l: "Active" },
    { n: employees.filter(e => e.status === "relieved").length, l: "Relieved" },
    { n: selectedZone === "all" ? ZONES.length : 1, l: selectedZone === "all" ? "Zones covered" : "Zone selected" }
  ];
  document.getElementById("statsRow").innerHTML = cards.map(c =>
    `<div class="stat-card"><div class="n">${c.n}</div><div class="l">${c.l}</div></div>`
  ).join("");
}

function renderTable(){
  const rows = getFiltered();
  const tbody = document.getElementById("empTbody");
  const emptyState = document.getElementById("emptyState");
  document.getElementById("catColHeader").textContent = selectedCategory === "all" ? "Category" : "Zone";
  if(!rows.length){
    tbody.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }
  emptyState.style.display = "none";
  tbody.innerHTML = rows.map(e => {
    const statusBadge = e.status === "relieved"
      ? '<span class="badge badge-relieved">Relieved</span>'
      : '<span class="badge badge-active">Active</span>';
    const middleCol = selectedCategory === "all"
      ? `<span class="cat-pill">${escapeHtml(e.category || "—")}</span>`
      : escapeHtml(e.zone || "—");
    const actions = confirmDeleteId === e.id
      ? `<span class="confirm-row"><span>Remove permanently?</span><button class="btn-danger-text" data-confirm-yes="${escapeHtml(e.id)}">Yes</button><button class="btn-text" data-confirm-no="1">Cancel</button></span>`
      : `<button class="btn-text" data-edit="${escapeHtml(e.id)}">Edit</button>${e.status === "active" ? `<button class="btn-text" data-relieve="${escapeHtml(e.id)}">Mark relieved</button>` : `<button class="btn-text" data-reinstate="${escapeHtml(e.id)}">Reinstate</button>`}<button class="btn-danger-text" data-delete="${escapeHtml(e.id)}">Remove</button>`;
    return `<tr><td><div class="emp-name">${escapeHtml(e.name)}</div><div class="emp-sub">${escapeHtml(e.designation || "")}</div></td><td>${middleCol}</td><td>${selectedZone === "all" ? escapeHtml(e.zone || "—") : escapeHtml(e.category || "—")}</td><td>${escapeHtml(e.phone || "—")}</td><td>${fmtDate(e.joinDate)}</td><td>${statusBadge}${e.status === "relieved" && e.relievingDate ? `<div class="emp-sub">${fmtDate(e.relievingDate)}</div>` : ""}</td><td class="actions-cell">${actions}</td></tr>`;
  }).join("");
  tbody.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openEditModal(b.dataset.edit)));
  tbody.querySelectorAll("[data-relieve]").forEach(b => b.addEventListener("click", () => quickSetStatus(b.dataset.relieve, "relieved")));
  tbody.querySelectorAll("[data-reinstate]").forEach(b => b.addEventListener("click", () => quickSetStatus(b.dataset.reinstate, "active")));
  tbody.querySelectorAll("[data-delete]").forEach(b => b.addEventListener("click", () => { confirmDeleteId = b.dataset.delete; renderTable(); }));
  tbody.querySelectorAll("[data-confirm-yes]").forEach(b => b.addEventListener("click", () => deleteEmployee(b.dataset.confirmYes)));
  tbody.querySelectorAll("[data-confirm-no]").forEach(b => b.addEventListener("click", () => { confirmDeleteId = null; renderTable(); }));
}

function render(){ renderZoneTabs(); renderCatTabs(); renderStats(); renderTable(); }

async function quickSetStatus(id, status){
  try{
    setSync("Saving…", "loading");
    await api("updateStatus", { id, status });
    await refreshData();
  } catch(error){ setSync(error.message, "error"); }
}

async function deleteEmployee(id){
  try{
    setSync("Removing…", "loading");
    await api("deleteEmployee", { id });
    confirmDeleteId = null;
    await refreshData();
  } catch(error){ setSync(error.message, "error"); }
}

function populateZoneSelect(){
  document.getElementById("f_zone").innerHTML = ZONES.map(z => `<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`).join("");
}

function openAddModal(){
  editingId = null;
  document.getElementById("modalTitle").textContent = "Add employee";
  document.getElementById("empForm").reset();
  populateZoneSelect();
  document.getElementById("f_zone").value = selectedZone !== "all" ? selectedZone : ZONES[0];
  document.getElementById("f_category").value = selectedCategory !== "all" ? selectedCategory : CATEGORIES[0];
  document.getElementById("f_status").value = "active";
  document.getElementById("relievingField").style.display = "none";
  clearErrors();
  document.getElementById("modalOverlay").classList.add("open");
}

function openEditModal(id){
  const e = employees.find(x => x.id === id);
  if(!e) return;
  editingId = id;
  document.getElementById("modalTitle").textContent = "Edit employee";
  populateZoneSelect();
  ["name","designation","zone","category","phone","joinDate","status","relievingDate","notes"].forEach(key => {
    const el = document.getElementById("f_" + key);
    if(el) el.value = e[key] || (key === "status" ? "active" : "");
  });
  document.getElementById("relievingField").style.display = e.status === "relieved" ? "block" : "none";
  clearErrors();
  document.getElementById("modalOverlay").classList.add("open");
}

function closeModal(){ document.getElementById("modalOverlay").classList.remove("open"); }
function clearErrors(){
  document.getElementById("err_name").classList.remove("show");
  document.getElementById("err_relieving").classList.remove("show");
}

async function submitForm(ev){
  ev.preventDefault();
  clearErrors();
  const name = document.getElementById("f_name").value.trim();
  const status = document.getElementById("f_status").value;
  const relievingDate = document.getElementById("f_relievingDate").value;
  let hasError = false;
  if(!name){ document.getElementById("err_name").classList.add("show"); hasError = true; }
  if(status === "relieved" && !relievingDate){ document.getElementById("err_relieving").classList.add("show"); hasError = true; }
  if(hasError) return;
  const employee = {
    id: editingId || genId(), name,
    designation: document.getElementById("f_designation").value.trim(),
    zone: document.getElementById("f_zone").value,
    category: document.getElementById("f_category").value,
    phone: document.getElementById("f_phone").value.trim(),
    joinDate: document.getElementById("f_joinDate").value,
    status, relievingDate: status === "relieved" ? relievingDate : "",
    notes: document.getElementById("f_notes").value.trim()
  };
  const button = document.getElementById("saveBtn");
  button.disabled = true;
  button.textContent = "Saving…";
  try{
    await api("saveEmployee", { employee });
    closeModal();
    await refreshData();
  } catch(error){ setSync(error.message, "error"); }
  finally { button.disabled = false; button.textContent = "Save employee"; }
}

function openZoneModal(){
  document.getElementById("zoneForm").reset();
  document.getElementById("err_zoneName").classList.remove("show");
  document.getElementById("zoneModalOverlay").classList.add("open");
}
function closeZoneModal(){ document.getElementById("zoneModalOverlay").classList.remove("open"); }

async function submitZoneForm(ev){
  ev.preventDefault();
  const name = document.getElementById("f_zoneName").value.trim();
  const err = document.getElementById("err_zoneName");
  err.classList.remove("show");
  if(!name || ZONES.some(z => z.toLowerCase() === name.toLowerCase())){ err.classList.add("show"); return; }
  try{
    await api("addZone", { name });
    closeZoneModal();
    await refreshData();
  } catch(error){ setSync(error.message, "error"); }
}

function csvEscape(v){
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportCsv(){
  const header = ["Name","Designation","Zone","Category","Phone","Join date","Status","Relieving date","Notes"];
  const lines = [header.join(","), ...getFiltered().map(e => [e.name,e.designation,e.zone,e.category,e.phone,e.joinDate,e.status,e.relievingDate,e.notes].map(csvEscape).join(","))];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type:"text/csv;charset=utf-8;" }));
  const a = Object.assign(document.createElement("a"), { href:url, download:"rts-employees.csv" });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

const IMPORT_FIELDS = {
  name: ["name", "full name", "employee name"],
  designation: ["designation", "role", "job title"],
  zone: ["zone", "location", "area"],
  category: ["category", "team", "department"],
  phone: ["phone", "phone number", "mobile", "mobile number", "contact"],
  joinDate: ["join date", "joining date", "date of joining", "joined"],
  status: ["status", "employee status"],
  relievingDate: ["relieving date", "relieved date", "last working date"],
  notes: ["notes", "remarks", "comments"],
  id: ["id", "employee id"]
};

function normalizeHeader(value){
  return String(value == null ? "" : value).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function valueFromImportRow(row, aliases){
  const key = Object.keys(row).find(candidate => aliases.includes(normalizeHeader(candidate)));
  return key == null ? "" : row[key];
}

function importDate(value){
  if(!value) return "";
  if(value instanceof Date && !isNaN(value.getTime())){
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const text = String(value).trim();
  let match = text.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if(match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  match = text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if(match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function normalizeImportedEmployee(row){
  const categoryValue = String(valueFromImportRow(row, IMPORT_FIELDS.category) || "Wellness").trim();
  const categoryKey = categoryValue.toLowerCase();
  const category = categoryKey === "sports" ? "Sports" : categoryKey === "rs" ? "RS" : categoryKey === "wellness" ? "Wellness" : categoryValue;
  const statusValue = String(valueFromImportRow(row, IMPORT_FIELDS.status) || "active").trim().toLowerCase();
  const status = ["relieved", "inactive", "left", "terminated"].includes(statusValue) ? "relieved" : "active";
  const relievingDate = importDate(valueFromImportRow(row, IMPORT_FIELDS.relievingDate));
  return {
    id: String(valueFromImportRow(row, IMPORT_FIELDS.id) || "").trim(),
    name: String(valueFromImportRow(row, IMPORT_FIELDS.name) || "").trim(),
    designation: String(valueFromImportRow(row, IMPORT_FIELDS.designation) || "").trim(),
    zone: String(valueFromImportRow(row, IMPORT_FIELDS.zone) || ZONES[0] || "Hosur").trim(),
    category,
    phone: String(valueFromImportRow(row, IMPORT_FIELDS.phone) || "").trim(),
    joinDate: importDate(valueFromImportRow(row, IMPORT_FIELDS.joinDate)),
    status,
    relievingDate: status === "relieved" ? relievingDate : "",
    notes: String(valueFromImportRow(row, IMPORT_FIELDS.notes) || "").trim()
  };
}

async function importEmployeeFile(file){
  if(!file) return;
  if(!window.XLSX) throw new Error("The Excel reader could not load. Check your internet connection and try again.");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "", raw: true });
  if(!rows.length) throw new Error("The selected file does not contain employee rows.");
  const hasNameColumn = Object.keys(rows[0]).some(key => IMPORT_FIELDS.name.includes(normalizeHeader(key)));
  if(!hasNameColumn) throw new Error('The file must include a "Name" column.');
  const parsed = rows.map(normalizeImportedEmployee);
  const employeesToImport = parsed.filter(employee => employee.name);
  const skipped = parsed.length - employeesToImport.length;
  if(!employeesToImport.length) throw new Error("No valid employee names were found in the file.");
  const message = `Import ${employeesToImport.length} employee${employeesToImport.length === 1 ? "" : "s"}${skipped ? ` and skip ${skipped} blank row${skipped === 1 ? "" : "s"}` : ""}?`;
  if(!window.confirm(message)) return;

  let created = 0;
  let updated = 0;
  setSync(`Importing 0 of ${employeesToImport.length}…`, "loading");
  for(let start = 0; start < employeesToImport.length; start += 200){
    const batch = employeesToImport.slice(start, start + 200);
    const result = await api("importEmployees", { employees: batch });
    created += Number(result.created || 0);
    updated += Number(result.updated || 0);
    setSync(`Importing ${Math.min(start + batch.length, employeesToImport.length)} of ${employeesToImport.length}…`, "loading");
  }
  await refreshData();
  setSync(`Import complete: ${created} added, ${updated} updated${skipped ? `, ${skipped} skipped` : ""}`);
}

async function handleImportFile(ev){
  const file = ev.target.files?.[0];
  if(!file) return;
  const button = document.getElementById("importBtn");
  button.disabled = true;
  try{ await importEmployeeFile(file); }
  catch(error){ setSync(error.message, "error"); }
  finally { button.disabled = false; ev.target.value = ""; }
}

function showApp(){
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("appRoot").style.display = "block";
}
function showLogin(message = ""){
  document.getElementById("appRoot").style.display = "none";
  document.getElementById("loginScreen").style.display = "flex";
  const error = document.getElementById("loginError");
  error.textContent = message || "Incorrect username or password.";
  error.classList.toggle("show", Boolean(message));
}
function updateThemeIcon(theme){
  document.getElementById("iconSun").style.display = theme === "dark" ? "block" : "none";
  document.getElementById("iconMoon").style.display = theme === "dark" ? "none" : "block";
}

document.getElementById("loginForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const button = ev.currentTarget.querySelector('button[type="submit"]');
  const error = document.getElementById("loginError");
  error.classList.remove("show");
  button.disabled = true; button.textContent = "Signing in…";
  try{
    const result = await api("login", {
      username: document.getElementById("l_user").value.trim(),
      password: document.getElementById("l_pass").value
    });
    authToken = result.token;
    sessionStorage.setItem(SESSION_KEY, authToken);
    showApp();
    await refreshData();
  } catch(err){ error.textContent = err.message; error.classList.add("show"); }
  finally { button.disabled = false; button.textContent = "Sign in"; }
});
document.getElementById("logoutBtn").addEventListener("click", () => {
  authToken = ""; sessionStorage.removeItem(SESSION_KEY); showLogin();
});
document.getElementById("themeToggle").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
  updateThemeIcon(next);
});
document.getElementById("addBtn").addEventListener("click", openAddModal);
document.getElementById("cancelBtn").addEventListener("click", closeModal);
document.getElementById("modalOverlay").addEventListener("click", ev => { if(ev.target.id === "modalOverlay") closeModal(); });
document.getElementById("empForm").addEventListener("submit", submitForm);
document.getElementById("f_status").addEventListener("change", ev => {
  document.getElementById("relievingField").style.display = ev.target.value === "relieved" ? "block" : "none";
});
document.getElementById("searchInput").addEventListener("input", ev => { searchTerm = ev.target.value; renderTable(); });
document.getElementById("statusFilter").addEventListener("change", ev => { statusFilter = ev.target.value; renderStats(); renderTable(); });
document.getElementById("exportBtn").addEventListener("click", exportCsv);
document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
document.getElementById("importFile").addEventListener("change", handleImportFile);
document.getElementById("zoneCancelBtn").addEventListener("click", closeZoneModal);
document.getElementById("zoneModalOverlay").addEventListener("click", ev => { if(ev.target.id === "zoneModalOverlay") closeZoneModal(); });
document.getElementById("zoneForm").addEventListener("submit", submitZoneForm);

(async function init(){
  const storedTheme = localStorage.getItem(THEME_KEY);
  const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const theme = storedTheme || (systemDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  updateThemeIcon(theme);
  populateZoneSelect();
  render();
  if(!configured()){
    showLogin("Google Sheet connection is not configured. Follow README.md before publishing.");
    return;
  }
  if(!authToken){ showLogin(); return; }
  try{ showApp(); await refreshData(); }
  catch(error){ authToken = ""; sessionStorage.removeItem(SESSION_KEY); showLogin("Your session expired. Please sign in again."); }
})();
