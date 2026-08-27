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
  return { metas: { ...METAS_DEF, ...(c.metas || {}) }, compiten: c.compiten || {}, roles: c.roles || {} };
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

  const base = () => ({ cuentas: 0, comensales: 0, venta: 0, cafes: 0, postres: 0, bebidas: 0,
    extras: 0, extrasMonto: 0, aguacate: 0, tCuentas: 0, tComensales: 0, tVenta: 0 });
  const por = new Map();
  const get = (m) => { if (!por.has(m)) por.set(m, { mesero: m, ...base() }); return por.get(m); };

  for (const o of comedor) {
    const p = get(o.mesero || "(sin usuario)");
    p.cuentas++; p.comensales += num(o.comensales); p.venta += num(o.total);
    p.cafes += num(o.cafes); p.postres += num(o.postres); p.bebidas += num(o.bebidas);
    p.extras += num(o.extras_uds); p.extrasMonto += num(o.extras_monto);
    const ex = (o.detalle && o.detalle.extras) || {};
    for (const k of Object.keys(ex)) if (/aguacate/i.test(k)) p.aguacate += num(ex[k]);
  }
  for (const o of todos) {
    const p = get(o.mesero || "(sin usuario)");
    p.tCuentas++; p.tComensales += num(o.comensales); p.tVenta += num(o.total);
  }

  const lista = [...por.values()].map((p) => ({
    ...p,
    tktPersona: p.comensales ? p.venta / p.comensales : 0,
    cafeCuenta: p.cuentas ? p.cafes / p.cuentas : 0,
    // Attach = por PERSONA, no por cuenta. Es como se lee en la casa
    // ("1 de cada 15 personas pide postre") y como está en el guión.
    attach: p.comensales ? p.postres / p.comensales : 0,
    bebidaCuenta: p.cuentas ? p.bebidas / p.cuentas : 0,
    extrasCuenta: p.cuentas ? p.extras / p.cuentas : 0,
    aguaCuenta: p.cuentas ? p.aguacate / p.cuentas : 0,
    ventaComensal: p.tComensales ? p.tVenta / p.tComensales : 0,
    chica: p.cuentas < MIN_CUENTAS,
  })).filter((p) => p.cuentas > 0 || p.tCuentas > 0);

  const eq = lista.reduce((a, p) => {
    for (const k of ["cuentas", "comensales", "venta", "cafes", "postres", "bebidas", "extras", "extrasMonto", "aguacate", "tComensales", "tVenta"]) a[k] += p[k];
    return a;
  }, { cuentas: 0, comensales: 0, venta: 0, cafes: 0, postres: 0, bebidas: 0, extras: 0, extrasMonto: 0, aguacate: 0, tComensales: 0, tVenta: 0 });
  eq.mesero = "Equipo";
  eq.tktPersona = eq.comensales ? eq.venta / eq.comensales : 0;
  eq.cafeCuenta = eq.cuentas ? eq.cafes / eq.cuentas : 0;
  eq.attach = eq.comensales ? eq.postres / eq.comensales : 0;
  eq.bebidaCuenta = eq.cuentas ? eq.bebidas / eq.cuentas : 0;
  eq.extrasCuenta = eq.cuentas ? eq.extras / eq.cuentas : 0;
  eq.aguaCuenta = eq.cuentas ? eq.aguacate / eq.cuentas : 0;
  eq.ventaComensal = eq.tComensales ? eq.tVenta / eq.tComensales : 0;

  lista.sort((a, b) => b.cuentas - a.cuentas);
  // Qué días del periodo tienen órdenes. Sirve para avisar cuándo el total
  // que se muestra NO es el del periodo completo.
  const dias = new Set(todos.map((o) => o.fecha));
  return { lista, eq, comedor, dias };
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
  ventaTotal: { t: "Venta total", q: "Todo lo que pasó por su usuario, en todos los canales.", c: "Suma del total de sus órdenes cerradas, comedor y para-llevar.",
    d: "Aquí SÍ entra el para-llevar, a diferencia del bloque de arriba." },
  efectividad: { t: "Efectividad", q: "Su venta por persona comparada con el promedio del equipo. 100% = promedio.",
    c: "Su venta por comensal (todos los canales) entre la del equipo.",
    d: "CUIDADO al comparar meseros contra cajeras: el para-llevar tiene ticket naturalmente más bajo (un café son $35), así que la efectividad de quien atiende barra sale menor. No es mal desempeño, es la naturaleza del canal." },
  marcador: { t: "Cómo se ordena el marcador", q: "Gana quien mejor ofrece, no quien tuvo más mesas.",
    c: "Se ordena por tasa por cuenta y se muestra el volumen al lado.",
    d: "Por total ganaría siempre quien atendió más mesas: en julio Alexa hizo 138 extras, los más de todos, con 0.58 por cuenta; Giselle 91 con 0.72." },
};
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
    if (!(store.state.fechasMesero || []).length) await store.cargarFechasMesero();
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
    const { lista, eq, dias } = calcular(r.desde, r.hasta);
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

    // Columnas: primero quienes compiten (de piso), luego el resto, luego Equipo.
    const piso = lista.filter((p) => compite(p.mesero));
    const otros = lista.filter((p) => !compite(p.mesero));
    const cols = [...piso, ...otros];

    // Si nadie tiene bebidas, es que falta la columna o falta re-importar.
    // Decirlo es mejor que enseñar una fila de ceros que parece un dato real.
    const sinBebidas = !lista.some((p) => num(p.bebidas) > 0);

    el.innerHTML = selector(r)
      + avisoDiasFaltantes(r, dias)
      + (sinBebidas ? avisoBebidas() : "")
      + bloqueComedor(cols, piso.length, eq, metas, r)
      + bloqueRatios(cols, piso.length, eq)
      + bloqueVenta(cols, piso.length, eq, r)
      + focos(lista, eq, metas, r)
      + leyenda()
      + marcador(lista, eq, metas, r)
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
        <div style="font-size:13px;font-weight:700">${esc(p.mesero.split(" ")[0])}</div>
        <div style="font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;opacity:.8">${esc(rolDe(p.mesero) || (i < nPiso ? "piso" : "no compite"))}</div>
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

  function bloqueComedor(cols, nPiso, eq, metas, r) {
    const f = [
      fila("Cuentas", "", "cuentas", cols, eq, "cuentas", (v) => Math.round(v).toLocaleString("es-MX"), null),
      fila("Comensales", "", "comensales", cols, eq, "comensales", (v) => Math.round(v).toLocaleString("es-MX"), null),
      fila("Ticket / persona", "", "tkt", cols, eq, "tktPersona", (v) => money(v), null),
      fila("Café / cuenta", `meta ${metas.cafeCuenta.toFixed(1)}`, "cafe", cols, eq, "cafeCuenta", (v) => v.toFixed(2), metas.cafeCuenta),
      fila("Attach postre", `meta ${(metas.attachPostre * 100).toFixed(0)}%`, "postre", cols, eq, "attach", (v) => (v * 100).toFixed(0) + "%", metas.attachPostre),
      fila("Extras / cuenta", "proteína + premium", "extras", cols, eq, "extrasCuenta", (v) => v.toFixed(2), metas.extrasCuenta),
      fila("Aguacate / cuenta", "", "aguacate", cols, eq, "aguaCuenta", (v) => v.toFixed(2), null),
      fila("Bebidas / cuenta", "spritz + limonada", "bebidas", cols, eq, "bebidaCuenta", (v) => v.toFixed(2), null),
    ].join("");
    return tabla({ head: seccion("Servicio en comedor", `KPIs de piso · ${esc(r.txt)} · solo comedor` + ico("filtros")), filas: f }, cols, nPiso);
  }

  function bloqueRatios(cols, nPiso, eq) {
    const ratio = (nom, sub, campo) => fila(nom, sub, null, cols, eq, "__r_" + campo,
      (_, p) => { const u = num(p[campo]); return u > 0 ? `1 : ${(num(p.comensales) / u).toFixed(1)}` : "—"; }, null);
    return tabla({
      head: seccion("1 de cada cuántas personas pide…", "Personas por unidad — más bajo, más consumo" + ico("ratios")),
      filas: [ratio("1 café por cada…", "personas", "cafes"),
              ratio("1 bebida por cada…", "personas", "bebidas"),
              ratio("1 postre por cada…", "personas", "postres")].join(""),
    }, cols, nPiso);
  }

  function bloqueVenta(cols, nPiso, eq, r) {
    const prom = num(eq.ventaComensal);
    const f = [
      fila("Venta total", "", "ventaTotal", cols, eq, "tVenta", (v) => money(v), null),
      fila("Comensales atendidos", "", null, cols, eq, "tComensales", (v) => Math.round(v).toLocaleString("es-MX"), null),
      fila("Venta por comensal", "", null, cols, eq, "ventaComensal", (v) => money(v), null),
      fila("Efectividad", "vs promedio del equipo", "efectividad", cols, eq, "ventaComensal",
        (v) => prom ? Math.round(v / prom * 100) + "%" : "—", prom || null, true),
    ].join("");
    return tabla({ head: seccion("Venta total y efectividad", "Todos los canales: comedor + para-llevar"), filas: f }, cols, nPiso)
      + cotejoCortes(eq, r);
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
  function focos(lista, eq, metas, r) {
    const piso = lista.filter((p) => compite(p.mesero) && !p.chica);
    const pts = [];
    const nom = (p) => p.mesero.split(" ")[0];

    if (num(eq.cafeCuenta) < metas.cafeCuenta) {
      const pers = num(eq.cafes) ? (num(eq.comensales) / num(eq.cafes)).toFixed(1) : "—";
      pts.push(`<b>Café — de todos.</b> Nadie llega a ${metas.cafeCuenta.toFixed(1)} por cuenta: va en
        ${num(eq.cafeCuenta).toFixed(2)}, o sea ~1 café por cada ${pers} personas. Los de piso están casi iguales,
        así que es techo de sistema: se sube con el ritual de «¿otro café?» en la sobremesa para todo el piso, no rankeando.`);
    }
    if (num(eq.attach) < metas.attachPostre) {
      const pers = num(eq.postres) ? (num(eq.comensales) / num(eq.postres)).toFixed(0) : "—";
      pts.push(`<b>Postre — de todos.</b> Va en ${(num(eq.attach) * 100).toFixed(0)}% contra la meta de
        ${(metas.attachPostre * 100).toFixed(0)}%: ~1 postre por cada ${pers} personas. La carta no se ve —
        hacerla visible y ofrecerla al levantar los platos fuertes.`);
    }
    // La brecha específica: dónde hay líder claro y rezagado claro. Eso SÍ se
    // coachea persona a persona, al revés del café.
    if (piso.length >= 2) {
      const ord = [...piso].sort((a, b) => b.aguaCuenta - a.aguaCuenta);
      const lider = ord[0], ultimo = ord[ord.length - 1];
      if (num(lider.aguaCuenta) > 0 && num(lider.aguaCuenta) >= num(ultimo.aguaCuenta) * 2) {
        const mejorVenta = [...piso].sort((a, b) => b.ventaComensal - a.ventaComensal)[0];
        pts.push(`<b>Aguacate y extras — ${esc(nom(ultimo))} es la brecha.</b>
          ${esc(nom(lider))} vende ${num(lider.aguaCuenta).toFixed(2)} de aguacate por cuenta y
          ${esc(nom(ultimo))} ${num(ultimo.aguaCuenta).toFixed(2)}.
          ${mejorVenta.mesero === ultimo.mesero
            ? `Ojo: ${esc(nom(ultimo))} es quien MÁS vende por comensal, así que su tema no es desempeño general — es sumar extras.`
            : `Que ${esc(nom(lider))} le enseñe cómo lo ofrece al tomar la orden.`}`);
      }
    }
    if (!pts.length) pts.push(`<b>Todo en meta.</b> Ningún indicador del equipo está por debajo. Buen momento para subir la meta.`);

    return `<div class="card">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:#5c2018;margin-bottom:10px">Focos de coaching · ${esc(r.txt)}</div>
      ${pts.map((t) => `<div style="display:flex;gap:9px;margin-bottom:11px;font-size:13.5px;line-height:1.5">
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
  function marcador(lista, eq, metas, r) {
    const podio = (campo) => lista.filter((p) => compite(p.mesero) && !p.chica).sort((a, b) => b[campo] - a[campo]);
    const MED = ["🥇", "🥈", "🥉"];
    const tarj = (titulo, arr, campo, vol, meta, fmt, infoK) => {
      const h = `<h3 style="margin:0 0 8px;font-size:13.5px">${esc(titulo)}${infoK ? ico(infoK) : ""}</h3>`;
      if (!arr.length) return `<div>${h}<div class="sub">Sin muestra suficiente.</div></div>`;
      return `<div>${h}${arr.map((p, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #ece7df">
          <span style="width:20px">${MED[i] || ""}</span>
          <span style="flex:1;min-width:0;font-weight:${i === 0 ? 700 : 500};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.mesero.split(" ")[0])}</span>
          <span class="sub" style="font-size:11px">${Math.round(num(p[vol]))} uds</span>
          <b style="min-width:48px;text-align:right;color:${num(p[campo]) >= meta ? V_TXT : A_TXT}">${fmt(num(p[campo]))}</b>
        </div>`).join("")}</div>`;
    };
    const fuera = lista.filter((p) => p.chica && compite(p.mesero));
    return `<div class="card">
      <h2 style="margin-top:0">🏁 Marcador · ${esc(r.txt)}${ico("marcador")}</h2>
      <div style="display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">
        ${tarj("Extras por cuenta", podio("extrasCuenta"), "extrasCuenta", "extras", metas.extrasCuenta, (v) => v.toFixed(2), "extras")}
        ${tarj("Postre por persona", podio("attach"), "attach", "postres", metas.attachPostre, (v) => (v * 100).toFixed(0) + "%", "postre")}
      </div>
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
    if (rec) rec.addEventListener("click", () => { store.state.ordenesMeseroAl = 0; recargar(); });
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
      <h3 style="margin:16px 0 6px;font-size:14px">Metas</h3>
      <label class="campo"><span>Cafés por cuenta</span><input data-meta="cafeCuenta" type="number" step="0.1" inputmode="decimal" value="${metas.cafeCuenta}" /></label>
      <label class="campo"><span>Attach de postre (% de personas)</span><input data-meta="attachPostre" type="number" step="1" inputmode="decimal" value="${(metas.attachPostre * 100).toFixed(0)}" /></label>
      <label class="campo"><span>Extras por cuenta</span><input data-meta="extrasCuenta" type="number" step="0.01" inputmode="decimal" value="${metas.extrasCuenta}" /></label>
    </div>`;
  }
  function wireAjustes() {
    el.querySelectorAll("[data-compite]").forEach((c) => c.addEventListener("change", () =>
      guardar({ compiten: { ...cfg().compiten, [c.dataset.compite]: c.checked } })));
    el.querySelectorAll("[data-rol]").forEach((i) => i.addEventListener("change", () =>
      guardar({ roles: { ...cfg().roles, [i.dataset.rol]: i.value.trim() } })));
    el.querySelectorAll("[data-meta]").forEach((i) => i.addEventListener("change", () => {
      const k = i.dataset.meta;
      guardar({ metas: { ...cfg().metas, [k]: k === "attachPostre" ? num(i.value) / 100 : num(i.value) } });
    }));
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
  function avisoDiasFaltantes(r, dias) {
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
      <p class="sub" style="margin:6px 0 0">Sube los reportes de órdenes que falten en <b>Insumos → Importar</b>.
      Si la casa cerró alguno de esos días, ignora este aviso.</p>
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
