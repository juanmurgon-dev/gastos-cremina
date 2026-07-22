// ─────────────────────────────────────────────────────────────
//  Capa de datos: habla con Supabase y guarda los tickets en memoria.
//  Las pantallas se "suscriben" y se redibujan solas cuando algo cambia.
// ─────────────────────────────────────────────────────────────
import { supabase } from "./supabase-init.js";

// ── Catálogos (mismos que el bot) ───────────────────────────
export const AREAS = ["cocina", "barra", "piso", "limpieza", "otro"];
export const TIPOS = ["costo de venta", "operativo"];
export const UNIDADES = ["kg", "pz", "L", "caja", "paq", "manojo", "lt", "gr", "otro"];

export const COLOR_AREA = {
  cocina: "#2ec4b6", barra: "#ff9f1c", piso: "#ffbf69",
  limpieza: "#148b7f", otro: "#7ea8a2"
};

// ── Estado en memoria ───────────────────────────────────────
export const state = {
  tickets: [],
  cortes: [],
  productos: [],
  modificadores: [],
  combos: [],
  variantes: [],
  gastosFijos: [],
  requisiciones: [],
  costosPlatillo: [],   // costo directo por platillo (para el margen)
  perfil: { nombre: "", email: "", cargado: false },
  config: { presupuestoSemanal: 35000, presupuestoPorArea: {} },
  orgId: null,          // id del restaurante (multi-tenant); null = single-tenant
  multiTenant: false,   // true si la BD ya tiene la tabla 'miembros'
  miRol: null,          // rol del usuario en su restaurante: owner|gerente|chef|compras|staff
  orgNombre: null,      // nombre del restaurante (para mostrar en el encabezado)
  listo: false
};

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify() { subs.forEach((fn) => fn()); }

function rowToTicket(r) {
  return {
    id: r.id,
    proveedor: r.proveedor || "",
    fecha: r.fecha || "",
    total: num(r.total),
    aviso: r.aviso || "",
    fotoUrl: r.foto_url || "",
    lineas: Array.isArray(r.lineas) ? r.lineas : [],
    creadoPor: r.creado_por || "",
    editadoPor: r.editado_por || "",
    editadoEn: r.editado_en || null
  };
}

async function cargarTickets() {
  const { data, error } = await supabase
    .from("tickets").select("*").order("fecha", { ascending: false });
  if (error) { console.error("cargarTickets:", error); state.listo = true; notify(); return; }
  state.tickets = (data || []).map(rowToTicket);
  state.listo = true;
  notify();
}

async function cargarConfig() {
  // Sin filtrar por id='app': en single-tenant hay una sola fila; en multi-tenant
  // RLS ya devuelve solo la del restaurante del usuario.
  const { data } = await supabase.from("config").select("data").limit(1);
  const row = data && data[0];
  if (row && row.data) state.config = { ...state.config, ...row.data };
  notify();
}

// ¿La BD es multi-tenant? ¿A qué restaurante(s) pertenece el usuario?
async function cargarMiOrg() {
  const { data, error } = await supabase.from("miembros").select("org_id, rol, orgs(nombre)").limit(1);
  if (error) { state.multiTenant = false; state.orgId = null; state.miRol = null; state.orgNombre = null; return; } // tabla no existe → single-tenant
  state.multiTenant = true;
  const row = data && data[0];
  state.orgId = (row && row.org_id) || null;
  state.miRol = (row && row.rol) || null;
  state.orgNombre = (row && row.orgs && row.orgs.nombre) || null;
}

// Onboarding: crea un restaurante nuevo y deja al usuario como dueño.
export async function crearOrg(nombre) {
  const { data, error } = await supabase.rpc("crear_org", { nombre });
  if (error) throw error;
  state.orgId = data;
  return data;
}

async function cargarCortes() {
  // La tabla puede no existir todavía (si aún no corren el import de ventas).
  const { data, error } = await supabase.from("cortes").select("*").order("fecha", { ascending: false });
  if (!error && data) { state.cortes = data; notify(); }
}

async function cargarProductos() {
  const p = await supabase.from("productos_venta").select("*");
  if (!p.error && p.data) state.productos = p.data;
  const m = await supabase.from("modificadores_venta").select("*");
  if (!m.error && m.data) state.modificadores = m.data;
  const c = await supabase.from("combos_venta").select("*");
  if (!c.error && c.data) state.combos = c.data;
  const v = await supabase.from("variantes_venta").select("*");
  if (!v.error && v.data) state.variantes = v.data;
  notify();
}

