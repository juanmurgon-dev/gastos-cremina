// Importador: sube los Excel de tu punto de venta (cortes diarios + reporte de artículos
// semanal), los lee en el navegador y los carga a Supabase. Detecta el tipo solo.
import { supabase } from "../supabase-init.js";
import * as store from "../store.js";
import { money } from "../store.js";

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function N(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? n : 0;
}
function pad(n) { return String(n).padStart(2, "0"); }

// "18/06/26 21:44:03" o Date → "2026-06-18"
function ddmmToISO(s) {
  if (!s) return null;
  if (s instanceof Date) return `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
  const t = String(s).trim().split(" ")[0];
  const p = t.split("/");
  if (p.length !== 3) return null;
  let [d, m, y] = p.map((x) => parseInt(x, 10));
  if (y < 100) y += 2000;
  if (!d || !m || !y) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function labelRango(desde, hasta) {
  if (!desde) return "semana";
  const a = new Date(desde + "T00:00"), b = new Date((hasta || desde) + "T00:00");
  return `${store.fechaDMA(a)} – ${store.fechaDMA(b)}`;
}

// Semana (lunes–domingo) que contiene una fecha ISO. Así TODO se agrupa por
// semana en los reportes, aunque el archivo traiga un solo día de datos.
function semanaDe(iso) {
  const d = new Date(iso + "T00:00");
  const dow = (d.getDay() + 6) % 7;                 // 0 = lunes
  const lun = new Date(d); lun.setDate(d.getDate() - dow);
  const dom = new Date(lun); dom.setDate(lun.getDate() + 6);
  const f = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  return { desde: f(lun), hasta: f(dom) };
}

// ── Parsers (lógica validada contra los archivos reales) ──
function parseCorte(rows) {
  const lab = (r) => (rows[r] && rows[r][0] != null) ? String(rows[r][0]).trim() : "";
  const cel = (r, i = 0) => (rows[r] && rows[r][i] != null) ? rows[r][i] : null;
  let corte = null, fecha = null, persona = "", venta = 0, efect = 0, dif = 0, tarj = 0, transf = 0;
  let tiposStart = null, cur = null; const seen = new Set();

  for (let i = 0; i < rows.length; i++) {
    const l = lab(i), val = rows[i] ? rows[i][1] : null;
    const m = l.match(/Corte de caja #(\d+)/);
    if (m) corte = parseInt(m[1], 10);
    if (l === "Cierre") { fecha = ddmmToISO(cel(i + 1, 0)); persona = String(cel(i + 2, 0) || ""); }
    if (l === "Ventas en efectivo en sucursal") efect = N(val);
    if (l === "Tipos de pago") tiposStart = i;
    if (tiposStart != null && i > tiposStart) {
      if (["Efectivo", "Visa", "Mastercard", "American Express", "Transferencia", "Otro"].includes(l)) cur = l;
      if (l === "Venta total" && cur && !seen.has(cur)) {
        seen.add(cur);
        if (["Visa", "Mastercard", "American Express"].includes(cur)) tarj += N(val);
        else if (cur === "Transferencia") transf += N(val);
      }
    }
  }
  for (let i = 0; i < rows.length; i++) {
    if (lab(i) === "Resumen - Venta total")
      for (let j = i + 1; j < Math.min(i + 5, rows.length); j++) if (lab(j) === "Venta total") { venta = N(rows[j][1]); break; }
    if (lab(i) === "Resumen - Movimientos en efectivo")
      for (let j = i + 1; j < Math.min(i + 12, rows.length); j++) if (lab(j) === "Diferencia") { dif = N(rows[j][1]); break; }
  }
  return { corte, fecha, persona, ventas_total: venta, efectivo: efect, tarjeta: tarj, transferencia: transf, diferencia: dif };
}

function parseProducto(wb, XLSX) {
  const agg = XLSX.utils.sheet_to_json(wb.Sheets["Productos Vendidos Agregados"], { header: 1 });
  const prods = [];
  for (let i = 1; i < agg.length; i++) {
    const r = agg[i];
    if (!r || !r[0]) continue;
    const venta = N(r[7] != null ? r[7] : r[5]);
    prods.push({ producto: String(r[0]), categoria: String(r[1] || ""), cantidad: N(r[3]), venta });
  }
  let minF = null, maxF = null; const mods = {}, combos = {};
  const lst = wb.Sheets["Listado de Productos Vendidos"];
  if (lst) {
    const rowsL = XLSX.utils.sheet_to_json(lst, { header: 1 });
    const hdr = (rowsL[0] || []).map((x) => String(x || "").trim());
    const iF = hdr.indexOf("Fecha"), iSku = hdr.indexOf("SKU"), iNom = hdr.indexOf("Nombre del artículo");
    let actual = null;
    for (let i = 1; i < rowsL.length; i++) {
      const r = rowsL[i]; if (!r) continue;
      const f = ddmmToISO(r[iF]);
      if (f) { if (!minF || f < minF) minF = f; if (!maxF || f > maxF) maxF = f; }
      const sku = String(r[iSku] || ""), nom = String(r[iNom] || "").trim();
      if (!nom) continue;
      if (sku.startsWith("AR-")) {           // modificador del platillo actual
        mods[nom] = (mods[nom] || 0) + 1;
        if (actual) { const k = actual + "\u0001" + nom; combos[k] = (combos[k] || 0) + 1; }
      } else {                                // platillo (nuevo "actual")
        actual = nom;
      }
    }
  }
  return { prods, mods, combos, desde: minF, hasta: maxF };
}

// ═══════════════════════════════════════════════════════════════════════
//  RECONOCIMIENTO POR CONTENIDO
//  No dependemos del nombre de la hoja ni de la marca del punto de venta:
//  miramos los ENCABEZADOS de columna y deducimos qué reporte es. Así un
//  cliente nuevo sube su Excel tal como se lo entrega su sistema y funciona.
// ═══════════════════════════════════════════════════════════════════════

// "Categoría de Artículo " → "categoria de articulo"
function norm(s) {
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Separador interno para las llaves compuestas (producto + categoría).
const SEP = "\u0001";

// Sinónimos por concepto. El orden del objeto ES la prioridad: los conceptos
// más específicos reclaman su columna antes que los genéricos (así
// "cantidad de ordenes" no se confunde con "cantidad").
const CAMPOS = {
  tipoLinea:  ["modificador producto cargo por servicio", "modificador producto", "tipo de linea"],
  idLinea:    ["id del articulo de la orden", "id de linea", "id articulo orden"],
  idPadre:    ["id padre", "articulo padre", "id del padre"],
  // Desempeño por mesero: la hoja de órdenes trae quién atendió, y la de
  // detalle trae los artículos. Se cruzan por el número de referencia, que
  // es la única columna que comparten. Van ANTES que "venta", porque
  // "total de orden" cae en los alias genéricos de "total".
  referencia: ["numero de referencia", "referencia", "folio"],
  usuario:    ["usuario", "mesero", "atendio", "cajero", "empleado"],
  tipoOrden:  ["tipo de orden", "tipo orden"],
  estatus:    ["estatus", "estado", "status"],
  mesa:       ["mesa", "numero de mesa"],
  totalOrden: ["total de orden", "total de la orden"],
  descuentoOrden: ["descuento de la orden", "descuento de orden"],
  ordenes:    ["cantidad de ordenes", "cantidad ordenes", "numero de ordenes", "ordenes", "tickets", "cuentas"],
  comensales: ["cantidad comensales", "cantidad de comensales", "comensales", "personas"],
  categoria:  ["categoria de articulo", "categoria del articulo", "categoria", "familia",
               "grupo de menu", "clasificacion"],
  grupoMod:   ["grupo modificador", "grupo de modificador", "grupo modificadores"],
  cantidadOpc:["cantidad modificador", "cantidad de la opcion", "cantidad opcion"],
  ventaOpc:   ["venta total de la opcion", "venta de la opcion", "total de la opcion"],
  opcion:     ["opcion modificador", "opcion", "variante", "tipo variante", "tipo por platillo"],
  fecha:      ["fecha hora", "fecha de venta", "fecha", "dia", "date"],
  producto:   ["articulo de la orden", "nombre del articulo", "articulo", "producto", "platillo",
               "descripcion", "nombre", "item"],
  cantidad:   ["cantidad del articulo", "cantidad", "unidades", "uds", "piezas", "qty", "quantity", "vendidos"],
  venta:      ["total de articulo", "total articulos", "venta total mxn", "venta total", "importe",
               "total", "monto", "subtotal", "venta"],
};

// Asigna cada columna a UN concepto (una columna nunca se reclama dos veces).
function mapaColumnas(hdr) {
  const mapa = {};
  const usadas = new Set();
  // 1ª pasada: coincidencia exacta.
  for (const [campo, alias] of Object.entries(CAMPOS)) {
    for (const a of alias) {
      const i = hdr.indexOf(a);
      if (i >= 0 && !usadas.has(i)) { mapa[campo] = i; usadas.add(i); break; }
    }
  }
  // 2ª pasada: el encabezado EMPIEZA con el alias (ej. "total de articulo mxn").
  for (const [campo, alias] of Object.entries(CAMPOS)) {
    if (mapa[campo] != null) continue;
    for (const a of alias) {
      const i = hdr.findIndex((h, j) => !usadas.has(j) && h && h.startsWith(a));
      if (i >= 0) { mapa[campo] = i; usadas.add(i); break; }
    }
  }
  return mapa;
}

// El encabezado no siempre es la primera fila (hay reportes con título arriba).
// Probamos las primeras filas y nos quedamos con la que reconoce más columnas.
function buscarEncabezado(rows) {
  let mejor = { i: -1, mapa: {}, n: 0 };
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const fila = rows[i];
    if (!Array.isArray(fila)) continue;
    const hdr = fila.map(norm);
    if (hdr.filter(Boolean).length < 2) continue;
    const mapa = mapaColumnas(hdr);
    const n = Object.keys(mapa).length;
    if (n > mejor.n) mejor = { i, mapa, n };
  }
  return mejor;
}

// ¿Qué reporte es esta hoja? null = no la reconocemos.
function clasificarHoja(rows) {
  const { i, mapa } = buscarEncabezado(rows);
  if (i < 0) return null;
  const hay = (c) => mapa[c] != null;
  // Una línea por artículo vendido (la fuente más rica: trae fecha y categoría).
  if (hay("producto") && hay("cantidad") && hay("fecha")) return { tipo: "lineas", mapa, hdr: i };
  // Detalle por orden (un renglón por cuenta, muchos del MISMO día). Se parece
  // a "venta por día" pero NO lo es: si se lee renglón por renglón, el día
  // termina con los comensales de una sola mesa. Se reconoce porque la fecha
  // se repite, y se suma.
  // Se exige la columna de comensales: un listado de PAGOS también repite fecha,
  // y sumarlo daría un día con 0 comensales que pisaría el bueno.
  if (hay("fecha") && !hay("producto") && hay("comensales") && fechasRepetidas(rows, mapa, i))
    return { tipo: "ordenes", mapa, hdr: i };
  // Venta por día: fecha + importe, sin artículos. Va UNA fila por día; si la
  // fecha se repite es un detalle (pagos, órdenes) y leerlo renglón por renglón
  // dejaba el día con la venta de una sola cuenta. Mejor no reconocerlo.
  if (hay("fecha") && hay("venta") && !hay("producto") && !fechasRepetidas(rows, mapa, i))
    return { tipo: "ventasdia", mapa, hdr: i };
  // Producto desglosado por variante / modificador.
  if (hay("producto") && hay("opcion") && hay("cantidad")) return { tipo: "variantes", mapa, hdr: i };
  // Producto agregado: cuántos se vendieron y cuánto dejaron.
  if (hay("producto") && hay("cantidad") && hay("venta")) return { tipo: "productos", mapa, hdr: i };
  // Resumen de modificadores: grupo + opción, sin columna de producto.
  if (hay("grupoMod") && hay("opcion") && (hay("cantidadOpc") || hay("cantidad")))
    return { tipo: "modificadores", mapa, hdr: i };
  return null;
}

// Recorre TODAS las hojas del libro y se queda con el reporte más útil
// (entre más detalle traiga, mejor).
const RANGO_TIPO = { lineas: 5, variantes: 4, productos: 3, ordenes: 2.5, ventasdia: 2, modificadores: 1 };
function clasificarLibro(wb, XLSX) {
  let mejor = null, kpi = null;
  for (const nombre of wb.SheetNames) {
    let rows;
    try { rows = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1 }); }
    catch { continue; }
    if (!rows || rows.length < 2) continue;
    const c = clasificarHoja(rows);
    if (!c) continue;
    const cand = { ...c, hoja: nombre, rows };
    if (!mejor || RANGO_TIPO[cand.tipo] > RANGO_TIPO[mejor.tipo]) mejor = cand;
    // Un mismo libro suele traer el detalle de artículos (más rico) Y el de
    // órdenes. Si nos quedamos solo con el primero perdemos los comensales,
    // así que la hoja de KPIs se aparta por separado.
    if (cand.tipo === "ordenes" || cand.tipo === "ventasdia") {
      if (!kpi || cand.tipo === "ordenes") kpi = cand;
    }
  }
  if (mejor && kpi && mejor.hoja !== kpi.hoja) mejor.kpi = kpi;
  return mejor;
}

// Lee una celda de la fila por concepto.
const cel = (r, mapa, campo) => (mapa[campo] != null ? r[mapa[campo]] : null);
const texto = (v) => {
  const s = String(v == null ? "" : v).trim();
  return (s === "-" || s === "—") ? "" : s;   // los reportes usan "-" como vacío
};

// ¿La columna de fecha trae el mismo día varias veces? Entonces la hoja es
// detalle (una fila por orden), no un resumen con una fila por día.
function fechasRepetidas(rows, mapa, hdr) {
  if (mapa.fecha == null) return false;
  const vistas = new Set();
  for (let i = hdr + 1; i < rows.length; i++) {
    const f = ddmmToISO(cel(rows[i], mapa, "fecha"));
    if (!f) continue;
    if (vistas.has(f)) return true;
    vistas.add(f);
  }
  return false;
}

// ── Detalle por orden → resumen por día ──
// Cada fila es una cuenta cerrada. El día es la suma: cuántas órdenes, cuántos
// comensales y cuánto se vendió. Da exactamente lo mismo que el reporte diario.
function parseOrdenes(rows, mapa, hdr) {
  const dias = new Map();
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const fecha = ddmmToISO(cel(r, mapa, "fecha"));
    if (!fecha) continue;
    if (!dias.has(fecha)) dias.set(fecha, { fecha, ventas_total: 0, ordenes: 0, comensales: 0 });
    const d = dias.get(fecha);
    d.ordenes += 1;
    d.comensales += N(cel(r, mapa, "comensales"));
    // "venta" o "total de orden": desde que existe el concepto `totalOrden`
    // (para el desglose por mesero), en esta hoja la columna del importe la
    // reclama él. Sin este respaldo, los días entrarían con venta 0.
    d.ventas_total += N(cel(r, mapa, "venta")) || N(cel(r, mapa, "totalOrden"));
  }
  return [...dias.values()].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
}

// ── Venta por día ──
// ═══════════════ DESEMPEÑO POR MESERO ═══════════════
// El reporte de órdenes de Parrot trae dos hojas: una con una fila por cuenta
// (y quién la atendió) y otra con una fila por artículo. Ninguna sirve sola:
// la de artículos NO dice el mesero. Se cruzan por el número de referencia.
//
// Qué cuenta como qué (definido con los datos reales de julio 2026, y
// cuadrado contra el scorecard hecho a mano):
//   café   → artículos de la categoría "Barra de Café"
//   postre → artículos de la categoría "Postres"
//   extra  → MODIFICADORES pagados cuyo grupo (el paréntesis final del
//            nombre, ej. "Aguacate (Extras Premium)") sea de Extras.
//            Incluye "-2 pz huevo", que resta comida pero se cobra: así se
//            midió julio y así se conservan comparables los históricos.
const CAT_CAFE = norm("Barra de Café");
const CAT_POSTRE = norm("Postres");
const GRUPOS_EXTRA = [norm("Extras Proteína"), norm("Extras Premium")];

function parseMeseros(gen) {
  const k = gen.kpi;
  // Sin la hoja de órdenes no hay mesero que valga: la de artículos no lo trae.
  if (!k || k.mapa.referencia == null || k.mapa.usuario == null) return [];

  const ord = new Map();
  for (let i = k.hdr + 1; i < k.rows.length; i++) {
    const r = k.rows[i];
    if (!Array.isArray(r)) continue;
    const ref = texto(cel(r, k.mapa, "referencia"));
    const fecha = ddmmToISO(cel(r, k.mapa, "fecha"));
    if (!ref || !fecha) continue;
    ord.set(ref, {
      referencia: ref,
      fecha,
      mesero: texto(cel(r, k.mapa, "usuario")),
      tipo_orden: texto(cel(r, k.mapa, "tipoOrden")),
      estatus: texto(cel(r, k.mapa, "estatus")),
      mesa: texto(cel(r, k.mapa, "mesa")),
      comensales: Math.round(N(cel(r, k.mapa, "comensales"))),
      total: N(cel(r, k.mapa, "totalOrden")) || N(cel(r, k.mapa, "venta")),
      descuento: N(cel(r, k.mapa, "descuentoOrden")),
      cafes: 0, postres: 0, extras_uds: 0, extras_monto: 0, bebidas: 0,
      detalle: { categorias: {}, extras: {}, grupos: {}, articulos: {}, mods: {} },
    });
  }
  if (!ord.size) return [];

  // Ahora las líneas: cada artículo suma a la cuenta a la que pertenece.
  if (gen.mapa.referencia != null) {
    for (let i = gen.hdr + 1; i < gen.rows.length; i++) {
      const r = gen.rows[i];
      if (!Array.isArray(r)) continue;
      const o = ord.get(texto(cel(r, gen.mapa, "referencia")));
      if (!o) continue;
      const art = texto(cel(r, gen.mapa, "producto"));
      const cat = texto(cel(r, gen.mapa, "categoria"));
      const q = Math.round(N(cel(r, gen.mapa, "cantidad"))) || 0;
      const monto = N(cel(r, gen.mapa, "venta"));

      if (norm(texto(cel(r, gen.mapa, "tipoLinea"))) === "modificador") {
        if (monto <= 0) continue;                       // los gratis no son venta
        const m = /\(([^)]+)\)\s*$/.exec(art);          // el grupo va al final
        const grupo = m ? m[1] : "";
        // Todos los grupos pagados, para poder medir mañana algo que hoy no
        // se mide sin volver a importar mes y medio de órdenes.
        if (grupo) o.detalle.grupos[grupo] = (o.detalle.grupos[grupo] || 0) + q;
        // El modificador SIN su grupo entre paréntesis: "Aguacate", no
        // "Aguacate (Extras Premium)". Así se puede medir por nombre.
        const solo = art.replace(/\s*\([^)]+\)\s*$/, "").trim();
        if (solo) o.detalle.mods[solo] = (o.detalle.mods[solo] || 0) + q;
        // Spritz y limonadas: la bebida que el mesero SÍ mueve, aparte del café.
        if (/^(spritz|limonada)/i.test(art)) o.bebidas += q;
        if (!GRUPOS_EXTRA.includes(norm(grupo))) continue;
        o.extras_uds += q;
        o.extras_monto += monto;
        o.detalle.extras[art] = (o.detalle.extras[art] || 0) + q;
      } else {
        if (!cat) continue;
        o.detalle.categorias[cat] = (o.detalle.categorias[cat] || 0) + q;
        // Y el platillo por su nombre, para poder medir uno solo.
        if (art) o.detalle.articulos[art] = (o.detalle.articulos[art] || 0) + q;
        if (norm(cat) === CAT_CAFE) o.cafes += q;
        else if (norm(cat) === CAT_POSTRE) o.postres += q;
      }
    }
  }
  return [...ord.values()];
}

function parseVentasDia(rows, mapa, hdr) {
  const out = [];
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const fecha = ddmmToISO(cel(r, mapa, "fecha"));
    if (!fecha) continue;                       // se salta subtítulos y filas de total
    out.push({
      fecha,
      ventas_total: N(cel(r, mapa, "venta")),
      ordenes: N(cel(r, mapa, "ordenes")),
      comensales: N(cel(r, mapa, "comensales")),
    });
  }
  return out;
}

// ── Una línea por artículo vendido → productos + modificadores + combos ──
function parseLineasOrden(rows, mapa, hdr) {
  // Nombre de cada línea por su id, para saber de qué platillo cuelga cada modificador.
  const nombrePorId = new Map();
  if (mapa.idLinea != null) {
    for (let i = hdr + 1; i < rows.length; i++) {
      const r = rows[i];
      if (r && cel(r, mapa, "idLinea") != null)
        nombrePorId.set(String(cel(r, mapa, "idLinea")), texto(cel(r, mapa, "producto")));
    }
  }
  let minF = null, maxF = null;
  const prods = new Map(), mods = {}, combos = {};
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const nom = texto(cel(r, mapa, "producto"));
    if (!nom) continue;
    const f = ddmmToISO(cel(r, mapa, "fecha"));
    if (f) { if (!minF || f < minF) minF = f; if (!maxF || f > maxF) maxF = f; }

    const cant = mapa.cantidad != null ? N(cel(r, mapa, "cantidad")) : 1;
    const tipo = norm(cel(r, mapa, "tipoLinea")) || "producto";
    if (tipo === "modificador") {
      mods[nom] = (mods[nom] || 0) + cant;
      const padre = mapa.idPadre != null ? nombrePorId.get(String(cel(r, mapa, "idPadre") || "")) : null;
      if (padre && padre !== nom) {
        const k = padre + SEP + nom;
        combos[k] = (combos[k] || 0) + cant;
      }
      continue;
    }
    if (tipo !== "producto") continue;          // cargos por servicio, propinas, etc.
    const cat = texto(cel(r, mapa, "categoria"));
    const k = nom + SEP + cat;
    const o = prods.get(k) || { producto: nom, categoria: cat, cantidad: 0, venta: 0 };
    o.cantidad += cant;
    o.venta += N(cel(r, mapa, "venta"));
    prods.set(k, o);
  }
  return { prods: [...prods.values()], mods, combos, desde: minF, hasta: maxF };
}

// ── Producto ya agregado (sin fecha): la fecha se toma del lote ──
function parseProductosSimple(rows, mapa, hdr) {
  const agg = new Map();
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const nom = texto(cel(r, mapa, "producto"));
    if (!nom) continue;
    if (norm(cel(r, mapa, "tipoLinea")) === "modificador") continue;
    const cat = texto(cel(r, mapa, "categoria"));
    const k = nom + SEP + cat;
    const o = agg.get(k) || { producto: nom, categoria: cat, cantidad: 0, venta: 0 };
    o.cantidad += N(cel(r, mapa, "cantidad"));
    o.venta += N(cel(r, mapa, "venta"));
    agg.set(k, o);
  }
  return [...agg.values()];
}

// ── Resumen de modificadores vendidos (sin producto): qué extras se piden más ──
function parseModificadores(rows, mapa, hdr) {
  const agg = new Map();
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const opcion = texto(cel(r, mapa, "opcion"));
    if (!opcion) continue;
    // Preferimos la cantidad de la OPCIÓN; la genérica suele ser el total del grupo.
    const cant = N(mapa.cantidadOpc != null ? cel(r, mapa, "cantidadOpc") : cel(r, mapa, "cantidad"));
    agg.set(opcion, (agg.get(opcion) || 0) + cant);
  }
  return [...agg.entries()].map(([modificador, cantidad]) => ({ modificador, cantidad }));
}

// ── Producto por variante (genérico) ──
function parseVariantesSimple(rows, mapa, hdr) {
  const out = [];
  for (let i = hdr + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const prod = texto(cel(r, mapa, "producto"));
    const opcion = texto(cel(r, mapa, "opcion"));
    if (!prod || !opcion) continue;
    out.push({
      producto: prod,
      grupo: texto(cel(r, mapa, "grupoMod")),
      opcion,
      unidades: N(cel(r, mapa, "cantidad")),
      venta: N(cel(r, mapa, "venta")),
    });
  }
  return out;
}

// ¿Ya existe la columna 'fecha' en modificadores/combos? La agrega
// supabase/fecha-modificadores-combos.sql. Si el cliente todavía no la corre,
// seguimos guardando por semana como antes en vez de romper la importación.
let _mcPorDia = null;
async function modCombosPorDia() {
  if (_mcPorDia !== null) return _mcPorDia;
  const { error } = await supabase.from("modificadores_venta").select("fecha").limit(1);
  _mcPorDia = !error;
  return _mcPorDia;
}

// ── Insertar en Supabase (borra y recarga para no duplicar) ──
async function importarCorte(c) {
  if (!c.corte || !c.fecha) throw new Error("el corte no trae número o fecha");
  await supabase.from("cortes").delete().eq("corte", c.corte);
  // Si ese día ya tenía la venta puesta por el reporte de ventas, quítala: el
  // corte de caja es más completo (efectivo, tarjeta) y manda. Evita duplicar.
  await supabase.from("cortes").delete().eq("fecha", c.fecha).is("corte", null);
  const { error } = await supabase.from("cortes").insert(c);
  if (error) throw new Error(error.message);
}

// Guarda la venta de cada día del reporte de ventas. Un día que YA tiene corte de
// caja no se toca (el corte trae más detalle); y nunca se deja más de una fila por
// día, para que la venta jamás se cuente doble.
async function importarVentasDia(filas) {
  if (!filas.length) throw new Error("no encontré días con venta en ese reporte");
  let nuevos = 0, conCorte = 0, total = 0;
  for (const f of filas) {
    const { data: previos, error: e0 } = await supabase
      .from("cortes").select("id, corte").eq("fecha", f.fecha);
    if (e0) throw new Error(e0.message);
    const auto = (previos || []).filter((c) => c.corte == null).map((c) => c.id);
    if (auto.length) {
      const { error: e1 } = await supabase.from("cortes").delete().in("id", auto);
      if (e1) throw new Error(e1.message);
    }
    if ((previos || []).some((c) => c.corte != null)) { conCorte++; continue; }
    const { error: e2 } = await supabase.from("cortes").insert({
      corte: null, fecha: f.fecha, persona: "",
      ventas_total: f.ventas_total, efectivo: 0, tarjeta: 0, transferencia: 0, diferencia: 0,
    });
    if (e2) throw new Error(e2.message);
    nuevos++; total += f.ventas_total;
  }
  // El corte solo guarda dinero. Comensales y órdenes viven en kpis_dia, que es
  // de donde salen el ticket promedio y la ocupación — antes se leían del Excel
  // y se tiraban aquí mismo, por eso el día quedaba sin comensales.
  for (const f of filas) {
    if (!f.comensales && !f.ordenes) continue;
    try { await store.guardarKpiDia(f.fecha, { comensales: f.comensales, cuentas: f.ordenes, venta: f.ventas_total }); }
    catch (_) { /* no bloquear la importación por un KPI */ }
  }
  const conKpi = filas.filter((f) => f.comensales || f.ordenes).length;
  return { nuevos, conCorte, dias: filas.length, total, conKpi,
    comensales: filas.reduce((a, f) => a + N(f.comensales), 0) };
}

async function importarProducto(p) {
  if (!p.desde) throw new Error("no pude leer las fechas del reporte");
  // Todo se guarda por SEMANA (lunes–domingo). Si el reporte es de UN día,
  // ACUMULA: reemplaza solo ese día y limpia el agregado semanal viejo.
  const wk = semanaDe(p.desde);
  const desde = wk.desde, hasta = wk.hasta;
  const periodo = labelRango(desde, hasta);
  const fechaDia = (!p.hasta || p.hasta === p.desde) ? p.desde : null;   // reporte de UN día
  let delP = supabase.from("productos_venta").delete().eq("desde", desde);
  delP = fechaDia ? delP.eq("fecha", fechaDia) : delP.is("fecha", null);
  await delP;
  // Modificadores y combos también se reemplazan POR DÍA. Antes se borraba la
  // semana entera, así que subir el martes se llevaba lo del lunes.
  const porDia = await modCombosPorDia();
  for (const tabla of ["modificadores_venta", "combos_venta"]) {
    let del = supabase.from(tabla).delete().eq("desde", desde);
    if (porDia) del = fechaDia ? del.eq("fecha", fechaDia) : del.is("fecha", null);
    await del;
  }
  const conDia = (o) => (porDia ? { ...o, fecha: fechaDia || null } : o);
  const prows = p.prods.map((x) => ({ periodo, desde, hasta, fecha: fechaDia || null, ...x }));
  const mrows = Object.entries(p.mods).map(([modificador, cantidad]) =>
    conDia({ periodo, desde, hasta, modificador, cantidad }));
  const crows = Object.entries(p.combos).map(([k, cantidad]) => {
    const [producto, modificador] = k.split("\u0001");
    return conDia({ periodo, desde, hasta, producto, modificador, cantidad });
  });
  const e1 = await supabase.from("productos_venta").insert(prows);
  if (e1.error) throw new Error(e1.error.message);
  if (mrows.length) {
    const e2 = await supabase.from("modificadores_venta").insert(mrows);
    if (e2.error) throw new Error(e2.error.message);
  }
  if (crows.length) {
    const e3 = await supabase.from("combos_venta").insert(crows);
    if (e3.error) throw new Error(e3.error.message);
  }
  return { periodo, desde, hasta, dia: fechaDia, prod: prows.length, mods: mrows.length, combos: crows.length };
}

// Venta por producto y variante (archivo "Grupos modificadores" de tu punto de venta).
function parseVariantes(wb, XLSX) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Artículo - Grupo Modificador"], { header: 1 });
  const base = {}, tmp = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (!r || !r[0]) continue;
    const prod = String(r[0]), dishUnits = N(r[3]), ventaSinMod = N(r[6]);
    const grupo = String(r[8] || ""), opcion = String(r[10] || "");
    if (base[prod] === undefined && dishUnits) base[prod] = ventaSinMod / dishUnits;
    if (!grupo || !opcion) continue;
    tmp.push({ prod, grupo, opcion, unidades: N(r[12]), extra: N(r[14]) });
  }
  return tmp.map((o) => ({
    producto: o.prod, grupo: o.grupo, opcion: o.opcion, unidades: o.unidades,
    venta: Math.round((o.unidades * (base[o.prod] || 0) + o.extra) * 100) / 100
  }));
}

// Categorías de menú: si el archivo agrupa por estas (en vez de por grupo
// modificador real), es el REPORTE en PDF/Word, no el "Grupos modificadores"
// de tu punto de venta. Rechazarlo evita borrar el desglose bueno por variante.
const CATEGORIAS_REPORTE = new Set(["desayunos", "comida", "entradas", "postres",
  "barra de café", "barra de cafe", "bebidas", "mimosas", "extras", "otros"]);

// Carga variantes en variantes_venta, acumulando por día (igual que productos).
async function cargarVariantes(rows, wk, fechaDia) {
  const { desde, hasta, periodo } = wk;
  const out = rows.map((v) => ({ periodo, desde, hasta, fecha: fechaDia || null, ...v }));
  // Día individual → reemplaza solo ESE día. Consolidado (varios días) → reemplaza solo
  // el agregado sin fecha. Así un consolidado (ej. 27–29) y un día suelto (ej. 30) COEXISTEN
  // y se suman en la semana, siempre que no se traslapen en el mismo día.
  let del = supabase.from("variantes_venta").delete().eq("desde", desde);
  del = fechaDia ? del.eq("fecha", fechaDia) : del.is("fecha", null);
  const { error: ed } = await del;
  if (ed) throw new Error(ed.message);
  const { error: ei } = await supabase.from("variantes_venta").insert(out);
  if (ei) throw new Error(ei.message);
  return { periodo, filas: out.length };
}

async function importarVariantes(vrows, semana, fechaDia) {
  if (!semana) throw new Error("sube también el 'Reporte de artículos' de esa semana (para saber la fecha)");
  const clean = (s) => (s || "").trim().toLowerCase();
  const esCategoria = (v) => CATEGORIAS_REPORTE.has(clean(v.grupo));
  const esSabor = (v) => /^sabor(es)?$/i.test((v.grupo || "").trim());     // tabla "<producto> — sabores vendidos"
  const esSinVar = (v) => /sin\s*variante/i.test((v.grupo || "").trim());  // fila plana "Sin variante"

  // ── Sabores de bebidas (ej. Latte): las unidades vienen en su tabla de sabores,
  //    pero la VENTA sólo aparece en la fila 'Sin variante' del producto. La repartimos
  //    proporcional a las unidades de cada sabor para conservar el desglose. ──
  const sabores = (vrows || []).filter((v) => esSabor(v) && (v.producto || "").trim() && (v.opcion || "").trim());
  const prodConSabor = new Set(sabores.map((v) => clean(v.producto)));
  const ventaProd = new Map();   // producto -> venta total (de su fila 'Sin variante')
  for (const v of (vrows || [])) if (esSinVar(v)) ventaProd.set(clean(v.producto), N(v.venta));
  const uniSabor = new Map();    // producto -> total de unidades sumando sus sabores
  for (const v of sabores) uniSabor.set(clean(v.producto), (uniSabor.get(clean(v.producto)) || 0) + N(v.unidades));
  const saboresRows = sabores.map((v) => {
    const k = clean(v.producto), totV = ventaProd.get(k) || 0, totU = uniSabor.get(k) || 0;
    return {
      producto: v.producto, grupo: "Sabor", opcion: v.opcion, unidades: N(v.unidades),
      venta: (totV > 0 && totU > 0) ? Math.round(totV * N(v.unidades) / totU) : N(v.venta),
    };
  });

  // ── Variantes "normales" (Chilaquiles, Chai, …) y filas 'Sin variante' de productos SIN
  //    sabor. Se excluyen: categorías de menú, las filas de sabores (ya tratadas) y la fila
  //    plana de los productos que YA se desglosaron por sabor (para no duplicar el Latte). ──
  const reales = (vrows || []).filter((v) =>
    (v.producto || "").trim() && !esCategoria(v) && !esSabor(v)
    && !(esSinVar(v) && prodConSabor.has(clean(v.producto))));

  const normales = reales.map((v) => {
    let opcion = (v.opcion || "").trim();
    // Fila 'Sin variante': muestra el nombre del producto como etiqueta (no "sin variante").
    if (esSinVar(v) && (!opcion || clean(opcion) === "sin variante")) opcion = v.producto;
    return { producto: v.producto, grupo: esSinVar(v) ? "" : v.grupo, opcion, unidades: N(v.unidades), venta: N(v.venta) };
  });

  const todas = [...normales, ...saboresRows].filter((r) => (r.opcion || "").trim());

  if (!todas.length) {
    // No hay variantes reales → es el reporte por categoría → cárgalo como VENTA POR PRODUCTO.
    const porProd = new Map();
    for (const v of (vrows || [])) {
      const nombre = (v.producto || "").trim();
      if (!nombre) continue;
      const o = porProd.get(nombre) || { producto: nombre, categoria: (v.grupo || "").trim(), cantidad: 0, venta: 0 };
      o.cantidad += N(v.unidades);
      o.venta += N(v.venta);
      porProd.set(nombre, o);
    }
    const prows = [...porProd.values()];
    if (!prows.length) throw new Error("No reconocí productos en ese reporte.");
    const out = await cargarProductos(prows, semana, fechaDia);
    return { comoProductos: true, periodo: out.periodo, filas: out.filas, dia: fechaDia };
  }

  const out = await cargarVariantes(todas, semana, fechaDia);
  return { periodo: out.periodo, filas: out.filas, dia: fechaDia };
}

// Semana que le toca a un reporte SIN fechas propias: la del día detectado en
// el mismo lote, o la del reporte que sí traía fechas, o la última ya cargada.
function semanaDeLote(diaRef, semanaRef) {
  if (diaRef) {
    const w = semanaDe(diaRef);
    return { desde: w.desde, hasta: w.hasta, periodo: labelRango(w.desde, w.hasta) };
  }
  return semanaRef || semanaMasReciente();
}

// Semana más reciente ya cargada (respaldo si suben el grupos sin el reporte de artículos).
function semanaMasReciente() {
  const ps = store.state.productos || [];
  let best = null;
  for (const p of ps) if (!best || p.desde > best.desde) best = p;
  return best ? { desde: best.desde, hasta: best.hasta, periodo: best.periodo } : null;
}

// ── PDF: Claude (Edge Function) lo lee y devuelve JSON, y aquí lo cargamos ──
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = () => rej(new Error("no pude leer el PDF"));
    r.readAsDataURL(file);
  });
}

// Carga productos en productos_venta. Si es un reporte de UN DÍA (fechaDia), ACUMULA:
// reemplaza solo ese día dentro de la semana (idempotente) y limpia el agregado
// semanal viejo. Si es semanal (fechaDia null), reemplaza la semana completa.
async function cargarProductos(prows, wk, fechaDia) {
  const { desde, hasta, periodo } = wk;
  const rows = prows.map((p) => ({ periodo, desde, hasta, fecha: fechaDia || null, ...p }));
  // Día individual → solo ese día. Consolidado → solo el agregado sin fecha. Coexisten.
  let del = supabase.from("productos_venta").delete().eq("desde", desde);
  del = fechaDia ? del.eq("fecha", fechaDia) : del.is("fecha", null);
  const { error: ed } = await del;
  if (ed) throw new Error(ed.message);
  const { error: ei } = await supabase.from("productos_venta").insert(rows);
  if (ei) throw new Error(ei.message);
  return { periodo, filas: rows.length };
}

// Guarda el resumen de extras/modificadores de la semana.
async function importarModificadores(mods, wk, fechaDia) {
  const { desde, hasta, periodo } = wk;
  const porDia = await modCombosPorDia();
  let del = supabase.from("modificadores_venta").delete().eq("desde", desde);
  if (porDia) del = fechaDia ? del.eq("fecha", fechaDia) : del.is("fecha", null);
  const { error: ed } = await del;
  if (ed) throw new Error(ed.message);
  const rows = mods.map((m) => {
    const r = { periodo, desde, hasta, modificador: m.modificador, cantidad: m.cantidad };
    return porDia ? { ...r, fecha: fechaDia || null } : r;
  });
  const { error: ei } = await supabase.from("modificadores_venta").insert(rows);
  if (ei) throw new Error(ei.message);
  return { periodo, filas: rows.length };
}

async function importarProductosPDF(r) {
  if (!r.desde) throw new Error("el PDF no trae las fechas del periodo");
  const w = semanaDe(r.desde);
  const wk = { desde: w.desde, hasta: w.hasta, periodo: labelRango(w.desde, w.hasta) };
  const fechaDia = (!r.hasta || r.hasta === r.desde) ? r.desde : null;   // reporte de UN día
  const prows = (r.items || []).map((x) => ({
    producto: String(x.producto || ""), categoria: String(x.categoria || ""),
    cantidad: N(x.cantidad), venta: N(x.venta),
  }));
  const out = await cargarProductos(prows, wk, fechaDia);
  return { periodo: out.periodo, prod: out.filas, dia: fechaDia };
}

// Diagnóstico: muestra en el log si el reporte trajo comensales/mesas (para saber si
// la función los está leyendo del encabezado).
function kpiSuffix(data) {
  const c = Number(data && data.comensales) || 0, m = Number(data && data.mesas) || 0;
  return (c || m) ? ` · 👥 ${Math.round(c)} comensales, ${Math.round(m)} mesas` : ` · ⚠️ el reporte no trajo comensales`;
}

// Guarda los KPIs del encabezado del reporte (comensales/mesas/venta), keyeados por
// la fecha de INICIO del periodo (día si es diario, lunes si es semanal). Así cuenta
// tanto si subes reportes diarios como semanales.
async function guardarKpiDesde(data) {
  const fecha = data && data.desde;
  if (!fecha) return;
  const com = N(data.comensales), mes = N(data.mesas);
  if (!com && !mes) return;   // el reporte no traía ese encabezado
  try { await store.guardarKpiDia(fecha, { comensales: com, cuentas: mes, venta: N(data.venta_total), hasta: data.hasta || data.desde }); } catch (_) { /* no bloquear la importación */ }
}

async function procesarPDF(f, semanaBackup) {
  const pdfBase64 = await fileToBase64(f);
  const { data, error } = await supabase.functions.invoke("extraer-reporte", { body: { pdfBase64 } });
  if (error) {
    let msg = error.message || String(error);
    if (error.context && typeof error.context.json === "function") {
      try { const b = await error.context.json(); if (b && b.error) msg = b.error; } catch { /* usa msg */ }
    }
    return [`❌ ${f.name}: ${msg}`];
  }
  if (!data) return [`❌ ${f.name}: la función no devolvió datos.`];
  if (data.error) return [`❌ ${f.name}: ${data.error}`];

  if (data.tipo === "corte") {
    await importarCorte({
      corte: data.corte, fecha: data.fecha, persona: data.persona || "",
      ventas_total: N(data.ventas_total), efectivo: N(data.efectivo),
      tarjeta: N(data.tarjeta), transferencia: N(data.transferencia), diferencia: N(data.diferencia),
    });
    return [`✅ (PDF) Corte #${data.corte} · ${data.fecha} · ${money(N(data.ventas_total))}`];
  }
  if (data.tipo === "productos") {
    const out = await importarProductosPDF(data);
    await guardarKpiDesde(data);
    return [(out.dia
      ? `✅ (PDF) Día ${out.dia} · ${out.prod} productos (sumado a la semana ${out.periodo})`
      : `✅ (PDF) Productos ${out.periodo} · ${out.prod} productos`) + kpiSuffix(data)];
  }
  if (data.tipo === "variantes") {
    const semana = data.desde
      ? (() => { const wk = semanaDe(data.desde); return { desde: wk.desde, hasta: wk.hasta, periodo: labelRango(wk.desde, wk.hasta) }; })()
      : semanaBackup;
    const fechaDia = (data.desde && (!data.hasta || data.hasta === data.desde)) ? data.desde : null;
    await guardarKpiDesde(data);
    const vrows = (data.items || []).map((v) => ({
      producto: String(v.producto || ""), grupo: String(v.grupo || ""),
      opcion: String(v.opcion || ""), unidades: N(v.unidades), venta: N(v.venta),
    }));
    const out = await importarVariantes(vrows, semana, fechaDia);
    if (out.comoProductos) return [(out.dia
      ? `✅ (PDF) Día ${out.dia} · ${out.filas} productos (sumado a la semana ${out.periodo})`
      : `✅ (PDF) Venta por producto ${out.periodo} · ${out.filas} productos (reporte por categoría)`) + kpiSuffix(data)];
    return [(out.dia
      ? `✅ (PDF) Día ${out.dia} · ${out.filas} líneas por variante (sumado a la semana ${out.periodo})`
      : `✅ (PDF) Variantes ${out.periodo} · ${out.filas} líneas platillo/variante`) + kpiSuffix(data)];
  }
  return [`⚠️ ${f.name}: no reconocí el reporte del PDF.`];
}

