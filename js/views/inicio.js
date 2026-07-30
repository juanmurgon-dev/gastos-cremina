// Pantalla de Inicio: resumen de la semana (venta, gasto, costo %), comparación
// con semanas pasadas, proyección de cierre de semana y avance de la meta.
import * as store from "../store.js";
import { money, num } from "../store.js";
import * as dashCompras from "./dash-compras.js";
import * as info from "../info.js";

// Inicio se adapta al ROL: compras ve su tablero; los demás (owner/gerente/
// staff/single-tenant) ven el resumen financiero de siempre.
export function render(el) {
  let sub = null, rolActual = "__none__";
  const unsub = store.subscribe(evaluar);
  evaluar();
  function evaluar() {
    const rol = store.state.miRol;
    if (rol === rolActual) return;         // el rol no cambió → no re-montar
    rolActual = rol;
    if (typeof sub === "function") { try { sub(); } catch (e) {} }
    el.innerHTML = "";
    sub = (rol === "compras") ? dashCompras.render(el) : renderOwner(el);
  }
  return () => { if (typeof sub === "function") { try { sub(); } catch (e) {} } unsub(); };
}

function kmoney(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + (Math.trunc(n / 1000) / 1000).toFixed(3).replace(/\.?0+$/, "") + "M";
  if (a >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + Math.round(n);
}

const DIAS_S = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MES_S = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaCorta(iso) {
  const d = new Date(iso + "T00:00");
  return `${DIAS_S[d.getDay()]} ${d.getDate()} ${MES_S[d.getMonth()]}`;
}
function esAyer(iso) {
  const h = new Date(); h.setHours(0, 0, 0, 0); h.setDate(h.getDate() - 1);
  return iso === `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
}
function opac(v, max) { return (0.4 + 0.6 * (v / (max || 1))).toFixed(2); }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

const ES_CORTESIA = /pan de cortes[íi]a|propina/i;   // cortesía y propina no cuentan como venta
const CAT_BEBIDA = new Set(["Barra de Café", "Bebidas"]);
// Nombres que son CATEGORÍAS del reporte, no productos. Si aparecen como "producto"
// es basura de una importación vieja (la tabla de categorías se coló) → se ignoran.
const CATEGORIAS_NOMBRE = new Set(["desayunos", "comida", "comidas", "entradas", "postres",
  "barra de café", "barra de cafe", "bebidas", "bebida", "refrescos", "mimosas", "extras", "otros",
  "total productos", "sin variante"]);
const esCategoriaNombre = (n) => CATEGORIAS_NOMBRE.has(String(n || "").trim().toLowerCase());
// "Cayendo" se enfoca solo en cocina (comida y desayuno) y nunca cuenta el consumo de colaboradores.
const ES_COMIDA_CAT = new Set(["desayunos", "desayuno", "comida", "comidas"]);
const esComidaCat = (c) => ES_COMIDA_CAT.has(String(c || "").trim().toLowerCase());
const ES_COLABORADOR = /colaborador/i;

// Grupo modificador "principal" de un platillo/bebida (Tipo → Sabor; evita leche/temperatura).
const ES_SECUNDARIO = /leche|fr[íi]o|caliente|shot|cold foam|temperatura/i;
function elegirGrupo(grupos) {
  const unidades = (g) => grupos[g].reduce((a, r) => a + store.num(r.unidades), 0);
  // Quita leche/temperatura PRIMERO (para no confundir "Tipo de leche" con el tipo de bebida).
  const pool = Object.keys(grupos).filter((n) => !ES_SECUNDARIO.test(n));
  const base = pool.length ? pool : Object.keys(grupos);
  let cand = base.filter((n) => n.toLowerCase().startsWith("tipo"));
  if (!cand.length) cand = base.filter((n) => n.toLowerCase().startsWith("sabor"));
  if (!cand.length) cand = base;
  return cand.sort((a, b) => unidades(b) - unidades(a))[0];
}
// El tipo/variante más vendido de un producto en un periodo ("qué tipo de chilaquiles/bebida").
function topVariante(producto, periodo) {
  if (!store.usaVariantes()) return null;   // en modo "solo artículo" no hay variantes que mostrar
  const key = (producto || "").trim().toLowerCase();
  const vars = (store.state.variantes || []).filter((v) =>
    (v.producto || "").trim().toLowerCase() === key && v.periodo === periodo && !ES_CORTESIA.test(v.opcion || ""));
  if (!vars.length) return null;
  const grupos = {};
  for (const v of vars) (grupos[v.grupo] = grupos[v.grupo] || []).push(v);
  const gname = elegirGrupo(grupos);
  const top = (grupos[gname] || []).slice().sort((a, b) => store.num(b.unidades) - store.num(a.unidades))[0];
  return top ? { grupo: gname, opcion: top.opcion, u: store.num(top.unidades) } : null;
}

// Más vendidos (platillo y bebida) del periodo más reciente con datos.
function topProductos() {
  const prod = (store.state.productos || []).filter((p) =>
    !ES_CORTESIA.test(p.producto || "") && !ES_CORTESIA.test(p.categoria || "") && !esCategoriaNombre(p.producto));
  if (!prod.length) return null;
  const pmap = new Map();
  for (const p of prod) if (!pmap.has(p.periodo)) pmap.set(p.periodo, p.desde);
  const periodos = [...pmap.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1));
  const periodo = periodos.length ? periodos[0][0] : null;
  const agg = new Map();
  for (const p of prod) {
    if (p.periodo !== periodo) continue;
    const k = p.producto || "—";
    const a = agg.get(k) || { producto: k, cat: p.categoria || "Otros", u: 0, venta: 0 };
    a.u += store.num(p.cantidad); a.venta += store.num(p.venta);
    agg.set(k, a);
  }
  const arr = [...agg.values()];
  if (!arr.length) return null;
  const top = arr.slice().sort((a, b) => b.u - a.u);
  const topPlatillos = arr.filter((x) => !CAT_BEBIDA.has(x.cat)).sort((a, b) => b.u - a.u).slice(0, 3);
  const topBebidas = arr.filter((x) => CAT_BEBIDA.has(x.cat)).sort((a, b) => b.u - a.u).slice(0, 3);
  for (const x of [...topPlatillos, ...topBebidas]) x.tipo = topVariante(x.producto, periodo); // su tipo/sabor
  return { periodo, top, topPlatillos, topBebidas, topFood: topPlatillos[0] || null, topBebida: topBebidas[0] || null };
}

// Movimientos de venta entre el periodo reciente y el anterior:
//  · Caídas: productos de buena venta (>15/sem) que bajaron ≥15%.
//  · Subidas ("ojo del bueno"): productos que subieron ≥15%.
const MIN_VENTA = 15;   // arriba de 15 vendidos por semana = producto que sí importa
function movimientosProductos() {
  const prod = (store.state.productos || []).filter((p) =>
    !ES_CORTESIA.test(p.producto || "") && !ES_CORTESIA.test(p.categoria || "") && !esCategoriaNombre(p.producto));
  if (!prod.length) return null;
  const pmap = new Map();
  for (const p of prod) if (!pmap.has(p.periodo)) pmap.set(p.periodo, p.desde);
  const periodos = [...pmap.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map((e) => e[0]);
  if (periodos.length < 2) return null;             // se necesitan 2 periodos para comparar
  const cur = periodos[0], prev = periodos[1];
  // Solo comparamos SEMANAS CONSECUTIVAS. Si la semana anterior no tiene datos de producto
  // cargados, NO comparamos contra una semana lejana (daría caídas/subidas falsas).
  const diasGap = Math.round((new Date(pmap.get(cur) + "T00:00") - new Date(pmap.get(prev) + "T00:00")) / 86400000);
  if (diasGap > 10) return null;
  const agg = (per) => {
    const m = new Map();
    for (const p of prod) if (p.periodo === per) {
      const k = p.producto || "—";
      const a = m.get(k) || { u: 0, cat: p.categoria || "Otros" };
      a.u += store.num(p.cantidad); m.set(k, a);
    }
    return m;
  };
  const A = agg(prev), B = agg(cur);
  const caidas = [], subidas = [];
  for (const nombre of new Set([...A.keys(), ...B.keys()])) {
    const av = A.get(nombre) ? A.get(nombre).u : 0;
    const bv = B.get(nombre) ? B.get(nombre).u : 0;
    const cat = (B.get(nombre) || A.get(nombre)).cat;
    if (av <= 0) continue;                           // sin base previa no hay %
    if (Math.max(av, bv) < MIN_VENTA) continue;      // debe ser de buena venta
    const chg = (bv - av) / av;
    if (chg <= -0.15) caidas.push({ nombre, cat, prev: av, cur: bv, drop: chg });
    else if (chg >= 0.15) subidas.push({ nombre, cat, prev: av, cur: bv, rise: chg });
  }
  // "Cayendo" se enfoca solo en cocina (comida y desayuno) y excluye el consumo de colaboradores.
  const caidasCocina = caidas.filter((x) => esComidaCat(x.cat) && !ES_COLABORADOR.test(x.nombre));
  caidasCocina.sort((a, b) => a.drop - b.drop);      // mayor caída primero
  subidas.sort((a, b) => b.rise - a.rise);           // mayor subida primero
  return { cur, prev, caidas: caidasCocina, subidas };
}

// Insumo en el que más gastas y el que más subió de precio.
function insumosDestacados() {
  // Solo insumos de COSTO DE VENTA (comida/barra); no gastos operativos/fijos como gas, luz o renta.
  const ins = store.preciosPorInsumo().filter((i) => i.tipo === "costo de venta");
  if (!ins.length) return null;
  const conGasto = ins.map((i) => ({ ...i, gasto: (i.registros || []).reduce((a, r) => a + store.num(r.monto), 0) }));
  const masGasto = conGasto.slice().sort((a, b) => b.gasto - a.gasto)[0] || null;
  // El que más subió, pero solo si el alza es de al menos $1 (no centavos).
  const masSubio = ins.filter((i) => i.veces >= 2 && i.cambio >= 1)
    .sort((a, b) => b.cambio - a.cambio)[0] || null;
  return { masGasto, masSubio };
}

// Mini-tarjeta para los vistazos operativos.
function tile(icon, label, big, sub, color, tip) {
  return `<div style="background:rgba(46,196,182,.07);border:1px solid var(--linea);border-radius:14px;padding:13px 14px;min-width:0">
    <div class="sub" style="font-size:11.5px;font-weight:600">${icon} ${label}${tip ? info.iconoTip(tip) : ""}</div>
    <div style="font-size:16px;font-weight:700;letter-spacing:-.01em;margin-top:3px;line-height:1.2;color:${color || "var(--tinta)"};overflow-wrap:anywhere">${big}</div>
    <div class="sub" style="font-size:12px;margin-top:3px">${sub}</div>
  </div>`;
}
function grid2(tiles) {
  const cols = tiles.length > 1 ? "1fr 1fr" : "1fr";
  return `<div style="display:grid;grid-template-columns:${cols};gap:10px">${tiles.join("")}</div>`;
}

// "De un vistazo": pulso DIARIO (venta de ayer) + lo que sube/baja de venta en
// la semana y tu insumo clave.
function cardVistazo(tp, ins, cd, pulso) {
  const tiles = [];
  // ── Pulso diario: venta del último día con corte (lo único que sí es diario) ──
  if (pulso) {
    const lbl = esAyer(pulso.fecha) ? "Venta de ayer" : `Venta · ${fechaCorta(pulso.fecha)}`;
    const diaSem = DIAS_S[new Date(pulso.fecha + "T00:00").getDay()];
    let sub2, col2;
    if (pulso.tienePrev && pulso.prevVenta > 0) {
      const chg = (pulso.venta - pulso.prevVenta) / pulso.prevVenta;
      col2 = chg >= 0 ? "var(--verde)" : "var(--rojo)";
      sub2 = `${chg >= 0 ? "▲" : "▼"} ${Math.round(Math.abs(chg) * 100)}% vs ${diaSem} pasado (${kmoney(pulso.prevVenta)})`;
    } else {
      sub2 = `${fechaCorta(pulso.fecha)} · sin comparación`;
      col2 = "var(--tinta)";
    }
    tiles.push(tile("📅", lbl, money(pulso.venta), sub2, col2,
      { t: "Venta del día", q: "La venta del último día que ya tiene corte de caja cargado.",
        d: `Día tomado: ${fechaCorta(pulso.fecha)}. Se compara contra el mismo día (${diaSem}) de la semana pasada. Sale de tus cortes de caja.` }));
  }
  if (cd && cd.subidas.length) {
    const s = cd.subidas[0];
    tiles.push(tile("🚀", "Subiendo · semana", esc(s.nombre),
      `▲ ${Math.round(s.rise * 100)}% · ${Math.round(s.prev)}→${Math.round(s.cur)} vendidos`, "var(--verde)",
      { t: "Subiendo · semana", q: "El producto que más creció en unidades vendidas.",
        c: "Compara las unidades de la semana reciente contra la anterior (subió ≥15%).",
        d: `Semanas comparadas: ${cd.cur} (reciente) vs ${cd.prev} (anterior). Sale de tus reportes de venta por producto.` }));
  }
  if (cd && cd.caidas.length) {
    const c = cd.caidas[0];
    tiles.push(tile("📉", "Cayendo · semana", esc(c.nombre),
      `▼ ${Math.round(Math.abs(c.drop) * 100)}% · ${Math.round(c.prev)}→${Math.round(c.cur)} vendidos`, "var(--rojo)",
      { t: "Cayendo · semana", q: "El platillo de cocina que más bajó en unidades.",
        c: "Solo Comida y Desayunos; excluye bebidas, postres y consumo de colaboradores (cayó ≥15%).",
        d: `Semanas comparadas: ${cd.cur} (reciente) vs ${cd.prev} (anterior). Sale de tus reportes de venta por producto.` }));
  }
  if (ins && ins.masSubio) tiles.push(tile("📈", "Insumo que más subió", esc(ins.masSubio.nombre),
    `▲ ${money(ins.masSubio.cambio)} · ${money(ins.masSubio.precioActual)}${ins.masSubio.unidad ? "/" + esc(ins.masSubio.unidad) : ""}`, "var(--rojo)",
    { t: "Insumo que más subió", q: "El insumo de costo de venta cuyo precio más aumentó.",
      c: "Compara el precio de su compra más reciente contra la anterior.",
      d: "Sale de TODOS tus tickets (histórico, no una sola semana). Solo insumos de costo de venta, no gas/luz/renta." }));
  if (ins && ins.masGasto) tiles.push(tile("💸", "En lo que más gastas", esc(ins.masGasto.nombre),
    `${kmoney(ins.masGasto.gasto)} · ${ins.masGasto.veces} compra(s)`, "var(--naranja)",
    { t: "En lo que más gastas", q: "El insumo de costo de venta en el que llevas más dinero.",
      c: "Suma el monto de todas tus compras de ese insumo.",
      d: "Sale de TODOS tus tickets cargados (histórico, no una sola semana). Solo insumos de costo de venta." }));
  if (!tiles.length) return "";   // sin movimientos ni insumos → no muestres tarjeta vacía
  return `<div class="card"><h2 style="margin-bottom:11px">De un vistazo</h2>${grid2(tiles)}</div>`;
}

// Δ % entre actual y anterior; bueno=verde según el tipo de dato.
function delta(actual, previo, subeEsBueno, etiqueta) {
  if (!previo) return "";
  const p = (actual - previo) / previo * 100;
  if (Math.abs(p) < 0.5) return `<span class="sub">= igual</span>`;
  const sube = p > 0;
  const bueno = sube === subeEsBueno;
  const col = bueno ? "var(--verde)" : "var(--rojo)";
  return `<span style="color:${col};font-size:12px">${sube ? "▲" : "▼"} ${Math.abs(Math.round(p))}% ${etiqueta || "vs. sem. pasada"}</span>`;
}

// ─────────── Tablero por periodo (Semana / Mes / Año) ───────────
const MES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
// Categorías de venta → área del negocio (para el ingreso por área).
const CAT_A_AREA = (() => {
  const m = {};
  ["desayunos", "comida", "comidas", "postres", "entradas"].forEach((c) => (m[c] = "cocina"));
  ["café", "cafe", "barra de café", "barra de cafe", "bebidas", "bebida", "mimosas", "refrescos", "refresco"].forEach((c) => (m[c] = "barra"));
  return m;
})();
const areaDeCategoria = (cat) => CAT_A_AREA[String(cat || "").trim().toLowerCase()] || null;
// Clasifica un producto a área por su NOMBRE (cuando la venta viene de variantes_venta,
// que no trae categoría). Barra = café/bebidas; todo lo demás, cocina.
const BARRA_KW = /latte|caf[eé]|americano|capuc|cappu|espresso|expresso|mocha|moka|\bchai\b|matcha|cortado|flat white|frapp|cold brew|\bt[eé]\b|tonic|spritz|limonada|jugo|\bagua\b|refresco|coca|fanta|sprite|mimosa|michelada|cerveza|\bvino\b|smoothie|malteada|soda|jamaica|horchata|kombucha|bebida/i;
const areaDeProductoNombre = (nombre) => (BARRA_KW.test(String(nombre || "")) ? "barra" : "cocina");

const isoDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseFecha = (s) => new Date(s + "T00:00");
function lunesDeInicio(d) { const x = new Date(d); const g = (x.getDay() + 6) % 7; x.setDate(x.getDate() - g); x.setHours(0, 0, 0, 0); return x; }

// Rango [desde,hasta] + etiquetas para un modo y offset (0 = periodo actual).
function rangoPeriodo(modo, off) {
  const hoy = new Date();
  if (modo === "mes") {
    const m = new Date(hoy.getFullYear(), hoy.getMonth() - off, 1);
    const fin = new Date(m.getFullYear(), m.getMonth() + 1, 0);
    return { desde: isoDe(m), hasta: isoDe(fin), etiqueta: `${MES_LARGO[m.getMonth()]} ${m.getFullYear()}`, corta: `${MES_S[m.getMonth()]} ${String(m.getFullYear()).slice(2)}`, esActual: off === 0 };
  }
  if (modo === "año") {
    const y = hoy.getFullYear() - off;
    return { desde: `${y}-01-01`, hasta: `${y}-12-31`, etiqueta: String(y), corta: String(y), esActual: off === 0 };
  }
  const lun = lunesDeInicio(hoy); lun.setDate(lun.getDate() - off * 7);
  const dom = new Date(lun); dom.setDate(lun.getDate() + 6);
  return { desde: isoDe(lun), hasta: isoDe(dom), lunes: lun, etiqueta: `${lun.getDate()}–${dom.getDate()} ${MES_S[dom.getMonth()]}`, corta: `${lun.getDate()} ${MES_S[lun.getMonth()]}`, esActual: off === 0 };
}

// Ingreso (cortes) + gasto (tickets) de un rango de fechas.
function agregarRango(desde, hasta) {
  const ingreso = store.cortesEnRango(desde, hasta).reduce((a, c) => a + num(c.ventas_total), 0);
  const ts = store.ticketsEnRango(desde, hasta);
  const gasto = ts.reduce((a, t) => a + store.gastoTicket(t), 0);
  const gastoVar = ts.reduce((a, t) => a + store.gastoVariable(t), 0);
  return { ingreso, gasto, gastoVar };
}

// Comensales + ticket promedio de un rango. La venta sale del reporte (encabezado);
// si no la trae, cae a la venta de los cortes de caja del rango.
function metricasKpi(desde, hasta) {
  const k = store.kpisEnRango(desde, hasta);
  const venta = k.venta > 0 ? k.venta : agregarRango(desde, hasta).ingreso;
  return {
    comensales: k.comensales, cuentas: k.cuentas, venta,
    tPersona: k.comensales > 0 ? venta / k.comensales : 0,
    tCuenta: k.cuentas > 0 ? venta / k.cuentas : 0,
  };
}
// Flecha de tendencia vs el periodo anterior (arriba = verde, abajo = rojo).
function trendKpi(cur, prev) {
  if (!prev || prev <= 0 || !cur) return "";
  const chg = (cur - prev) / prev * 100;
  if (Math.abs(chg) < 1) return ` <span style="color:var(--gris);font-size:10px">→</span>`;
  const up = chg > 0;
  return ` <span style="color:${up ? "var(--verde)" : "var(--rojo)"};font-size:10px;font-weight:700">${up ? "▲" : "▼"}${Math.abs(Math.round(chg))}%</span>`;
}

// Orden de las tarjetas del Inicio (lo acomoda el usuario con ▲▼; se guarda por dispositivo).
const ORDEN_DEFAULT = ["utilidad", "comensales", "rentabilidad", "tendencia", "actuar", "vistazo", "meta"];
function cargarOrden() {
  let ord = [];
  try { const s = JSON.parse(localStorage.getItem("platify.inicio.orden")); if (Array.isArray(s)) ord = s.filter((k) => ORDEN_DEFAULT.includes(k)); } catch (_) { /* sin storage */ }
  for (const k of ORDEN_DEFAULT) if (!ord.includes(k)) ord.push(k);   // agrega tarjetas nuevas al final
  return ord;
}
function guardarOrden(ord) { try { localStorage.setItem("platify.inicio.orden", JSON.stringify(ord)); } catch (_) { /* sin storage */ } }

function renderOwner(el) {
  let modo = "semana";
  try { const m = localStorage.getItem("platify.inicio.modo"); if (m === "semana" || m === "mes" || m === "año") modo = m; } catch (_) { /* sin storage */ }
  let off = 0;    // 0 = periodo actual
  let orden = cargarOrden();
  let acomodando = false;
  const unsub = store.subscribe(pintar);
  pintar();

  function pintar() {
    if (!store.state.listo) { el.innerHTML = `<div class="vacio">Cargando…</div>`; return; }
    const r = rangoPeriodo(modo, off);
    const hoyISO = store.hoyISO();
    const finReal = (r.esActual && r.hasta > hoyISO) ? hoyISO : r.hasta;
    const modoLbl = modo === "semana" ? "de la semana" : modo === "mes" ? "del mes" : "del año";

    // ── Agregados del periodo elegido ──
    const per = agregarRango(r.desde, r.hasta);
    const ingreso = per.ingreso, gasto = per.gasto, gastoVar = per.gastoVar;
    const foodCost = ingreso > 0 ? gastoVar / ingreso * 100 : 0;
    const dias = Math.max(1, Math.round((parseFecha(finReal) - parseFecha(r.desde)) / 86400000) + 1);
    const fijos = store.gastoFijoMensual() / 30 * dias;
    const utilidad = ingreso - gasto - fijos;
    const sinDatos = ingreso === 0 && gasto === 0;
    const colU = sinDatos ? "var(--gris)" : utilidad > 0 ? "var(--verde)" : utilidad < 0 ? "var(--rojo)" : "var(--tinta)";
    const verdicto = sinDatos ? "Sin datos en este periodo" : utilidad > 0 ? "Vas ganando" : utilidad < 0 ? "Vas perdiendo" : "Vas a mano";
    const costoCol = foodCost <= 35 ? "var(--verde)" : foodCost <= 45 ? "var(--amarillo)" : "var(--rojo)";

    // ── Comensales y ticket promedio (del encabezado del reporte), con tendencia ──
    const rPrev = rangoPeriodo(modo, off + 1);
    const km = metricasKpi(r.desde, r.hasta);
    const kmPrev = metricasKpi(rPrev.desde, rPrev.hasta);
    const hayKpi = km.comensales > 0 || km.cuentas > 0;

    // ── Gasto por área (todas las líneas): cocina / barra / otro (piso+limpieza+otro) ──
    const spa = store.sumaPor(store.lineasEnRango(r.desde, r.hasta), "area");
    const gastoArea = { cocina: spa.cocina || 0, barra: spa.barra || 0, otro: (spa.piso || 0) + (spa.limpieza || 0) + (spa.otro || 0) };

    // ── Rentabilidad por área: ingreso (categorías de venta) vs insumo (líneas costo de venta) ──
    const ingArea = { cocina: 0, barra: 0 };
    for (const p of store.state.productos || []) {
      if (!p.desde || p.desde < r.desde || p.desde > r.hasta) continue;
      if (ES_CORTESIA.test(p.producto || "") || ES_CORTESIA.test(p.categoria || "")) continue;
      const a = areaDeCategoria(p.categoria);
      if (a) ingArea[a] += num(p.venta);
    }
    // Si productos_venta no dio ingreso (Cremina sube reportes de "producto y variante",
    // que van a variantes_venta SIN categoría), calcula el ingreso desde variantes,
    // clasificando cocina/barra por el NOMBRE del producto.
    if (!ingArea.cocina && !ingArea.barra) {
      for (const v of store.state.variantes || []) {
        if (!v.desde || v.desde < r.desde || v.desde > r.hasta) continue;
        if (ES_CORTESIA.test(v.producto || "") || ES_CORTESIA.test(v.opcion || "")) continue;
        ingArea[areaDeProductoNombre(v.producto)] += num(v.venta);
      }
    }
    const maxRent = Math.max(1, ingArea.cocina, ingArea.barra, gastoArea.cocina, gastoArea.barra);
    const bloqueArea = (nom, ing, gas) => {
      const margen = ing > 0 ? Math.round((ing - gas) / ing * 100) : null;
      const mcol = margen == null ? "var(--gris)" : margen >= 60 ? "var(--verde)" : margen >= 40 ? "var(--amarillo)" : "var(--rojo)";
      return `<div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><b>${nom}</b>
          <span style="font-size:12px;font-weight:700;color:${mcol}">${margen == null ? "sin ingreso" : "deja " + margen + "%"}</span></div>
        <div class="barra-row" style="margin-top:5px"><span class="etq" style="width:58px;font-size:11px">Ingreso</span>
          <span class="barra-track"><span class="barra-fill" style="width:${Math.max(3, 100 * ing / maxRent)}%;background:var(--verde-claro)"></span></span>
          <span class="val" style="width:78px">${kmoney(ing)}</span></div>
        <div class="barra-row"><span class="etq" style="width:58px;font-size:11px">Gasto</span>
          <span class="barra-track"><span class="barra-fill" style="width:${Math.max(3, 100 * gas / maxRent)}%;background:var(--naranja)"></span></span>
          <span class="val" style="width:78px">${kmoney(gas)}</span></div>
      </div>`;
    };
    const hayArea = ingArea.cocina || ingArea.barra || gastoArea.cocina || gastoArea.barra;

    // ── Tendencia: N periodos hacia atrás terminando en el seleccionado ──
    const N = modo === "año" ? 3 : modo === "mes" ? 6 : 8;
    const serie = [];
    for (let i = N - 1; i >= 0; i--) { const rr = rangoPeriodo(modo, off + i); serie.push({ etq: rr.corta, ...agregarRango(rr.desde, rr.hasta) }); }
    const maxSerie = Math.max(1, ...serie.map((s) => s.ingreso));

    // ── Snapshot de la SEMANA ACTUAL para "Para actuar" y "De un vistazo" (siempre ahora) ──
    const semanas = store.ventasSemanas(14);
    const wk = semanas[0], prevWk = semanas[1] || null;
    const cWk = wk.venta > 0 ? (wk.gastoVar ?? wk.gasto) / wk.venta * 100 : 0;
    const metaWk = store.metaDeSemana(wk.desde);
    const pctMeta = metaWk > 0 ? Math.min(100, 100 * wk.gastoVar / metaWk) : 0;
    const cMeta = pctMeta >= 100 ? "var(--rojo)" : pctMeta >= 85 ? "var(--amarillo)" : "var(--verde)";
    const gfSem = store.gastoFijoMensual() / 30 * 7;
    const contrib = 1 - (num(store.state.config.costoVarPct) || 26) / 100;
    const beDia = contrib > 0.02 ? (gfSem / contrib) / 7 : 0;
    const diasWk = Math.min(7, Math.max(1, Math.floor((new Date() - wk.lunes) / 86400000) + 1));
    const ventaDiaAct = wk.venta > 0 ? wk.venta / diasWk : 0;
    const tp = topProductos(), ins = insumosDestacados(), cd = movimientosProductos(), pulso = store.pulsoDiario();

    const acc = [];
    if (metaWk > 0 && wk.gastoVar > metaWk) acc.push(`🔴 Te pasaste de tu meta de compras por <b>${money(wk.gastoVar - metaWk)}</b>. Frena pedidos que no sean urgentes.`);
    const pred = store.prediccionCompras();
    if (pred.pendientes.length) {
      const nombres = pred.pendientes.slice(0, 3).map((x) => esc(x.nombre)).join(", ");
      acc.push(pred.seValePasar
        ? `🧾 Vas en <b>${money(pred.gastoSemana)}</b> de tu meta <b>${money(pred.meta)}</b>, pero según tu ritmo aún te falta pedir <b>${nombres}</b> (~${money(pred.costoPendiente)}). Ojo, te pasarías del presupuesto.`
        : `🧾 Según tu ritmo de compras, aún te falta pedir <b>${nombres}</b> (~${money(pred.costoPendiente)}).`);
    }
    if (wk.venta > 0 && cWk > 45) acc.push(`🔴 Tu costo de insumos va en <b>${Math.round(cWk)}%</b> (sano ≤35%). Sube precio, ajusta porciones o baja mermas.`);
    if (prevWk && prevWk.venta > 0 && ((wk.venta - prevWk.venta) / prevWk.venta * 100) <= -12)
      acc.push(`🔻 La venta bajó <b>${Math.round(Math.abs((wk.venta - prevWk.venta) / prevWk.venta * 100))}%</b> vs. la semana pasada. Activa una promo o busca a tus clientes frecuentes.`);
    if (cd && cd.caidas.length) { const c = cd.caidas[0]; acc.push(`🔻 <b>${esc(c.nombre)}</b> se vendía bien y cayó <b>${Math.round(Math.abs(c.drop) * 100)}%</b> (${Math.round(c.prev)}→${Math.round(c.cur)}). ¿Se agotó, subió de precio o hay que promocionarlo?`); }
    if (cd && cd.subidas.length) { const s = cd.subidas[0]; acc.push(`🚀 <b>${esc(s.nombre)}</b> subió <b>${Math.round(s.rise * 100)}%</b> en ventas (${Math.round(s.prev)}→${Math.round(s.cur)}). ¡Ojo del bueno! Dale más salida mientras está caliente.`); }
    if (ins && ins.masSubio) acc.push(`📈 <b>${esc(ins.masSubio.nombre)}</b> subió <b>${money(ins.masSubio.cambio)}</b> por ${esc(ins.masSubio.unidad || "unidad")}. Renegocia con tu proveedor o ajústalo en el menú.`);
    if (tp && (tp.topFood || tp.topBebida)) { const names = [tp.topFood && tp.topFood.producto, tp.topBebida && tp.topBebida.producto].filter(Boolean).map(esc).join(" y "); acc.push(`🏆 Empuja <b>${names}</b>: es lo que más vendes. Recomiéndalo u ofrécelo en combo.`); }
    if (wk.venta > 0 && beDia > 0 && ventaDiaAct > 0 && ventaDiaAct < beDia) acc.push(`🎯 Necesitas vender <b>${money(beDia)}/día</b> para no perder; vas en <b>${money(ventaDiaAct)}/día</b>. Enfócate en subir el ticket promedio.`);
    if (!acc.length) acc.push(`✅ Vas en rango sano. Mantén el ritmo y registra tus cortes cada día.`);
    const accTop = acc.slice(0, 3);

    const seg = (k, t) => `<button data-modo="${k}"${modo === k ? ' class="act"' : ""}>${t}</button>`;
    const esSemActual = modo === "semana" && off === 0;

    // ── Cada tarjeta por separado, para poder reordenarlas ──
    const cards = {};
    cards.utilidad = `<div class="card" style="text-align:center;padding:18px 16px">
        <div class="sub" style="text-transform:uppercase;letter-spacing:.09em;font-size:10.5px">Utilidad ${modoLbl}${info.icono("utilidad")}</div>
        <div style="font-size:40px;font-weight:800;letter-spacing:-.02em;line-height:1.05;color:${colU}">${sinDatos ? "—" : money(utilidad)}</div>
        <div style="font-weight:700;color:${colU}">${verdicto}${r.esActual && !sinDatos ? " (en curso)" : ""}</div>
        <div class="row-stats" style="margin-top:14px">
          <div class="stat" style="min-width:0"><div class="n" style="font-size:clamp(15px,5vw,21px);color:var(--verde-claro)">${kmoney(ingreso)}</div><div class="l">Ingreso</div></div>
          <div class="stat" style="min-width:0"><div class="n" style="font-size:clamp(15px,5vw,21px)">${kmoney(gasto)}</div><div class="l">Gasto</div></div>
          <div class="stat" style="min-width:0"><div class="n" style="font-size:clamp(15px,5vw,21px);color:${costoCol}">${ingreso > 0 ? Math.round(foodCost) + "%" : "—"}</div><div class="l">Food cost${info.icono("costoInsumos")}</div></div>
        </div>
        ${gfSem === 0 ? `<div class="sub" style="margin-top:8px;font-size:12px">💡 Registra tus gastos fijos (Gastos → Fijos) para la utilidad real.</div>` : ""}
      </div>`;

    cards.comensales = hayKpi ? `<div class="card">
        <h2 style="margin-bottom:4px">Comensales y ticket promedio${info.iconoTip({ t: "Comensales y ticket promedio", q: "Cuánta gente atendiste y cuánto gastó en promedio.", c: "Comensales y mesas vienen del encabezado de tu reporte. Por persona = venta ÷ comensales. Por cuenta = venta ÷ mesas atendidas.", d: "Se captura de cada reporte que subes en Importar. La flecha compara contra el periodo anterior (" + rPrev.etiqueta + ")." })}</h2>
        <p class="sub" style="margin:0 0 10px">La flecha compara vs ${esc(rPrev.etiqueta)}.</p>
        <div class="row-stats">
          <div class="stat" style="min-width:0"><div class="n" style="font-size:clamp(15px,5vw,21px)">${km.comensales || "—"}</div><div class="l">Comensales${trendKpi(km.comensales, kmPrev.comensales)}</div></div>
          <div class="stat" style="min-width:0"><div class="n" style="font-size:clamp(15px,5vw,21px)">${km.tPersona > 0 ? money(km.tPersona) : "—"}</div><div class="l">Por persona${trendKpi(km.tPersona, kmPrev.tPersona)}</div></div>
          <div class="stat" style="min-width:0"><div class="n" style="font-size:clamp(15px,5vw,21px)">${km.tCuenta > 0 ? money(km.tCuenta) : "—"}</div><div class="l">Por cuenta${trendKpi(km.tCuenta, kmPrev.tCuenta)}</div></div>
        </div>
      </div>` : "";

    cards.rentabilidad = `<div class="card">
        <h2 style="margin-bottom:4px">Rentabilidad por área${info.iconoTip({ t: "Rentabilidad por área", q: "Cuánto entra (ventas) vs cuánto gastas, en cocina y barra.", c: "Ingreso = ventas del área (Cocina: desayunos, comida, entradas, postres · Barra: café, bebidas, mimosas, refrescos). Gasto = lo que gastaste en tickets de esa área. Deja% = (ingreso − gasto) / ingreso.", d: "El ingreso sale de tus reportes de venta; el gasto, de tus tickets. Necesita que tus tickets tengan el ÁREA marcada." })}</h2>
        <p class="sub" style="margin:0 0 10px">¿Te deja más la cocina o la barra?</p>
        ${hayArea ? `${(ingArea.cocina || gastoArea.cocina) ? bloqueArea("🍳 Cocina", ingArea.cocina, gastoArea.cocina) : ""}${(ingArea.barra || gastoArea.barra) ? bloqueArea("☕ Barra", ingArea.barra, gastoArea.barra) : ""}`
          : `<div class="sub">Sin datos por área en este periodo. Necesitas ventas cargadas y tickets con su área marcada.</div>`}
      </div>`;

    cards.tendencia = `<div class="card">
        <h2 style="margin-bottom:8px">Tendencia · ingreso ${modo === "año" ? "por año" : modo === "mes" ? "por mes" : "por semana"}${info.icono("tendencia")}</h2>
        ${serie.map((s) => { const c = s.ingreso > 0 ? s.gastoVar / s.ingreso * 100 : 0;
          return `<div class="barra-row"><span class="etq" style="width:84px;font-size:12px">${s.etq}</span>
            <span class="barra-track"><span class="barra-fill" style="width:${Math.max(3, 100 * s.ingreso / maxSerie)}%;background:var(--verde-claro);opacity:${opac(s.ingreso, maxSerie)}"></span></span>
            <span class="val" style="width:120px">${kmoney(s.ingreso)} · <span style="color:${c <= 35 ? "var(--verde)" : c <= 45 ? "var(--amarillo)" : "var(--rojo)"}">${s.ingreso > 0 ? Math.round(c) + "%" : "—"}</span></span></div>`; }).join("")}
        <div class="leyenda"><span><i style="background:var(--verde-claro)"></i>Ingreso</span><span>% = costo insumos</span></div>
      </div>`;

    cards.actuar = `<div class="card" style="border-left:4px solid var(--flame)">
        <h2 style="margin-bottom:10px">Para actuar</h2>
        ${accTop.map((a) => `<div style="font-size:13.5px;padding:8px 0;border-bottom:1px solid var(--linea);line-height:1.45">${a}</div>`).join("")}
      </div>`;

    cards.vistazo = esSemActual ? cardVistazo(tp, ins, cd, pulso) : "";

    cards.meta = esSemActual ? `<div class="card">
        <h2 style="margin-bottom:8px">Meta de compras (semana)${info.icono("metaCompras")}</h2>
        <div class="barra-track" style="height:12px"><span class="barra-fill" style="width:${pctMeta}%;background:${cMeta}"></span></div>
        <div class="sub" style="margin-top:6px">${metaWk > 0 ? `Llevas ${money(wk.gastoVar)} de ${money(metaWk)} · ${Math.round(pctMeta)}% usado` : "Aún sin meta. Defínela aquí o en Gastos → Meta."}</div>
        <div class="fila" style="margin-top:10px;gap:8px">
          <input id="meta" type="number" step="any" inputmode="decimal" value="${metaWk || ""}" placeholder="Meta semanal (MXN)" style="flex:1" />
          <button class="btn sec" id="guardarMeta" style="flex:none;width:auto">Guardar</button>
        </div>
        <div id="okMeta"></div>
      </div>` : "";

    const visibles = orden.filter((k) => cards[k]);   // solo tarjetas con contenido, en el orden guardado
    // En modo acomodar, cada tarjeta se queda visible con ▲▼ en su esquina y borde punteado.
    const wrapAcom = (html, k, i) => `<div style="position:relative;outline:2px dashed var(--naranja);outline-offset:-3px;border-radius:16px">
        <div style="position:absolute;top:7px;right:7px;display:flex;gap:5px;z-index:3">
          <button class="btn sec chico" data-mv="up" data-k="${k}"${i === 0 ? " disabled style='opacity:.3'" : ""}>▲</button>
          <button class="btn sec chico" data-mv="down" data-k="${k}"${i === visibles.length - 1 ? " disabled style='opacity:.3'" : ""}>▼</button>
        </div>${html}</div>`;
    const cuerpo = acomodando
      ? visibles.map((k, i) => wrapAcom(cards[k], k, i)).join("")
      : visibles.map((k) => cards[k]).join("");

    el.innerHTML = `
      <div class="card" style="padding:12px">
        <div class="segmented" style="font-size:13px">${seg("semana", "Semana")}${seg("mes", "Mes")}${seg("año", "Año")}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px">
          <button class="btn sec chico" id="ant" title="Periodo anterior"${acomodando ? " disabled style='opacity:.35'" : ""}>◀</button>
          <div style="flex:1;text-align:center">
            <div style="font-weight:700;font-size:14px">${esc(r.etiqueta)}</div>
            <div class="sub" style="font-size:11px">${r.esActual ? "En curso" : ""}</div>
          </div>
          <button class="btn sec chico" id="sig" title="Periodo siguiente"${(off === 0 || acomodando) ? " disabled style='opacity:.35'" : ""}>▶</button>
        </div>
        <div style="text-align:center;margin-top:10px"><button class="btn sec chico" id="acomodar">${acomodando ? "✓ Listo, así queda" : "↕ Acomodar tarjetas"}</button></div>
        ${acomodando ? `<div class="sub" style="text-align:center;font-size:11px;margin-top:6px">Mueve cada tarjeta con ▲▼ de su esquina</div>` : ""}
      </div>
      ${cuerpo}`;

    el.querySelector("#acomodar").addEventListener("click", () => { acomodando = !acomodando; pintar(); });

    if (acomodando) {
      el.querySelectorAll("[data-mv]").forEach((b) => b.addEventListener("click", () => {
        const key = b.dataset.k, dir = b.dataset.mv;
        const vis = orden.filter((k) => cards[k]);
        const i = vis.indexOf(key), j = dir === "up" ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= vis.length) return;
        [vis[i], vis[j]] = [vis[j], vis[i]];
        let vi = 0;
        orden = orden.map((k) => (cards[k] ? vis[vi++] : k));   // conserva la posición de las ocultas
        guardarOrden(orden);
        pintar();
      }));
      return;   // en modo acomodar no se necesitan los demás listeners
    }

    el.querySelectorAll("[data-modo]").forEach((b) => b.addEventListener("click", () => {
      modo = b.dataset.modo; off = 0;
      try { localStorage.setItem("platify.inicio.modo", modo); } catch (_) { /* sin storage */ }
      pintar();
    }));
    el.querySelector("#ant").addEventListener("click", () => { off++; pintar(); });
    const sig = el.querySelector("#sig");
    if (sig && off > 0) sig.addEventListener("click", () => { off = Math.max(0, off - 1); pintar(); });
    const gm = el.querySelector("#guardarMeta");
    if (gm) gm.addEventListener("click", async () => {
      const v = num(el.querySelector("#meta").value);
      try {
        await store.guardarMetaSemana(wk.desde, v);   // solo esta semana en adelante
        el.querySelector("#okMeta").innerHTML = `<div class="ok-box" style="margin-top:10px">Meta guardada (solo esta semana en adelante).</div>`;
      } catch (err) { alert("No pude guardar: " + ((err && err.message) || err)); }
    });
  }

  return unsub;
}
