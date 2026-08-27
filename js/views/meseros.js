// Pantalla: desempeño por mesero. Sale de `ordenes_mesero` (una fila por
// cuenta), que se llena al importar el reporte de órdenes de Parrot.
//
// Está armada para LEERSE EN LA JUNTA, no para admirar datos: los
// indicadores van en renglones y la gente en columnas, porque así se compara
// a las personas de un vistazo horizontal. Al revés hay que leer de lado.
//
// Tres bloques, en este orden a propósito:
//   1. Servicio en comedor — el desempeño de piso, con su meta y su color.
//   2. 1 de cada cuántas personas — el mismo dato dicho como se dice en la
//      junta. "1 café por cada 1.5 personas" se entiende; "1.63 por cuenta"
//      hay que traducirlo mentalmente.
//   3. Venta total y efectividad — todos los canales, para el contexto.
//   Y al final los focos de coaching, que es lo único que se acciona.
import * as store from "../store.js";
import { money, num } from "../store.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Debajo de esto la muestra no alcanza para comparar a nadie: un mal martes
// cambia al líder. Se muestran sus números, pero fuera del podio y marcados.
const MIN_CUENTAS = 40;
const METAS_DEF = { cafeCuenta: 2.0, attachPostre: 0.10, extrasCuenta: 0.72 };

const VERDE = "#dff0e2", V_TXT = "#0e7a4a";
const AMBAR = "#fbf0d8", A_TXT = "#8a6a1c";
const ROJO  = "#fadfdb", R_TXT = "#b3261e";

function cfg() {
  const c = (store.state.config && store.state.config.meseros) || {};
  return { metas: { ...METAS_DEF, ...(c.metas || {}) }, compiten: c.compiten || {},
           roles: c.roles || {}, criterios: c.criterios || null };
}

// ═══════════════════════════════════════════════════════════════
//  CRITERIOS
//
//  Un indicador son tres decisiones: QUÉ cuentas, ENTRE QUÉ lo divides,
//  y cuál es la META. Todo lo que se mide aquí cabe en esa forma, así que
//  en vez de escribir cada uno en el código, se configuran.
//
//  `dim` dice de dónde sale el número:
//    columna   → un contador ya sumado en la orden (rápido, siempre existe)
//    categoria → detalle.categorias  · grupo  → detalle.grupos
//    articulo  → detalle.articulos   · mod    → detalle.mods
//    extras    → detalle.extras (el nombre completo con su grupo)
//
//  Los cinco de fábrica reproducen exacto el scorecard de siempre. En
//  cuanto agregas uno tuyo, convive con ellos sin tocar código.
// ═══════════════════════════════════════════════════════════════
const CRITERIOS_DEF = [
  { id: "cafe",     nombre: "Café / cuenta",      dim: "columna", valores: ["cafes"],
    entre: "cuenta",   meta: 2.0,  peso: 2, formato: "num", ratio: "cafés",   compite: false,
    nota: "Todos los de piso suelen quedar casi iguales: es techo del sistema, no de la persona." },
  { id: "postre",   nombre: "Attach postre",      dim: "columna", valores: ["postres"],
    entre: "comensal", meta: 0.10, peso: 2, formato: "pct", ratio: "postres", compite: true },
  { id: "extras",   nombre: "Extras / cuenta",    dim: "columna", valores: ["extras_uds"],
    entre: "cuenta",   meta: 0.72, peso: 3, formato: "num", sub: "proteína + premium", compite: true },
  { id: "aguacate", nombre: "Aguacate / cuenta",  dim: "extras",  valores: ["Aguacate"],
    entre: "cuenta",   meta: 0,    peso: 1, formato: "num", compite: false },
  { id: "bebidas",  nombre: "Bebidas / cuenta",   dim: "columna", valores: ["bebidas"],
    entre: "cuenta",   meta: 0,    peso: 1, formato: "num", sub: "spritz + limonada", ratio: "bebidas", compite: false },
];

// Los de fábrica siguen tomando su meta de donde siempre, para no romper
// lo que ya configuraste en la pantalla de metas.
function criterios() {
  const c = cfg();
  if (c.criterios) return c.criterios;
  const m = c.metas;
  return CRITERIOS_DEF.map((x) => ({ ...x,
    meta: x.id === "cafe" ? m.cafeCuenta : x.id === "postre" ? m.attachPostre
        : x.id === "extras" ? m.extrasCuenta : x.meta }));
}

// Cuántas unidades de ESTE criterio trae una orden.
function unidadesDe(o, cri) {
  const vals = cri.valores || [];
  if (cri.dim === "columna") return vals.reduce((a, k) => a + num(o[k]), 0);
  const mapa = (o.detalle && o.detalle[
    cri.dim === "categoria" ? "categorias" : cri.dim === "grupo" ? "grupos"
    : cri.dim === "articulo" ? "articulos" : cri.dim === "mod" ? "mods" : "extras"]) || {};
  let n = 0;
  for (const k of Object.keys(mapa)) {
    const kl = k.toLowerCase();
    // Coincide exacto o contiene: así "Aguacate" encuentra
    // "Aguacate (Extras Premium)" sin tener que escribirlo completo.
    if (vals.some((v) => { const vl = String(v).toLowerCase(); return kl === vl || kl.includes(vl); })) n += num(mapa[k]);
  }
  return n;
}

// Qué se puede medir con lo que HAY cargado. El selector se arma de aquí,
// así que el cliente elige de su propia operación y nunca de una lista
// inventada. Lo que no aparezca es que no está en los datos todavía.
function dimensionesDisponibles() {
  const d = { categoria: new Set(), grupo: new Set(), articulo: new Set(), mod: new Set() };
  const llave = { categoria: "categorias", grupo: "grupos", articulo: "articulos", mod: "mods" };
  for (const o of store.state.ordenesMesero || []) {
    for (const k of Object.keys(d)) {
      const m = (o.detalle && o.detalle[llave[k]]) || {};
      for (const v of Object.keys(m)) d[k].add(v);
    }
  }
  return { categoria: [...d.categoria].sort(), grupo: [...d.grupo].sort(),
           articulo: [...d.articulo].sort(), mod: [...d.mod].sort() };
}
const compite = (n) => cfg().compiten[n] !== false;
const rolDe = (n) => cfg().roles[n] || "";

// ── Periodos ────────────────────────────────────────────────────
const hoy = () => new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function lunesDe(f) { const d = new Date(f + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); }
function masDias(f, n) { const d = new Date(f + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); }
function etiquetaSemana(l) {
  const [, m1, d1] = l.split("-"); const dom = masDias(l, 6); const [, m2, d2] = dom.split("-");
  return m1 === m2 ? `${+d1} – ${+d2} ${MES_CORTO[+m2 - 1]}` : `${+d1} ${MES_CORTO[+m1 - 1]} – ${+d2} ${MES_CORTO[+m2 - 1]}`;
}
// Del índice de fechas, no de las órdenes: así la lista de semanas existe
// desde el primer instante sin haber bajado ninguna orden.
function semanasConDatos() {
  const s = new Set();
  for (const f of store.state.fechasMesero || []) s.add(lunesDe(f));
  return [...s].sort().reverse();
}
function rangoDe(clave, semana) {
  const d = hoy();
  if (clave === "mes") return { desde: iso(new Date(d.getFullYear(), d.getMonth(), 1)), hasta: iso(d), txt: "Este mes" };
  if (clave === "mespasado") {
    const ini = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return { desde: iso(ini), hasta: iso(new Date(d.getFullYear(), d.getMonth(), 0)), txt: "Mes pasado" };
  }
  if (clave === "semana") {
    const lun = semana || lunesDe(iso(d));
    return { desde: lun, hasta: masDias(lun, 6), txt: "Semana " + etiquetaSemana(lun), corto: true };
  }
  return { desde: "0000-01-01", hasta: "9999-12-31", txt: "Todo lo cargado" };
}

