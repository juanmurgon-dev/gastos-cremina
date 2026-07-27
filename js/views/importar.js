// Importador: sube los Excel de Parrot (cortes diarios + reporte de artículos
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

// Venta por producto y variante (archivo "Grupos modificadores" de Parrot).
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
// de Parrot. Rechazarlo evita borrar el desglose bueno por variante.
const CATEGORIAS_REPORTE = new Set(["desayunos", "comida", "entradas", "postres",
  "barra de café", "barra de cafe", "bebidas", "mimosas", "extras", "otros"]);

async function importarVariantes(vrows, semana) {
  if (!semana) throw new Error("sube también el 'Reporte de artículos' de esa semana (para saber la fecha)");
  // Candado: no dejes que el reporte por categoría (o placeholders "Sin variante")
  // sobrescriba el desglose real por variante.
  const grupos = [...new Set((vrows || []).map((v) => (v.grupo || "").trim().toLowerCase()).filter(Boolean))];
  const cats = grupos.filter((g) => CATEGORIAS_REPORTE.has(g)).length;
  const hayPlaceholder = (vrows || []).some((v) => (v.opcion || "").trim().toLowerCase() === "sin variante");
  if ((grupos.length && cats / grupos.length >= 0.5) || hayPlaceholder) {
    // Es el REPORTE agrupado por categoría, no el de variantes. En vez de
    // rechazarlo, lo cargamos como VENTA POR PRODUCTO: así el reporte semanal
    // SÍ entra, y NO se toca el desglose por variante que ya tuvieras.
    const porProd = new Map();
    for (const v of (vrows || [])) {
      const nombre = (v.producto || "").trim();
      if (!nombre) continue;
      const o = porProd.get(nombre) || { producto: nombre, categoria: (v.grupo || "").trim(), cantidad: 0, venta: 0 };
      o.cantidad += N(v.unidades);
      o.venta += N(v.venta);
      porProd.set(nombre, o);
    }
    const prows = [...porProd.values()].map((p) => ({ periodo: semana.periodo, desde: semana.desde, hasta: semana.hasta, ...p }));
    if (!prows.length) throw new Error("No reconocí productos en ese reporte.");
    await supabase.from("productos_venta").delete().eq("desde", semana.desde);
    const { error: ep } = await supabase.from("productos_venta").insert(prows);
    if (ep) throw new Error(ep.message);
    return { comoProductos: true, periodo: semana.periodo, filas: prows.length };
  }
  await supabase.from("variantes_venta").delete().eq("desde", semana.desde);
  const rows = vrows.map((v) => ({ periodo: semana.periodo, desde: semana.desde, hasta: semana.hasta, ...v }));
  const { error } = await supabase.from("variantes_venta").insert(rows);
  if (error) throw new Error(error.message);
  return { periodo: semana.periodo, filas: rows.length };
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

async function importarProductosPDF(r) {
  if (!r.desde) throw new Error("el PDF no trae las fechas del periodo");
  const wk = semanaDe(r.desde);
  const desde = wk.desde, hasta = wk.hasta;
  const periodo = labelRango(desde, hasta);
  await supabase.from("productos_venta").delete().eq("desde", desde);
  const rows = (r.items || []).map((x) => ({
    periodo, desde, hasta,
    producto: String(x.producto || ""), categoria: String(x.categoria || ""),
    cantidad: N(x.cantidad), venta: N(x.venta),
  }));
  const { error } = await supabase.from("productos_venta").insert(rows);
  if (error) throw new Error(error.message);
  return { periodo, desde, hasta, prod: rows.length };
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
    return [`✅ (PDF) Productos ${out.periodo} · ${out.prod} productos`];
  }
  if (data.tipo === "variantes") {
    const semana = data.desde
      ? (() => { const wk = semanaDe(data.desde); return { desde: wk.desde, hasta: wk.hasta, periodo: labelRango(wk.desde, wk.hasta) }; })()
      : semanaBackup;
    const vrows = (data.items || []).map((v) => ({
      producto: String(v.producto || ""), grupo: String(v.grupo || ""),
      opcion: String(v.opcion || ""), unidades: N(v.unidades), venta: N(v.venta),
    }));
    const out = await importarVariantes(vrows, semana);
    if (out.comoProductos) return [`✅ (PDF) Venta por producto ${out.periodo} · ${out.filas} productos (reporte por categoría — no toqué el desglose por variante)`];
    return [`✅ (PDF) Variantes ${out.periodo} · ${out.filas} líneas platillo/variante`];
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
      <h2>Importar de Parrot</h2>
      <p class="sub" style="margin-top:0">Sube los archivos que descargas de Parrot:
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
    res.innerHTML = `<div class="sub" style="margin-top:12px">Leyendo ${files.length} archivo(s)…</div>`;

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

    const logs = [];
    let semanaRef = null;
    for (const it of items) {
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
          logs.push(`⚠️ ${it.f.name}: no reconocí el formato (¿es un export de Parrot?)`);
        }
      } catch (err) {
        logs.push(`❌ ${it.f.name}: ${(err && err.message) || err}`);
      }
    }
    const okN = logs.filter((l) => l.startsWith("✅")).length;
    const malN = logs.length - okN;
    if (okN) await store.recargarVentas();

    let pie;
    if (okN && !malN) {
      pie = `<div class="ok-box" style="margin-top:12px">Listo. Se cargaron ${okN} archivo(s). Ya se actualizaron Resumen y Productos.</div>`;
    } else if (okN && malN) {
      pie = `<div class="aviso-box" style="margin-top:12px">Se cargaron ${okN}, pero ${malN} no (revisa los ❌ de arriba). Lo que sí entró ya se actualizó.</div>`;
    } else {
      pie = `<div class="error-box" style="margin-top:12px">No se cargó ningún archivo. Revisa los ❌ de arriba.</div>`;
    }
    res.innerHTML =
      `<div style="margin-top:14px">${logs.map((l) => `<div style="font-size:13px;padding:6px 0;border-bottom:1px solid var(--linea)">${l}</div>`).join("")}</div>
       ${pie}`;
    e.target.value = "";
  });
}
