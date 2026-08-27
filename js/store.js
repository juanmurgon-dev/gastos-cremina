// ─────────────────────────────────────────────────────────────
//  Capa de datos: habla con Supabase y guarda los tickets en memoria.
//  Las pantallas se "suscriben" y se redibujan solas cuando algo cambia.
// ─────────────────────────────────────────────────────────────
import * as plan from "./plan.js";
import { supabase } from "./supabase-init.js";

// ── Catálogos (mismos que el bot) ───────────────────────────
export const AREAS = ["cocina", "barra", "piso", "limpieza", "otro"];
export const TIPOS = ["costo de venta", "operativo"];
export const UNIDADES = ["kg", "pz", "L", "caja", "paq", "manojo", "lt", "gal", "gr", "otro"];

// Un color por área, y que se distingan de verdad. Antes barra (#ff9f1c) y
// piso (#ffbf69) eran casi el mismo naranja, y cocina y limpieza los dos
// turquesa: a simple vista no se sabía cuál era cuál. Ahora son cinco tonos
// separados. Este mismo mapa lo usan requisiciones, tickets, insumos,
// presupuesto y reportes, así que "barra" se ve igual en toda la app.
export const COLOR_AREA = {
  cocina: "#0f8a7d",     // turquesa
  barra: "#c2670f",      // ámbar
  piso: "#3560a8",       // azul
  limpieza: "#7a4f9e",   // morado
  otro: "#78736c"        // gris
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
  ingredientesMaestro: [], // registro maestro: precio por gramo por ingrediente (fuente para recetas)
  invArticulos: [],     // catálogo de artículos de inventario (reutilizable)
  invConteos: [],       // cabeceras de conteo + total (vista v_conteo_totales)
  cierres: [],          // cierres mensuales con COGS (vista v_cogs_mensual)
  perfil: { nombre: "", email: "", cargado: false },
  config: { presupuestoSemanal: 35000, presupuestoPorArea: {} },
  orgId: null,          // id del restaurante (multi-tenant); null = single-tenant
  multiTenant: false,   // true si la BD ya tiene la tabla 'miembros'
  dominio: "",          // dominio de login del restaurante (orgs.dominio)
  plan: null,           // plan del restaurante: lite | pro (null = se ve todo)
  miRol: null,          // rol: owner|admin|gerente|chef|barista|ayudante|compras|staff
  miArea: null,         // área del rol acotado: 'barra' | 'cocina' | null (sin límite)
  rolCargado: false,    // ¿ya sabemos quién es? Hasta entonces no se enseña nada.
  ordenesMesero: [],    // una fila por cuenta (se carga al abrir Ventas → Meseros)
  ordenesMeseroAl: 0,   // cuándo se trajeron (para saber si ya están viejas)
  ventasSemana: {},     // venta escrita a mano por semana: { "2026-08-10": 189353 }
  fechasMesero: null,   // días que tienen órdenes (índice ligero, sin bajar las órdenes)
  indiceMesero: null,   // pares { fecha, mesero } — para saber quién ha trabajado
  ordenesMeseroRango: null,  // qué rango está cargado ahora mismo
  errorMeseros: null,   // p.ej. "falta correr meseros.sql"
  orgNombre: null,      // nombre del restaurante (para mostrar en el encabezado)
  listo: false
};

const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify() { _preciosCache = null; _preciosMap = null; subs.forEach((fn) => fn()); }
// Cache de preciosPorInsumo(): se reconstruye caro (recorre todos los tickets).
// Se invalida en notify() (cualquier cambio de estado). Evita rehacerlo miles de
// veces al costear recetas (antes bloqueaba el hilo → el buscador no escribía).
let _preciosCache = null, _preciosMap = null;

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
    creadoEn: r.creado_en || "",       // fecha/hora de SUBIDA a la app (≠ fecha del gasto)
    editadoPor: r.editado_por || "",
    editadoEn: r.editado_en || null
  };
}

// Supabase corta CADA consulta en 1000 filas. Con varios meses de historial eso
// hace que semanas enteras desaparezcan sin aviso (variantes_venta ya pasó ese
// tope). Pedimos de mil en mil hasta que llegue una página incompleta.
// Trae TODAS las filas de una consulta, de mil en mil.
//
// Supabase corta en 1000 filas por petición y NO avisa: devuelve mil y se
// queda tan tranquilo. Cualquier consulta que pueda pasar de ahí tiene que
// pasar por aquí, o va a mentir en silencio — que fue justo lo que hizo el
// índice de meseros: con 2,277 órdenes solo veía las primeras mil, así que
// faltaban semanas en el selector y personas en el scorecard.
async function traerPaginado(hacerQuery, orden) {
  const PAGINA = 1000, MAX = 60;
  const filas = [];
  for (let i = 0; i < MAX; i++) {
    const r = await hacerQuery()
      .order(orden, { ascending: true })
      .range(i * PAGINA, i * PAGINA + PAGINA - 1);
    if (r.error) return { filas, error: r.error };
    filas.push(...(r.data || []));
    if (!r.data || r.data.length < PAGINA) break;
  }
  return { filas, error: null };
}

async function traerTodo(tabla, orden = "id") {
  const PAGINA = 1000, MAX_PAGINAS = 60;
  const filas = [];
  for (let i = 0; i < MAX_PAGINAS; i++) {
    const { data, error } = await supabase.from(tabla).select("*")
      .order(orden, { ascending: true })
      .range(i * PAGINA, i * PAGINA + PAGINA - 1);
    if (error) return { filas, error };
    filas.push(...(data || []));
    if (!data || data.length < PAGINA) break;   // última página
  }
  return { filas, error: null };
}

// Más reciente primero (las vistas lo esperan así).
const porFechaDesc = (a, b) => String(b.fecha || "").localeCompare(String(a.fecha || ""));

async function cargarTickets() {
  const { filas: data, error } = await traerTodo("tickets");
  data.sort(porFechaDesc);
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
  // Se piden las columnas del plan, pero con red: si la base todavía no las
  // tiene (plan-destinos.sql sin correr), PostgREST rechaza la consulta
  // ENTERA. Sin este reintento, el error caería en la rama de "base sin
  // roles" de abajo y TODOS pasarían a ver todo — el barista incluido.
  // Un error de columna faltante no puede convertirse en un permiso.
  let { data, error } = await supabase.from("miembros")
    .select("org_id, rol, area, orgs(nombre, plan, extras, ocultos, dominio)").limit(1);
  if (error) {
    ({ data, error } = await supabase.from("miembros")
      .select("org_id, rol, area, orgs(nombre)").limit(1));
  }
  if (error) {
    // La tabla no existe → base sin roles (single-tenant): todos ven todo.
    state.multiTenant = false; state.orgId = null; state.miRol = null;
    state.miArea = null; state.orgNombre = null;
    state.plan = null; plan.definir(null, [], []);
  } else {
    state.multiTenant = true;
    const row = data && data[0];
    state.orgId = (row && row.org_id) || null;
    state.miRol = (row && row.rol) || null;
    state.miArea = (row && row.area && String(row.area).toLowerCase()) || null;
    state.orgNombre = (row && row.orgs && row.orgs.nombre) || null;
    // Qué destinos ve este restaurante. Si la base todavía no tiene las
    // columnas (`plan-destinos.sql` sin correr), `o` viene sin ellas y el
    // plan queda en null → se ve todo, como antes. Nadie se queda sin app
    // por una migración pendiente.
    const o = (row && row.orgs) || {};
    state.plan = o.plan || null;
    state.dominio = o.dominio || "";
    plan.definir(o.plan, o.extras, o.ocultos);
    // Se deja anotado en el navegador porque la pantalla de LOGIN lo
    // necesita — y ahí todavía no hay sesión con la cual preguntarlo.
    // (La misma llave que lee app.js; no se importa app.js desde aquí
    //  para no armar un círculo entre los dos módulos.)
    try { if (o.dominio) localStorage.setItem("platify.dominio", String(o.dominio).toLowerCase()); } catch (e) {}
  }
  // Pase lo que pase: ya sabemos a qué atenernos. Antes de esta línea, la app
  // no debe dibujar ninguna pantalla — no sabe a quién se la está enseñando.
  state.rolCargado = true;
  notify();
}

// ═══════════════════════════════════════════════════════════════════
//  DESEMPEÑO POR MESERO (una fila por cuenta, de `ordenes_mesero`)
//
//  NO se carga en init(): son miles de filas que solo le sirven a una
//  pantalla. La vista de Meseros las pide cuando se abre.
// ═══════════════════════════════════════════════════════════════════
// Índice ligero: SOLO las fechas que tienen órdenes. Con esto la pantalla
// arma su lista de semanas sin bajar una sola orden completa.
export async function cargarFechasMesero() {
  // Fecha + quién atendió. Dos columnas de texto: pesa poco y con eso la
  // pantalla sabe QUÉ semanas hay y QUIÉNES han trabajado, sin bajar una
  // sola orden completa.
  const { filas, error } = await traerPaginado(
    () => supabase.from("ordenes_mesero").select("fecha, mesero"), "fecha");
  if (error) return [];
  state.indiceMesero = filas.filter((r) => r.fecha);
  state.fechasMesero = [...new Set(state.indiceMesero.map((r) => r.fecha))].sort();
  notify();
  return state.fechasMesero;
}