// ── El cálculo ──────────────────────────────────────────────────
// Se exporta porque Capacitación lo reusa: los niveles plata y oro se ganan
// con desempeño real, y ese número tiene que salir del MISMO cálculo que ve
// el marcador. Dos fórmulas para lo mismo es pedir que un día no cuadren.
export { calcular as metricasMeseros, rangoDe as rangoMeseros };

function calcular(desde, hasta) {
  const enRango = (store.state.ordenesMesero || []).filter((o) => o.fecha >= desde && o.fecha <= hasta);
  // COMEDOR: el desempeño de piso. El para-llevar no tiene mesa que atender.
  const comedor = enRango.filter((o) => o.tipo_orden === "Comedor" && o.estatus === "Cerrada" && num(o.total) > 0);
  // TODOS LOS CANALES: para la venta total y la efectividad.
  const todos = enRango.filter((o) => o.estatus === "Cerrada" && num(o.total) > 0);

  const base = () => ({ cuentas: 0, comensales: 0, venta: 0, extrasMonto: 0,
    uds: {}, val: {}, tCuentas: 0, tComensales: 0, tVenta: 0 });
  const por = new Map();
  const get = (m) => { if (!por.has(m)) por.set(m, { mesero: m, ...base() }); return por.get(m); };

  const CRI = criterios();
  for (const o of comedor) {
    const p = get(o.mesero || "(sin usuario)");
    p.cuentas++; p.comensales += num(o.comensales); p.venta += num(o.total);
    p.extrasMonto += num(o.extras_monto);
    // Unidades de cada criterio configurado, en una sola pasada.
    for (const c of CRI) p.uds[c.id] = (p.uds[c.id] || 0) + unidadesDe(o, c);
  }
  for (const o of todos) {
    const p = get(o.mesero || "(sin usuario)");
    p.tCuentas++; p.tComensales += num(o.comensales); p.tVenta += num(o.total);
  }

  // El valor de cada criterio: unidades entre su divisor. El attach de
  // postre va entre COMENSALES, no entre cuentas — así se lee en la casa
  // ("1 de cada 15 personas pide postre") y así está en el guión.
  const valorar = (p) => {
    for (const c of CRI) {
      const div = c.entre === "comensal" ? p.comensales : c.entre === "cuenta" ? p.cuentas : 1;
      p.val[c.id] = div ? num(p.uds[c.id]) / div : 0;
    }
    // Nota 0-100: qué tanto de su meta alcanzó cada criterio, ponderado.
    // Se topa en 100% por criterio para que uno brillante no tape uno malo.
    let suma = 0, pesos = 0;
    for (const c of CRI) {
      if (!(num(c.meta) > 0) || !(num(c.peso) > 0)) continue;
      suma += Math.min(1, num(p.val[c.id]) / num(c.meta)) * num(c.peso);
      pesos += num(c.peso);
    }
    p.nota = pesos ? Math.round(suma / pesos * 100) : null;
    return p;
  };

  const lista = [...por.values()].map((p) => valorar({
    ...p,
    tktPersona: p.comensales ? p.venta / p.comensales : 0,
    ventaComensal: p.tComensales ? p.tVenta / p.tComensales : 0,
    chica: p.cuentas < MIN_CUENTAS,
  })).filter((p) => p.cuentas > 0 || p.tCuentas > 0);

  const eq = lista.reduce((a, p) => {
    for (const k of ["cuentas", "comensales", "venta", "extrasMonto", "tComensales", "tVenta"]) a[k] += p[k];
    for (const c of CRI) a.uds[c.id] = (a.uds[c.id] || 0) + num(p.uds[c.id]);
    return a;
  }, { ...base(), mesero: "Equipo" });
  eq.tktPersona = eq.comensales ? eq.venta / eq.comensales : 0;
  eq.ventaComensal = eq.tComensales ? eq.tVenta / eq.tComensales : 0;
  valorar(eq);

  lista.sort((a, b) => b.cuentas - a.cuentas);
  // Qué días del periodo tienen órdenes. Sirve para avisar cuándo el total
  // que se muestra NO es el del periodo completo.
  const dias = new Set(todos.map((o) => o.fecha));
  // Cortesías: cerradas pero en cero, casi siempre por un descuento que se
  // come el ticket completo. No son venta, pero callarlas hace que el total
  // no cuadre con nada y nadie sepa por qué.
  const cortesias = enRango.filter((o) => o.estatus === "Cerrada" && num(o.total) <= 0).length;
  const descuentos = enRango.reduce((a, o) => a + num(o.descuento), 0);
  return { lista, eq, comedor, dias, criterios: CRI, cortesias, descuentos };
}