async function cargarGastosFijos() {
  const { data, error } = await supabase.from("gastos_fijos").select("*").order("monto_mensual", { ascending: false });
  if (!error && data) { state.gastosFijos = data; notify(); }
}

async function cargarCostosPlatillo() {
  // La tabla puede no existir aún (si no corren costos-platillo.sql).
  const { data, error } = await supabase.from("costos_platillo").select("*");
  if (!error && data) { state.costosPlatillo = data; notify(); }
}

// Map producto → costo por porción, para cruzar con las ventas.
export function mapaCostos() {
  const m = new Map();
  for (const c of state.costosPlatillo || []) m.set(c.producto, num(c.costo));
  return m;
}

// Guarda (o actualiza) el costo de un platillo.
export async function guardarCostoPlatillo(producto, costo) {
  const row = { producto, costo: num(costo), actualizado: new Date().toISOString() };
  const { error } = await supabase.from("costos_platillo").upsert(row);
  if (error) throw error;
  await cargarCostosPlatillo();
}

// Borra el costo de un platillo (vuelve a quedar "sin costo").
export async function borrarCostoPlatillo(producto) {
  const { error } = await supabase.from("costos_platillo").delete().eq("producto", producto);
  if (error) throw error;
  await cargarCostosPlatillo();
}

async function cargarRequisiciones() {
  // La tabla puede no existir aún (si no corren requisiciones.sql).
  const { data, error } = await supabase.from("requisiciones").select("*").order("creado_en", { ascending: false });
  if (!error && data) { state.requisiciones = data; notify(); }
}

export async function guardarRequisicion(req) {
  const row = {
    id: req.id,
    fecha: req.fecha || hoyISO(),
    titulo: req.titulo || "",
    estatus: req.estatus || "pendiente",
    items: Array.isArray(req.items) ? req.items : [],
    total: num(req.total),
    creado_por: req.creadoPor || miNombre()
  };
  const { error } = await supabase.from("requisiciones").upsert(row);
  if (error) throw error;
  await cargarRequisiciones();
}

export async function borrarRequisicion(id) {
  const { error } = await supabase.from("requisiciones").delete().eq("id", id);
  if (error) throw error;
  await cargarRequisiciones();
}

// Respaldo: descarga TODO el historial del restaurante en un solo archivo JSON.
// El usuario está autenticado, así que RLS le devuelve solo sus datos.
export async function exportarRespaldo() {
  const tablas = ["tickets", "cortes", "gastos_fijos", "productos_venta",
    "modificadores_venta", "combos_venta", "variantes_venta", "requisiciones",
    "costos_platillo", "config", "perfiles"];
  const out = { app: "Cifra", exportado: new Date().toISOString(), tablas: {} };
  for (const t of tablas) {
    const { data, error } = await supabase.from(t).select("*");
    out.tablas[t] = error ? { error: error.message } : (data || []);
  }
  return out;
}

// Suma mensual de los gastos fijos activos.
export function gastoFijoMensual() {
  return (state.gastosFijos || []).filter((g) => g.activo !== false).reduce((a, g) => a + num(g.monto_mensual), 0);
}

export async function guardarGastoFijo(g) {
  const { error } = await supabase.from("gastos_fijos").insert({
    concepto: g.concepto || "", categoria: g.categoria || "",
    monto_mensual: num(g.monto_mensual), activo: g.activo !== false
  });
  if (error) throw error;
  await cargarGastosFijos();
}

export async function actualizarGastoFijo(id, patch) {
  const p = {};
  if ("concepto" in patch) p.concepto = patch.concepto;
  if ("categoria" in patch) p.categoria = patch.categoria;
  if ("monto_mensual" in patch) p.monto_mensual = num(patch.monto_mensual);
  if ("activo" in patch) p.activo = patch.activo;
  const { error } = await supabase.from("gastos_fijos").update(p).eq("id", id);
  if (error) throw error;
  await cargarGastosFijos();
}

export async function borrarGastoFijo(id) {
  const { error } = await supabase.from("gastos_fijos").delete().eq("id", id);
  if (error) throw error;
  await cargarGastosFijos();
}