// Quiénes atendieron en las últimas `semanas` antes de `hasta`. Sirve para
// que las columnas del scorecard no cambien de una semana a otra: si alguien
// no tuvo turnos, aparece igual con "sin turnos" en vez de desaparecer.
export function meserosActivos(hasta, semanas = 8) {
  const fin = new Date(hasta + "T12:00:00");
  const ini = new Date(fin); ini.setDate(ini.getDate() - semanas * 7);
  const desdeISO = ini.toISOString().slice(0, 10);
  const s = new Set();
  for (const r of state.indiceMesero || []) {
    if (r.fecha >= desdeISO && r.fecha <= hasta && r.mesero) s.add(r.mesero);
  }
  return [...s];
}

// Trae las órdenes de UN RANGO, no todas. Antes bajaba la historia
// completa para enseñar una semana: 2,277 órdenes con su desglose para
// mostrar 150. Eso es lo que hacía que la pestaña tardara en abrir, y
// habría empeorado cada semana que pasara.
export async function cargarOrdenesMesero(desde, hasta) {
  const clave = (desde || "") + "|" + (hasta || "");
  const { filas, error } = await traerPaginado(() => {
    let q = supabase.from("ordenes_mesero").select("*");
    if (desde) q = q.gte("fecha", desde);
    if (hasta) q = q.lte("fecha", hasta);
    return q;
  }, "referencia");
  if (error) { state.errorMeseros = error.message; notify(); return []; }
  state.errorMeseros = null;
  state.ordenesMesero = filas;
  state.ordenesMeseroRango = clave;
  // Cuándo se trajo esto. La pantalla lo muestra y decide si ya está viejo:
  // la base puede cambiar por fuera (un import en otro dispositivo, o un
  // arreglo corrido a mano en SQL) y sin esto la app se quedaba con la copia
  // en memoria hasta recargar la app entera.
  state.ordenesMeseroAl = Date.now();
  notify();
  return filas;
}

// Comensales y venta partidos por canal (comedor vs para-llevar), para un
// rango. Trae SOLO tres columnas del periodo pedido en vez de las miles de
// órdenes completas: Inicio necesita cuatro números, no el detalle.
// Devuelve null si la tabla no existe todavía — quien llame que no pinte nada.
export async function comensalesPorCanal(desde, hasta) {
  const { filas: data, error } = await traerPaginado(
    () => supabase.from("ordenes_mesero").select("referencia, tipo_orden, comensales, total")
      .gte("fecha", desde).lte("fecha", hasta).eq("estatus", "Cerrada"), "referencia");
  if (error) return null;
  const r = { comedor: 0, llevar: 0, ctasComedor: 0, ctasLlevar: 0, ventaComedor: 0, ventaLlevar: 0 };
  for (const o of data || []) {
    if (num(o.total) <= 0) continue;             // cuentas en cero: prueba o error
    if (o.tipo_orden === "Comedor") { r.comedor += num(o.comensales); r.ctasComedor++; r.ventaComedor += num(o.total); }
    else { r.llevar += num(o.comensales); r.ctasLlevar++; r.ventaLlevar += num(o.total); }
  }
  return (r.comedor || r.llevar) ? r : null;
}

// Guarda el reporte importado. Upsert por referencia: volver a subir el mismo
// archivo (o uno que se traslape) corrige en vez de duplicar.
// `conDetalle` dice si el archivo traía la hoja de artículos. Cuando NO la
// trae (el reporte de órdenes exportado solo), se guardan los datos de la
// cuenta —mesero, comensales, total— pero no se tocan los conteos de café,
// postres y extras: un upsert solo escribe las columnas que le mandas, así
// que omitirlas conserva lo que ya se había guardado de un reporte completo.
// Mandarlas en cero borraría el desglose de esa semana.
export async function importarOrdenesMesero(filas, conDetalle = true) {
  if (!Array.isArray(filas) || !filas.length) return { guardadas: 0 };
  const LOTE = 500;
  let guardadas = 0;
  state.columnasQueFaltan = null;
  // El índice de fechas y personas que alimenta la pestaña de Meseros queda
  // viejo en cuanto entra una orden nueva. Sin esto, subir el reporte de un
  // día y no ver aparecer ni el día ni a quien lo trabajó hasta recargar
  // toda la app — que fue justo lo que pasó con Denisse, Alexa y Giselle.
  state.fechasMesero = null;
  state.indiceMesero = null;
  for (let i = 0; i < filas.length; i += LOTE) {
    const trozo = filas.slice(i, i + LOTE).map((f) => ({
      referencia: f.referencia,
      fecha: f.fecha,
      mesero: f.mesero || "",
      tipo_orden: f.tipo_orden || "",
      estatus: f.estatus || "",
      mesa: f.mesa || "",
      comensales: num(f.comensales),
      total: num(f.total),
      descuento: num(f.descuento),
      ...(conDetalle ? {
        cafes: num(f.cafes),
        postres: num(f.postres),
        extras_uds: num(f.extras_uds),
        extras_monto: num(f.extras_monto),
        bebidas: num(f.bebidas),
        detalle: f.detalle || {},
      } : {}),
    }));
    let lote = trozo;
    let { error } = await supabase.from("ordenes_mesero").upsert(lote, { onConflict: "referencia" });

    // Cuando la app guarda una columna que la base todavía no tiene, PostgREST
    // rechaza el LOTE ENTERO y no entra ni una orden. Ya pasó con `bebidas` y
    // con `descuento`, y va a volver a pasar con la siguiente columna nueva.
    //
    // En vez de tratar cada caso por su nombre, se lee cuál columna reclama,
    // se quita, y se reintenta. Así una columna que falte cuesta esa columna,
    // no la importación completa. Y SIEMPRE se dice cuál faltó — un fallo
    // callado es peor que uno ruidoso.
    for (let intento = 0; intento < 4 && error; intento++) {
      const m = /Could not find the '([^']+)' column/i.exec(error.message || "");
      if (!m) break;
      const col = m[1];
      state.columnasQueFaltan = [...new Set([...(state.columnasQueFaltan || []), col])];
      lote = lote.map((r) => { const c = { ...r }; delete c[col]; return c; });
      ({ error } = await supabase.from("ordenes_mesero").upsert(lote, { onConflict: "referencia" }));
    }
    if (error) throw error;
    guardadas += trozo.length;
  }
  await cargarOrdenesMesero();
  logActividad("meseros", guardadas + " órdenes");
  return { guardadas, faltan: state.columnasQueFaltan };
}

// ═══════════════════════════════════════════════════════════════════
//  CAPACITACIÓN
//  Se carga bajo demanda (solo la usa su pantalla) y NO se guarda en
//  `state`: la vista pide y recibe. Así no hay dos copias del mismo dato.
// ═══════════════════════════════════════════════════════════════════
export async function cargarCapacitacion() {
  const tablas = ["capacitacion_personas", "capacitacion_competencias", "capacitacion_criterios",
                  "capacitacion_preguntas", "capacitacion_intentos", "capacitacion_practicas"];
  const res = await Promise.all(tablas.map((t) => supabase.from(t).select("*")));
  const fallo = res.find((r) => r.error);
  if (fallo) {
    const m = fallo.error.message || "";
    throw new Error(/does not exist|schema cache/i.test(m)
      ? "Falta correr capacitacion.sql en Supabase." : m);
  }
  const [personas, competencias, criterios, preguntas, intentos, practicas] = res.map((r) => r.data || []);
  personas.sort((a, b) => (a.area || "").localeCompare(b.area || "") || (a.nombre || "").localeCompare(b.nombre || ""));
  competencias.sort((a, b) => (a.orden || 0) - (b.orden || 0));
  return { personas, competencias, criterios, preguntas, intentos, practicas };
}

export async function guardarPersonaCap(p) {
  const { error } = await supabase.from("capacitacion_personas").insert({
    nombre: p.nombre, area: p.area, puesto: p.puesto || "", nombre_parrot: p.nombre_parrot || "",
  });
  if (error) throw new Error(/duplicate/i.test(error.message) ? "Ya hay alguien con ese nombre." : error.message);
}

export async function borrarPersonaCap(id) {
  const { error } = await supabase.from("capacitacion_personas").delete().eq("id", id);
  if (error) throw error;
}

// Un intento = un examen completo. Se guarda entero, no respuesta por
// respuesta, para poder decir "pasó el 70% en ESTE intento" aunque repita.
export async function guardarIntentoQuiz(i) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("capacitacion_intentos").insert({
    persona_id: i.persona_id, competencia_id: i.competencia_id, nivel: i.nivel,
    evaluador: (u && u.user && u.user.id) || null,
    respuestas: i.respuestas || {}, aciertos: num(i.aciertos), total: num(i.total),
    aprobado: !!i.aprobado,
  });
  if (error) throw error;
  logActividad("capacitacion", "quiz " + i.nivel);
}