// ── Qué significa cada número ───────────────────────────────────
const INFO = {
  filtros: { t: "Qué entra en el bloque de comedor",
    q: "Solo el servicio de mesa. No entra el para-llevar ni las cuentas en cero.",
    c: "Órdenes con tipo «Comedor», estatus «Cerrada» y venta mayor a cero.",
    d: "El para-llevar se excluye porque no hay mesa que atender: en julio Kenya tenía 478 órdenes en total pero solo 80 de comedor. El bloque de venta total sí incluye todos los canales." },
  cuentas: { t: "Cuentas", q: "Cuántas mesas atendió.", c: "Una por cada orden de comedor cerrada con venta.",
    d: "Reporte de órdenes de Parrot. La persona sale de la columna Usuario." },
  comensales: { t: "Comensales", q: "Cuántas personas atendió, sumando todas sus mesas.", c: "Suma de la columna Comensales de sus cuentas.",
    d: "Lo captura el mesero al abrir la mesa. Si no lo captura bien, su ticket por persona sale raro." },
  tkt: { t: "Ticket por persona", q: "Cuánto dejó en promedio cada persona que atendió.", c: "Su venta de comedor entre sus comensales.",
    d: "Por persona y no por cuenta: una mesa de 6 y una de 2 no son comparables. En julio el equipo quedó en $296." },
  cafe: { t: "Café por cuenta", q: "Cuántos cafés se llevó en promedio cada mesa.", c: "Unidades de «Barra de Café» entre sus cuentas.",
    d: "Ojo al leerlo: en julio los tres de piso quedaron entre 1.47 y 1.63, casi iguales. Eso es techo del SISTEMA, no diferencia de persona — por eso el café no entra en la competencia. Se sube con el ritual de sobremesa para todos." },
  postre: { t: "Attach de postre", q: "De cada 100 personas, cuántas se llevaron postre.", c: "Postres vendidos entre COMENSALES (no entre cuentas).",
    d: "Se mide por persona porque así se lee en la casa y así está en el guión: «1 de cada 15 personas lo pide». Medido por cuenta daría casi el doble y no compara con nada de lo que ya tienes escrito." },
  bebidas: { t: "Bebidas por cuenta", q: "Spritz y limonadas: la otra bebida que el mesero sí mueve.", c: "Unidades cuyo nombre empieza con Spritz o Limonada, entre sus cuentas.",
    d: "Van aparte del café a propósito: el café tiene techo de sistema, éstas no. Son modificadores pagados del grupo Tipo de Bebidas en Parrot." },
  extras: { t: "Extras por cuenta", q: "Cuántos extras pagados logró vender por mesa.", c: "Modificadores pagados de «Extras Proteína» y «Extras Premium», entre sus cuentas.",
    d: "Incluye «-2 pz huevo», que QUITA comida pero se cobra: 86 de los 378 de julio. Se dejó dentro para que tus históricos sigan comparables, pero no es upsell coacheable — conviene decirlo en la junta." },
  aguacate: { t: "Aguacate por cuenta", q: "El extra más fácil de vender.", c: "Unidades de «Aguacate (Extras Premium)» entre sus cuentas.",
    d: "Es la mejor prueba de que los extras SÍ se coachean: en julio Giselle 0.20 y Leo 0.18 contra Alexa 0.07, siendo Alexa la de más volumen." },
  ratios: { t: "1 de cada cuántas personas", q: "El mismo dato de arriba, dicho como se dice en la junta.",
    c: "Comensales entre unidades vendidas. Más bajo = más consumo.",
    d: "«1 café por cada 1.5 personas» se entiende de inmediato; «1.63 por cuenta» hay que traducirlo. Es el mismo número visto al revés." },
  ventaTotal: { t: "Venta total", q: "Todo lo que pasó por su usuario, en todos los canales.",
    c: "Suma del «Total de orden» de sus órdenes cerradas, comedor y para-llevar. Ese total ya viene NETO de descuentos, y las órdenes que quedaron en $0 (cortesías) no se cuentan.",
    d: "Por eso casi nunca cuadra con el corte de caja: el corte va en bruto y además trae propinas. En julio y agosto los descuentos fueron 2.3% de la venta y hubo 29 órdenes en cortesía. Debajo de la tabla se dice cuántas fueron en el periodo que estás viendo." },
  efectividad: { t: "Efectividad", q: "Su venta por persona comparada con el promedio del equipo. 100% = promedio.",
    c: "Su venta por comensal (todos los canales) entre la del equipo.",
    d: "CUIDADO al comparar meseros contra cajeras: el para-llevar tiene ticket naturalmente más bajo (un café son $35), así que la efectividad de quien atiende barra sale menor. No es mal desempeño, es la naturaleza del canal." },
  nota: { t: "La calificación",
    q: "Qué tanto de sus metas alcanzó cada quien, en un solo número del 0 al 100.",
    c: "Por cada criterio con meta: qué tan cerca quedó de ella, topado en 100%, multiplicado por su peso. La suma se divide entre los pesos.",
    d: "Se topa en 100% por criterio a propósito: sin eso, alguien brillante en extras taparía que no vende un solo postre. Y se puede desarmar renglón por renglón — nunca es una caja negra que nadie pueda discutir en la junta." },
  marcador: { t: "Cómo se ordena el marcador", q: "Gana quien mejor ofrece, no quien tuvo más mesas.",
    c: "Se ordena por tasa por cuenta y se muestra el volumen al lado.",
    d: "Por total ganaría siempre quien atendió más mesas: en julio Alexa hizo 138 extras, los más de todos, con 0.58 por cuenta; Giselle 91 con 0.72." },
};
// ⓘ de un criterio que trae su propia advertencia de lectura.
const icoTexto = (c) => `<button data-nota="${esc(c.nota)}" title="Ojo con este" style="border:none;background:none;padding:0 0 0 3px;cursor:pointer;color:var(--gris,#9a9a9a);font-size:12px;line-height:1;vertical-align:middle">ⓘ</button>`;
const ico = (k) => `<button data-info="${k}" title="¿Qué es esto?" style="border:none;background:none;padding:0 0 0 3px;cursor:pointer;color:var(--gris,#9a9a9a);font-size:12px;line-height:1;vertical-align:middle">ⓘ</button>`;

