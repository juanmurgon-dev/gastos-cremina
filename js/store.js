// ─────────────────────────────────────────────────────────────
//  Capa de datos: habla con Supabase y guarda los tickets en memoria.
//  Las pantallas se "suscriben" y se redibujan solas cuando algo cambia.
// ─────────────────────────────────────────────────────────────
import { supabase } from "./supabase-init.js";

// ── Catálogos (mismos que el bot) ───────────────────────────
export const AREAS = ["cocina", "barra", "piso", "limpieza", "otro"];
export const TIPOS = ["costo de venta", "operativo"];
export const UNIDADES = ["kg", "pz", "L", "caja", "paq", "manojo", "lt", "gal", "gr", "otro"];

export const COLOR_AREA = {
  cocina: "#2ec4b6", barra: "#ff9f1c", piso: "#ffbf69",
  limpieza: "#148b7f", otro: "#7ea8a2"
};

// ── Estado en memoria ───────────────────────────────────────
export const state = {
  tickets: [],
  cortes: [],
  kpisDia: [],          // comensales/cuentas/venta por día (del encabezado del reporte)
  productos: [],
  modificadores: [],
  combos: [],
  variantes: [],
  gastosFijos: [],
  requisiciones: [],
  costosPlatillo: [],   // costo directo por platillo (para el margen)
  recetas: [],          // recetas: platillo/preparación → insumos + cantidad
  recetasFicha: [],     // ficha técnica: categoría, tiempo de prep, procedimiento
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

// KPIs por día (comensales, cuentas, venta) que vienen en el encabezado del reporte.
async function cargarKpis() {
  const { data, error } = await supabase.from("kpis_dia").select("*").order("fecha", { ascending: false });
  if (!error && data) { state.kpisDia = data; notify(); }
}
// Guarda (upsert por fecha) los KPIs de un periodo. `hasta` = fin del periodo
// (igual a fecha si es de un solo día). Idempotente al re-subir el reporte.
export async function guardarKpiDia(fecha, kpi) {
  if (!fecha) return;
  const row = { fecha, hasta: kpi.hasta || fecha, comensales: Math.round(num(kpi.comensales)), cuentas: Math.round(num(kpi.cuentas)), venta: num(kpi.venta) };
  const { error } = await supabase.from("kpis_dia").upsert(row);
  if (error) throw error;
  await cargarKpis();
}
// Suma comensales / cuentas / venta de los registros dentro de [desde, hasta].
// soloUnDia = cuenta solo registros de UN día (para la columna "Día"; excluye los semanales).
export function kpisEnRango(desdeISO, hastaISO, soloUnDia = false) {
  let comensales = 0, cuentas = 0, venta = 0;
  for (const k of state.kpisDia || []) {
    if (!k.fecha) continue;
    if (desdeISO && k.fecha < desdeISO) continue;
    if (hastaISO && k.fecha > hastaISO) continue;
    if (soloUnDia && k.hasta && k.hasta !== k.fecha) continue;   // salta los de periodo (semana/mes)
    comensales += num(k.comensales); cuentas += num(k.cuentas); venta += num(k.venta);
  }
  return { comensales, cuentas, venta };
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

// ─── RECETAS + COSTEO (cruza recetas × precios de compra) ──────────────
async function cargarRecetas() {
  // La tabla puede no existir aún (si no corrieron recetas-inventario.sql).
  const { data, error } = await supabase.from("recetas").select("*");
  if (!error && data) { state.recetas = data; notify(); }
}
async function cargarRecetasFicha() {
  const { data, error } = await supabase.from("recetas_ficha").select("*");
  if (!error && data) { state.recetasFicha = data; notify(); }
}

// Datos de ficha (categoría, tiempo, pasos, foto) de una receta.
export function fichaDe(producto) {
  const f = (state.recetasFicha || []).find((x) => x.producto === producto);
  return f || { producto, categoria: "", tiempo: 0, procedimiento: "", pasos: [], foto: "" };
}
export async function guardarFicha(producto, f) {
  const pasos = Array.isArray(f && f.pasos)
    ? f.pasos.slice(0, 40).map((p) => ({ descripcion: String(p.descripcion || "").slice(0, 500), tiempo: num(p.tiempo) || 0 }))
    : [];
  const row = {
    producto,
    categoria: String((f && f.categoria) || "").slice(0, 60),
    tiempo: pasos.length ? pasos.reduce((a, p) => a + (num(p.tiempo) || 0), 0) : (num(f && f.tiempo) || 0),
    procedimiento: pasos.map((p) => p.descripcion).join("\n").slice(0, 4000), // compat
    pasos,
    foto: String((f && f.foto) || "").slice(0, 800000),
    actualizado: new Date().toISOString(),
  };
  const { error } = await supabase.from("recetas_ficha").upsert(row);
  if (error) throw error;
  await cargarRecetasFicha();
}

const round2 = (n) => Math.round((num(n) || 0) * 100) / 100;

// Conversión de unidades para costear como tu hoja: cantidad en g/ml, precio por kg/L.
const _uBase = {
  g: ["g", 1], gr: ["g", 1], grs: ["g", 1], gramo: ["g", 1], gramos: ["g", 1],
  kg: ["g", 1000], kgs: ["g", 1000], kilo: ["g", 1000], kilos: ["g", 1000], mg: ["g", 0.001],
  ml: ["ml", 1], cc: ["ml", 1], l: ["ml", 1000], lt: ["ml", 1000], lts: ["ml", 1000], litro: ["ml", 1000], litros: ["ml", 1000],
  gal: ["ml", 3785], galon: ["ml", 3785], "galón": ["ml", 3785], galones: ["ml", 3785],
  oz: ["ml", 29.57], onza: ["ml", 29.57], onzas: ["ml", 29.57], cda: ["ml", 15], cucharada: ["ml", 15], cucharadas: ["ml", 15], cdta: ["ml", 5], cucharadita: ["ml", 5],
  pza: ["pza", 1], pz: ["pza", 1], pzas: ["pza", 1], pieza: ["pza", 1], piezas: ["pza", 1], u: ["pza", 1], un: ["pza", 1], unidad: ["pza", 1],
};
const normU = (u) => String(u || "").trim().toLowerCase().replace(/[.\s]+$/, "");
// Factor para pasar de 'desde' a 'hacia' (misma familia). Si no se puede, 1 (asume misma unidad).
export function factorConversion(desde, hacia) {
  const a = _uBase[normU(desde)], b = _uBase[normU(hacia)];
  if (!a || !b || a[0] !== b[0]) return 1;
  return a[1] / b[1];
}
// ¿Se puede convertir entre estas dos unidades?
export function unidadesCompatibles(u1, u2) {
  const a = _uBase[normU(u1)], b = _uBase[normU(u2)];
  return !!(a && b && a[0] === b[0]);
}
// Unidad de receta sugerida según cómo compras (kg→g, L→ml).
export function sugerirUnidadReceta(unidadCompra) {
  const u = normU(unidadCompra);
  if (u === "kg" || u === "kgs" || u === "kilo" || u === "kilos") return "g";
  if (u === "l" || u === "lt" || u === "lts" || u === "litro" || u === "litros") return "ml";
  return unidadCompra || "";
}

// Precio (última compra) de un insumo por nombre.
export function precioInsumo(nombre) {
  const key = String(nombre || "").trim().toLowerCase();
  const hit = preciosPorInsumo().find((i) => i.nombre.toLowerCase() === key);
  return hit ? num(hit.precioActual) : 0;
}

// Renglones de la receta de un platillo o preparación.
export function recetasDe(producto) {
  return (state.recetas || []).filter((r) => r.producto === producto);
}

// ¿'nombre' es una preparación base (sub-receta)?
export function esPreparacion(nombre) {
  return (state.recetas || []).some((r) => r.producto === nombre && r.es_preparacion);
}
function rendimientoDe(nombre) {
  const f = (state.recetas || []).find((r) => r.producto === nombre && r.es_preparacion);
  return f && num(f.rendimiento) > 0 ? num(f.rendimiento) : 1;
}
// Unidad en la que rinde una preparación (para mostrar "$/L").
export function unidadPreparacion(nombre) {
  const f = (state.recetas || []).find((r) => r.producto === nombre && r.es_preparacion);
  return f ? (f.rinde_unidad || "") : "";
}

// Costo por unidad de un insumo, resolviendo preparaciones (recursivo, anti-ciclos).
// ¿Este nombre tiene su propia receta? (preparación o platillo) → usable como componente/subreceta.
export function tieneReceta(nombre) {
  return recetasDe(nombre).length > 0;
}
export function costoInsumo(nombre, seen) {
  seen = seen || new Set();
  const prep = esPreparacion(nombre);
  if (prep || tieneReceta(nombre)) {          // preparación O platillo con receta → costo de SU receta
    if (seen.has(nombre)) return 0;           // corta ciclos (Latte → Latte de Vainilla → Latte…)
    seen.add(nombre);
    const divisor = prep ? rendimientoDe(nombre) : porcionesDe(nombre);
    return costoDeReceta(nombre, seen) / (divisor || 1);   // costo por porción/unidad
  }
  return precioInsumo(nombre);                 // insumo comprado
}

// Unidad de compra de un insumo (o la unidad en que rinde, si es preparación).
export function unidadInsumo(nombre) {
  if (esPreparacion(nombre)) return unidadPreparacion(nombre);
  if (tieneReceta(nombre)) return "porción";   // platillo usado como componente → por porción
  const key = String(nombre || "").trim().toLowerCase();
  const hit = preciosPorInsumo().find((i) => i.nombre.toLowerCase() === key);
  return hit ? (hit.unidad || "") : "";
}

// Costo de un renglón: cantidad × (ajuste por merma) × conversión de unidad × costo por unidad de compra.
// Ej.: 80 g de queso a $176/kg → 80 × (g→kg = 0.001) × 176 = 14.08. La merma sube el costo
// (si usas 100 g de algo con 20% de merma, compras 125 g → cuesta más).
// Se costea la CANTIDAD BRUTA (lo que sacas del almacén, que es lo que pagas).
// La merma NO baja el costo: sirve para saber cuánto queda útil (cantidad neta).
export function costoLinea(insumo, cantidad, unidad, merma, seen) {
  return num(cantidad) * factorConversion(unidad, unidadInsumo(insumo)) * costoInsumo(insumo, seen);
}
// Cantidad neta (aprovechable) después de la merma.
export function cantidadNeta(cantidad, merma) {
  const m = Math.min(99, Math.max(0, num(merma) || 0));
  return num(cantidad) * (1 - m / 100);
}

// Costo total de la receta (precios de compra actuales + conversión de unidades).
export function costoDeReceta(producto, seen) {
  let total = 0;
  for (const r of recetasDe(producto)) total += costoLinea(r.insumo, r.cantidad, r.unidad, r.merma, seen);
  return total;
}

// Porciones que rinde la receta de un platillo (para costo por porción).
export function porcionesDe(producto) {
  const f = (state.recetas || []).find((r) => r.producto === producto);
  return f && num(f.porciones) > 0 ? num(f.porciones) : 1;
}

// Guarda la receta completa (reemplaza sus renglones) y recalcula su costo.
export async function guardarReceta(producto, items, opts) {
  opts = opts || {};
  await supabase.from("recetas").delete().eq("producto", producto);
  const porciones = num(opts.porciones) > 0 ? num(opts.porciones) : 1;
  const filas = (items || []).filter((i) => i.insumo && num(i.cantidad) > 0).map((i) => ({
    producto,
    insumo: i.insumo,
    cantidad: num(i.cantidad),
    unidad: i.unidad || "",
    merma: num(i.merma) || 0,
    porciones,
    es_preparacion: !!opts.es_preparacion,
    rendimiento: opts.es_preparacion ? (num(opts.rendimiento) || 1) : 1,
    rinde_unidad: opts.es_preparacion ? (opts.rinde_unidad || "") : "",
  }));
  if (filas.length) {
    const { error } = await supabase.from("recetas").insert(filas);
    if (error) throw error;
  }
  await cargarRecetas();
  if (opts.ficha) { try { await guardarFicha(producto, opts.ficha); } catch (e) { console.warn("ficha:", e); } }
  if (opts.es_preparacion) await recalcularTodos();          // afecta a los platillos que la usan
  else await guardarCostoPlatillo(producto, round2(costoDeReceta(producto)));
}

export async function borrarReceta(producto) {
  const { error } = await supabase.from("recetas").delete().eq("producto", producto);
  if (error) throw error;
  await cargarRecetas();
}

// Recalcula costos_platillo de todos los platillos con receta usando los precios
// de compra actuales; solo escribe los que cambiaron. Así el margen se actualiza
// solo cuando cambian tus compras, sin recapturar nada.
export async function recalcularTodos() {
  const actuales = mapaCostos();
  const platillos = [...new Set((state.recetas || []).filter((r) => !r.es_preparacion).map((r) => r.producto))];
  let cambios = 0;
  for (const p of platillos) {
    const nuevo = round2(costoDeReceta(p) / (porcionesDe(p) || 1)); // costo POR PORCIÓN
    if (round2(actuales.get(p)) !== nuevo) {
      await supabase.from("costos_platillo").upsert({ producto: p, costo: nuevo, actualizado: new Date().toISOString() });
      cambios++;
    }
  }
  if (cambios) await cargarCostosPlatillo();
}

// Importa varias recetas de golpe (de un CSV). Reemplaza las que ya existan.
// grupos = [{producto, es_preparacion, rendimiento, rinde_unidad, items:[{insumo,cantidad,unidad}]}]
export async function importarRecetas(grupos) {
  const ordenados = [...(grupos || [])].sort((a, b) => (b.es_preparacion ? 1 : 0) - (a.es_preparacion ? 1 : 0)); // preparaciones primero
  for (const g of ordenados) {
    if (!g.producto) continue;
    await supabase.from("recetas").delete().eq("producto", g.producto);
    const porc = num(g.porciones) > 0 ? num(g.porciones) : 1;
    const filas = (g.items || []).filter((i) => i.insumo && num(i.cantidad) > 0).map((i) => ({
      producto: g.producto, insumo: i.insumo, cantidad: num(i.cantidad), unidad: i.unidad || "", merma: num(i.merma) || 0, porciones: porc,
      es_preparacion: !!g.es_preparacion, rendimiento: g.es_preparacion ? (num(g.rendimiento) || 1) : 1,
      rinde_unidad: g.es_preparacion ? (g.rinde_unidad || "") : "",
    }));
    if (filas.length) { const { error } = await supabase.from("recetas").insert(filas); if (error) throw error; }
  }
  await cargarRecetas();
  await recalcularTodos();
  return ordenados.length;
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

// ───────────── Cruce gasto ↔ requisición ─────────────
// Estatus general de una requisición, derivado del de cada item (incluye "comprado").
export function estatusRequis(items) {
  const its = items || [];
  if (!its.length) return "pendiente";
  if (its.every((x) => x.estatus === "comprado")) return "comprado";
  if (its.some((x) => x.estatus === "comprado")) return "parcial";
  if (its.every((x) => x.estatus === "pedido")) return "pedido";
  if (its.some((x) => x.estatus === "pedido")) return "parcial";
  return "pendiente";
}

// ¿La descripción de una línea de ticket corresponde al nombre de un item?
function nombreCoincideReq(a, b) {
  const na = normIns(a), nb = normIns(b);
  if (na.length < 3 || nb.length < 3) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  // comparten alguna palabra "fuerte" (≥4 letras)
  const tb = new Set(nb.split(" ").filter((w) => w.length >= 4));
  return na.split(" ").some((w) => w.length >= 4 && tb.has(w));
}

// Cruza las líneas de un gasto recién capturado contra los items de requisiciones
// ABIERTAS (no compradas) y devuelve los candidatos a marcar como "Comprado".
export function cruzarGastoRequis(lineas) {
  const ls = (lineas || []).filter((l) => (l.descripcion || "").trim());
  if (!ls.length) return [];
  const out = [];
  for (const r of (state.requisiciones || [])) {
    if (r.estatus === "comprado") continue;
    (r.items || []).forEach((it, idx) => {
      if (it.estatus === "comprado") return;
      const l = ls.find((x) => nombreCoincideReq(x.descripcion, it.nombre));
      if (l) out.push({ reqId: r.id, reqTitulo: r.titulo || fechaBonita(r.fecha) || "Requisición", itemIdx: idx, nombre: it.nombre, linea: l.descripcion });
    });
  }
  return out;
}

// Marca como "Comprado" los items elegidos y actualiza el estatus de cada requisición.
// selecciones: [{ reqId, itemIdx }] · info: { fecha }
export async function marcarComprados(selecciones, info = {}) {
  const byReq = new Map();
  for (const s of (selecciones || [])) {
    if (!byReq.has(s.reqId)) byReq.set(s.reqId, new Set());
    byReq.get(s.reqId).add(s.itemIdx);
  }
  for (const [reqId, idxs] of byReq) {
    const r = (state.requisiciones || []).find((x) => x.id === reqId);
    if (!r) continue;
    const items = (r.items || []).map((it, idx) => idxs.has(idx)
      ? { ...it, estatus: "comprado", compradoEn: info.fecha || hoyISO() }
      : it);
    await guardarRequisicion({ ...r, items, estatus: estatusRequis(items), creadoPor: r.creado_por });
  }
}

// Total de items aún NO comprados en requisiciones abiertas (para el badge de la pestaña).
export function itemsPendientesRequis() {
  let n = 0;
  for (const r of (state.requisiciones || [])) {
    if (r.estatus === "comprado") continue;
    for (const it of (r.items || [])) if (it.estatus !== "comprado") n++;
  }
  return n;
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
  await Promise.allSettled([cargarTickets(), cargarConfig(), cargarCortes(), cargarProductos(), cargarPerfil(), cargarGastosFijos(), cargarRequisiciones(), cargarCostosPlatillo(), cargarRecetas(), cargarRecetasFicha(), cargarKpis()]);
  try { await recalcularTodos(); } catch (e) { /* recetas o precios aún no disponibles */ }
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
    .on("postgres_changes", { event: "*", schema: "public", table: "kpis_dia" }, cargarKpis)
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
  return proveedor;
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

// Corrige el NOMBRE y/o UNIDAD de un insumo en TODOS sus tickets (arregla el costeo).
// Devuelve cuántos tickets se tocaron.
export async function renombrarInsumo(viejo, nuevoNombre, nuevaUnidad) {
  const vk = String(viejo || "").trim().toLowerCase();
  const nombre = String(nuevoNombre || "").trim();
  const unidad = nuevaUnidad == null ? "" : String(nuevaUnidad).trim();
  let cambiados = 0;
  for (const t of state.tickets) {
    let toco = false;
    const lineas = (t.lineas || []).map((l) => {
      if ((l.descripcion || "").trim().toLowerCase() === vk) {
        toco = true;
        const nl = { ...l };
        if (nombre) nl.descripcion = nombre;
        if (unidad) nl.unidad = unidad;
        return nl;
      }
      return l;
    });
    if (toco) {
      const { error } = await supabase.from("tickets").update({
        lineas: lineas.map(limpiarLinea), editado_por: miNombre(), editado_en: new Date().toISOString(),
      }).eq("id", t.id);
      if (error) throw error;
      cambiados++;
    }
  }
  await cargarTickets();
  return cambiados;
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

// El IVA es impuesto, no insumo: se ignora en TODO cálculo de gasto/insumo.
const ES_IVA = /\biva\b/i;   // "IVA", "IVA 16%", "IVA 8%" — no matchea "oliva"/"saliva"

// Total del ticket tal cual (lo que se pagó, con IVA) — para mostrar el ticket.
export function totalTicket(t) {
  const s = (t.lineas || []).reduce((a, l) => a + num(l.monto), 0);
  return s || num(t.total);
}

// Gasto en insumos del ticket: suma sus líneas SIN el IVA (para los análisis).
// Desglosa un ticket en costo de venta (cv) vs operativo (op), y reparte el IVA
// del ticket entre ambos según su proporción. Así el IVA que corresponde a los
// insumos de "costo de venta" (ivaCV) SÍ se cuenta como parte de ese insumo,
// y el IVA de lo operativo (ivaOp) queda del lado operativo.
function desgloseTicket(t) {
  const ls = t.lineas || [];
  let cv = 0, op = 0, iva = 0;
  for (const l of ls) {
    const m = num(l.monto);
    if (ES_IVA.test(l.descripcion || "")) { iva += m; continue; }
    if (l.tipo === "costo de venta") cv += m; else op += m;
  }
  const base = cv + op;
  const ivaCV = base > 0 ? iva * (cv / base) : 0;
  return { cv, op, iva, ivaCV, ivaOp: iva - ivaCV };
}

// Gasto TOTAL del ticket (para utilidad): insumos + operativo + el IVA de los
// insumos. El IVA de lo operativo no se cuenta (así lo pidió el usuario).
export function gastoTicket(t) {
  const ls = t.lineas || [];
  if (!ls.length) return num(t.total);
  const d = desgloseTicket(t);
  return d.cv + d.op + d.ivaCV;
}

// Gasto VARIABLE del ticket: solo lo de "costo de venta" (insumos que entran al
// platillo) MÁS el IVA que le corresponde a esos insumos. Excluye lo "operativo"
// (limpieza, servicios, gastos generales) y su IVA. Es el gasto que se compara
// contra la META y con la venta (costo %).
export function gastoVariable(t) {
  const ls = t.lineas || [];
  if (!ls.length) return num(t.total);
  const d = desgloseTicket(t);
  return d.cv + d.ivaCV;
}

// Todas las líneas (con fecha del ticket) dentro de [desde, hasta] ISO inclusive
export function lineasEnRango(desdeISO, hastaISO) {
  const out = [];
  for (const t of state.tickets) {
    if (!t.fecha) continue;
    if (desdeISO && t.fecha < desdeISO) continue;
    if (hastaISO && t.fecha > hastaISO) continue;
    for (const l of t.lineas || []) {
      if (ES_IVA.test(l.descripcion || "")) continue;   // el IVA no cuenta como gasto de insumo
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
    const total = ticketsEnRango(desde, hasta).reduce((a, t) => a + gastoTicket(t), 0);
    semanas.push({ lunes, desde, hasta, etiqueta: etiquetaSemana(lunes), total });
  }
  return semanas;
}

// ── Ventas (cortes de caja) ─────────────────────────────────
export function cortesEnRango(desdeISO, hastaISO) {
  return state.cortes.filter((c) =>
    c.fecha && (!desdeISO || c.fecha >= desdeISO) && (!hastaISO || c.fecha <= hastaISO));
}

// Pulso del ÚLTIMO día con corte: venta de ese día y comparación con el mismo
// día de la semana pasada. Es lo único que sí tenemos por día (los cortes de
// caja); el detalle por producto solo llega por semana desde Parrot.
export function pulsoDiario() {
  const porDia = new Map();
  for (const c of state.cortes || []) {
    if (!c.fecha) continue;
    porDia.set(c.fecha, (porDia.get(c.fecha) || 0) + num(c.ventas_total));
  }
  if (!porDia.size) return null;
  const fechas = [...porDia.keys()].sort();          // viejo → nuevo
  const fecha = fechas[fechas.length - 1];           // último día con corte
  const d = parseISO(fecha); d.setDate(d.getDate() - 7);
  const prevISO = toISO(d);
  return {
    fecha,
    venta: porDia.get(fecha) || 0,
    prevISO,
    prevVenta: porDia.get(prevISO) || 0,
    tienePrev: porDia.has(prevISO),
  };
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
    const ts = ticketsEnRango(desde, hasta);
    const gasto = ts.reduce((a, t) => a + gastoTicket(t), 0);        // total (para utilidad)
    const gastoVar = ts.reduce((a, t) => a + gastoVariable(t), 0);   // solo costo de venta (meta/costo %)
    out.push({ lunes, desde, hasta, etiqueta: etiquetaSemana(lunes), venta, gasto, gastoVar });
  }
  return out;
}

// Nivel de detalle de ventas del restaurante: "articulo" | "variante".
// La preferencia vive en config.detalleVentas ("auto" | "articulo" | "variante").
// "auto" (o sin definir) = variante SI el restaurante ya subió grupos
// modificadores; si no, artículo. Así un cliente que no usa variantes no ve
// avisos pidiéndoselas, y quien sí las usa (p. ej. Cremina) las conserva.
export function detalleVentas() {
  const pref = state.config && state.config.detalleVentas;
  if (pref === "articulo" || pref === "variante") return pref;
  return (state.variantes && state.variantes.length) ? "variante" : "articulo";
}
export function usaVariantes() { return detalleVentas() === "variante"; }

// Venta y gasto de SOLO los primeros `dias` de la semana que arranca en `lunes`.
// Sirve para comparar "mismo punto de la semana" (día 3 vs día 3 de la anterior).
export function semanaParcial(lunes, dias) {
  const l = (lunes instanceof Date) ? new Date(lunes) : parseISO(lunes);
  const fin = new Date(l); fin.setDate(l.getDate() + Math.max(0, dias - 1));
  const desde = toISO(l), hasta = toISO(fin);
  const venta = cortesEnRango(desde, hasta).reduce((a, c) => a + num(c.ventas_total), 0);
  const ts = ticketsEnRango(desde, hasta);
  const gasto = ts.reduce((a, t) => a + gastoTicket(t), 0);
  const gastoVar = ts.reduce((a, t) => a + gastoVariable(t), 0);
  return { venta, gasto, gastoVar, dias };
}

// Historial de precios por insumo (agrupa por descripción normalizada)
// ── Proveedores: unificar nombres que son el mismo ──────────
// Palabras que no distinguen un proveedor (conectores y sufijos de razón social).
const STOP_PROV = new Set(["de", "del", "la", "el", "los", "las", "y", "e",
  "s", "a", "c", "v", "r", "l", "rl", "cv", "sa", "sc", "srl", "sapi", "sab", "sadecv",
  "sucursal", "suc", "sucursales", "matriz", "no", "num", "numero", "mexico", "mex", "mx"]);
// Clave normalizada: minúsculas, sin acentos, sin conectores ni "S de RL / SA de CV".
export function normProv(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !STOP_PROV.has(w) && !/^\d+$/.test(w)).join(" ").trim();
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

// Une el proveedor `origen` dentro de `destino`: los tickets del origen pasan a
// nombre del destino (vía alias), se rellenan los datos de contacto que le
// falten al destino con los del origen, y se borra la ficha del origen. Al
// final queda UN SOLO proveedor. Ambos son fichas del directorio.
export async function fusionarProveedores(origen, destino) {
  if (!origen || !destino || origen.id === destino.id) return;
  const kOrigen = normProv(origen.nombre);
  const kDestino = normProv(destino.nombre);
  const nombreDest = (destino.nombre || "").trim();

  // 1) Alias: la clave del origen —y cualquier alias que ya apuntara al origen
  //    (fusiones previas)— ahora apunta al nombre del destino.
  const al = { ...((state.config && state.config.proveedorAlias) || {}) };
  if (kOrigen) al[kOrigen] = nombreDest;
  for (const k of Object.keys(al)) {
    if (normProv(al[k]) === kOrigen) al[k] = nombreDest;
  }
  if (kDestino) delete al[kDestino];   // el destino no necesita alias hacia sí mismo

  // 2) Directorio: rellena datos faltantes del destino con los del origen y
  //    quita la ficha del origen (queda una sola).
  const dir = proveedoresDir().slice();
  const iDest = dir.findIndex((x) => x.id === destino.id);
  if (iDest >= 0) {
    dir[iDest] = {
      ...dir[iDest],
      telefono: dir[iDest].telefono || origen.telefono || "",
      correo: dir[iDest].correo || origen.correo || "",
      direccion: dir[iDest].direccion || origen.direccion || "",
    };
  }
  const dir2 = dir.filter((x) => x.id !== origen.id);

  await guardarConfig({ proveedorAlias: al, proveedoresDir: dir2 });
}

// Todos los tickets de un proveedor (por nombre canónico, respetando las
// unificaciones), del más reciente al más viejo.
export function ticketsDeProveedor(nombre) {
  const k = normProv(canonProv(nombre));
  if (!k) return [];
  return state.tickets
    .filter((t) => t.proveedor && normProv(canonProv(t.proveedor)) === k)
    .slice()
    .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
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

// TODOS los proveedores CONOCIDOS: los del directorio + los que ya aparecen en
// tus tickets (ya canonizados por los alias de "unificar"), sin repetir.
// Devuelve [{ key, nombre }]. Es la base para emparejar bien y no duplicar.
export function proveedoresTodos() {
  const map = new Map();   // clave normalizada → nombre a usar
  for (const p of proveedoresDir()) {
    const k = normProv(p.nombre);
    if (k && !map.has(k)) map.set(k, p.nombre);
  }
  for (const t of state.tickets) {
    const raw = (t.proveedor || "").trim();
    if (!raw) continue;
    const canon = canonProv(raw);              // respeta las unificaciones
    const k = normProv(canon);
    if (k && !map.has(k)) map.set(k, canon);
  }
  return [...map.entries()].map(([key, nombre]) => ({ key, nombre }));
}

// El proveedor conocido más parecido a un nombre escrito (tolera errores de
// dedo). Busca contra TODOS los conocidos (directorio + tickets). { nombre, exacto } o null.
export function mejorMatchProveedor(nombre) {
  const raw = (nombre || "").trim();
  const key = normProv(raw);
  if (!key) return null;
  const lista = proveedoresTodos();
  const ex = lista.find((p) => p.key === key);
  if (ex) return { nombre: ex.nombre, exacto: true };
  let best = null, bestD = Infinity;
  for (const p of lista) {
    const d = lev(key, p.key);
    const tol = Math.max(1, Math.floor(Math.min(key.length, p.key.length) * 0.34));
    if (d <= tol && d < bestD) { best = p; bestD = d; }
  }
  if (best) return { nombre: best.nombre, exacto: false };
  // Fallback por CONTENCIÓN: si TODOS los tokens de un proveedor conocido están
  // dentro del nombre escrito (ej. "costco mayoreo tijuana" contiene "costco"),
  // unifica al más específico. Exige un token distintivo (>=4) para no unir por genéricos.
  const keyToks = new Set(key.split(" ").filter(Boolean));
  let cont = null, contLen = 0;
  for (const p of lista) {
    const pToks = p.key.split(" ").filter(Boolean);
    if (!pToks.length) continue;
    if (pToks.every((t) => keyToks.has(t)) && pToks.some((t) => t.length >= 4) && p.key.length > contLen) {
      cont = p; contLen = p.key.length;
    }
  }
  return cont ? { nombre: cont.nombre, exacto: false } : null;
}

// Se llama al guardar/editar un ticket: si el proveedor escrito se parece a uno
// que YA conoces (directorio o tickets, aunque tenga un error de dedo), usa ese
// nombre para no duplicar. Si es realmente nuevo, crea su ficha en el directorio.
export async function clasificarProveedorTicket(nombre) {
  const raw = (nombre || "").trim();
  if (!raw) return raw;
  const m = mejorMatchProveedor(raw);
  if (m) return m.nombre;
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

// ── Búsqueda de insumos (fuzzy: sin acentos, tolera errores de dedo) ────
export function normIns(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}
// Insumos existentes parecidos a la consulta, rankeados (mejor primero).
export function buscarInsumos(query, limit = 8) {
  const lista = preciosPorInsumo();
  const q = normIns(query);
  if (!q) return lista.slice(0, limit);
  const out = [];
  for (const i of lista) {
    const n = normIns(i.nombre);
    let score = -1;
    if (n === q) score = 100;
    else if (n.startsWith(q) || q.startsWith(n)) score = 80;
    else if (n.includes(q) || (n.length >= 3 && q.includes(n))) score = 65;
    else if (n.split(" ").some((w) => w.startsWith(q))) score = 55;
    else {
      const d = lev(q, n);
      if (d <= Math.max(2, Math.floor(q.length * 0.4))) score = 45 - d;
      else {
        const wd = Math.min(...n.split(" ").map((w) => lev(q, w)));
        if (wd <= Math.max(1, Math.floor(q.length * 0.34))) score = 35 - wd;
      }
    }
    if (score >= 0) out.push({ ...i, score });
  }
  out.sort((a, b) => b.score - a.score || a.nombre.length - b.nombre.length);
  return out.slice(0, limit);
}
// El insumo existente más cercano a un nombre escrito (para no duplicar al agregar).
// Solo unifica si el parecido es fuerte; si no, devuelve el nombre tal cual (insumo nuevo).
export function emparejarInsumo(nombre) {
  const raw = (nombre || "").trim();
  if (!raw) return raw;
  const hit = buscarInsumos(raw, 1)[0];
  return (hit && hit.score >= 65) ? hit.nombre : raw;
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
      if (k2 === kBase || sim >= 0.72) { grupo.push(nombres[j]); usado.add(j); }
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
      if (/propina/i.test(nombre) || ES_IVA.test(nombre)) continue;   // propina/IVA no son insumo
      const key = normIns(nombre);   // acentos/espacios/mayúsculas no crean insumos duplicados
      if (!map.has(key)) map.set(key, { nombre, area: l.area, registros: [] });
      const pu = num(l.precio_unitario) || (num(l.cantidad) ? num(l.monto) / num(l.cantidad) : num(l.monto));
      map.get(key).registros.push({
        fecha: t.fecha, precio: pu, unidad: l.unidad, proveedor: canonProv(t.proveedor), monto: num(l.monto),
        tipo: TIPOS.includes(l.tipo) ? l.tipo : "operativo"
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
    // Clasificación del insumo: "costo de venta" u "operativo" (la de su registro más reciente).
    v.tipo = (ultimo && ultimo.tipo) || "operativo";
    arr.push(v);
  }
  arr.sort((a, b) => b.veces - a.veces);
  return arr;
}

// ── Ritmo de compras ────────────────────────────────────────────────────────
// Cada cuánto compras cada insumo y a cada proveedor, y qué "ya toca pedir".
// Todo se calcula de los tickets ya registrados (sirve para anticipar pedidos).
function metricasRitmo(fechasISO) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const ds = [...new Set(fechasISO.filter(Boolean))].sort();   // fechas únicas, ascendente
  const fechas = ds.map(parseISO).filter(Boolean);
  const n = fechas.length;
  if (!n) return null;
  const primera = fechas[0], ultima = fechas[n - 1];
  const dEntre = (a, b) => Math.round((b - a) / 86400000);
  const diasDesde = Math.max(0, dEntre(ultima, hoy));
  const intervalo = n >= 2 ? dEntre(primera, ultima) / (n - 1) : null;   // días promedio entre compras
  const spanDias = Math.max(7, dEntre(primera, hoy) + 1);
  const porSemana = n / (spanDias / 7);
  let estado = "ok", urgencia = 0;
  if (intervalo != null && intervalo > 0) {
    urgencia = diasDesde / intervalo;                 // 1 = justo toca; >1 = vencido
    estado = urgencia >= 1 ? "toca" : urgencia >= 0.7 ? "pronto" : "ok";
  }
  return { veces: n, ultima: toISO(ultima), diasDesde, intervalo, porSemana, estado, urgencia };
}

export function ritmoCompras() {
  // Por insumo (agrupado por descripción normalizada, como preciosPorInsumo).
  const insMap = new Map();
  for (const t of state.tickets) {
    for (const l of t.lineas || []) {
      const nombre = (l.descripcion || "").trim();
      if (!nombre || /propina/i.test(nombre) || ES_IVA.test(nombre)) continue;
      const key = normIns(nombre);   // acentos/espacios/mayúsculas no crean insumos duplicados
      let o = insMap.get(key);
      if (!o) { o = { nombre, area: l.area, fechas: [], montos: [], unidad: l.unidad || "", provs: new Set() }; insMap.set(key, o); }
      o.fechas.push(t.fecha);
      o.montos.push(num(l.monto));
      if (l.unidad) o.unidad = l.unidad;
      if (t.proveedor) o.provs.add(canonProv(t.proveedor));
    }
  }
  const insumos = [];
  for (const o of insMap.values()) {
    const m = metricasRitmo(o.fechas);
    if (!m) continue;
    const montoProm = o.montos.reduce((a, b) => a + b, 0) / o.montos.length;
    insumos.push({ ...m, nombre: o.nombre, area: o.area, unidad: o.unidad, proveedor: [...o.provs][0] || "", montoProm });
  }

  // Por proveedor (nombre canónico).
  const provMap = new Map();
  for (const t of state.tickets) {
    const raw = (t.proveedor || "").trim();
    if (!raw) continue;
    const c = canonProv(raw);
    let o = provMap.get(c);
    if (!o) { o = { nombre: c, fechas: [], totales: [] }; provMap.set(c, o); }
    o.fechas.push(t.fecha);
    o.totales.push(gastoTicket(t));
  }
  const proveedores = [];
  for (const o of provMap.values()) {
    const m = metricasRitmo(o.fechas);
    if (!m) continue;
    const gastoProm = o.totales.reduce((a, b) => a + b, 0) / o.totales.length;
    proveedores.push({ ...m, nombre: o.nombre, gastoProm });
  }

  const ord = (a, b) => (b.urgencia - a.urgencia) || (b.porSemana - a.porSemana);
  insumos.sort(ord); proveedores.sort(ord);
  return { insumos, proveedores };
}

// Predicción para el presupuesto: insumos recurrentes que YA tocan y no se han
// pedido esta semana, con su costo típico; avisa si te pasarías de la meta.
export function prediccionCompras() {
  const { insumos } = ritmoCompras();
  const desde = toISO(lunesDe(new Date()));
  const meta = metaDeSemana(desde);
  const gastoSemana = ticketsEnRango(desde, hoyISO()).reduce((a, t) => a + gastoVariable(t), 0);

  const pendientes = [];
  for (const i of insumos) {
    if (i.veces < 2 || i.intervalo == null || i.intervalo > 12) continue;   // solo compra frecuente
    if (i.estado !== "toca") continue;                                      // ya vencido
    if (i.ultima >= desde) continue;                                        // ya lo pediste esta semana
    pendientes.push({ nombre: i.nombre, montoProm: i.montoProm, intervalo: i.intervalo, diasDesde: i.diasDesde, unidad: i.unidad });
  }
  pendientes.sort((a, b) => b.montoProm - a.montoProm);
  const costoPendiente = pendientes.reduce((a, p) => a + p.montoProm, 0);
  const proyectado = gastoSemana + costoPendiente;
  return { meta, gastoSemana, pendientes, costoPendiente, proyectado, seValePasar: meta > 0 && proyectado > meta };
}