export async function guardarPracticaCap(p) {
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("capacitacion_practicas").insert({
    persona_id: p.persona_id, competencia_id: p.competencia_id, nivel: p.nivel,
    evaluador: (u && u.user && u.user.id) || null,
    checklist: p.checklist || {}, observaciones: p.observaciones || "", aprobado: !!p.aprobado,
  });
  if (error) throw error;
  logActividad("capacitacion", "observación " + p.nivel);
}

// ═══════════════════════════════════════════════════════════════════
//  VENTA SEMANAL ESCRITA A MANO
//
//  El único dato de entrada del plan Lite. Antes se escribía en la
//  pantalla de Meta y se perdía al salir, porque se trataba como un
//  ajuste temporal sobre lo que viniera de Parrot. Sin Parrot ese número
//  ES el sistema, así que ahora se guarda por semana.
// ═══════════════════════════════════════════════════════════════════
export async function cargarVentasSemana() {
  const { data, error } = await supabase.from("ventas_semana").select("semana, venta");
  if (error) return;                       // tabla aún no creada: se ignora
  const m = {};
  for (const r of data || []) m[r.semana] = num(r.venta);
  state.ventasSemana = m;
  notify();
}

// La venta que TÚ escribiste para esa semana. null = no hay, hay que
// caer a lo que digan los reportes.
export function ventaEscritaDe(lunesISO) {
  const v = state.ventasSemana[lunesISO];
  return v == null ? null : num(v);
}

export async function guardarVentaSemana(lunesISO, venta) {
  const { error } = await supabase.from("ventas_semana")
    .upsert({ semana: lunesISO, venta: num(venta), actualizado: new Date().toISOString() },
            { onConflict: "org_id,semana" });
  if (error) throw error;
  state.ventasSemana = { ...state.ventasSemana, [lunesISO]: num(venta) };
  notify();
}

// ───────────── Roles y candados ─────────────
// OJO: esto es solo para ESCONDER lo que no le toca a cada quien y que la app
// no se vea rota. El candado de verdad vive en la RLS de Supabase
// (supabase/roles-candados.sql): aunque alguien se salte la interfaz y le
// pegue directo a la API, la base de datos no le devuelve el dato.

// Jefes: ven todo. En single-tenant (sin tabla miembros) todos son jefes.
//
// Fail-closed: mientras no sepamos el rol, la respuesta es NO. Antes esto
// devolvía true por defecto, y como el rol llega de la base DESPUÉS de dibujar
// la pantalla, quien abriera la app veía por un momento la versión completa —
// con precios y todo — aunque no le tocara. Ante la duda, lo mínimo.
const ROLES_JEFE = ["owner", "admin", "gerente", "chef"];
export function esJefe() {
  if (!state.rolCargado) return false;
  if (!state.multiTenant) return true;
  return ROLES_JEFE.includes(state.miRol);
}
// Rol acotado a un área (barista → barra, ayudante → cocina).
export function miArea() { return state.miArea || ""; }
export function esDeArea() { return !esJefe() && !!miArea(); }
// ¿Esta categoría/área le toca al usuario? (compara sin importar mayúsculas)
export function esMiArea(cat) {
  if (esJefe()) return true;
  const a = miArea();
  return !!a && String(cat || "").toLowerCase() === a;
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
  const { filas: data, error } = await traerTodo("cortes");
  if (!error && data) { state.cortes = data.sort(porFechaDesc); notify(); }
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
  const p = await traerTodo("productos_venta");
  if (!p.error) state.productos = p.filas;
  const m = await traerTodo("modificadores_venta");
  if (!m.error) state.modificadores = m.filas;
  const c = await traerTodo("combos_venta");
  if (!c.error) state.combos = c.filas;
  const v = await traerTodo("variantes_venta");
  if (!v.error) state.variantes = v.filas;
  // Si una consulta falló, que no se vea como "no hay ventas": se avisa en pantalla.
  state.errorVentas = [p, m, c, v].map((r) => r.error && r.error.message).filter(Boolean).join(" · ") || null;
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
  return f || { producto, categoria: "", tiempo: 0, procedimiento: "", pasos: [], foto: "", completa: false, precio_venta: 0 };
}
export async function guardarFicha(producto, f) {
  const pasos = Array.isArray(f && f.pasos)
    ? f.pasos.slice(0, 40).map((p) => ({ descripcion: String(p.descripcion || "").slice(0, 500), tiempo: num(p.tiempo) || 0 }))
    : [];
  const row = {
    producto,
    categoria: String((f && f.categoria) || "").slice(0, 60),
    numero: String((f && f.numero) || "").slice(0, 30),
    observaciones: String((f && f.observaciones) || "").slice(0, 4000),
    tiempo: pasos.length ? pasos.reduce((a, p) => a + (num(p.tiempo) || 0), 0) : (num(f && f.tiempo) || 0),
    procedimiento: pasos.map((p) => p.descripcion).join("\n").slice(0, 4000), // compat
    pasos,
    foto: String((f && f.foto) || "").slice(0, 800000),
    completa: !!(f && f.completa),   // el usuario marcó la receta como terminada/verificada
    // Precio de carta CON IVA. Manda sobre el promedio de ventas, que mezcla
    // el platillo con sus versiones más caras. 0 = usar el promedio.
    precio_venta: num(f && f.precio_venta) || 0,
    actualizado: new Date().toISOString(),
  };
  let { error } = await supabase.from("recetas_ficha").upsert(row);
  if (error && /precio_venta/i.test(error.message || "")) {
    // Todavía no corren precio-carta.sql: guarda la ficha SIN el precio en vez
    // de tirar todo el guardado por una columna que falta.
    const { precio_venta, ...sinPrecio } = row;
    ({ error } = await supabase.from("recetas_ficha").upsert(sinPrecio));
  }
  if (error) throw error;
  await cargarRecetasFicha();
}

const round2 = (n) => Math.round((num(n) || 0) * 100) / 100;

// Conversión de unidades para costear como tu hoja: cantidad en g/ml, precio por kg/L.
// Familias: peso (base g), volumen (base ml), conteo (base pza). Solo convierte dentro
// de la misma familia. La ONZA aquí es de PESO (28.35 g); para onza líquida usa "fl oz".
const _uBase = {
  // ── Peso (base g) ──
  mg: ["g", 0.001],
  g: ["g", 1], gr: ["g", 1], grs: ["g", 1], gramo: ["g", 1], gramos: ["g", 1],
  kg: ["g", 1000], kgs: ["g", 1000], kilo: ["g", 1000], kilos: ["g", 1000], kilogramo: ["g", 1000], kilogramos: ["g", 1000],
  oz: ["g", 28.3495], onza: ["g", 28.3495], onzas: ["g", 28.3495], "oz peso": ["g", 28.3495],
  lb: ["g", 453.592], lbs: ["g", 453.592], libra: ["g", 453.592], libras: ["g", 453.592],
  // ── Volumen (base ml) ──
  ml: ["ml", 1], cc: ["ml", 1],
  l: ["ml", 1000], lt: ["ml", 1000], lts: ["ml", 1000], litro: ["ml", 1000], litros: ["ml", 1000],
  gal: ["ml", 3785.41], galon: ["ml", 3785.41], "galón": ["ml", 3785.41], galones: ["ml", 3785.41],
  "fl oz": ["ml", 29.5735], floz: ["ml", 29.5735], "onza liquida": ["ml", 29.5735], "onza líquida": ["ml", 29.5735],
  taza: ["ml", 240], tazas: ["ml", 240], cup: ["ml", 240], cups: ["ml", 240],
  cda: ["ml", 15], cucharada: ["ml", 15], cucharadas: ["ml", 15], cdta: ["ml", 5], cucharadita: ["ml", 5], cucharaditas: ["ml", 5],
  // ── Conteo (base pza) ──
  pza: ["pza", 1], pz: ["pza", 1], pzas: ["pza", 1], pieza: ["pza", 1], piezas: ["pza", 1],
  u: ["pza", 1], un: ["pza", 1], unidad: ["pza", 1], unidades: ["pza", 1],
  docena: ["pza", 12], docenas: ["pza", 12],
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
  const hit = preciosIndex().get(String(nombre || "").trim().toLowerCase());
  return hit ? num(hit.precioActual) : 0;
}