async function cargarPerfil() {
  const { data } = await supabase.auth.getUser();
  const user = data && data.user;
  if (!user) return;
  state.perfil.email = user.email || "";
  const { data: p } = await supabase.from("perfiles").select("nombre").eq("id", user.id).maybeSingle();
  if (p && p.nombre) state.perfil.nombre = p.nombre;
  state.perfil.cargado = true;
  notify();
}

// Nombre a mostrar del usuario actual (o su correo si no puso nombre).
export function miNombre() {
  return state.perfil.nombre || state.perfil.email || "";
}

export async function guardarPerfil(nombre) {
  const { data } = await supabase.auth.getUser();
  const user = data && data.user;
  if (!user) throw new Error("sin sesión");
  const { error } = await supabase.from("perfiles").upsert({ id: user.id, nombre });
  if (error) throw error;
  state.perfil.nombre = nombre;
  notify();
}

// Vuelve a leer ventas/cortes/productos (tras una importación).
export async function recargarVentas() {
  await Promise.all([cargarCortes(), cargarProductos(), cargarCostosPlatillo()]);
}

let arrancado = false;
export async function init() {
  if (arrancado) return;
  arrancado = true;
  // allSettled: aunque una consulta falle, la app SIEMPRE deja de estar "cargando".
  await cargarMiOrg();  // primero: define single vs multi-tenant y el orgId
  await Promise.allSettled([cargarTickets(), cargarConfig(), cargarCortes(), cargarProductos(), cargarPerfil(), cargarGastosFijos(), cargarRequisiciones(), cargarCostosPlatillo()]);
  state.listo = true;
  notify();
  // Fija la base de la meta UNA sola vez, para que las semanas viejas queden
  // con su referencia y no "floten" al cambiar la meta actual.
  if (state.config.metaBase == null && ("presupuestoSemanal" in state.config || "metaHist" in state.config)) {
    guardarConfig({ metaBase: num(state.config.presupuestoSemanal) || 0 }).catch(() => {});
  }
  // Realtime: cuando alguien registra/edita, todos se actualizan.
  supabase.channel("cambios-gastos")
    .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, cargarTickets)
    .on("postgres_changes", { event: "*", schema: "public", table: "config" }, cargarConfig)
    .on("postgres_changes", { event: "*", schema: "public", table: "requisiciones" }, cargarRequisiciones)
    .subscribe();
}

// ── Escribir ────────────────────────────────────────────────
export async function guardarTicket(t) {
  const proveedor = await clasificarProveedorTicket(t.proveedor || "");
  const { error } = await supabase.from("tickets").insert({
    proveedor,
    fecha: t.fecha || hoyISO(),
    total: num(t.total),
    aviso: t.aviso || "",
    foto_url: t.fotoUrl || "",
    lineas: (t.lineas || []).map(limpiarLinea),
    creado_por: t.creadoPor || ""
  });
  if (error) throw error;
  await cargarTickets();
}

export async function actualizarTicket(id, datos) {
  const patch = {};
  if ("proveedor" in datos) patch.proveedor = await clasificarProveedorTicket(datos.proveedor);
  if ("fecha" in datos) patch.fecha = datos.fecha || hoyISO();
  if ("total" in datos) patch.total = num(datos.total);
  if ("aviso" in datos) patch.aviso = datos.aviso;
  if ("fotoUrl" in datos) patch.foto_url = datos.fotoUrl;
  if ("lineas" in datos) patch.lineas = (datos.lineas || []).map(limpiarLinea);
  patch.editado_por = miNombre();
  patch.editado_en = new Date().toISOString();
  const { error } = await supabase.from("tickets").update(patch).eq("id", id);
  if (error) throw error;
  await cargarTickets();
}

export async function borrarTicket(id) {
  const { error } = await supabase.from("tickets").delete().eq("id", id);
  if (error) throw error;
  await cargarTickets();
}

export async function guardarConfig(cfg) {
  const merged = { ...state.config, ...cfg };
  let error;
  if (state.multiTenant && state.orgId) {
    ({ error } = await supabase.from("config").upsert({ org_id: state.orgId, data: merged }, { onConflict: "org_id" }));
  } else {
    ({ error } = await supabase.from("config").upsert({ id: "app", data: merged }));
  }
  if (error) throw error;
  state.config = merged;
  notify();
}