function abrirInfo(k) {
  const i = INFO[k]; if (!i) return;
  const rot = (t) => `<div class="sub" style="font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;margin:14px 0 3px">${t}</div>`;
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal" style="text-align:left">
    <h2 style="margin:0 0 6px">${esc(i.t)}</h2>
    <p style="margin:0;font-size:15px;line-height:1.4">${esc(i.q)}</p>
    ${rot("Cómo se calcula")}<p style="margin:0;font-size:13.5px;line-height:1.45">${esc(i.c)}</p>
    ${rot("De dónde sale")}<p style="margin:0;font-size:13.5px;line-height:1.45;color:var(--gris,#666)">${esc(i.d)}</p>
    <button class="btn sec" data-cerrar style="margin-top:18px">Cerrar</button>
  </div>`;
  document.body.appendChild(bg);
  const cerrar = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
  bg.querySelector("[data-cerrar]").addEventListener("click", cerrar);
}

// ── Vista ───────────────────────────────────────────────────────
export function render(el) {
  let periodo = "mes", verAjustes = false, semanaSel = null;
  // Solo se baja el periodo que se está viendo. Antes bajaba la historia
  // completa para enseñar una semana, y por eso tardaba en abrir.
  const VIEJO_MS = 2 * 60 * 1000;
  let cargando = true;
  let pidiendo = null;      // rango que se está pidiendo, para no pedirlo dos veces

  const unsub = store.subscribe(pintar);
  arrancar();
  pintar();

  async function arrancar() {
    // `null` = el índice se invalidó (entró una importación). `[]` = ya se
    // consultó y de verdad no hay nada. Solo el primer caso vuelve a pedir.
    if (!store.state.fechasMesero) await store.cargarFechasMesero();
    if (periodo === "semana" && !semanaSel) semanaSel = semanasConDatos()[0] || null;
    cargando = false;
    pedirRango();
    pintar();
  }

  // Pide el rango del periodo actual si no es el que ya está cargado.
  function pedirRango() {
    const r = rangoDe(periodo, semanaSel);
    const clave = r.desde + "|" + r.hasta;
    const fresco = store.state.ordenesMeseroRango === clave
                   && Date.now() - (store.state.ordenesMeseroAl || 0) < VIEJO_MS;
    if (fresco || pidiendo === clave) return;
    pidiendo = clave;
    store.cargarOrdenesMesero(r.desde, r.hasta).finally(() => {
      if (pidiendo === clave) pidiendo = null;
      pintar();
    });
  }

  function recargar() {
    store.state.ordenesMeseroAl = 0;
    pidiendo = null;
    pedirRango();
    pintar();
  }

  function pintar() {
    const r = rangoDe(periodo, semanaSel);
    // ¿Lo que hay en memoria es de ESTE periodo? Si no, está por llegar.
    const listo = store.state.ordenesMeseroRango === r.desde + "|" + r.hasta;
    const { lista, eq, dias, criterios: CRI, cortesias, descuentos } = calcular(r.desde, r.hasta);
    const metas = cfg().metas;

    if (store.state.errorMeseros) {
      el.innerHTML = `<div class="card"><h2 style="margin-top:0">Falta preparar la base</h2>
        <p class="sub">No pude leer <b>ordenes_mesero</b>: ${esc(store.state.errorMeseros)}</p>
        <p class="sub">Corre <b>supabase/meseros.sql</b> y vuelve a entrar.</p></div>`;
      return;
    }
    if (cargando) { el.innerHTML = `<div class="vacio">Cargando…</div>`; return; }
    if (!listo) { el.innerHTML = selector(r) + `<div class="vacio">Trayendo ${esc(r.txt.toLowerCase())}…</div>`; wireSel(); return; }
    if (!lista.length) { el.innerHTML = selector(r) + vacio(); wireSel(); return; }

    // Columnas estables: quien haya trabajado en las últimas 8 semanas sale
    // SIEMPRE, aunque este periodo no tenga turnos. Si desaparecieran, el
    // scorecard cambiaría de forma cada semana y sería imposible compararlo
    // con el de la junta anterior — que es justo para lo que existe.
    const conocidos = store.meserosActivos(r.hasta, 8);
    const yaEstan = new Set(lista.map((p) => p.mesero));
    const sinTurnos = conocidos.filter((m) => !yaEstan.has(m));
    for (const m of sinTurnos) {
      lista.push({ mesero: m, cuentas: 0, comensales: 0, venta: 0, extrasMonto: 0,
                   uds: {}, val: {}, tCuentas: 0, tComensales: 0, tVenta: 0,
                   tktPersona: 0, ventaComensal: 0, nota: null, chica: true });
    }

    // Columnas: primero quienes compiten (de piso), luego el resto, luego Equipo.
    const piso = lista.filter((p) => compite(p.mesero));
    const otros = lista.filter((p) => !compite(p.mesero));
    const cols = [...piso, ...otros];

    // Si nadie tiene bebidas, es que falta la columna o falta re-importar.
    // Decirlo es mejor que enseñar una fila de ceros que parece un dato real.
    const sinBebidas = !lista.some((p) => num(p.uds && p.uds.bebidas) > 0);

    el.innerHTML = selector(r)
      + avisoDiasFaltantes(r, dias, sinTurnos)
      + (sinBebidas ? avisoBebidas() : "")
      + bloqueComedor(cols, piso.length, eq, metas, r, CRI)
      + bloqueRatios(cols, piso.length, eq, CRI)
      + bloqueVenta(cols, piso.length, eq, r, cortesias, descuentos)
      + (sinTurnos.length ? `<div class="card" style="padding:12px 14px"><p class="sub" style="margin:0;font-size:12px">
          <b>Sin turnos ${esc(r.txt.toLowerCase())}:</b> ${esc(sinTurnos.map((m) => m.split(" ")[0]).join(", "))}.
          Aparecen en el scorecard con guiones para que las columnas no cambien de una semana a otra.</p></div>` : "")
      + focos(lista, eq, metas, r, CRI)
      + leyenda()
      + marcador(lista, eq, metas, r, CRI)
      + `<div class="card"><button class="btn sec" id="mAjustes">⚙️ Quién compite, roles y metas</button>
         <div id="mPanel">${verAjustes ? panelAjustes(lista, metas) : ""}</div></div>`;

    wireSel(); wireInfo();
    el.querySelector("#mAjustes").onclick = () => { verAjustes = !verAjustes; pintar(); };
    if (verAjustes) wireAjustes();
  }

  // ── Encabezado de sección, como el de tu scorecard ────────────
  const seccion = (titulo, sub) => `<div style="background:#6b7a3a;color:#fff;padding:9px 14px;border-radius:12px 12px 0 0">
    <div style="font-size:12.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700">${esc(titulo)}</div>
    ${sub ? `<div style="font-size:11.5px;opacity:.85;margin-top:2px">${sub}</div>` : ""}</div>`;

  function encabezados(cols, nPiso) {
    return `<tr>
      <th style="position:sticky;left:0;background:var(--blanco,#fff);z-index:2;text-align:left;padding:9px 10px;min-width:150px"></th>
      ${cols.map((p, i) => `<th style="padding:8px 6px;text-align:center;color:#fff;background:${i < nPiso ? "#173a34" : "#7b7b74"};min-width:88px">
        <div style="font-size:13px;font-weight:700;${p.cuentas ? "" : "opacity:.5"}">${esc(p.mesero.split(" ")[0])}</div>
        <div style="font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;opacity:.8">${p.cuentas ? esc(rolDe(p.mesero) || (i < nPiso ? "piso" : "no compite")) : "sin turnos"}</div>
      </th>`).join("")}
      <th style="padding:8px 6px;text-align:center;color:#fff;background:#5c2018;min-width:82px;font-size:13px">Equipo</th>
    </tr>`;
  }

  // fmt: cómo se pinta · meta: contra qué se colorea (null = sin color)
  // soloCompiten: colorea únicamente a los de piso. Se usa en Efectividad,
  // porque pintarle rojo a una cajera por vender para-llevar sería castigarla
  // por la naturaleza de su canal, no por su desempeño.
  function fila(etiqueta, subEt, infoK, cols, eq, campo, fmt, meta, soloCompiten) {
    const celda = (p, esEq) => {
      const v = num(p[campo]);
      let bg = "", col = "";
      if (meta != null && p.cuentas > 0 && !(soloCompiten && !compite(p.mesero) && !esEq)) {
        if (v >= meta) { bg = VERDE; col = V_TXT; }
        else if (v >= meta * 0.75) { bg = AMBAR; col = A_TXT; }
        else { bg = ROJO; col = R_TXT; }
      }
      return `<td style="padding:9px 6px;text-align:center;background:${esEq ? "#f6efe8" : bg || "transparent"};${col ? "color:" + col + ";" : ""}font-weight:${esEq || (meta != null && v >= meta) ? 700 : 500};font-size:13.5px">${p.cuentas || p.tCuentas ? fmt(v, p) : "—"}</td>`;
    };
    return `<tr style="border-top:1px solid #ece7df">
      <td style="position:sticky;left:0;background:var(--blanco,#fff);z-index:1;padding:9px 10px;font-weight:600;font-size:13.5px">
        ${esc(etiqueta)}${infoK ? ico(infoK) : ""}
        ${subEt ? `<div class="sub" style="font-size:10.5px;font-weight:400">${esc(subEt)}</div>` : ""}
      </td>
      ${cols.map((p) => celda(p, false)).join("")}${celda(eq, true)}
    </tr>`;
  }

  const tabla = (contenido, cols, nPiso) => `<div class="card" style="padding:0;overflow:hidden">
    ${contenido.head}
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">
      <thead>${encabezados(cols, nPiso)}</thead><tbody>${contenido.filas}</tbody>
    </table></div></div>`;

  const fmtCri = (c) => (v) => c.formato === "pct" ? (v * 100).toFixed(0) + "%" : v.toFixed(2);

  function bloqueComedor(cols, nPiso, eq, metas, r, CRI) {
    const f = [
      fila("Cuentas", "", "cuentas", cols, eq, "cuentas", (v) => Math.round(v).toLocaleString("es-MX"), null),
      fila("Comensales", "", "comensales", cols, eq, "comensales", (v) => Math.round(v).toLocaleString("es-MX"), null),
      fila("Ticket / persona", "", "tkt", cols, eq, "tktPersona", (v) => money(v), null),
      // Un renglón por criterio configurado. Antes estaban escritos a mano
      // en el código, que es por lo que cada indicador nuevo pedía cambios.
      ...CRI.map((c) => filaCri(c, cols, eq)),
      fila("Extras en dinero", "", null, cols, eq, "extrasMonto", (v) => money(v), null),
      filaNota(cols, eq, CRI),
    ].join("");
    return tabla({ head: seccion("Servicio en comedor", `KPIs de piso · ${esc(r.txt)} · solo comedor` + ico("filtros")), filas: f }, cols, nPiso);
  }

  // Renglón de un criterio: lee `val[id]`, se colorea contra su meta.
  function filaCri(c, cols, eq) {
    const sub = [c.sub, num(c.meta) > 0 ? "meta " + fmtCri(c)(num(c.meta)) : ""].filter(Boolean).join(" · ");
    const celda = (p, esEq) => {
      const v = num(p.val && p.val[c.id]);
      const meta = num(c.meta);
      let bg = "", col = "";
      if (meta > 0 && p.cuentas > 0) {
        if (v >= meta) { bg = VERDE; col = V_TXT; }
        else if (v >= meta * 0.75) { bg = AMBAR; col = A_TXT; }
        else { bg = ROJO; col = R_TXT; }
      }
      return `<td style="padding:9px 6px;text-align:center;background:${esEq ? "#f6efe8" : bg || "transparent"};${col ? "color:" + col + ";" : ""}font-weight:${esEq || (meta > 0 && v >= meta) ? 700 : 500};font-size:13.5px">${p.cuentas ? fmtCri(c)(v) : "—"}</td>`;
    };
    return `<tr style="border-top:1px solid #ece7df">
      <td style="position:sticky;left:0;background:var(--blanco,#fff);z-index:1;padding:9px 10px;font-weight:600;font-size:13.5px">
        ${esc(c.nombre)}${INFO[c.id] ? ico(c.id) : (c.nota ? icoTexto(c) : "")}
        ${sub ? `<div class="sub" style="font-size:10.5px;font-weight:400">${esc(sub)}</div>` : ""}
      </td>
      ${cols.map((p) => celda(p, false)).join("")}${celda(eq, true)}
    </tr>`;
  }

  // La nota: qué tanto de sus metas alcanzó, ponderado por el peso de cada
  // criterio. Se puede desarmar renglón por renglón — nunca es caja negra.
  function filaNota(cols, eq, CRI) {
    const conMeta = CRI.filter((c) => num(c.meta) > 0 && num(c.peso) > 0);
    if (!conMeta.length) return "";
    const celda = (p, esEq) => {
      const n = p.nota;
      const col = n == null ? "" : n >= 90 ? V_TXT : n >= 70 ? A_TXT : R_TXT;
      const bg = n == null ? "" : n >= 90 ? VERDE : n >= 70 ? AMBAR : ROJO;
      return `<td style="padding:11px 6px;text-align:center;background:${esEq ? "#f6efe8" : bg};${col ? "color:" + col + ";" : ""}font-weight:800;font-size:17px">${n == null || !p.cuentas ? "—" : n}</td>`;
    };
    return `<tr style="border-top:2px solid var(--linea)">
      <td style="position:sticky;left:0;background:var(--blanco,#fff);z-index:1;padding:11px 10px;font-weight:800;font-size:14px">
        Calificación${ico("nota")}
        <div class="sub" style="font-size:10.5px;font-weight:400">${esc(conMeta.map((c) => c.nombre.split(" ")[0] + "×" + c.peso).join(" · "))}</div>
      </td>
      ${cols.map((p) => celda(p, false)).join("")}${celda(eq, true)}
    </tr>`;
  }

  function bloqueRatios(cols, nPiso, eq, CRI) {
    const conRatio = CRI.filter((c) => c.ratio);
    if (!conRatio.length) return "";
    const ratio = (c) => fila(`1 ${c.ratio.replace(/s$/, "")} por cada…`, "personas", null, cols, eq, "__r_" + c.id,
      (_, p) => { const u = num(p.uds && p.uds[c.id]); return u > 0 ? `1 : ${(num(p.comensales) / u).toFixed(1)}` : "—"; }, null);
    return tabla({
      head: seccion("1 de cada cuántas personas pide…", "Personas por unidad — más bajo, más consumo" + ico("ratios")),
      filas: conRatio.map(ratio).join(""),
    }, cols, nPiso);
  }

  function bloqueVenta(cols, nPiso, eq, r, cortesias, descuentos) {
    const prom = num(eq.ventaComensal);
    const f = [
      fila("Venta total", "", "ventaTotal", cols, eq, "tVenta", (v) => money(v), null),
      fila("Comensales atendidos", "", null, cols, eq, "tComensales", (v) => Math.round(v).toLocaleString("es-MX"), null),
      fila("Venta por comensal", "", null, cols, eq, "ventaComensal", (v) => money(v), null),
      fila("Efectividad", "vs promedio del equipo", "efectividad", cols, eq, "ventaComensal",
        (v) => prom ? Math.round(v / prom * 100) + "%" : "—", prom || null, true),
    ].join("");
    return tabla({ head: seccion("Venta total y efectividad", "Todos los canales: comedor + para-llevar"), filas: f }, cols, nPiso)
      + queNoEntra(cortesias, descuentos, eq)
      + cotejoCortes(eq, r);
  }

  // Qué NO está sumado en el total de arriba. Es la primera explicación de
  // por qué este número no cuadra con el corte de caja, y hasta ahora había
  // que adivinarla.
  function queNoEntra(cortesias, descuentos, eq) {
    if (!cortesias && !(descuentos > 0)) return "";
    const partes = [];
    if (cortesias) partes.push(`<b>${cortesias}</b> orden(es) en cortesía, que salieron en $0`);
    if (descuentos > 0) partes.push(`<b>${money(descuentos)}</b> en descuentos ya restados`);
    const pct = num(eq.tVenta) > 0 ? (descuentos / num(eq.tVenta) * 100).toFixed(1) : null;
    return `<div class="card" style="padding:12px 14px">
      <p class="sub" style="margin:0;font-size:12px"><b>Qué no entra en esta venta:</b>
        ${partes.join(" · ")}${pct ? ` (${pct}% de la venta)` : ""}.
        Si comparas contra tu corte de caja, ahí sí entran las propinas y la venta va en bruto —
        por eso el corte casi siempre sale más alto.</p></div>`;
  }

  // La app tiene TRES fuentes de venta: los cortes de caja (lo que ve Inicio),
  // el encabezado del reporte de productos, y el reporte de órdenes (esto).
  // Si no se importan igual de completas dan números distintos, y ver 45k en
  // Inicio y 23k aquí sin explicación destruye la confianza en la herramienta.
  // Mejor decirlo, con la diferencia y su causa probable.
  function cotejoCortes(eq, r) {
    if (!store.cortesEnRango || r.desde === "0000-01-01") return "";
    const corte = store.cortesEnRango(r.desde, r.hasta).reduce((a, c) => a + num(c.ventas_total), 0);
    const ordenes = num(eq.tVenta);
    if (!corte || !ordenes) return "";
    const dif = Math.abs(corte - ordenes) / Math.max(corte, ordenes);
    if (dif < 0.05) return "";                       // diferencias chicas son ruido de redondeo
    const faltaAqui = ordenes < corte;
    return `<div class="card" style="border-left:4px solid var(--amarillo,#b8860b)">
      <b>Este total no cuadra con el de Inicio.</b>
      <p class="sub" style="margin:6px 0 0">
        Aquí (reporte de órdenes): <b>${money(ordenes)}</b> ·
        En Inicio (cortes de caja): <b>${money(corte)}</b> ·
        diferencia ${Math.round(dif * 100)}%.</p>
      <p class="sub" style="margin:6px 0 0">Son dos fuentes distintas y se importan por separado.
        ${faltaAqui
          ? "El más bajo es éste, así que lo más probable es que falten reportes de órdenes por subir — revisa arriba si el periodo tiene días sin datos."
          : "El más bajo es el de Inicio, así que probablemente falten cortes de caja de esos días."}</p>
    </div>`;
  }

  // ── Focos de coaching ─────────────────────────────────────────
  // Se generan del dato, no son texto fijo: si el mes cambia, cambian solos.
  // Se generan del dato, no son texto fijo: si cambian los criterios o el mes,
  // cambian solos.
  function focos(lista, eq, metas, r, CRI) {
    const piso = lista.filter((p) => compite(p.mesero) && !p.chica);
    const pts = [];
    const nom = (p) => p.mesero.split(" ")[0];

    // 1) Criterios donde el EQUIPO no llega a la meta.
    for (const c of CRI) {
      if (!(num(c.meta) > 0) || num(eq.val[c.id]) >= num(c.meta)) continue;
      const pers = num(eq.uds[c.id]) ? (num(eq.comensales) / num(eq.uds[c.id])).toFixed(1) : "—";
      pts.push(`<b>${esc(c.nombre)} — de todos.</b> El equipo va en ${fmtCri(c)(num(eq.val[c.id]))}
        contra la meta de ${fmtCri(c)(num(c.meta))}: uno por cada ${pers} personas.`);
    }

    // 2) La brecha específica: líder claro contra rezagado claro. Eso SÍ se
    //    coachea persona a persona, al revés de un techo de sistema.
    for (const c of CRI) {
      if (piso.length < 2) break;
      const ord = [...piso].sort((a, b) => num(b.val[c.id]) - num(a.val[c.id]));
      const lider = ord[0], ultimo = ord[ord.length - 1];
      if (!(num(lider.val[c.id]) > 0) || num(lider.val[c.id]) < num(ultimo.val[c.id]) * 2) continue;
      const mejorVenta = [...piso].sort((a, b) => b.ventaComensal - a.ventaComensal)[0];
      pts.push(`<b>${esc(c.nombre)} — ${esc(nom(ultimo))} es la brecha.</b>
        ${esc(nom(lider))} va en ${fmtCri(c)(num(lider.val[c.id]))} y ${esc(nom(ultimo))} en
        ${fmtCri(c)(num(ultimo.val[c.id]))}.
        ${mejorVenta.mesero === ultimo.mesero
          ? `Ojo: ${esc(nom(ultimo))} es quien MÁS vende por comensal, así que su tema no es desempeño general — es este indicador.`
          : `Que ${esc(nom(lider))} le enseñe cómo lo hace.`}`);
    }

    // 3) Techo de sistema: donde todos están casi iguales no hay nada que
    //    coachear individualmente. Calificar a alguien por algo que no
    //    controla es la forma más rápida de que el equipo deje de creer.
    for (const c of CRI) {
      if (piso.length < 3) break;
      const vs = piso.map((p) => num(p.val[c.id])).filter((v) => v > 0);
      if (vs.length < 3) continue;
      const max = Math.max(...vs), min = Math.min(...vs);
      if (max <= 0 || (max - min) / max > 0.25) continue;
      pts.push(`<b>${esc(c.nombre)} — no rankees aquí.</b> Todos los de piso están entre
        ${fmtCri(c)(min)} y ${fmtCri(c)(max)}. Eso es techo del sistema, no diferencia de persona:
        se sube cambiando el ritual para todo el piso, no comparando gente.`);
    }

    if (!pts.length) pts.push(`<b>Todo en meta.</b> Ningún indicador del equipo está por debajo. Buen momento para subir la meta.`);

    return `<div class="card">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:#5c2018;margin-bottom:10px">Focos de coaching · ${esc(r.txt)}</div>
      ${pts.slice(0, 5).map((t) => `<div style="display:flex;gap:9px;margin-bottom:11px;font-size:13.5px;line-height:1.5">
        <span style="color:var(--naranja,#c0622a)">▸</span><div>${t}</div></div>`).join("")}
    </div>`;
  }

  function leyenda() {
    const p = (c, t) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:11.5px">
      <span style="width:14px;height:14px;border-radius:4px;background:${c};display:inline-block"></span>${t}</span>`;
    return `<div class="card" style="padding:12px 14px">
      ${p(VERDE, "en meta")}${p(AMBAR, "en camino")}${p(ROJO, "a mejorar")}
      <p class="sub" style="margin:10px 0 0;font-size:11px;line-height:1.5">
        Comparar meseros contra cajeras <b>no es directo</b>: el para-llevar tiene ticket naturalmente más bajo,
        así que su efectividad sale menor sin que sea mal desempeño. Toca la ⓘ de cualquier renglón para ver
        qué significa y de dónde sale.</p></div>`;
  }

  // ── Marcador (la competencia) ─────────────────────────────────
  function marcador(lista, eq, metas, r, CRI) {
    // Compiten los criterios marcados. El café NO: cuando todos quedan casi
    // iguales es techo del sistema, y rankear ahí premia el ruido.
    const enJuego = CRI.filter((c) => c.compite && num(c.meta) > 0);
    const podio = (c) => lista.filter((p) => compite(p.mesero) && !p.chica)
      .sort((a, b) => num(b.val[c.id]) - num(a.val[c.id]));
    const MED = ["🥇", "🥈", "🥉"];
    const tarj = (c) => {
      const arr = podio(c);
      const h = `<h3 style="margin:0 0 8px;font-size:13.5px">${esc(c.nombre)}${INFO[c.id] ? ico(c.id) : ""}</h3>`;
      if (!arr.length) return `<div>${h}<div class="sub">Sin muestra suficiente.</div></div>`;
      return `<div>${h}${arr.map((p, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #ece7df">
          <span style="width:20px">${MED[i] || ""}</span>
          <span style="flex:1;min-width:0;font-weight:${i === 0 ? 700 : 500};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.mesero.split(" ")[0])}</span>
          <span class="sub" style="font-size:11px">${Math.round(num(p.uds[c.id]))} uds</span>
          <b style="min-width:48px;text-align:right;color:${num(p.val[c.id]) >= num(c.meta) ? V_TXT : A_TXT}">${fmtCri(c)(num(p.val[c.id]))}</b>
        </div>`).join("")}</div>`;
    };
    const fuera = lista.filter((p) => p.chica && compite(p.mesero));
    return `<div class="card">
      <h2 style="margin-top:0">🏁 Marcador · ${esc(r.txt)}${ico("marcador")}</h2>
      ${enJuego.length
        ? `<div style="display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">${enJuego.map(tarj).join("")}</div>`
        : `<div class="sub">Ningún criterio está marcado para competir. Actívalos en ⚙️ abajo.</div>`}
      ${fuera.length ? `<p class="sub" style="margin:12px 2px 0;font-size:11.5px">Fuera del podio por muestra chica (menos de ${MIN_CUENTAS} cuentas):
        ${esc(fuera.map((p) => `${p.mesero.split(" ")[0]} (${p.cuentas})`).join(", "))}.</p>` : ""}
      ${r.corto ? `<p class="sub" style="margin:8px 2px 0;font-size:11.5px">⚠️ Una semana son ~45 cuentas por persona: con esa muestra un mal martes cambia al líder. <b>El marcador que cuenta es el del mes.</b></p>` : ""}
    </div>`;
  }

  // ── Selector y ajustes ────────────────────────────────────────
  function selector(r) {
    const op = (k, t) => `<button data-p="${k}" class="btn sec chico" style="flex:1${k === periodo ? ";background:var(--verde,#0e3a39);color:#fff;border-color:transparent" : ""}">${t}</button>`;
    const semanas = semanasConDatos();
    return `<div class="card" style="padding:10px">
      <div class="fila" style="gap:6px">${op("semana", "Semana")}${op("mes", "Este mes")}${op("mespasado", "Mes pasado")}${op("todo", "Todo")}</div>
      ${periodo === "semana" ? (semanas.length
        ? `<select id="mSemana" style="margin-top:8px;width:100%">${semanas.map((s) => `<option value="${s}"${s === semanaSel ? " selected" : ""}>${esc(etiquetaSemana(s))}</option>`).join("")}</select>`
        : `<div class="sub" style="margin-top:8px">Todavía no hay semanas cargadas.</div>`) : ""}
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap">
        <span class="sub" style="font-size:11.5px">${esc(r.desde)} → ${esc(r.hasta)}</span>
        <span class="sub" style="font-size:11.5px;margin-left:auto">${selloDatos()}</span>
        <button class="btn sec chico" id="mRecargar" style="width:auto;padding:4px 10px;font-size:11.5px">↻ Actualizar</button>
      </div>
    </div>`;
  }
  // De cuándo son los datos en pantalla. Se muestra siempre: adivinar si lo
  // que ves ya trae el último cambio cuesta más que un renglón de texto.
  function selloDatos() {
    const t = store.state.ordenesMeseroAl;
    if (!t) return "";
    const min = Math.floor((Date.now() - t) / 60000);
    const d = new Date(t);
    const hora = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    return min < 1 ? "datos recién traídos" : min < 60 ? `datos de hace ${min} min` : `datos de las ${hora}`;
  }
  function wireSel() {
    const rec = el.querySelector("#mRecargar");
    // ↻ vuelve a pedir TODO: el índice de días y personas, y las órdenes del
    // rango. Antes solo pedía el rango, así que un día recién subido no
    // aparecía en la lista de semanas por más veces que le picaras.
    if (rec) rec.addEventListener("click", async () => {
      store.state.ordenesMeseroAl = 0;
      store.state.fechasMesero = null;
      await store.cargarFechasMesero();
      recargar();
    });
    el.querySelectorAll("[data-p]").forEach((b) => b.addEventListener("click", () => {
      periodo = b.dataset.p;
      if (periodo === "semana" && !semanaSel) semanaSel = semanasConDatos()[0] || null;
      pedirRango(); pintar();
    }));
    const s = el.querySelector("#mSemana");
    if (s) s.addEventListener("change", () => { semanaSel = s.value; pedirRango(); pintar(); });
  }
  function wireInfo() {
    el.querySelectorAll("[data-info]").forEach((b) =>
      b.addEventListener("click", (e) => { e.preventDefault(); abrirInfo(b.dataset.info); }));
    el.querySelectorAll("[data-nota]").forEach((b) =>
      b.addEventListener("click", (e) => { e.preventDefault(); alert(b.dataset.nota); }));
  }

  function panelAjustes(lista, metas) {
    return `<div style="margin-top:12px">
      <h3 style="margin:0 0 6px;font-size:14px">Quién compite y con qué puesto</h3>
      <p class="sub" style="margin-top:0;font-size:11.5px">Desmarca a quien no sea de piso. Sigue apareciendo en el scorecard, pero fuera del podio y en columna gris.</p>
      ${lista.map((p) => `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--linea)">
        <input type="checkbox" data-compite="${esc(p.mesero)}"${compite(p.mesero) ? " checked" : ""} style="width:18px;height:18px;flex:none;accent-color:var(--verde)" />
        <span style="flex:1;min-width:0">${esc(p.mesero)}</span>
        <input data-rol="${esc(p.mesero)}" value="${esc(rolDe(p.mesero))}" placeholder="puesto" style="width:110px;font-size:12px" />
        <span class="sub" style="font-size:11px;white-space:nowrap">${p.cuentas} ctas</span>
      </div>`).join("")}
      ${panelCriterios()}
    </div>`;
  }

  // ── Constructor de criterios ──────────────────────────────────
  // Se elige de la propia operación del restaurante, no de una lista
  // inventada: las opciones salen de lo que trae SU reporte de Parrot.
  function panelCriterios() {
    const CRI = criterios();
    const dims = dimensionesDisponibles();
    const hayDim = dims.categoria.length || dims.grupo.length;
    return `
      <h3 style="margin:20px 0 6px;font-size:14px">Qué se mide</h3>
      <p class="sub" style="margin-top:0;font-size:11.5px">El <b>peso</b> es cuánto cuenta para la calificación.
      <b>Compite</b> lo pone en el marcador. Meta en 0 = solo se muestra, no califica.</p>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12.5px;min-width:430px">
        <thead><tr style="text-align:left">
          <th style="padding:5px 4px">Indicador</th><th style="padding:5px 4px;width:74px">Meta</th>
          <th style="padding:5px 4px;width:58px">Peso</th><th style="padding:5px 4px;width:62px">Compite</th><th style="width:30px"></th>
        </tr></thead>
        <tbody>${CRI.map((c, i) => `<tr style="border-top:1px solid var(--linea)">
          <td style="padding:7px 4px">${esc(c.nombre)}
            <div class="sub" style="font-size:10px">${esc(c.dim === "columna" ? "de fábrica" : c.dim + ": " + (c.valores || []).join(", "))}</div></td>
          <td style="padding:7px 4px"><input data-cri="${i}" data-campo="meta" type="number" step="0.01" inputmode="decimal"
            value="${c.formato === "pct" ? (num(c.meta) * 100).toFixed(0) : num(c.meta)}" style="width:64px;font-size:12px" />
            ${c.formato === "pct" ? '<span class="sub" style="font-size:10px">%</span>' : ""}</td>
          <td style="padding:7px 4px"><input data-cri="${i}" data-campo="peso" type="number" step="1" min="0" inputmode="numeric" value="${num(c.peso)}" style="width:48px;font-size:12px" /></td>
          <td style="padding:7px 4px;text-align:center"><input data-cri="${i}" data-campo="compite" type="checkbox"${c.compite ? " checked" : ""} style="width:17px;height:17px;accent-color:var(--verde)" /></td>
          <td style="padding:7px 4px"><button class="linkbtn" data-cridel="${i}" style="color:var(--rojo);padding:0 4px">✕</button></td>
        </tr>`).join("")}</tbody>
      </table></div>

      <h3 style="margin:18px 0 6px;font-size:14px">Agregar indicador</h3>
      ${hayDim ? `
        <label class="campo"><span>Nombre</span><input id="nqNombre" placeholder="Ej. Aguas por cuenta" /></label>
        <div class="fila" style="gap:8px">
          <label class="campo" style="flex:1"><span>Qué cuenta</span><select id="nqDim">
            ${dims.categoria.length ? `<option value="categoria">Una categoría</option>` : ""}
            ${dims.grupo.length ? `<option value="grupo">Un grupo de modificador</option>` : ""}
            ${dims.articulo.length ? `<option value="articulo">Un platillo</option>` : ""}
            ${dims.mod.length ? `<option value="mod">Un modificador</option>` : ""}
          </select></label>
          <label class="campo" style="flex:1"><span>Entre qué</span><select id="nqEntre">
            <option value="cuenta">Por cuenta</option><option value="comensal">Por persona</option>
          </select></label>
        </div>
        <label class="campo"><span>Cuál</span><select id="nqVal"></select></label>
        <div class="fila" style="gap:8px">
          <label class="campo" style="flex:1"><span>Meta</span><input id="nqMeta" type="number" step="0.01" inputmode="decimal" placeholder="0" /></label>
          <label class="campo" style="width:90px"><span>Peso</span><input id="nqPeso" type="number" step="1" min="0" inputmode="numeric" value="1" /></label>
        </div>
        <label style="display:flex;align-items:center;gap:9px;margin-bottom:10px;font-size:13px">
          <input id="nqCompite" type="checkbox" style="width:17px;height:17px;accent-color:var(--verde)" /> Que compita en el marcador</label>
        <button class="btn" id="nqAdd">Agregar</button>`
      : `<div class="aviso-box">Para elegir qué medir hace falta el desglose por categoría y grupo, que solo traen
         las importaciones recientes. <b>Vuelve a subir tu reporte de órdenes</b> en Insumos → Importar y aquí
         aparecerán tus categorías y tus grupos de modificador.</div>`}`;
  }
  function wireAjustes() {
    el.querySelectorAll("[data-compite]").forEach((c) => c.addEventListener("change", () =>
      guardar({ compiten: { ...cfg().compiten, [c.dataset.compite]: c.checked } })));
    el.querySelectorAll("[data-rol]").forEach((i) => i.addEventListener("change", () =>
      guardar({ roles: { ...cfg().roles, [i.dataset.rol]: i.value.trim() } })));
    // ── Criterios: editar, borrar y agregar ─────────────────────
    const guardarCri = (lista) => guardar({ criterios: lista });

    el.querySelectorAll("[data-cri]").forEach((i) => i.addEventListener("change", () => {
      const lista = criterios().map((c) => ({ ...c }));
      const c = lista[Number(i.dataset.cri)];
      if (!c) return;
      const campo = i.dataset.campo;
      if (campo === "compite") c.compite = i.checked;
      else if (campo === "meta") c.meta = c.formato === "pct" ? num(i.value) / 100 : num(i.value);
      else c.peso = Math.max(0, Math.round(num(i.value)));
      guardarCri(lista);
    }));

    el.querySelectorAll("[data-cridel]").forEach((b) => b.addEventListener("click", () => {
      const lista = criterios().map((c) => ({ ...c }));
      const c = lista[Number(b.dataset.cridel)];
      if (!c || !confirm(`¿Quitar "${c.nombre}" del scorecard?`)) return;
      lista.splice(Number(b.dataset.cridel), 1);
      guardarCri(lista);
    }));

    // El selector de "cuál" se llena con lo que hay en SUS datos.
    const dims = dimensionesDisponibles();
    const dimSel = el.querySelector("#nqDim"), valSel = el.querySelector("#nqVal");
    const llenarVal = () => {
      if (!dimSel || !valSel) return;
      const ops = dims[dimSel.value] || [];
      valSel.innerHTML = ops.map((v) => `<option>${esc(v)}</option>`).join("")
        || `<option value="">— nada disponible —</option>`;
    };
    if (dimSel) { dimSel.addEventListener("change", llenarVal); llenarVal(); }

    const add = el.querySelector("#nqAdd");
    if (add) add.addEventListener("click", () => {
      const nombre = (el.querySelector("#nqNombre").value || "").trim();
      const valor = valSel ? valSel.value : "";
      if (!nombre || !valor) { alert("Ponle nombre y elige qué cuenta."); return; }
      const entre = el.querySelector("#nqEntre").value;
      const lista = criterios().map((c) => ({ ...c }));
      lista.push({
        id: "c" + Date.now().toString(36),
        nombre, dim: dimSel.value, valores: [valor], entre,
        meta: num(el.querySelector("#nqMeta").value),
        peso: Math.max(0, Math.round(num(el.querySelector("#nqPeso").value))),
        formato: "num",
        compite: el.querySelector("#nqCompite").checked,
      });
      guardarCri(lista);
    });
  }
  async function guardar(patch) {
    const actual = (store.state.config && store.state.config.meseros) || {};
    try { await store.guardarConfig({ meseros: { ...actual, ...patch } }); pintar(); }
    catch (e) { alert("No pude guardar: " + ((e && e.message) || e)); }
  }

  // Si al periodo le faltan días, TODO lo de abajo está incompleto: los
  // totales, el ranking y los focos. Callarlo es dar un numero que parece
  // bueno y no lo es — que es justo lo que pasa al comparar contra Ventas,
  // donde el reporte semanal si viene completo.
  function avisoDiasFaltantes(r, dias, sinTurnos = []) {
    if (r.desde === "0000-01-01") return "";        // "Todo": no hay periodo que cubrir
    const hoyIso = iso(hoy());
    const fin = r.hasta > hoyIso ? hoyIso : r.hasta;
    const faltan = [];
    for (let d = r.desde; d <= fin; d = masDias(d, 1)) if (!dias.has(d)) faltan.push(d);
    if (!faltan.length) return "";
    const total = faltan.length + dias.size;
    const dm = (f) => { const [, m, dd] = f.split("-"); return `${+dd} ${MES_CORTO[+m - 1]}`; };
    return `<div class="card" style="border-left:4px solid var(--rojo,#b3261e)">
      <b>Faltan ${faltan.length} de ${total} días en este periodo.</b>
      <p class="sub" style="margin:6px 0 0">Sin órdenes de: ${esc(faltan.map(dm).join(", "))}.</p>
      <p class="sub" style="margin:6px 0 0"><b>Todo lo de abajo está incompleto</b> — los totales, el marcador
      y los focos solo cuentan los ${dias.size} días que sí están. Si comparas contra la pestaña de Ventas
      el número no va a cuadrar, porque allá el reporte semanal sí viene completo.</p>
      ${sinTurnos.length ? `<p class="sub" style="margin:6px 0 0">Por eso
      <b>${esc(sinTurnos.map((m) => m.split(" ")[0]).join(", "))}</b>
      ${sinTurnos.length === 1 ? "puede salir" : "pueden salir"} en <b>sin turnos</b>:
      si ${sinTurnos.length === 1 ? "trabajó" : "trabajaron"} justo alguno de los días que faltan,
      el app no tiene cómo saberlo. Sube esos días y ${sinTurnos.length === 1 ? "aparece" : "aparecen"} solos.</p>` : ""}
      <p class="sub" style="margin:6px 0 0">Sube los reportes de órdenes que falten en <b>Insumos → Importar</b>.
      Si la casa cerró alguno de esos días, ignora este aviso.</p>
      <p class="sub" style="margin:6px 0 0;opacity:.75">Ojo: Parrot nombra el archivo con el día que
      lo <i>descargas</i>, no con el día que trae adentro. Un archivo llamado "Ordenes 25-08" puede traer
      el 24. Guíate por esta lista, no por el nombre del archivo.</p>
    </div>`;
  }

  function avisoBebidas() {
    return `<div class="card" style="border-left:4px solid var(--naranja,#c0622a)">
      <b>Las bebidas salen en cero.</b>
      <p class="sub" style="margin:6px 0 0">Los spritz y limonadas SÍ vienen en tu Excel — el problema es que la
      base todavía no tiene dónde guardarlos. Corre las <b>dos</b> líneas en el SQL Editor:</p>
      <div style="background:var(--fondo-2,#f6f6f4);border-radius:8px;padding:9px 11px;margin:8px 0;font-family:ui-monospace,monospace;font-size:11.5px;overflow-x:auto">
        <div style="white-space:nowrap">alter table public.ordenes_mesero add column if not exists bebidas int not null default 0;</div>
        <div style="white-space:nowrap;margin-top:4px">notify pgrst, 'reload schema';</div>
      </div>
      <p class="sub" style="margin:0">La segunda es la que suele faltar: Supabase guarda en memoria la forma de
      cada tabla, y sin refrescarla sigue creyendo que esa columna no existe aunque ya la hayas creado.</p>
      <p class="sub" style="margin:8px 0 0">Después vuelve a subir el reporte en <b>Insumos → Importar</b>.
      Si al terminar aparece un ⚠️ hablando de bebidas, es que la base sigue sin verla.</p>
    </div>`;
  }

  function vacio() {
    return `<div class="card">
      <h2 style="margin-top:0">Todavía no hay órdenes de ese periodo</h2>
      <p class="sub">Ve a <b>Insumos → Importar</b> y sube el <b>reporte de órdenes de Parrot</b>
      (el Excel con «Reporte de órdenes» y «Reporte de detalle de órdenes»).</p></div>`;
  }

  return () => { if (typeof unsub === "function") unsub(); };
}