// ── Precio por unidad respetando LO QUE CAPTURA EL USUARIO ──────────────
// El problema que resuelve: un proveedor factura "10 caja $1,879" y otro
// "60 pza $1,879". Es el mismo insumo y el mismo gasto, pero el precio
// unitario del ticket brinca de $187.90 a $31.32 y el costeo se vuelve loco.
// La presentación que el usuario escribió (ej. "6 pza") dice cuánto trae de
// verdad cada caja, así que manda sobre lo que diga el ticket.
//
// Orden de autoridad, de más a menos:
//   1. Registro Maestro (precio por gramo) — lo escribió a mano
//   2. Presentación por proveedor          — la escribió a mano
//   3. Precio crudo del ticket             — último recurso
const RE_PRES_U = /(\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|g|gr|grs|gramos?|lts?|l|litros?|ml|pzas?|pz|piezas?)/i;
export function parsePresentacion(txt) {
  const s = String(txt || "");
  const m = s.match(RE_PRES_U);
  if (m) return { qty: parseFloat(m[1].replace(",", ".")), unit: m[2].toLowerCase() };
  const n = s.match(/(\d+(?:[.,]\d+)?)/);   // un número solo ("300") = cantidad en la unidad base
  return n ? { qty: parseFloat(n[1].replace(",", ".")), unit: "" } : null;
}

// Unidad base (kg / L / pza) en la que tiene sentido medir este insumo.
export function baseDeInsumo(item) {
  if (!item) return "";
  const cand = [];
  for (const r of item.registros || []) {
    if (r.unidad) cand.push(r.unidad);
    const p = parsePresentacion(presentacionDe(item.nombre, r.proveedor));
    if (p && p.unit) cand.push(p.unit);
  }
  for (const fam of ["kg", "L", "pza"]) if (cand.some((u) => unidadesCompatibles(u, fam))) return fam;
  // Sin peso ni volumen pero con presentación (ej. huevo "300") → se compara por pieza.
  return (item.registros || []).some((r) => parsePresentacion(presentacionDe(item.nombre, r.proveedor))) ? "pza" : "";
}

// Precio por unidad base de UNA compra. null si no hay con qué normalizarla.
// `conPres` es true solo cuando el número salió de la presentación capturada.
export function precioBaseCompra(nombre, r, base) {
  if (!base || !r) return null;
  const precio = num(r.precio);
  if (!(precio > 0)) return null;
  const p = parsePresentacion(presentacionDe(nombre, r.proveedor));
  if (p && p.qty > 0) {
    if (p.unit && unidadesCompatibles(p.unit, base)) return { precio: precio / (p.qty * factorConversion(p.unit, base)), conPres: true };
    if (!p.unit) return { precio: precio / p.qty, conPres: true };
  }
  if (r.unidad && unidadesCompatibles(r.unidad, base)) return { precio: precio * factorConversion(base, r.unidad), conPres: false };
  return null;
}

// Precio unitario ya normalizado de un insumo: { precio, unidad, normalizado }.
// Lo resuelve preciosPorInsumo(); aquí solo se lee.
export function precioNormalizado(nombre) {
  const item = preciosIndex().get(String(nombre || "").trim().toLowerCase());
  if (!item || !(num(item.precioActual) > 0)) return null;
  return { precio: num(item.precioActual), unidad: item.unidad || "", normalizado: !!item.normalizado };
}


// Costo sugerido para un artículo de inventario, buscando el insumo más parecido
// en tus tickets (emparejamiento difuso) y tomando su último precio de compra.
// Devuelve { precio, insumo } — precio 0 si no encontró nada razonable.
export function costoSugerido(nombre) {
  const match = emparejarInsumo(nombre);
  const precio = precioInsumo(match);
  return { precio, insumo: precio > 0 ? match : "" };
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
  const m = maestroDe(nombre);                 // Registro Maestro: precio por gramo tiene prioridad
  if (m && num(m.precio_g) > 0) return num(m.precio_g);   // $/g (unidad base = g)
  return precioInsumo(nombre);   // del ticket, ya normalizado a su unidad base

}

// Unidad de compra de un insumo (o la unidad en que rinde, si es preparación).
export function unidadInsumo(nombre) {
  if (esPreparacion(nombre)) return unidadPreparacion(nombre);
  if (tieneReceta(nombre)) return "porción";   // platillo usado como componente → por porción
  const _m = maestroDe(nombre);
  if (_m) return _m.unidad_base || "g";         // del Registro Maestro → su unidad base
  const hit = preciosIndex().get(String(nombre || "").trim().toLowerCase());
  return hit ? (hit.unidad || "") : "";
}

// Costo de un renglón: cantidad × (ajuste por merma) × conversión de unidad × costo por unidad de compra.
// Ej.: 80 g de queso a $176/kg → 80 × (g→kg = 0.001) × 176 = 14.08. La merma sube el costo
// (si usas 100 g de algo con 20% de merma, compras 125 g → cuesta más).
// Se costea la CANTIDAD BRUTA (lo que sacas del almacén, que es lo que pagas).
// La merma NO baja el costo: sirve para saber cuánto queda útil (cantidad neta).
export function costoLinea(insumo, cantidad, unidad, merma, seen) {
  // Si el insumo está en el Registro Maestro → cuesta por GRAMO (fuente confiable):
  //   costo = gramos usados × precio/g. Convierte kg/oz/lb→g, o pza→g con gramos_pz.
  const m = (!esPreparacion(insumo) && !tieneReceta(insumo)) ? maestroDe(insumo) : null;
  if (m && num(m.precio_g) > 0) {
    const bu = m.unidad_base || "g";                 // unidad base del maestro (g/ml/pza/kg/L)
    const u = normU(unidad || bu);
    if (unidadesCompatibles(u, bu)) return num(cantidad) * factorConversion(u, bu) * num(m.precio_g);
  }
  const ui = unidadInsumo(insumo);
  // Si receta y compra son de familias distintas (ej. receta en g, compra en L/pza),
  // NO se puede convertir → no inflar el costo con números absurdos: lo dejamos en $0
  // hasta que ese insumo tenga unidad compatible o entre al Registro Maestro (en gramos).
  if (unidad && ui && !unidadesCompatibles(unidad, ui)) return 0;
  return num(cantidad) * factorConversion(unidad, ui) * costoInsumo(insumo, seen);
}

// ── Registro Maestro de Ingredientes (precio por gramo, fuente para recetas) ──
async function cargarIngredientesMaestro() {
  const { data, error } = await supabase.from("ingredientes_maestro").select("*").order("nombre");
  if (!error && data) { state.ingredientesMaestro = data; notify(); }
}
export function maestroDe(nombre) {
  const k = normIns(nombre);
  return (state.ingredientesMaestro || []).find((x) => normIns(x.nombre) === k) || null;
}