// Meta de gasto POR SEMANA (historial con fecha de inicio). Cambiar la meta NO
// toca las semanas anteriores: cada una conserva la que tenía como referencia.
export function metaDeSemana(lunesISO) {
  const hist = (state.config.metaHist || []).filter((e) => e && e.desde <= lunesISO);
  if (hist.length) {
    hist.sort((a, b) => (a.desde < b.desde ? 1 : -1));
    return num(hist[0].meta);
  }
  // Semanas anteriores a cualquier meta guardada: base FIJA (no cambia al guardar).
  const base = state.config.metaBase;
  return num(base == null ? state.config.presupuestoSemanal : base) || 0;
}

export async function guardarMetaSemana(lunesISO, valor) {
  const cfg = {};
  // La 1ª vez fija la base = meta previa, para que las semanas viejas queden fijas.
  if (state.config.metaBase == null) cfg.metaBase = num(state.config.presupuestoSemanal) || 0;
  const hist = (state.config.metaHist || []).filter((e) => e && e.desde !== lunesISO);
  hist.push({ desde: lunesISO, meta: num(valor) });
  hist.sort((a, b) => (a.desde < b.desde ? -1 : 1));
  cfg.metaHist = hist;
  cfg.presupuestoSemanal = num(valor);
  await guardarConfig(cfg);
}

function limpiarLinea(l) {
  return {
    area: AREAS.includes(l.area) ? l.area : "otro",
    descripcion: (l.descripcion || "").toString().trim(),
    cantidad: num(l.cantidad),
    unidad: l.unidad || "",
    precio_unitario: num(l.precio_unitario ?? l.precioUnitario),
    monto: num(l.monto),
    tipo: TIPOS.includes(l.tipo) ? l.tipo : "operativo",
    notas: l.notas || ""
  };
}

// ── Helpers de dinero / número / fecha ──────────────────────
export function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (!v) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
}

