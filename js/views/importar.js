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
  const mismo = a.getMonth() === b.getMonth();
  return mismo
    ? `${a.getDate()}–${b.getDate()} ${MES[b.getMonth()]}`
    : `${a.getDate()} ${MES[a.getMonth()]} – ${b.getDate()} ${MES[b.getMonth()]}`;
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

// ── Insertar en Supabase (borra y recarga para no duplicar) ──
async function importarCorte(c) {
  if (!c.corte || !c.fecha) throw new Error("el corte no trae número o fecha");
  await supabase.from("cortes").delete().eq("corte", c.corte);
  const { error } = await supabase.from("cortes").insert(c);
  if (error) throw new Error(error.message);
}

async function importarProducto(p) {
  if (!p.desde) throw new Error("no pude leer las fechas del reporte");
  // Todo se guarda por SEMANA (lunes–domingo), aunque el reporte traiga 1 día.
  const wk = semanaDe(p.desde);
  const desde = wk.desde, hasta = wk.hasta;
  const periodo = labelRango(desde, hasta);
  await supabase.from("productos_venta").delete().eq("desde", desde);
  await supabase.from("modificadores_venta").delete().eq("desde", desde);
  await supabase.from("combos_venta").delete().eq("desde", desde);
  const prows = p.prods.map((x) => ({ periodo, desde, hasta, ...x }));
  const mrows = Object.entries(p.mods).map(([modificador, cantidad]) =>
    ({ periodo, desde, hasta, modificador, cantidad }));
  const crows = Object.entries(p.combos).map(([k, cantidad]) => {
    const [producto, modificador] = k.split("\u0001");
    return { periodo, desde, hasta, producto, modificador, cantidad };
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
  return { periodo, desde, hasta, prod: prows.length, mods: mrows.length, combos: crows.length };
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
  let del = supabase.from("variantes_venta").delete().eq("desde", desde);
  if (fechaDia) del = del.or(`fecha.eq.${fechaDia},fecha.is.null`);
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
  let del = supabase.from("productos_venta").delete().eq("desde", desde);
  if (fechaDia) del = del.or(`fecha.eq.${fechaDia},fecha.is.null`);
  const { error: ed } = await del;
  if (ed) throw new Error(ed.message);
  const { error: ei } = await supabase.from("productos_venta").insert(rows);
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
      <p class="sub" style="margin-top:0">Sube los archivos que descargas de tu punto de venta:
      los <b>cortes de caja</b> (diarios), y ${semanales}. Acepto <b>Excel</b> y también <b>PDF</b> de los reportes.
      Puedes soltar varios de golpe; yo detecto cuál es cuál.</p>
      <label class="btn"><input id="files" type="file" accept=".xlsx,.pdf" multiple hidden> ⬆ Elegir archivos</label>
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
        let tipo = "?";
        if (wb.SheetNames.includes("Detalle corte de caja")) tipo = "corte";
        else if (wb.SheetNames.includes("Productos Vendidos Agregados")) tipo = "producto";
        else if (wb.SheetNames.includes("Artículo - Grupo Modificador")) tipo = "variante";
        items.push({ f, wb, tipo });
      } catch (err) { items.push({ f, err }); }
    }
    // PDFs al final: primero el Excel (que da semanaRef exacta para variantes).
    const orden = { corte: 0, producto: 1, variante: 2, pdf: 3, "?": 4 };
    items.sort((a, b) => (orden[a.tipo] ?? 4) - (orden[b.tipo] ?? 4));

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
        if (it.tipo === "corte") {
          const c = parseCorte(XLSX.utils.sheet_to_json(it.wb.Sheets["Detalle corte de caja"], { header: 1 }));
          await importarCorte(c);
          logs.push(`✅ Corte #${c.corte} · ${c.fecha} · ${money(c.ventas_total)}`);
        } else if (it.tipo === "producto") {
          const p = parseProducto(it.wb, XLSX);
          const r = await importarProducto(p);
          semanaRef = { desde: r.desde, hasta: r.hasta, periodo: r.periodo };
          logs.push(`✅ Productos ${r.periodo} · ${r.prod} productos, ${r.combos} combos`);
        } else if (it.tipo === "variante") {
          const r = await importarVariantes(parseVariantes(it.wb, XLSX), semanaRef || semanaMasReciente());
          logs.push(r.comoProductos
            ? `✅ Venta por producto ${r.periodo} · ${r.filas} productos (reporte por categoría — no toqué el desglose por variante)`
            : `✅ Variantes ${r.periodo} · ${r.filas} líneas platillo/variante`);
        } else if (it.tipo === "pdf") {
          logs.push(...await procesarPDF(it.f, semanaRef || semanaMasReciente()));
        } else {
          logs.push(`⚠️ ${escF(it.f.name)}: no reconocí el formato (¿es un export de tu punto de venta?)`);
        }
      } catch (err) {
        logs.push(`❌ ${escF(it.f.name)}: ${(err && err.message) || err}`);
      }
    }
    const okN = logs.filter((l) => l.startsWith("✅")).length;
    const malN = logs.length - okN;
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