// ── Variantes de un platillo (del grupo modificador del POS) ──
// Igual criterio que el Margen: elige el grupo principal (ignora leche/temperatura,
// prefiere "Tipo"/sabores) y devuelve las opciones que se venden.
const _ES_CORTESIA = /pan de cortes[íi]a/i;
const _ES_SECUNDARIO = /leche|fr[íi]o|caliente|shot|cold foam|temperatura/i;
const _ES_SABOR_NOMBRE = /sabor|saboriz|jarabe|syrup|flavor|esencia/i;
const _ES_SABOR_OPCION = /vainilla|avellana|caramelo|cremina|chocolate|mo[ck]a|canela|amaretto|hazelnut|vanilla|caramel|coco|fresa|matcha|chai|lavanda|menta|calabaza|pumpkin|maple|pistache|cajeta/i;
function _elegirGrupoVar(grupos) {
  const unidades = (g) => grupos[g].reduce((a, r) => a + num(r.unidades), 0);
  const pool = Object.keys(grupos).filter((n) => !_ES_SECUNDARIO.test(n));
  const base = pool.length ? pool : Object.keys(grupos);
  let cand = base.filter((n) => n.toLowerCase().startsWith("tipo"));
  if (!cand.length) cand = base.filter((n) => _ES_SABOR_NOMBRE.test(n));
  if (!cand.length) cand = base.filter((n) => grupos[n].some((r) => _ES_SABOR_OPCION.test(r.opcion || "")));
  if (!cand.length) cand = base;
  return cand.sort((a, b) => unidades(b) - unidades(a))[0];
}
export function variantesDe(producto) {
  if (!usaVariantes || !usaVariantes()) return [];
  const vars = (state.variantes || []).filter((v) =>
    v.producto === producto && !_ES_CORTESIA.test(v.producto || "") && !_ES_CORTESIA.test(v.opcion || ""));
  if (!vars.length) return [];
  const grupos = {};
  for (const v of vars) (grupos[v.grupo] = grupos[v.grupo] || []).push(v);
  const gname = _elegirGrupoVar(grupos);
  const seen = new Map();
  for (const r of (grupos[gname] || [])) {
    const op = (r.opcion || "").trim();
    if (!op) continue;
    const o = seen.get(op) || { opcion: op, unidades: 0, venta: 0 };
    o.unidades += num(r.unidades); o.venta += num(r.venta); seen.set(op, o);
  }
  return [...seen.values()]
    .map((o) => ({ ...o, precio: o.unidades > 0 ? o.venta / o.unidades : 0 }))
    .sort((a, b) => b.venta - a.venta);
}
export function precioGMaestro(nombre) { const m = maestroDe(nombre); return m ? num(m.precio_g) : 0; }
export async function guardarIngredienteMaestro(row) {
  const r = {
    nombre: String(row.nombre || "").trim(),
    compra_pz: num(row.compra_pz) || 1,
    gramos_pz: num(row.gramos_pz) || 0,
    precio_total: num(row.precio_total) || 0,
    unidad_base: String(row.unidad_base || "g").trim() || "g",
    fecha: row.fecha || hoyISO(),
    updated_at: new Date().toISOString(),
  };
  // La tabla tiene índice único por lower(nombre). El upsert resuelve conflictos
  // por id, así que insertar un nombre que YA existe truena por duplicado y se
  // pierde el precio recién capturado (pasa al renombrar un insumo). Si no nos
  // dieron id, buscamos el del registro que ya tiene ese nombre y lo actualizamos.
  let id = row.id;
  if (!id) {
    const low = r.nombre.toLowerCase();
    const ya = (state.ingredientesMaestro || []).find((x) => String(x.nombre || "").toLowerCase() === low);
    if (ya) id = ya.id;
  }
  if (id) r.id = id;
  const { error } = await supabase.from("ingredientes_maestro").upsert(r);
  if (error) throw error;
  await cargarIngredientesMaestro();
  try { await recalcularTodos(); } catch (e) { /* recuesta recetas con el nuevo precio/g */ }
}
export async function borrarIngredienteMaestro(id) {
  const { error } = await supabase.from("ingredientes_maestro").delete().eq("id", id);
  if (error) throw error;
  await cargarIngredientesMaestro();
  try { await recalcularTodos(); } catch (e) {}
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
  // El área manda quién puede verla (RLS). Se conserva la que ya tenía la
  // requisición; si es nueva, la del área de quien la crea ('general' para jefes).
  const previa = (state.requisiciones || []).find((r) => r.id === req.id);
  const row = {
    id: req.id,
    fecha: req.fecha || hoyISO(),
    titulo: req.titulo || "",
    estatus: req.estatus || "pendiente",
    items: Array.isArray(req.items) ? req.items : [],
    total: num(req.total),
    area: req.area || (previa && previa.area) || miArea() || "general",
    creado_por: req.creadoPor || miNombre()
  };
  const { error } = await supabase.from("requisiciones").upsert(row);
  if (error) throw error;
  await cargarRequisiciones();
  logActividad("requisicion");
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
  // Ojo: las RECETAS y sus fichas también son trabajo del restaurante y antes
  // no se respaldaban. Las fotos (insumo_fotos) siguen fuera: pesan demasiado.
  const tablas = ["tickets", "cortes", "gastos_fijos", "productos_venta",
    "modificadores_venta", "combos_venta", "variantes_venta", "requisiciones",
    "costos_platillo", "recetas", "recetas_ficha", "ingredientes_maestro",
    "config", "perfiles"];
  const out = { app: "Cifra", exportado: new Date().toISOString(), tablas: {} };
  for (const t of tablas) {
    const SIN_ID = { costos_platillo: "producto", recetas_ficha: "producto", ingredientes_maestro: "nombre" };
    const orden = SIN_ID[t] || "id";
    const { filas, error } = await traerTodo(t, orden);
    out.tablas[t] = error ? { error: error.message } : filas;
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
  await Promise.allSettled([cargarTickets(), cargarConfig(), cargarCortes(), cargarProductos(), cargarPerfil(), cargarGastosFijos(), cargarRequisiciones(), cargarCostosPlatillo(), cargarRecetas(), cargarRecetasFicha(), cargarKpis(), cargarVentasSemana(), cargarInvArticulos(), cargarConteos(), cargarCierres(), cargarIngredientesMaestro()]);
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
    .on("postgres_changes", { event: "*", schema: "public", table: "inventario_conteos" }, cargarConteos)
    .on("postgres_changes", { event: "*", schema: "public", table: "inventario_articulos" }, cargarInvArticulos)
    .on("postgres_changes", { event: "*", schema: "public", table: "ingredientes_maestro" }, cargarIngredientesMaestro)
    .subscribe();
}

// ═══════════════════════════════════════════════════════════════════
//  INVENTARIO: catálogo de artículos, conteos mensuales y cierre/COGS.
// ═══════════════════════════════════════════════════════════════════

// Catálogo de artículos (reutilizable mes a mes).
async function cargarInvArticulos() {
  const { data, error } = await supabase.from("inventario_articulos").select("*").order("categoria").order("orden");
  if (!error && data) { state.invArticulos = data; notify(); }
}
// Cabeceras de conteo + su total (de la vista v_conteo_totales).
async function cargarConteos() {
  const { data, error } = await supabase.from("v_conteo_totales").select("*").order("fecha", { ascending: false });
  if (!error && data) { state.invConteos = data; notify(); }
}
// Cierres mensuales ya calculados (vista v_cogs_mensual).
async function cargarCierres() {
  const { data, error } = await supabase.from("v_cogs_mensual").select("*").order("periodo", { ascending: false });
  if (!error && data) { state.cierres = data; notify(); }
}
export async function recargarInventario() {
  await Promise.allSettled([cargarInvArticulos(), cargarConteos(), cargarCierres()]);
}

export function conteoBorrador() {
  return (state.invConteos || []).find((c) => c.estado === "borrador") || null;
}
export function articulosActivos() {
  return (state.invArticulos || []).filter((a) => a.activo !== false);
}

// Líneas de un conteo (se cargan bajo demanda, no viven en el estado global).
export async function lineasDeConteo(conteoId) {
  const { data, error } = await supabase.from("inventario_conteo_lineas")
    .select("*").eq("conteo_id", conteoId);
  if (error) throw error;
  return data || [];
}

// Crea un conteo nuevo con fecha dada y genera una línea por cada artículo activo.
export async function crearConteo(fecha) {
  const { data, error } = await supabase.from("inventario_conteos")
    .insert({ fecha, estado: "borrador", creado_por: (state.user && state.user.id) || null })
    .select().single();
  if (error) throw error;
  const arts = articulosActivos();
  if (arts.length) {
    const filas = arts.map((a) => ({
      conteo_id: data.id, articulo_id: a.id,
      nombre_snapshot: a.nombre, unidad_snapshot: a.unidad, categoria_snapshot: a.categoria,
      // Si el catálogo no trae costo, sugiere el de tus tickets (último precio de compra).
      cantidad: 0, costo_unitario: num(a.costo_unitario) || costoSugerido(a.nombre).precio,
    }));
    const { error: e2 } = await supabase.from("inventario_conteo_lineas").insert(filas);
    if (e2) throw e2;
  }
  await cargarConteos();
  logActividad("inventario", "conteo " + fecha);
  return data;
}

// Actualiza una línea (cantidad / costo / nombre / unidad). Devuelve error si falla.
export async function guardarLinea(lineaId, cambios) {
  const patch = { updated_at: new Date().toISOString() };
  if ("cantidad" in cambios) patch.cantidad = num(cambios.cantidad);
  if ("costo_unitario" in cambios) patch.costo_unitario = num(cambios.costo_unitario);
  if ("nombre_snapshot" in cambios) patch.nombre_snapshot = cambios.nombre_snapshot;
  if ("unidad_snapshot" in cambios) patch.unidad_snapshot = cambios.unidad_snapshot;
  const { error } = await supabase.from("inventario_conteo_lineas").update(patch).eq("id", lineaId);
  if (error) throw error;
  await cargarConteos();   // refresca el total corriente
}

// Guarda el costo de varias líneas de golpe (para el botón "sugerir costos de tickets").
export async function guardarCostosLote(items) {
  await Promise.all((items || []).map((it) =>
    supabase.from("inventario_conteo_lineas")
      .update({ costo_unitario: num(it.costo), updated_at: new Date().toISOString() }).eq("id", it.id)));
  await cargarConteos();
}

// Agrega una línea ad-hoc (artículo fuera del catálogo). Opcionalmente lo guarda al catálogo.
export async function agregarLineaAdHoc(conteoId, art, guardarEnCatalogo) {
  let articuloId = null;
  if (guardarEnCatalogo) {
    const nuevo = await guardarArticulo({
      nombre: art.nombre, unidad: art.unidad || "pza", categoria: art.categoria || "Sin categoría",
      costo_unitario: num(art.costo_unitario), orden: 999,
    });
    articuloId = nuevo.id;
  }
  const { data, error } = await supabase.from("inventario_conteo_lineas").insert({
    conteo_id: conteoId, articulo_id: articuloId,
    nombre_snapshot: art.nombre, unidad_snapshot: art.unidad || "pza",
    categoria_snapshot: art.categoria || "Sin categoría",
    cantidad: num(art.cantidad), costo_unitario: num(art.costo_unitario),
  }).select().single();
  if (error) throw error;
  await cargarConteos();
  return data;
}

// Cierra el conteo y refresca el costo del catálogo con lo capturado (precios frescos).
export async function cerrarConteo(conteoId) {
  const lineas = await lineasDeConteo(conteoId);
  for (const l of lineas) {
    if (l.articulo_id && num(l.costo_unitario) > 0) {
      await supabase.from("inventario_articulos")
        .update({ costo_unitario: num(l.costo_unitario), updated_at: new Date().toISOString() })
        .eq("id", l.articulo_id);
    }
  }
  const { error } = await supabase.from("inventario_conteos")
    .update({ estado: "cerrado", updated_at: new Date().toISOString() }).eq("id", conteoId);
  if (error) throw error;
  await Promise.allSettled([cargarConteos(), cargarInvArticulos()]);
  logActividad("inventario", "cierre conteo");
}

// ── Catálogo CRUD ──
export async function guardarArticulo(art) {
  const row = {
    nombre: art.nombre, unidad: art.unidad || "pza", categoria: art.categoria || "Sin categoría",
    costo_unitario: num(art.costo_unitario), orden: num(art.orden), activo: art.activo !== false,
    updated_at: new Date().toISOString(),
  };
  if (art.id) {
    const { data, error } = await supabase.from("inventario_articulos").update(row).eq("id", art.id).select().single();
    if (error) throw error; await cargarInvArticulos(); return data;
  }
  const { data, error } = await supabase.from("inventario_articulos").insert(row).select().single();
  if (error) throw error; await cargarInvArticulos(); return data;
}
export async function bajaArticulo(id) {   // baja lógica (nunca borrado físico)
  const { error } = await supabase.from("inventario_articulos")
    .update({ activo: false, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error; await cargarInvArticulos();
}
export async function reactivarArticulo(id) {
  const { error } = await supabase.from("inventario_articulos")
    .update({ activo: true, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error; await cargarInvArticulos();
}
// Borrado físico. Seguro para el histórico: las líneas de conteos pasados tienen
// on delete set null (conservan nombre/unidad/valor en su snapshot).
export async function borrarArticulo(id) {
  const { error } = await supabase.from("inventario_articulos").delete().eq("id", id);
  if (error) throw error; await cargarInvArticulos();
}

// Rellena el costo del CATÁLOGO con el precio sugerido de tus tickets (emparejamiento
// difuso). Por defecto solo llena los que están en 0 (no pisa costos ya capturados).
export async function sugerirCostosCatalogo(soloVacios = true) {
  const arts = state.invArticulos || [];
  const updates = [];
  for (const a of arts) {
    if (soloVacios && num(a.costo_unitario) > 0) continue;
    const sug = costoSugerido(a.nombre);
    if (sug.precio > 0) updates.push({ id: a.id, costo: sug.precio });
  }
  await Promise.all(updates.map((u) => supabase.from("inventario_articulos")
    .update({ costo_unitario: u.costo, updated_at: new Date().toISOString() }).eq("id", u.id)));
  if (updates.length) await cargarInvArticulos();
  return { actualizados: updates.length, total: arts.length };
}

// ── Cierre mensual ──
export async function guardarCierre(cierre) {
  const row = {
    periodo: cierre.periodo,
    conteo_inicial_id: cierre.conteo_inicial_id || null,
    conteo_final_id: cierre.conteo_final_id || null,
    compras_sin_iva: num(cierre.compras_sin_iva),
    consumo_familia: num(cierre.consumo_familia),
    venta_neta: num(cierre.venta_neta),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("cierres_mensuales").upsert(row, { onConflict: "periodo" });
  if (error) throw error;
  await cargarCierres();
  logActividad("inventario", "cierre " + cierre.periodo);
}

// ── Escribir ────────────────────────────────────────────────
// Registra una acción del usuario para el panel de uso (aperturas, capturas, etc.).
// Silencioso: si la tabla 'actividad' no existe todavía, no pasa nada.
export async function logActividad(evento, detalle = "") {
  try {
    await supabase.from("actividad").insert({ org_id: state.orgId || null, evento, detalle: String(detalle || "").slice(0, 120) });
  } catch (_) { /* sin panel de actividad, ignora */ }
}

export async function guardarTicket(t) {
  const proveedor = await clasificarProveedorTicket(t.proveedor || "");
  const { error } = await supabase.from("tickets").insert({
    proveedor,
    fecha: t.fecha || hoyISO(),
    total: num(t.total),
    aviso: t.aviso || "",
    foto_url: t.fotoUrl || "",
    // Los nombres que se parezcan a uno oficial entran ya con ese nombre,
    // para que no se abra un insumo nuevo por una tilde o una mayúscula.
    lineas: (t.lineas || []).map((l) => limpiarLinea({ ...l, descripcion: canonInsumo(l.descripcion) })),
    creado_por: t.creadoPor || ""
  });
  if (error) throw error;
  await cargarTickets();
  logActividad("ticket");
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
// ── Qué precio manda para costear, por insumo ──────────────────────────
// Por defecto el más reciente, que es lo que casi siempre quieres. Pero si un
// proveedor te cobró de más una vez, o compras a dos precios y quieres costear
// con el bajo, aquí se elige. Se guarda en config, no toca los tickets.
export const CRITERIOS = ["reciente", "barato", "caro", "promedio", "fijo"];
export function criterioPrecioDe(nombre) {
  const m = state.config.criteriosPrecio || {};
  const c = m[normIns(nombre)];
  if (!c) return { modo: "reciente" };
  if (typeof c === "string") return { modo: CRITERIOS.includes(c) ? c : "reciente" };
  return { modo: CRITERIOS.includes(c.modo) ? c.modo : "reciente", valor: num(c.valor) };
}
export async function guardarCriterioPrecio(nombre, modo, valor) {
  const m = { ...(state.config.criteriosPrecio || {}) };
  const k = normIns(nombre);
  if (!modo || modo === "reciente") delete m[k];               // el default no se guarda
  else if (modo === "fijo") m[k] = { modo: "fijo", valor: num(valor) };
  else m[k] = { modo };
  await guardarConfig({ criteriosPrecio: m });
}

// Corrige UNA compra (el renglón de un ticket) desde la pantalla de Precios.
// Lo que se paga (el monto) es el dato duro del ticket; lo que suele venir mal
// es CUÁNTO trae: "1 caja $176.93" cuando en realidad son 6 L. Por eso se
// editan cantidad y unidad, y el precio unitario se recalcula solo.
export async function editarCompra(ticketId, insumo, cambios) {
  const t = state.tickets.find((x) => x.id === ticketId);
  if (!t) throw new Error("Ya no existe ese ticket.");
  const k = normIns(insumo);
  let toco = false;
  const lineas = (t.lineas || []).map((l) => {
    if (toco || normIns(l.descripcion) !== k) return l;
    toco = true;
    const nl = { ...l };
    if (cambios.cantidad != null) nl.cantidad = num(cambios.cantidad);
    if (cambios.unidad != null) nl.unidad = String(cambios.unidad).trim();
    if (cambios.monto != null) nl.monto = num(cambios.monto);
    const c = num(nl.cantidad);
    nl.precio_unitario = c > 0 ? round2(num(nl.monto) / c) : num(nl.monto);
    return nl;
  });
  if (!toco) throw new Error("Ese ticket ya no tiene este insumo.");
  const { error } = await supabase.from("tickets").update({
    lineas: lineas.map(limpiarLinea), editado_por: miNombre(), editado_en: new Date().toISOString(),
  }).eq("id", ticketId);
  if (error) throw error;
  await cargarTickets();
}

// Presentación del insumo POR PROVEEDOR (ej. Prov A "Bote 5 kg", Prov B "Bidón 10 kg").
// Metadato en config, indexado por nombre normalizado + proveedor — no toca los tickets.
// Compat: si no hay por-proveedor, cae a la presentación a nivel insumo (versión vieja).
export function presentacionDe(nombre, proveedor) {
  const m = state.config.presentaciones || {};
  const k = normIns(nombre);
  if (proveedor != null && proveedor !== "") {
    const kp = k + "|" + normProv(proveedor);
    if (m[kp] != null && m[kp] !== "") return m[kp];
  }
  return m[k] || "";
}
export async function guardarPresentacion(nombre, proveedor, texto) {
  const m = { ...(state.config.presentaciones || {}) };
  const k = normIns(nombre) + (proveedor != null && proveedor !== "" ? "|" + normProv(proveedor) : "");
  const t = String(texto || "").trim();
  if (t) m[k] = t; else delete m[k];
  await guardarConfig({ presentaciones: m });
}

// SKU del proveedor para un insumo (override editable, guardado en config).
export function skuProvDe(nombre, proveedor) {
  const m = state.config.skusProv || {};
  const kp = normIns(nombre) + "|" + normProv(proveedor);
  return m[kp] || "";
}
export async function guardarSkuProv(nombre, proveedor, texto) {
  const m = { ...(state.config.skusProv || {}) };
  const k = normIns(nombre) + "|" + normProv(proveedor);
  const t = String(texto || "").trim();
  if (t) m[k] = t; else delete m[k];
  await guardarConfig({ skusProv: m });
}

// Fotos de la presentación por insumo/proveedor (tabla dedicada, carga bajo demanda).
// Devuelve un Map(proveedor_norm → foto base64) con las fotos de ESE insumo.
export async function fotosDeInsumo(nombre) {
  const m = new Map();
  const { data, error } = await supabase.from("insumo_fotos").select("proveedor_norm,foto").eq("insumo_norm", normIns(nombre));
  if (!error && data) for (const r of data) m.set(r.proveedor_norm || "", r.foto || "");
  return m;
}
// Igual que fotosDeInsumo pero para MUCHOS insumos de un jalón (una sola
// consulta, no una por renglón). Devuelve Map(insumo_norm → Map(prov_norm → foto)).
export async function fotosDeInsumos(nombres) {
  const claves = [...new Set((nombres || []).map((n) => normIns(n)).filter(Boolean))];
  const out = new Map();
  if (!claves.length) return out;
  // Por lotes: una lista enorme en .in() puede pasarse del largo de la URL.
  for (let i = 0; i < claves.length; i += 200) {
    const { data, error } = await supabase.from("insumo_fotos")
      .select("insumo_norm,proveedor_norm,foto").in("insumo_norm", claves.slice(i, i + 200));
    if (error || !data) continue;
    for (const r of data) {
      if (!r.foto) continue;
      if (!out.has(r.insumo_norm)) out.set(r.insumo_norm, new Map());
      out.get(r.insumo_norm).set(r.proveedor_norm || "", r.foto);
    }
  }
  return out;
}

export async function guardarFotoInsumo(nombre, proveedor, foto) {
  const row = {
    insumo_norm: normIns(nombre), proveedor_norm: proveedor ? normProv(proveedor) : "",
    insumo: String(nombre || "").trim(), proveedor: String(proveedor || "").trim(),
    foto: foto || "", actualizado: new Date().toISOString(),
  };
  const { error } = await supabase.from("insumo_fotos").upsert(row, { onConflict: "insumo_norm,proveedor_norm" });
  if (error) throw error;
}
export async function borrarFotoInsumo(nombre, proveedor) {
  const { error } = await supabase.from("insumo_fotos").delete()
    .eq("insumo_norm", normIns(nombre)).eq("proveedor_norm", proveedor ? normProv(proveedor) : "");
  if (error) throw error;
}
// Al renombrar un insumo, mueve sus fotos a la nueva clave para que no se pierdan.
export async function migrarFotosInsumo(viejo, nuevo) {
  if (normIns(viejo) === normIns(nuevo)) return;
  await supabase.from("insumo_fotos").update({ insumo_norm: normIns(nuevo), insumo: String(nuevo || "").trim() }).eq("insumo_norm", normIns(viejo));
}

export async function renombrarInsumo(viejo, nuevoNombre, nuevaUnidad, nuevoCodigo) {
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
        if (nuevoCodigo !== undefined) nl.codigo = String(nuevoCodigo || "").trim();   // set/limpia el SKU
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
  let error = null;

  // Camino multi-tenant: una fila de config por restaurante.
  if (state.multiTenant && state.orgId) {
    ({ error } = await supabase.from("config").upsert(
      { org_id: state.orgId, data: merged }, { onConflict: "org_id" }));
  }

  // Respaldo: la tabla `config` puede seguir con su forma vieja — una sola
  // fila con id='app', sin columna org_id. Pasa cuando se activaron los roles
  // (que crean `miembros`, así que multiTenant queda en true) sin haber
  // migrado config. Sin este respaldo, el guardado tronaba en silencio y el
  // usuario perdía lo que acababa de capturar.
  if (!state.multiTenant || !state.orgId || error) {
    const r = await supabase.from("config").upsert({ id: "app", data: merged });
    if (r.error) {
      // Si el respaldo TAMBIÉN falla, lo que importa es su error, no el del
      // primer intento: antes se enseñaba "falta la columna org_id" aunque la
      // causa real fuera otra (permisos, por ejemplo) y mandaba a buscar mal.
      if (error) r.error.message = `${r.error.message} · (el intento por restaurante ya había fallado con: ${error.message})`;
      throw r.error;
    }
  }

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
    codigo: (l.codigo || "").toString().trim(),   // código/SKU del producto en el proveedor
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

// TODA fecha que se muestra en la app pasa por aquí: DD/MM/YYYY.
// Acepta ISO ("2026-08-05") o un Date.
export function fechaDMA(f) {
  const d = f instanceof Date ? f : parseISO(f);
  if (!d || isNaN(d)) return "s/f";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// "03/08/2026 – 09/08/2026" para el lunes dado
export function etiquetaSemana(lunes) {
  const dom = new Date(lunes);
  dom.setDate(lunes.getDate() + 6);
  return `${fechaDMA(lunes)} – ${fechaDMA(dom)}`;
}

export function fechaBonita(iso) { return fechaDMA(iso); }

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
// porSubida=true → filtra por la fecha en que se SUBIÓ el ticket a la app
// (t.creado_en), no por la fecha del gasto (t.fecha).
export function lineasEnRango(desdeISO, hastaISO, porSubida = false) {
  const out = [];
  for (const t of state.tickets) {
    const f = porSubida ? (t.creadoEn || "").slice(0, 10) : t.fecha;
    if (!f) continue;
    if (desdeISO && f < desdeISO) continue;
    if (hastaISO && f > hastaISO) continue;
    for (const l of t.lineas || []) {
      if (ES_IVA.test(l.descripcion || "")) continue;   // el IVA no cuenta como gasto de insumo
      out.push({ ...l, fecha: t.fecha, subida: (t.creadoEn || "").slice(0, 10), proveedor: t.proveedor, ticketId: t.id });
    }
  }
  return out;
}

export function ticketsEnRango(desdeISO, hastaISO, porSubida = false) {
  return state.tickets.filter((t) => {
    const f = porSubida ? (t.creadoEn || "").slice(0, 10) : t.fecha;
    return f && (!desdeISO || f >= desdeISO) && (!hastaISO || f <= hastaISO);
  });
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
// caja); el detalle por producto solo llega por semana desde tu punto de venta.
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
// Búsqueda tolerante para TODOS los buscadores de la app.
// Ignora acentos y mayúsculas, y pide que aparezcan todas las palabras en
// cualquier orden: "jamon kirkland" encuentra "Jamón Kirkland" y también
// "Kirkland Jamón Serrano". Sin consulta, todo pasa.
export function coincide(texto, consulta) {
  const q = normIns(consulta);
  if (!q) return true;
  const t = normIns(texto);
  return q.split(" ").every((palabra) => t.includes(palabra));
}

// ── NOMBRE OFICIAL DE UN INSUMO ────────────────────────────────────────
// El mismo insumo entra escrito de diez formas ("Jamon Kirkland", "JAMÓN
// KIRKLAND", "Jamón Kirkland "), y cada variante se vuelve un insumo aparte
// con su propio precio y su propio historial. Aquí se marca UN nombre como el
// oficial y, al entrar un ticket, todo lo que se le parezca lo suficiente se
// guarda con ese nombre.
export const PARECIDO_MIN = 0.8;   // 80%

// Qué tan parecidos son dos nombres, de 0 a 1. Se toma el mejor de dos
// medidas: letra por letra, y palabra por palabra sin importar el orden
// (así "Jamón Kirkland" y "Kirkland Jamón" cuentan como el mismo).
export function parecidoInsumo(a, b) {
  const x = normIns(a), y = normIns(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const ratio = (p, q) => (p === q ? 1 : 1 - lev(p, q) / Math.max(p.length, q.length));
  const orden = (s) => s.split(" ").filter(Boolean).sort().join(" ");
  return Math.max(ratio(x, y), ratio(orden(x), orden(y)));
}

// El 80% a secas no basta: "tomate bule" y "Tomate Bola" salen 82% parecidos
// y son tomates distintos; "bolsa 10" y "bolsa 5" salen 91% y son otro tamaño.
// Cuando el que cambia es un NÚMERO o una palabra corta que cambia entera, no
// hay error de dedo: hay producto distinto, y unirlos arruinaría el costeo.
function distingue(a, b) {
  const x = normIns(a), y = normIns(b);
  const nums = (s) => (s.match(/\d+(?:[.,]\d+)?/g) || []).join(" ");
  if (nums(x) !== nums(y)) return true;                       // bolsa 10 ≠ bolsa 5
  const tx = x.split(" ").filter(Boolean), ty = y.split(" ").filter(Boolean);
  if (tx.length !== ty.length) return false;
  for (let i = 0; i < tx.length; i++) {
    const p1 = tx[i], p2 = ty[i];
    if (p1 === p2) continue;
    const r = 1 - lev(p1, p2) / Math.max(p1.length, p2.length);
    if (Math.min(p1.length, p2.length) <= 4 && r < 0.75) return true;   // AXI ≠ UTI, bule ≠ bola
  }
  return false;
}

// ¿Son el mismo insumo escrito distinto? Parecido suficiente Y sin nada que
// los distinga de verdad.
export function mismoInsumo(a, b) {
  return parecidoInsumo(a, b) >= PARECIDO_MIN && !distingue(a, b);
}

// Los nombres marcados como oficiales, tal como se escribieron.
export function insumosOficiales() {
  const m = state.config.insumosOficiales || {};
  return Object.values(m).filter(Boolean);
}
export function esOficial(nombre) {
  const m = state.config.insumosOficiales || {};
  return !!m[normIns(nombre)];
}
export async function marcarOficial(nombre, activo) {
  const m = { ...(state.config.insumosOficiales || {}) };
  const k = normIns(nombre);
  if (!k) return;
  if (activo) m[k] = String(nombre).trim(); else delete m[k];
  await guardarConfig({ insumosOficiales: m });
}

// El nombre con el que se debe guardar un insumo: el oficial más parecido,
// si llega al 80%. Si no hay ninguno, se respeta lo que venga escrito.
export function canonInsumo(nombre) {
  const raw = String(nombre || "").trim();
  if (!raw) return raw;
  const of = insumosOficiales();
  if (!of.length) return raw;
  let mejor = null, mejorP = 0;
  for (const o of of) {
    if (!mismoInsumo(raw, o)) continue;
    const p = parecidoInsumo(raw, o);
    if (p > mejorP) { mejorP = p; mejor = o; }
  }
  return mejor || raw;
}

// Los insumos que YA existen y se absorberían bajo este nombre oficial.
// Sirve para avisar antes de unificar lo viejo (lo nuevo entra solo).
export function similaresA(oficial) {
  const k = normIns(oficial);
  return preciosPorInsumo()
    .filter((i) => normIns(i.nombre) !== k && mismoInsumo(i.nombre, oficial))
    .map((i) => ({ nombre: i.nombre, veces: i.veces, parecido: parecidoInsumo(i.nombre, oficial) }))
    .sort((a, b) => b.parecido - a.parecido);
}

// Unidades para sugerir al capturar un ticket: las de siempre MÁS las que ya
// usaste. La lista fija se quedaba corta ("Kg", "bl", "cj", "Lata", "Mazo",
// "servicio"…) y como era un <select> cerrado, abrir un ticket con una de esas
// y guardarlo borraba la unidad sin avisar.
export function unidadesConocidas() {
  const vistas = new Map();   // clave en minúsculas → cómo se escribió, y cuántas veces
  for (const u of UNIDADES) vistas.set(u.toLowerCase(), { txt: u, n: Infinity });
  for (const t of state.tickets) {
    for (const l of t.lineas || []) {
      const u = String(l.unidad || "").trim();
      if (!u) continue;
      const k = u.toLowerCase();
      const y = vistas.get(k);
      if (!y) vistas.set(k, { txt: u, n: 1 });
      else if (y.n !== Infinity) y.n++;
    }
  }
  return [...vistas.values()].sort((a, b) => b.n - a.n).map((x) => x.txt);
}

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

// Busca un insumo por el CÓDIGO/SKU del proveedor (guardado en las líneas de tickets).
// Devuelve { nombre, unidad } del ticket más reciente que coincida, o null.
export function insumoPorCodigo(codigo) {
  const c = (codigo || "").toString().trim().toLowerCase();
  if (!c) return null;
  const tks = [...state.tickets].sort((a, b) => ((a.fecha || "") < (b.fecha || "") ? 1 : -1));
  for (const t of tks) {
    for (const l of t.lineas || []) {
      if ((l.codigo || "").toString().trim().toLowerCase() === c && (l.descripcion || "").trim()) {
        return { nombre: emparejarInsumo(l.descripcion.trim()), unidad: l.unidad || "" };
      }
    }
  }
  return null;
}

// El CÓDIGO/SKU conocido de un insumo (por su nombre), del ticket más reciente que lo traiga.
export function codigoDeInsumo(nombre) {
  const n = normIns(nombre);
  if (!n) return "";
  const tks = [...state.tickets].sort((a, b) => ((a.fecha || "") < (b.fecha || "") ? 1 : -1));
  for (const t of tks) {
    for (const l of t.lineas || []) {
      if ((l.codigo || "").toString().trim() && normIns(l.descripcion) === n) return l.codigo.toString().trim();
    }
  }
  return "";
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
  if (_preciosCache) return _preciosCache;
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
        cantidad: num(l.cantidad),
        codigo: (l.codigo || "").toString().trim(),
        tipo: TIPOS.includes(l.tipo) ? l.tipo : "operativo",
        fotoTicket: t.fotoUrl || "", ticketId: t.id   // para ver la foto del ticket de origen
      });
    }
  }
  const arr = [];
  for (const v of map.values()) {
    v.registros.sort((a, b) => (a.fecha < b.fecha ? 1 : -1)); // más reciente primero

    // El precio unitario del ticket NO es comparable entre compras: el mismo
    // insumo viene "6 L a $29.49" en un ticket y "$176.93" suelto en otro, y
    // son EXACTAMENTE el mismo precio por litro. Comparar los números crudos
    // hacía ver bajones y subidas que nunca ocurrieron.
    // Aquí se lleva cada compra a una misma unidad base (kg / L / pza) y todo
    // —precio actual, tendencia, alertas— se compara ya normalizado.
    v.base = baseDeInsumo(v);
    for (const r of v.registros) {
      const b = precioBaseCompra(v.nombre, r, v.base);
      r.precioBase = b ? b.precio : null;
      r.fuente = b ? (b.conPres ? "presentacion" : "ticket") : null;
    }
    // La tendencia se calcula SOLO con las compras que sí se pudieron llevar a
    // la unidad base. Una compra que vino como "1 caja $176.93" sin saber qué
    // trae la caja no puede compararse contra "1 L $29.49": mezclarlas es lo
    // que hacía aparecer bajones falsos. Se queda listada y marcada, pero no
    // mueve el precio ni dispara alertas.
    const conBase = v.base ? v.registros.filter((r) => r.precioBase != null) : [];
    const usaBase = conBase.length > 0;
    const serie = usaBase ? conBase : v.registros;
    v.mezclado = usaBase && conBase.length < v.registros.length;
    v.sinNormalizar = v.registros.filter((r) => r.precioBase == null);
    const val = (r) => (usaBase && r.precioBase != null ? r.precioBase : r.precio);

    const ultimo = serie[0];
    const previo = serie.find((r) => Math.abs(val(r) - val(ultimo)) > 0.0001 && r.fecha < ultimo.fecha);
    v.precioActual = val(ultimo);
    v.precioPrevio = previo ? val(previo) : null;
    v.cambio = previo ? (val(ultimo) - val(previo)) : 0;   // cambio absoluto en $ (para alertas de ±$1)
    v.unidad = usaBase ? v.base : ultimo.unidad;
    v.normalizado = !!usaBase;
    v.variacion = previo && val(previo) ? (val(ultimo) - val(previo)) / val(previo) : 0;

    // La tendencia de arriba siempre es reciente-vs-anterior (así se movió el
    // precio de verdad). Lo que se puede elegir es cuál de esos precios se usa
    // para COSTEAR: por defecto el reciente, pero el usuario manda.
    v.precioReciente = val(ultimo);
    const cr = criterioPrecioDe(v.nombre);
    v.criterio = cr.modo;
    v.criterioValor = cr.valor;
    const vals = serie.map(val).filter((n) => n > 0);
    if (cr.modo === "fijo" && num(cr.valor) > 0) v.precioActual = num(cr.valor);
    else if (vals.length) {
      if (cr.modo === "barato") v.precioActual = Math.min(...vals);
      else if (cr.modo === "caro") v.precioActual = Math.max(...vals);
      else if (cr.modo === "promedio") v.precioActual = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    // Para las que no se pudieron normalizar, deducimos cuánto trae el empaque
    // dividiendo lo que costó entre el precio por unidad base que sí conocemos.
    // Si da un número redondo (6.00, no 5.73) es casi seguro el contenido.
    for (const r of v.sinNormalizar) {
      const u = num(r.precio) / (v.precioActual || 0);
      if (!(u > 1.2) || !isFinite(u)) continue;
      const ent = Math.round(u);
      if (ent > 1 && Math.abs(u - ent) / ent < 0.02) r.deducido = ent;   // "trae ~6"
    }
    v.veces = v.registros.length;
    // Código/SKU del proveedor: el más reciente que lo tenga.
    v.codigo = (v.registros.find((r) => r.codigo) || {}).codigo || "";
    // Presentación (por proveedor). Para la tarjeta se usa la del proveedor más reciente.
    v.presentacion = presentacionDe(v.nombre, ultimo && ultimo.proveedor);
    // Clasificación del insumo: "costo de venta" u "operativo" (la de su registro más reciente).
    v.tipo = (ultimo && ultimo.tipo) || "operativo";
    arr.push(v);
  }
  arr.sort((a, b) => b.veces - a.veces);
  _preciosCache = arr;
  _preciosMap = new Map(arr.map((i) => [i.nombre.trim().toLowerCase(), i]));
  return arr;
}
// Índice por nombre (minúsculas) para lookups O(1). Usa el cache.
function preciosIndex() { if (!_preciosMap) preciosPorInsumo(); return _preciosMap; }

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
