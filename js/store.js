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
  cocina: "#0e3a39", barra: "#dd6031", piso: "#767522",
  limpieza: "#491208", otro: "#9c9482"
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
  perfil: { nombre: "", email: "", cargado: false },
  config: { presupuestoSemanal: 35000, presupuestoPorArea: {} },
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
  const { data } = await supabase.from("config").select("data").eq("id", "app").maybeSingle();
  if (data && data.data) state.config = { ...state.config, ...data.data };
  notify();
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
  await Promise.all([cargarCortes(), cargarProductos()]);
}

let arrancado = false;
export async function init() {
  if (arrancado) return;
  arrancado = true;
  // allSettled: aunque una consulta falle, la app SIEMPRE deja de estar "cargando".
  await Promise.allSettled([cargarTickets(), cargarConfig(), cargarCortes(), cargarProductos(), cargarPerfil(), cargarGastosFijos()]);
  state.listo = true;
  notify();
  // Realtime: cuando alguien registra/edita, todos se actualizan.
  supabase.channel("cambios-gastos")
    .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, cargarTickets)
    .on("postgres_changes", { event: "*", schema: "public", table: "config" }, cargarConfig)
    .subscribe();
}

// ── Escribir ────────────────────────────────────────────────
export async function guardarTicket(t) {
  const { error } = await supabase.from("tickets").insert({
    proveedor: t.proveedor || "",
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
  if ("proveedor" in datos) patch.proveedor = datos.proveedor;
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
  const { error } = await supabase.from("config").upsert({ id: "app", data: merged });
  if (error) throw error;
  state.config = merged;
  notify();
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
export function preciosPorInsumo() {
  const map = new Map();
  for (const t of state.tickets) {
    for (const l of t.lineas || []) {
      const nombre = (l.descripcion || "").trim();
      if (!nombre) continue;
      const key = nombre.toLowerCase();
      if (!map.has(key)) map.set(key, { nombre, area: l.area, registros: [] });
      const pu = num(l.precio_unitario) || (num(l.cantidad) ? num(l.monto) / num(l.cantidad) : num(l.monto));
      map.get(key).registros.push({
        fecha: t.fecha, precio: pu, unidad: l.unidad, proveedor: t.proveedor, monto: num(l.monto)
      });
    }
  }
  const arr = [];
  for (const v of map.values()) {
    v.registros.sort((a, b) => (a.fecha < b.fecha ? 1 : -1)); // más reciente primero
    const ultimo = v.registros[0];
    const previo = v.registros.find((r) => r.precio !== ultimo.precio && r.fecha < ultimo.fecha);
    v.precioActual = ultimo.precio;
    v.unidad = ultimo.unidad;
    v.variacion = previo && previo.precio ? (ultimo.precio - previo.precio) / previo.precio : 0;
    v.veces = v.registros.length;
    arr.push(v);
  }
  arr.sort((a, b) => b.veces - a.veces);
  return arr;
}