export function montar(el) {
  const usaVar = store.usaVariantes();
  const semanales = usaVar
    ? "el <b>reporte de artículos</b> + <b>grupos de modificadores</b> (semanales, súbelos juntos)"
    : "el <b>reporte de artículos</b> (semanal)";
  el.innerHTML = `
    <div class="card">
      <h2>Importar de tu punto de venta</h2>
      <p class="sub" style="margin-top:0">Sube los <b>Excel tal como te los da tu punto de venta</b>
      (o el PDF del reporte). No importa cómo se llame el archivo: leo las columnas
      y detecto solo qué es cada uno. Puedes soltar varios de golpe.</p>
      <label class="btn"><input id="files" type="file" accept=".xlsx,.xls,.csv,.pdf" multiple hidden> ⬆ Elegir archivos</label>
      <details style="margin-top:12px">
        <summary class="sub" style="cursor:pointer;font-size:12.5px">¿Qué reportes puedo subir?</summary>
        <div class="sub" style="font-size:12.5px;line-height:1.6;margin-top:8px">
          <b>Venta por día</b> — con columnas de fecha e importe. De aquí sale tu venta diaria.<br>
          <b>Detalle de órdenes</b> — una línea por artículo vendido. El más completo: trae fecha, categoría y modificadores.<br>
          <b>Productos vendidos</b> — artículo, cantidad e importe.<br>
          <b>Variantes / modificadores</b> — platillo, opción y unidades.<br>
          <b>Corte de caja</b> — el detalle de cierre con efectivo y tarjeta.<br>
          <span style="opacity:.8">Si un archivo no entra, te digo qué hojas trae para poder agregarlo.</span>
        </div>
      </details>
      <div class="aviso-box" style="margin-top:12px;font-size:12.5px;line-height:1.5">
        📅 <b>Días y consolidados se suman en la semana.</b> Puedes mezclar un consolidado
        (ej. 27–29 jul) con días sueltos (ej. 30 jul) y se acumulan juntos.
        <b>Ojo:</b> no subas un consolidado y un día que <b>incluyan la misma fecha</b> — se contaría doble.
      </div>
      <div id="res"></div>
    </div>

    <div class="card">
      <h2>Respaldo de tus datos</h2>
      <p class="sub" style="margin-top:-4px">Descarga TODO tu historial (gastos, ventas, gastos fijos, requisiciones…) en un archivo. Guárdalo por seguridad.</p>
      <button class="btn sec" id="respaldo">⬇ Descargar respaldo (todo)</button>
      <div id="resp-msg"></div>
    </div>`;

  el.querySelector("#respaldo").addEventListener("click", async () => {
    const btn = el.querySelector("#respaldo");
    const msg = el.querySelector("#resp-msg");
    btn.disabled = true; btn.textContent = "Preparando…";
    try {
      const data = await store.exportarRespaldo();
      const fecha = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `respaldo-cifra-${fecha}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      const n = Object.values(data.tablas).reduce((s, v) => s + (Array.isArray(v) ? v.length : 0), 0);
      msg.innerHTML = `<div class="ok-box" style="margin-top:10px">✅ Respaldo descargado (${n} registros). Guárdalo en un lugar seguro.</div>`;
    } catch (e) {
      msg.innerHTML = `<div class="error-box" style="margin-top:10px">No pude generar el respaldo: ${(e && e.message) || e}</div>`;
    }
    btn.disabled = false; btn.textContent = "⬇ Descargar respaldo (todo)";
  });

  el.querySelector("#files").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const res = el.querySelector("#res");
    if (!document.getElementById("imp-spin-css")) {
      const st = document.createElement("style"); st.id = "imp-spin-css";
      st.textContent = "@keyframes impspin{to{transform:rotate(360deg)}}.imp-spin{width:18px;height:18px;border:2.5px solid var(--linea);border-top-color:var(--naranja);border-radius:50%;animation:impspin .8s linear infinite;display:inline-block;vertical-align:middle;flex:none}";
      document.head.appendChild(st);
    }
    res.innerHTML = `<div style="margin-top:14px;display:flex;align-items:center;gap:10px"><span class="imp-spin"></span><span style="font-size:13.5px;font-weight:700">Leyendo ${files.length} archivo(s)…</span></div>`;

    // El lector de Excel solo se carga si hay algún Excel. Un PDF NO lo necesita,
    // así que un fallo al cargarlo jamás debe bloquear la importación de un PDF.
    const esPDF = (f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf";
    let XLSX = null;
    if (files.some((f) => !esPDF(f))) {
      try { XLSX = await import("https://esm.sh/xlsx@0.18.5"); }
      catch (err) { XLSX = null; }   // los PDF sí se procesan; los Excel avisan abajo
    }

    // Clasificar primero, para procesar en orden (productos antes que variantes).
    const items = [];
    for (const f of files) {
      if (esPDF(f)) { items.push({ f, tipo: "pdf" }); continue; }
      if (!XLSX) { items.push({ f, err: new Error("no pude cargar el lector de Excel (revisa tu internet e intenta de nuevo)") }); continue; }
      try {
        const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
        // 1) Formatos ya conocidos: tienen parsers a la medida (más exactos).
        let tipo = "?", gen = null;
        if (wb.SheetNames.includes("Detalle corte de caja")) tipo = "corte";
        else if (wb.SheetNames.includes("Productos Vendidos Agregados")) tipo = "producto";
        else if (wb.SheetNames.includes("Artículo - Grupo Modificador")) tipo = "variante";
        else {
          // 2) Cualquier otro Excel: lo reconocemos por sus columnas.
          gen = clasificarLibro(wb, XLSX);
          if (gen) tipo = "gen-" + gen.tipo;
        }
        items.push({ f, wb, tipo, gen });
      } catch (err) { items.push({ f, err }); }
    }
    // PDFs al final: primero el Excel (que da semanaRef exacta para variantes).
    const orden = {
      corte: 0, "gen-ordenes": 0.5, "gen-ventasdia": 1, "gen-lineas": 2, producto: 3,
      "gen-productos": 4, variante: 5, "gen-variantes": 6, "gen-modificadores": 7,
      pdf: 8, "?": 9,
    };
    items.sort((a, b) => (orden[a.tipo] ?? 9) - (orden[b.tipo] ?? 9));

    // Spinner (una sola vez) para que se note que está trabajando.
    if (!document.getElementById("imp-spin-css")) {
      const st = document.createElement("style"); st.id = "imp-spin-css";
      st.textContent = "@keyframes impspin{to{transform:rotate(360deg)}}.imp-spin{width:18px;height:18px;border:2.5px solid var(--linea);border-top-color:var(--naranja);border-radius:50%;animation:impspin .8s linear infinite;display:inline-block;vertical-align:middle;flex:none}";
      document.head.appendChild(st);
    }
    const escF = (s) => String(s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const logLinea = (l) => `<div style="font-size:13px;padding:6px 0;border-bottom:1px solid var(--linea);overflow-wrap:anywhere">${l}</div>`;

    const logs = [];
    let semanaRef = null;
    let productosCargados = false;   // ¿ya entró un reporte de productos con detalle?
    let diaRef = null;   // día detectado en el lote (corte o reporte de 1 día) → acumula variantes por día
    const total = items.length;
    // Muestra spinner + barra + "procesando X de N" + los resultados que ya van.
    const pintarProgreso = (hechos, actual) => {
      const pct = Math.round(hechos / total * 100);
      res.innerHTML = `<div style="margin-top:14px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <span class="imp-spin"></span>
          <span style="font-size:13.5px;font-weight:700">Procesando ${Math.min(hechos + 1, total)} de ${total}…</span>
        </div>
        <div class="sub" style="font-size:12px;margin-bottom:8px;overflow-wrap:anywhere">${escF(actual)}</div>
        <div class="barra-track" style="height:10px"><span class="barra-fill" style="width:${Math.max(4, pct)}%;background:var(--naranja);transition:width .25s"></span></div>
        ${logs.length ? `<div style="margin-top:12px">${logs.map(logLinea).join("")}</div>` : ""}
      </div>`;
    };

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      pintarProgreso(i, it.f.name);
      await new Promise((r) => setTimeout(r, 20));   // deja que el navegador pinte antes del trabajo pesado
      try {
        if (it.err) throw it.err;
        // Comensales/órdenes del día: van aparte del reporte principal, para que
        // no se pierdan cuando el libro se importa por su hoja de artículos.
        if (it.gen && it.gen.kpi && it.tipo !== "gen-ordenes" && it.tipo !== "gen-ventasdia") {
          const k = it.gen.kpi;
          const dias = k.tipo === "ordenes" ? parseOrdenes(k.rows, k.mapa, k.hdr) : parseVentasDia(k.rows, k.mapa, k.hdr);
          let n = 0;
          for (const d of dias) {
            if (!d.comensales) continue;   // sin comensales no hay nada que rescatar
            try { await store.guardarKpiDia(d.fecha, { comensales: d.comensales, cuentas: d.ordenes, venta: d.ventas_total }); n++; } catch (_) {}
          }
          if (n) logs.push(`👥 ${it.f.name}: ${dias.reduce((a, d) => a + N(d.comensales), 0)} comensales en ${n} día(s)`);
        }
        if (it.tipo === "corte") {
          const c = parseCorte(XLSX.utils.sheet_to_json(it.wb.Sheets["Detalle corte de caja"], { header: 1 }));
          await importarCorte(c);
          if (c.fecha) diaRef = c.fecha;   // el corte de caja trae la fecha exacta del día
          logs.push(`✅ Corte #${c.corte} · ${c.fecha} · ${money(c.ventas_total)}`);
        } else if (it.tipo === "producto") {
          const p = parseProducto(it.wb, XLSX);
          const r = await importarProducto(p);
          productosCargados = true;
          semanaRef = { desde: r.desde, hasta: r.hasta, periodo: r.periodo };
          if (r.dia) diaRef = r.dia;       // reporte de productos de un solo día
          logs.push(r.dia
            ? `✅ Productos día ${r.dia} · ${r.prod} productos (sumado a la semana ${r.periodo})`
            : `✅ Productos ${r.periodo} · ${r.prod} productos, ${r.combos} combos`);
        } else if (it.tipo === "variante") {
          const r = await importarVariantes(parseVariantes(it.wb, XLSX), semanaRef || semanaMasReciente(), diaRef);
          logs.push(r.comoProductos
            ? `✅ Venta por producto ${r.periodo} · ${r.filas} productos (reporte por categoría — no toqué el desglose por variante)`
            : diaRef
              ? `✅ Variantes día ${diaRef} · ${r.filas} líneas (sumado a la semana ${r.periodo})`
              : `✅ Variantes ${r.periodo} · ${r.filas} líneas platillo/variante`);
        } else if (it.tipo === "gen-ordenes") {
          const filas = parseOrdenes(it.gen.rows, it.gen.mapa, it.gen.hdr);
          const r = await importarVentasDia(filas);
          if (filas.length === 1) diaRef = filas[0].fecha;
          logs.push(`✅ Detalle de órdenes · ${filas.length} día(s) · ${money(r.total)} · 👥 ${Math.round(r.comensales)} comensales`);
        } else if (it.tipo === "gen-ventasdia") {
          const filas = parseVentasDia(it.gen.rows, it.gen.mapa, it.gen.hdr);
          const r = await importarVentasDia(filas);
          if (filas.length === 1) diaRef = filas[0].fecha;
          const detalle = r.conCorte
            ? ` (${r.conCorte} día(s) ya tenían corte de caja, no los toqué)`
            : "";
          logs.push(`✅ Venta por día · ${r.nuevos} día(s) · ${money(r.total)}${detalle}` +
            (r.conKpi ? ` · 👥 ${Math.round(r.comensales)} comensales` : " · ⚠️ sin comensales en el reporte"));
        } else if (it.tipo === "gen-lineas") {
          // Si el libro trae también la hoja de órdenes (con la columna
          // Usuario), de paso sale el desempeño por mesero. Va aparte y no
          // debe tumbar la importación de ventas si algo falla.
          try {
            const ordm = parseMeseros(it.gen);
            if (ordm.length) {
              const rm = await store.importarOrdenesMesero(ordm);
              const gente = new Set(ordm.map((o) => o.mesero).filter(Boolean)).size;
              logs.push(`✅ Meseros · ${rm.guardadas} cuentas de ${gente} persona(s)`);
              // Si la base rechazó `bebidas`, se guardó todo lo demás — pero hay
              // que DECIRLO. Callarlo hacía que la fila de bebidas saliera en
              // cero sin ninguna pista de por qué.
              if (rm.faltaBebidas) {
                logs.push(`⚠️ Bebidas NO se guardaron: la base todavía no conoce esa columna. ` +
                  `En el SQL Editor corre estas dos líneas y vuelve a importar:  ` +
                  `alter table public.ordenes_mesero add column if not exists bebidas int not null default 0;  ` +
                  `notify pgrst, 'reload schema';`);
              }
            }
          } catch (e) {
            logs.push(`⚠️ Meseros: no pude guardarlo — ${(e && e.message) || e}` +
              (String((e && e.message) || "").includes("ordenes_mesero")
                ? " (¿ya corriste meseros.sql en Supabase?)" : ""));
          }
          const p = parseLineasOrden(it.gen.rows, it.gen.mapa, it.gen.hdr);
          if (!p.prods.length) throw new Error("no encontré artículos vendidos en ese reporte");
          // La venta por producto se guarda POR SEMANA, y este importador mete
          // todo en la semana de la PRIMERA fecha. Con un archivo de varias
          // semanas (el de órdenes suele traer mes y medio) eso aplasta seis
          // semanas dentro de una y borra lo que esa semana ya tenía.
          // Mejor no tocar las ventas: el desempeño por mesero, que es para lo
          // que sirve ese archivo, ya se guardó arriba con su fecha correcta.
          if (p.hasta && semanaDe(p.desde).desde !== semanaDe(p.hasta).desde) {
            logs.push(`⏭️ Ventas por producto: NO las toqué. Ese archivo abarca ` +
              `${labelRango(p.desde, p.hasta)} — varias semanas, y la venta se guarda semana por semana. ` +
              `Para actualizar ventas sube el reporte de UNA semana.`);
            continue;
          }
          const r = await importarProducto(p);
          productosCargados = true;
          semanaRef = { desde: r.desde, hasta: r.hasta, periodo: r.periodo };
          if (r.dia) diaRef = r.dia;
          logs.push(r.dia
            ? `✅ Ventas del día ${r.dia} · ${r.prod} productos (sumado a la semana ${r.periodo})`
            : `✅ Ventas ${r.periodo} · ${r.prod} productos, ${r.combos} combos`);
        } else if (it.tipo === "gen-productos") {
          // Este reporte es el más pobre (sin fecha ni categoría). Si en el mismo
          // lote ya entró uno con más detalle, NO lo pises.
          if (productosCargados) {
            logs.push(`↩️ ${escF(it.f.name)}: me lo salté — ya cargué esos productos desde un reporte con más detalle.`);
          } else {
            const prods = parseProductosSimple(it.gen.rows, it.gen.mapa, it.gen.hdr);
            if (!prods.length) throw new Error("no encontré productos en ese reporte");
            const wk = semanaDeLote(diaRef, semanaRef);
            if (!wk) throw new Error("ese reporte no trae fechas: súbelo junto con el reporte de ventas por día");
            const out = await cargarProductos(prods, wk, diaRef);
            productosCargados = true;
            logs.push(diaRef
              ? `✅ Productos del día ${diaRef} · ${out.filas} productos (sumado a la semana ${out.periodo})`
              : `✅ Productos ${out.periodo} · ${out.filas} productos`);
          }
        } else if (it.tipo === "gen-modificadores") {
          if (productosCargados) {
            logs.push(`↩️ ${escF(it.f.name)}: me lo salté — los modificadores ya vinieron en un reporte más completo.`);
          } else {
            const mods = parseModificadores(it.gen.rows, it.gen.mapa, it.gen.hdr);
            if (!mods.length) throw new Error("no encontré modificadores en ese reporte");
            const wk = semanaDeLote(diaRef, semanaRef);
            if (!wk) throw new Error("ese reporte no trae fechas: súbelo junto con el reporte de ventas por día");
            const r = await importarModificadores(mods, wk, diaRef);
            logs.push(`✅ Modificadores ${r.periodo} · ${r.filas} extras`);
          }
        } else if (it.tipo === "gen-variantes") {
          const vrows = parseVariantesSimple(it.gen.rows, it.gen.mapa, it.gen.hdr);
          if (!vrows.length) throw new Error("no encontré variantes en ese reporte");
          const r = await importarVariantes(vrows, semanaRef || semanaMasReciente(), diaRef);
          logs.push(r.comoProductos
            ? `✅ Venta por producto ${r.periodo} · ${r.filas} productos`
            : `✅ Variantes ${r.periodo} · ${r.filas} líneas platillo/variante`);
        } else if (it.tipo === "pdf") {
          logs.push(...await procesarPDF(it.f, semanaRef || semanaMasReciente()));
        } else {
          const hojas = (it.wb && it.wb.SheetNames || []).join(", ");
          logs.push(`⚠️ ${escF(it.f.name)}: no reconocí el formato. Hojas que trae: ${hojas || "—"}. ` +
            `Necesito columnas de artículo + cantidad + importe, o de fecha + venta.`);
        }
      } catch (err) {
        logs.push(`❌ ${escF(it.f.name)}: ${(err && err.message) || err}`);
      }
    }
    const okN = logs.filter((l) => l.startsWith("✅")).length;
    // Solo ❌ y ⚠️ son problemas. Antes se contaba "todo lo que no empiece con
    // ✅", así que líneas informativas —los comensales rescatados, o algo que
    // a propósito no se tocó— se reportaban como archivos fallidos.
    const malN = logs.filter((l) => l.startsWith("❌") || l.startsWith("⚠️")).length;
    if (okN) { await store.recargarVentas(); store.logActividad("reporte", okN + " archivo(s)"); }

    let pie;
    if (okN && !malN) {
      pie = `<div class="ok-box" style="margin-top:12px">Listo. Se cargaron ${okN} archivo(s). Ya se actualizaron Resumen y Productos.</div>`;
    } else if (okN && malN) {
      pie = `<div class="aviso-box" style="margin-top:12px">Se cargaron ${okN}, pero ${malN} no (revisa los ❌ de arriba). Lo que sí entró ya se actualizó.</div>`;
    } else {
      pie = `<div class="error-box" style="margin-top:12px">No se cargó ningún archivo. Revisa los ❌ de arriba.</div>`;
    }
    res.innerHTML =
      `<div style="margin-top:14px"><div class="barra-track" style="height:10px;margin-bottom:12px"><span class="barra-fill" style="width:100%;background:var(--verde)"></span></div>${logs.map(logLinea).join("")}</div>
       ${pie}`;
    e.target.value = "";
  });
}