export function money(n) {
  return num(n).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export function hoyISO() {
  return toISO(new Date());
}

export function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function parseISO(s) {
  if (!s) return null;
  const [y, m, d] = String(s).split("-").map(Number);
  if (!y) return null;
  return new Date(y, (m || 1) - 1, d || 1);
}

// Lunes de la semana (semana = lunes a domingo)
export function lunesDe(dateOrISO) {
  const d = typeof dateOrISO === "string" ? parseISO(dateOrISO) : new Date(dateOrISO);
  if (!d) return null;
  const dia = (d.getDay() + 6) % 7; // 0 = lunes
  const l = new Date(d);
  l.setDate(d.getDate() - dia);
  l.setHours(0, 0, 0, 0);
  return l;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// "15–21 jul" para el lunes dado
export function etiquetaSemana(lunes) {
  const dom = new Date(lunes);
  dom.setDate(lunes.getDate() + 6);
  const mismoMes = lunes.getMonth() === dom.getMonth();
  const a = lunes.getDate();
  const b = dom.getDate();
  if (mismoMes) return `${a}–${b} ${MESES[dom.getMonth()]}`;
  return `${a} ${MESES[lunes.getMonth()]} – ${b} ${MESES[dom.getMonth()]}`;
}

export function fechaBonita(iso) {
  const d = parseISO(iso);
  if (!d) return "s/f";
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

// ── Agregados para reportes ─────────────────────────────────

// Total de un ticket (suma de sus líneas; si no hay líneas usa .total)
export function totalTicket(t) {
  const s = (t.lineas || []).reduce((a, l) => a + num(l.monto), 0);
  return s || num(t.total);
}

// Todas las líneas (con fecha del ticket) dentro de [desde, hasta] ISO inclusive
export function lineasEnRango(desdeISO, hastaISO) {
  const out = [];
  for (const t of state.tickets) {
    if (!t.fecha) continue;
    if (desdeISO && t.fecha < desdeISO) continue;
    if (hastaISO && t.fecha > hastaISO) continue;
    for (const l of t.lineas || []) {
      out.push({ ...l, fecha: t.fecha, proveedor: t.proveedor, ticketId: t.id });
    }
  }
  return out;
}

export function ticketsEnRango(desdeISO, hastaISO) {
  return state.tickets.filter((t) =>
    t.fecha && (!desdeISO || t.fecha >= desdeISO) && (!hastaISO || t.fecha <= hastaISO));
}

// Suma agrupada por un campo de las líneas
export function sumaPor(lineas, campo) {
  const m = {};
  for (const l of lineas) {
    const k = l[campo] || "otro";
    m[k] = (m[k] || 0) + num(l.monto);
  }
  return m;
}

// Las últimas N semanas (lunes–domingo) con su gasto total
export function ultimasSemanas(n) {
  const hoyLunes = lunesDe(new Date());
  const semanas = [];
  for (let i = 0; i < n; i++) {
    const lunes = new Date(hoyLunes);
    lunes.setDate(hoyLunes.getDate() - i * 7);
    const dom = new Date(lunes);
    dom.setDate(lunes.getDate() + 6);
    const desde = toISO(lunes), hasta = toISO(dom);
    const total = ticketsEnRango(desde, hasta).reduce((a, t) => a + totalTicket(t), 0);
    semanas.push({ lunes, desde, hasta, etiqueta: etiquetaSemana(lunes), total });
  }
  return semanas;
}

// ── Ventas (cortes de caja) ─────────────────────────────────
export function cortesEnRango(desdeISO, hastaISO) {
  return state.cortes.filter((c) =>
    c.fecha && (!desdeISO || c.fecha >= desdeISO) && (!hastaISO || c.fecha <= hastaISO));
}

// Últimas N semanas con venta y gasto (para comparar y sacar costo %)
export function ventasSemanas(n) {
  const hoyLunes = lunesDe(new Date());
  const out = [];
  for (let i = 0; i < n; i++) {
    const lunes = new Date(hoyLunes);
    lunes.setDate(hoyLunes.getDate() - i * 7);
    const dom = new Date(lunes);
    dom.setDate(lunes.getDate() + 6);
    const desde = toISO(lunes), hasta = toISO(dom);
    const venta = cortesEnRango(desde, hasta).reduce((a, c) => a + num(c.ventas_total), 0);
    const gasto = ticketsEnRango(desde, hasta).reduce((a, t) => a + totalTicket(t), 0);
    out.push({ lunes, desde, hasta, etiqueta: etiquetaSemana(lunes), venta, gasto });
  }
  return out;
}

// Venta y gasto de SOLO los primeros `dias` de la semana que arranca en `lunes`.
// Sirve para comparar "mismo punto de la semana" (día 3 vs día 3 de la anterior).
export function semanaParcial(lunes, dias) {
  const l = (lunes instanceof Date) ? new Date(lunes) : parseISO(lunes);
  const fin = new Date(l); fin.setDate(l.getDate() + Math.max(0, dias - 1));
  const desde = toISO(l), hasta = toISO(fin);
  const venta = cortesEnRango(desde, hasta).reduce((a, c) => a + num(c.ventas_total), 0);
  const gasto = ticketsEnRango(desde, hasta).reduce((a, t) => a + totalTicket(t), 0);
  return { venta, gasto, dias };
}

// Historial de precios por insumo (agrupa por descripción normalizada)
// ── Proveedores: unificar nombres que son el mismo ──────────
// Palabras que no distinguen un proveedor (conectores y sufijos de razón social).
const STOP_PROV = new Set(["de", "del", "la", "el", "los", "las", "y", "e",
  "s", "a", "c", "v", "r", "l", "rl", "cv", "sa", "sc", "srl", "sapi", "sab", "sadecv"]);
// Clave normalizada: minúsculas, sin acentos, sin conectores ni "S de RL / SA de CV".
export function normProv(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !STOP_PROV.has(w)).join(" ").trim();
}
// Nombre canónico de un proveedor según el mapa de alias guardado en config.
export function canonProv(nombre) {
  const key = normProv(nombre);
  const al = (state.config && state.config.proveedorAlias) || {};
  return (key && al[key]) || (nombre || "");
}
// Agrupa los proveedores de los tickets por clave normalizada → Map(clave → Map(rawNombre → veces)).
export function clustersProveedor() {
  const byKey = new Map();
  for (const t of state.tickets) {
    const raw = (t.proveedor || "").trim();
    if (!raw) continue;
    const k = normProv(raw);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, new Map());
    const m = byKey.get(k);
    m.set(raw, (m.get(raw) || 0) + 1);
  }
  return byKey;
}
// Fusiona: para cada clave dada, apunta su alias al nombre canónico. Guarda en config.
export async function unificarProveedores(claves, canonico) {
  const al = { ...((state.config && state.config.proveedorAlias) || {}) };
  for (const k of claves) if (k) al[k] = canonico;
  await guardarConfig({ proveedorAlias: al });
}
export async function deshacerAliasProveedor(claves) {
  const al = { ...((state.config && state.config.proveedorAlias) || {}) };
  for (const k of claves) delete al[k];
  await guardarConfig({ proveedorAlias: al });
}
// ── Directorio de proveedores (con datos de contacto) ───────
// Se guarda en config.proveedoresDir (JSON), igual que los alias. Cada ficha:
// { id, nombre, telefono, correo, direccion }.
export function proveedoresDir() {
  const d = state.config && state.config.proveedoresDir;
  return Array.isArray(d) ? d : [];
}

function nuevoIdProv() {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID() : "p" + Date.now() + Math.round(Math.random() * 1e6);
}

function limpiarProv(p) {
  return {
    nombre: (p.nombre || "").toString().trim(),
    telefono: (p.telefono || "").toString().trim(),
    correo: (p.correo || "").toString().trim(),
    direccion: (p.direccion || "").toString().trim(),
  };
}

// Alta o edición de una ficha. Si trae id existente, la actualiza; si no, crea.
export async function guardarProveedorDir(p) {
  const dir = proveedoresDir().slice();
  const limpio = { id: p.id || nuevoIdProv(), ...limpiarProv(p) };
  if (!limpio.nombre) throw new Error("El proveedor necesita un nombre.");
  const i = dir.findIndex((x) => x.id === limpio.id);
  if (i >= 0) dir[i] = { ...dir[i], ...limpio };
  else dir.push(limpio);
  await guardarConfig({ proveedoresDir: dir });
  return limpio;
}

export async function borrarProveedorDir(id) {
  await guardarConfig({ proveedoresDir: proveedoresDir().filter((x) => x.id !== id) });
}

// Importa una lista (típicamente de un CSV). Fusiona por nombre normalizado:
// actualiza la ficha existente (sin borrar datos que ya tenía) y agrega las
// nuevas. Devuelve { nuevos, actualizados }.
export async function importarProveedoresDir(lista) {
  const dir = proveedoresDir().slice();
  const idx = new Map(dir.map((p, i) => [normProv(p.nombre), i]));
  let nuevos = 0, actualizados = 0;
  for (const raw of lista || []) {
    const p = limpiarProv(raw);
    if (!p.nombre) continue;
    const k = normProv(p.nombre);
    if (idx.has(k)) {
      const i = idx.get(k);
      dir[i] = {
        ...dir[i],
        nombre: p.nombre,
        telefono: p.telefono || dir[i].telefono,
        correo: p.correo || dir[i].correo,
        direccion: p.direccion || dir[i].direccion,
      };
      actualizados++;
    } else {
      idx.set(k, dir.length);
      dir.push({ id: nuevoIdProv(), ...p });
      nuevos++;
    }
  }
  await guardarConfig({ proveedoresDir: dir });
  return { nuevos, actualizados };
}

// Empareja un nombre libre contra el directorio: exacto por clave normalizada,
// o el más parecido dentro de un margen de error de dedo. null si no hay ficha
// suficientemente cercana. Devuelve { proveedor, exacto }.
export function emparejarProveedorDir(nombre) {
  const dir = proveedoresDir();
  const raw = (nombre || "").trim();
  if (!dir.length || !raw) return null;
  const key = normProv(raw);
  const exacto = dir.find((p) => normProv(p.nombre) === key);
  if (exacto) return { proveedor: exacto, exacto: true };
  let best = null, bestD = Infinity;
  for (const p of dir) {
    const k2 = normProv(p.nombre);
    if (!k2) continue;
    const d = lev(key, k2);
    const tol = Math.max(1, Math.floor(Math.min(key.length, k2.length) * 0.34));
    if (d <= tol && d < bestD) { best = p; bestD = d; }
  }
  return best ? { proveedor: best, exacto: false } : null;
}

// Se llama al guardar/editar un ticket: clasifica su proveedor contra el
// directorio. Si hay ficha existente (o la más parecida) devuelve SU nombre
// canónico; si es nuevo, crea la ficha (editable después) y lo deja como venía.
export async function clasificarProveedorTicket(nombre) {
  const raw = (nombre || "").trim();
  if (!raw) return raw;
  const m = emparejarProveedorDir(raw);
  if (m) return m.proveedor.nombre;
  try { await guardarProveedorDir({ nombre: raw }); } catch (e) { /* no bloquea el ticket */ }
  return raw;
}

// Distancia de edición (Levenshtein) para tolerar errores de dedo.
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}
// Proveedores existentes (ya canonizados) con cuántos tickets tiene cada uno.
export function proveedoresConocidos() {
  const m = new Map();
  for (const t of state.tickets) {
    const raw = (t.proveedor || "").trim();
    if (!raw) continue;
    const c = canonProv(raw);
    m.set(c, (m.get(c) || 0) + 1);
  }
  return [...m.entries()].map(([nombre, veces]) => ({ nombre, veces })).sort((a, b) => b.veces - a.veces);
}
// Sugiere un proveedor existente parecido (tolera "Crntral de Verdiras" → "Central de Verduras").
// Devuelve null si no hay parecido o si ya coincide con uno existente.
export function sugerirProveedor(nombre) {
  const key = normProv(nombre);
  if (!key || key.length < 4) return null;
  let best = null, bestSim = 0;
  for (const p of proveedoresConocidos()) {
    const k2 = normProv(p.nombre);
    if (!k2) continue;
    if (k2 === key) return null; // ya es un proveedor existente
    const sim = 1 - lev(key, k2) / Math.max(key.length, k2.length);
    if (sim > bestSim) { bestSim = sim; best = p; }
  }
  return best && bestSim >= 0.7 ? { ...best, sim: bestSim } : null;
}
// Agrupa proveedores que probablemente son el mismo (misma clave o muy parecidos).
// Devuelve solo los grupos con 2+ variantes (candidatos a unificar), el más usado primero.
export function agruparProveedores() {
  const nombres = proveedoresConocidos();
  const usado = new Set();
  const grupos = [];
  for (let i = 0; i < nombres.length; i++) {
    if (usado.has(i)) continue;
    usado.add(i);
    const grupo = [nombres[i]];
    const kBase = normProv(nombres[i].nombre);
    for (let j = i + 1; j < nombres.length; j++) {
      if (usado.has(j)) continue;
      const k2 = normProv(nombres[j].nombre);
      const sim = kBase && k2 ? 1 - lev(kBase, k2) / Math.max(kBase.length, k2.length) : 0;
      if (k2 === kBase || sim >= 0.8) { grupo.push(nombres[j]); usado.add(j); }
    }
    if (grupo.length > 1) grupos.push(grupo);
  }
  return grupos;
}

export function preciosPorInsumo() {
  const map = new Map();
  for (const t of state.tickets) {
    for (const l of t.lineas || []) {
      const nombre = (l.descripcion || "").trim();
      if (!nombre) continue;
      if (/propina/i.test(nombre)) continue;   // la propina no es un insumo
      const key = nombre.toLowerCase();
      if (!map.has(key)) map.set(key, { nombre, area: l.area, registros: [] });
      const pu = num(l.precio_unitario) || (num(l.cantidad) ? num(l.monto) / num(l.cantidad) : num(l.monto));
      map.get(key).registros.push({
        fecha: t.fecha, precio: pu, unidad: l.unidad, proveedor: canonProv(t.proveedor), monto: num(l.monto)
      });
    }
  }
  const arr = [];
  for (const v of map.values()) {
    v.registros.sort((a, b) => (a.fecha < b.fecha ? 1 : -1)); // más reciente primero
    const ultimo = v.registros[0];
    const previo = v.registros.find((r) => r.precio !== ultimo.precio && r.fecha < ultimo.fecha);
    v.precioActual = ultimo.precio;
    v.precioPrevio = previo ? previo.precio : null;
    v.cambio = previo ? (ultimo.precio - previo.precio) : 0;   // cambio absoluto en $ (para alertas de ±$1)
    v.unidad = ultimo.unidad;
    v.variacion = previo && previo.precio ? (ultimo.precio - previo.precio) / previo.precio : 0;
    v.veces = v.registros.length;
    arr.push(v);
  }
  arr.sort((a, b) => b.veces - a.veces);
  return arr;
}
