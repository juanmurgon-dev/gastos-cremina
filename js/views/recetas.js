// Pantalla: Recetas — FICHA TÉCNICA Y COSTEO.
//   Cada ingrediente es una tarjeta: cantidad bruta, unidad y merma (→ cantidad neta).
//   costo   = Σ (cantidad bruta × precio de compra, con conversión de unidades)
//   margen  = precio de venta (sin IVA) − costo por porción
// Soporta PREPARACIONES base (subrecetas) que se reusan en varios platillos.
// Al guardar, escribe el costo en costos_platillo → el Margen se actualiza solo.
import * as store from "../store.js";
import { money } from "../store.js";
import { parsearCSV, descargarCSV } from "../csv.js";

const num = (x) => { const n = parseFloat(x); return isNaN(n) ? 0 : n; };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const colorMargen = (pct) => pct == null ? "var(--sub)" : pct >= 65 ? "var(--verde)" : pct >= 45 ? "#c9740a" : "var(--rojo)";
const colorFood = (pct) => pct == null ? "var(--sub)" : pct <= 35 ? "var(--verde)" : pct <= 50 ? "#c9740a" : "var(--rojo)";
const IVA = 0.16; // precio de venta al público asumido con IVA; food cost sobre precio neto
const redondo = (n) => Math.round(n * 100) / 100;

// Reduce una foto (para que pese poco antes de guardarla en base64).
function comprimirImagen(file, max = 700) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > max || height > max) { const s = max / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); }
        const c = document.createElement("canvas"); c.width = width; c.height = height;
        c.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(c.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = reject; img.src = r.result;
    };
    r.onerror = reject; r.readAsDataURL(file);
  });
}

// Platillos (de productos_venta), agregados por nombre, con su precio de venta.
function platillos() {
  const m = new Map();
  for (const p of store.state.productos || []) {
    const nom = (p.producto || "").trim();
    if (!nom) continue;
    if (!m.has(nom)) m.set(nom, { producto: nom, categoria: p.categoria || "", venta: 0, cantidad: 0 });
    const o = m.get(nom); o.venta += num(p.venta); o.cantidad += num(p.cantidad);
  }
  // También los platillos que ya tienen receta aunque no estén en las ventas (importados o creados a mano).
  for (const r of store.state.recetas || []) {
    if (r.es_preparacion) continue;
    const nom = (r.producto || "").trim();
    if (nom && !m.has(nom)) m.set(nom, { producto: nom, categoria: "", venta: 0, cantidad: 0 });
  }
  const base = [...m.values()].map((o) => {
    const fcat = (store.fichaDe(o.producto) || {}).categoria;   // la categoría de la ficha tiene prioridad
    return { ...o, categoria: fcat || o.categoria || "", precio: o.cantidad > 0 ? o.venta / o.cantidad : 0 };
  });
  // Variantes (del grupo modificador del POS): una entrada por opción → "Platillo · Opción".
  const variantes = [];
  for (const p of base) {
    for (const v of store.variantesDe(p.producto)) {
      variantes.push({
        producto: `${p.producto} · ${v.opcion}`, categoria: p.categoria,
        venta: v.venta, cantidad: v.unidades, precio: v.precio,
        esVariante: true, base: p.producto, opcion: v.opcion,
      });
    }
  }
  // Evita duplicados: si un nombre ya se genera como variante (ej. "Chilaquiles · Rojos"),
  // no lo repitas como platillo base (pasaba con las recetas cargadas con ese nombre).
  const nombresVariante = new Set(variantes.map((v) => v.producto));
  const baseSinDup = base.filter((b) => !nombresVariante.has(b.producto));
  return [...baseSinDup, ...variantes].sort((a, b) => b.venta - a.venta);
}
// Categorías distintas de los platillos (para el filtro).
function categoriasPlatillos() {
  const set = new Set();
  for (const p of platillos()) if (p.categoria) set.add(p.categoria);
  return [...set].sort((a, b) => a.localeCompare(b, "es"));
}

// Preparaciones base existentes (recetas con es_preparacion).
function preparaciones() {
  const set = new Set();
  for (const r of store.state.recetas || []) if (r.es_preparacion) set.add(r.producto);
  return [...set].sort();
}

// Agrupa las filas de un CSV en recetas. Una fila por ingrediente; se agrupan por 'platillo'.
function gruposDesdeCSV(objs) {
  if (!objs.length) return [];
  // Formato ANCHO: una fila por platillo, con columnas "insumo 1", "cantidad 1", "unidad 1", "subreceta 1"…
  if (Object.keys(objs[0]).some((c) => /^insumo\s*\d/.test(c) || /^subreceta\s*\d/.test(c))) return gruposDesdeAncho(objs);
  // Formato LARGO: una fila por ingrediente (columnas platillo, insumo, cantidad, unidad…)
  const n2 = (x) => { const n = parseFloat(String(x).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; };
  const esSi = (v) => /^(s[ií]|1|true|x|yes)$/i.test(String(v || "").trim());
  const map = new Map();
  for (const o of objs) {
    const prod = (o.platillo || o.receta || o.producto || "").trim();
    const insumo = (o.insumo || o.ingrediente || "").trim();
    if (!prod || !insumo) continue;
    if (!map.has(prod)) map.set(prod, { producto: prod, es_preparacion: false, rendimiento: 1, rinde_unidad: "", porciones: 1, items: [] });
    const g = map.get(prod);
    if (esSi(o.es_preparacion || o.preparacion || o.subreceta)) g.es_preparacion = true;
    if (o.rendimiento) g.rendimiento = n2(o.rendimiento) || 1;
    if (o.porciones) g.porciones = n2(o.porciones) || 1;
    const ru = (o.rinde_unidad || o.unidad_rinde || o.unidad_preparacion || "").trim();
    if (ru) g.rinde_unidad = ru;
    g.items.push({ insumo, cantidad: n2(o.cantidad), unidad: (o.unidad || "").trim(), merma: n2(o.merma) });
  }
  return [...map.values()];
}

// Formato ANCHO: una fila por platillo. Insumos en tríos (insumo/cantidad/unidad) y subrecetas en pares (subreceta/cantidad).
function gruposDesdeAncho(objs) {
  const n2 = (x) => { const n = parseFloat(String(x).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; };
  const g1 = (o, ...ks) => { for (const k of ks) if (o[k] != null && String(o[k]).trim() !== "") return String(o[k]).trim(); return ""; };
  const grupos = [];
  for (const o of objs) {
    const producto = g1(o, "producto", "platillo", "nombre", "receta");
    if (!producto) continue;
    const grupo = { producto, es_preparacion: false, rendimiento: 1, rinde_unidad: "", porciones: n2(o.porciones) || 1, items: [] };
    for (let i = 1; i <= 30; i++) {
      const ins = g1(o, `insumo ${i}`, `insumo${i}`);
      if (ins) grupo.items.push({ insumo: ins, cantidad: n2(g1(o, `cantidad ${i}`, `cant ${i}`, `cantidad${i}`)), unidad: g1(o, `unidad ${i}`, `unidad${i}`) });
      const sub = g1(o, `subreceta ${i}`, `subreceta${i}`);
      if (sub) grupo.items.push({ insumo: sub, cantidad: n2(g1(o, `cantidad sub ${i}`, `cant sub ${i}`)) || 1, unidad: "porción" });
    }
    if (grupo.items.length) grupos.push(grupo);
  }
  return grupos;
}

// Descarga un CSV con el formato correcto y ejemplos, para armar las recetas ahí.
function descargarPlantilla() {
  // Formato ANCHO: una fila por platillo. Cada insumo con su cantidad y unidad; subrecetas al final.
  descargarCSV("plantilla-recetas-platify",
    ["producto", "porciones", "insumo 1", "cantidad 1", "unidad 1", "insumo 2", "cantidad 2", "unidad 2", "insumo 3", "cantidad 3", "unidad 3", "subreceta 1", "cantidad sub 1"],
    [
      ["Latte", "1", "leche", "12", "oz", "", "", "", "", "", "", "espresso", "1"],
      ["Omelette de Carnes", "1", "huevo", "120", "g", "queso monterrey", "80", "g", "chorizo", "20", "g", "", ""],
    ]
  );
}

// Exporta TODAS las recetas en formato de tabla: una fila por platillo, con sus
// insumos y subrecetas en columnas, y el costo por porción al final.
function descargarTablaRecetas() {
  const r2 = (n) => Math.round((num(n) || 0) * 100) / 100;
  const conReceta = platillos().filter((p) => store.recetasDe(p.producto).length);
  if (!conReceta.length) { alert("Aún no hay recetas para exportar. Captura o importa recetas primero."); return; }
  let maxIns = 0, maxSub = 0;
  const datos = conReceta.map((p) => {
    const ins = [], sub = [];
    for (const rr of store.recetasDe(p.producto)) { (store.tieneReceta(rr.insumo) ? sub : ins).push(rr); }
    maxIns = Math.max(maxIns, ins.length); maxSub = Math.max(maxSub, sub.length);
    return { p, ins, sub };
  });
  const enc = ["producto", "porciones"];
  for (let i = 1; i <= maxIns; i++) enc.push(`insumo ${i}`, `cantidad ${i}`, `unidad ${i}`);
  for (let i = 1; i <= maxSub; i++) enc.push(`subreceta ${i}`, `cantidad sub ${i}`);
  enc.push("costo por porción");
  const filas = datos.map(({ p, ins, sub }) => {
    const row = [p.producto, store.porcionesDe(p.producto)];
    for (let i = 0; i < maxIns; i++) { const r = ins[i]; row.push(r ? r.insumo : "", r ? r2(r.cantidad) : "", r ? (r.unidad || "") : ""); }
    for (let i = 0; i < maxSub; i++) { const r = sub[i]; row.push(r ? r.insumo : "", r ? r2(r.cantidad) : ""); }
    row.push(r2(store.costoDeReceta(p.producto) / (store.porcionesDe(p.producto) || 1)).toFixed(2));
    return row;
  });
  descargarCSV("recetas-tabla-platify", enc, filas);
}

export function render(el) {
  let sub = "platillos";   // platillos | preparaciones
  let editando = null;     // { nombre, esPrep }
  const stPrep = { filtro: "todas" };   // filtro de la lista de preparaciones

  function shell() {
    el.innerHTML = `
      <div class="segmented" style="font-size:13px">
        <button data-s="platillos">Platillos</button>
        <button data-s="preparaciones">Preparaciones</button>
      </div>
      <div id="rsub"></div>`;
    el.querySelectorAll(".segmented button").forEach((b) => {
      b.classList.toggle("act", b.dataset.s === sub);
      b.addEventListener("click", () => { sub = b.dataset.s; editando = null; shell(); });
    });
    pintar();
  }

  function pintar() {
    const cont = el.querySelector("#rsub");
    if (editando) return editor(cont, editando.nombre, editando.esPrep);
    if (sub === "platillos") return listaPlatillos(cont);
    return listaPreparaciones(cont);
  }

  // ───────────── Lista de platillos ─────────────
  function listaPlatillos(cont) {
    const st = { q: "", cat: "todas", filtro: "todas", orden: "venta" };
    // Métricas de un platillo: costo por porción, food cost, margen y ALERTA de datos dudosos.
    function metrica(p, costos) {
      const tiene = store.recetasDe(p.producto).length > 0;
      const costo = costos.has(p.producto) ? costos.get(p.producto) : null;   // costo por porción (recalcularTodos)
      const neto = p.precio > 0 ? p.precio / (1 + IVA) : 0;
      const foodPct = tiene && costo != null && costo > 0 && neto > 0 ? costo / neto * 100 : null;
      const margPct = tiene && costo != null && neto > 0 ? (neto - costo) / neto * 100 : null;
      let nSin = 0, nTot = 0;
      if (tiene) for (const rr of store.recetasDe(p.producto)) { nTot++; if (!store.costoLinea(rr.insumo, rr.cantidad, rr.unidad)) nSin++; }
      let alerta = null;
      if (tiene) {
        if (costo == null || costo <= 0) alerta = "Sin costo: ningún ingrediente tiene precio";
        else if (margPct != null && margPct < 0) alerta = "Margen negativo — revisa unidades o precios";
        else if (foodPct != null && foodPct > 60) alerta = `Food cost ${foodPct.toFixed(0)}% — muy alto, probable error`;
        else if (nSin > 0) alerta = `Faltan ${nSin} de ${nTot} ingredientes por costear`;
      }
      const completa = tiene ? !!(store.fichaDe(p.producto) || {}).completa : false;
      return { tiene, costo, neto, foodPct, margPct, alerta, completa };
    }
    // Métricas costosas (costeo de cada receta): se calculan UNA sola vez al
    // entrar, NO en cada tecla. Así el buscador solo filtra/repinta la lista.
    const costos = store.mapaCostos();
    const filas0 = platillos().map((p) => ({ p, m: metrica(p, costos) }));
    const totCon = filas0.filter((x) => x.m.tiene).length;
    const totSin = filas0.length - totCon;
    const totRev = filas0.filter((x) => x.m.alerta).length;
    const totOk = filas0.filter((x) => x.m.completa).length;
    const cats = categoriasPlatillos();

    cont.innerHTML = `
      <div class="card">
        <h2 style="margin-bottom:2px">Fichas técnicas</h2>
        <p class="sub" style="margin-top:0">📝 Con receta: <b>${totCon}</b> · ✅ Terminadas: <b>${totOk}</b> · ➕ Falta: <b>${totSin}</b> · <span style="color:var(--rojo)">⚠️ Revisar: <b>${totRev}</b></span></p>
        <div class="fila" style="gap:8px;margin:8px 0 4px;flex-wrap:wrap">
          <button class="btn sec chico" id="impcsv" style="flex:1">⬆ Importar CSV</button>
          <button class="btn sec chico" id="plantilla" style="flex:1">⬇ Formato vacío</button>
          <button class="btn sec chico" id="exptabla" style="flex:1 1 100%">⬇ Descargar recetas (tabla)</button>
        </div>
        <input type="file" id="fcsv" accept=".csv,text/csv" style="display:none" />
        <input id="bq" placeholder="Buscar platillo…" style="margin:6px 0 8px" value="" />
        <div id="chips" class="fila" style="gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:8px"></div>
        <div class="fila" style="gap:8px">
          <select id="fcat" style="flex:1;margin-bottom:12px">
            <option value="todas">Todas las categorías</option>
            ${cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
          </select>
          <select id="forden" style="flex:1;margin-bottom:12px">
            <option value="venta">↕ Más vendido</option>
            <option value="costo">💲 Más costoso</option>
            <option value="margen">📈 Mejor margen</option>
            <option value="margenPeor">📉 Peor margen</option>
          </select>
        </div>
        <div id="lista"></div>
      </div>`;

    const listaEl = cont.querySelector("#lista");
    const chipsEl = cont.querySelector("#chips");
    const chip = (id, txt) => `<button class="fchip" data-f="${id}" style="border:1px solid var(--linea);background:${st.filtro === id ? "var(--verde)" : "#fff"};color:${st.filtro === id ? "#fff" : "var(--txt,#222)"};border-radius:999px;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex:0 0 auto">${txt}</button>`;

    function pintarChips() {
      chipsEl.innerHTML = chip("todas", `Todas (${filas0.length})`) + chip("con", `📝 Con receta (${totCon})`) + chip("ok", `✅ Terminadas (${totOk})`) + chip("sin", `➕ Falta (${totSin})`) + chip("revisar", `⚠️ Revisar (${totRev})`);
      chipsEl.querySelectorAll(".fchip").forEach((c) => c.addEventListener("click", () => { st.filtro = c.dataset.f; pintarChips(); pintarLista(); }));
    }
    function pintarLista() {
      const q = st.q.trim().toLowerCase();
      let arr = filas0.filter(({ p }) => (!q || p.producto.toLowerCase().includes(q)) && (st.cat === "todas" || (p.categoria || "") === st.cat));
      if (st.filtro === "con") arr = arr.filter((x) => x.m.tiene);
      else if (st.filtro === "ok") arr = arr.filter((x) => x.m.completa);
      else if (st.filtro === "sin") arr = arr.filter((x) => !x.m.tiene);
      else if (st.filtro === "revisar") arr = arr.filter((x) => x.m.alerta);
      arr = arr.slice();
      if (st.orden === "costo") arr.sort((a, b) => (b.m.costo == null ? -Infinity : b.m.costo) - (a.m.costo == null ? -Infinity : a.m.costo));
      else if (st.orden === "margen") arr.sort((a, b) => (b.m.margPct == null ? -Infinity : b.m.margPct) - (a.m.margPct == null ? -Infinity : a.m.margPct));
      else if (st.orden === "margenPeor") arr.sort((a, b) => (a.m.margPct == null ? Infinity : a.m.margPct) - (b.m.margPct == null ? Infinity : b.m.margPct));
      else arr.sort((a, b) => (b.p.venta || 0) - (a.p.venta || 0));
      listaEl.innerHTML = !arr.length ? `<div class="vacio">No hay platillos con ese filtro.</div>` : arr.map(({ p, m }) => {
        const tiene = m.tiene, costo = m.costo, margPct = m.margPct;
        return `
          <button class="fila-item" data-p="${esc(p.producto)}" style="width:100%;text-align:left;background:none;border:none;border-bottom:1px solid var(--linea);padding:12px 2px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px">
            <span style="min-width:0">
              <b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${m.completa ? "✅ " : (m.alerta ? "⚠️ " : "")}${esc(p.producto)}</b>
              <span class="sub" style="font-size:12px">${p.esVariante ? "🔸 variante · " : ""}${esc(p.categoria || "")}${p.precio ? " · vende " + money(p.precio) : ""}</span>
              ${m.alerta ? `<span class="sub" style="font-size:11px;color:var(--rojo);display:block;white-space:normal">${esc(m.alerta)}</span>` : ""}
            </span>
            <span style="text-align:right;white-space:nowrap">
              ${tiene && costo != null
                ? `<span class="monto" style="font-size:14px">${money(costo)}</span><br><span class="sub" style="font-size:11.5px;color:${colorMargen(margPct)};font-weight:700">${margPct != null ? "margen " + margPct.toFixed(0) + "%" : ""}</span>`
                : `<span class="sub" style="font-size:12px;color:var(--rojo)">Sin receta →</span>`}
            </span>
          </button>`;
      }).join("");
      listaEl.querySelectorAll(".fila-item").forEach((b) => b.addEventListener("click", () => { editando = { nombre: b.dataset.p, esPrep: false }; pintar(); }));
    }

    // Eventos de los controles: se enganchan UNA vez; el input no se recrea al teclear.
    const bq = cont.querySelector("#bq");
    bq.addEventListener("input", () => { st.q = bq.value; pintarLista(); });
    cont.querySelector("#fcat").addEventListener("change", (e) => { st.cat = e.target.value; pintarLista(); });
    cont.querySelector("#forden").addEventListener("change", (e) => { st.orden = e.target.value; pintarLista(); });
    cont.querySelector("#plantilla").addEventListener("click", descargarPlantilla);
    cont.querySelector("#exptabla").addEventListener("click", descargarTablaRecetas);
    const fcsv = cont.querySelector("#fcsv");
    cont.querySelector("#impcsv").addEventListener("click", () => fcsv.click());
    fcsv.addEventListener("change", async () => {
      const file = fcsv.files[0]; if (!file) return;
      const btn = cont.querySelector("#impcsv"); if (btn) btn.textContent = "Importando…";
      try {
        const grupos = gruposDesdeCSV(parsearCSV(await file.text()));
        if (!grupos.length) alert("No encontré recetas en el CSV. Debe tener columnas 'platillo' e 'insumo'. Usa 'Descargar formato'.");
        else { const n = await store.importarRecetas(grupos); alert(`Listo: ${n} recetas/subrecetas importadas.`); pintar(); return; }
      } catch (e) { alert("Error al importar: " + (e.message || e)); }
      fcsv.value = ""; const b2 = cont.querySelector("#impcsv"); if (b2) b2.textContent = "⬆ Importar CSV";
    });

    pintarChips();
    pintarLista();
  }

  // ───────────── Lista de preparaciones ─────────────
  function listaPreparaciones(cont) {
    const preps = preparaciones();
    const lista = preps.map((nom) => ({ nom, completa: !!(store.fichaDe(nom) || {}).completa }));
    const listas = lista.filter((x) => x.completa).length;
    const faltan = lista.length - listas;

    cont.innerHTML = `
      <div class="card">
        <h2 style="margin-bottom:2px">Preparaciones base</h2>
        <p class="sub" style="margin-top:0">Salsas, masas, aderezos… que usas en varios platillos. Se costean una vez y se reutilizan como un insumo más.</p>
        ${lista.length ? `<p class="sub" style="margin:6px 0 0">✅ Terminadas: <b>${listas}</b> · ⏳ En proceso: <b>${faltan}</b></p>` : ""}
        <button class="btn" id="nueva" style="margin:8px 0 12px">＋ Nueva preparación</button>
        ${lista.length ? `<div id="chipsP" class="fila" style="gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:8px"></div>` : ""}
        <div id="lp"></div>
      </div>`;

    const lp = cont.querySelector("#lp");
    const chipsEl = cont.querySelector("#chipsP");
    const chip = (id, txt) => `<button class="pchip" data-f="${id}" style="border:1px solid var(--linea);background:${stPrep.filtro === id ? "var(--verde)" : "#fff"};color:${stPrep.filtro === id ? "#fff" : "var(--txt,#222)"};border-radius:999px;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex:0 0 auto">${txt}</button>`;

    function pintarChips() {
      if (!chipsEl) return;
      chipsEl.innerHTML = chip("todas", `Todas (${lista.length})`) + chip("ok", `✅ Terminadas (${listas})`) + chip("falta", `⏳ En proceso (${faltan})`);
      chipsEl.querySelectorAll(".pchip").forEach((c) => c.addEventListener("click", () => { stPrep.filtro = c.dataset.f; pintarChips(); pintarLista(); }));
    }

    function pintarLista() {
      let arr = lista;
      if (stPrep.filtro === "ok") arr = arr.filter((x) => x.completa);
      else if (stPrep.filtro === "falta") arr = arr.filter((x) => !x.completa);

      if (!preps.length) { lp.innerHTML = `<div class="vacio">Aún no hay preparaciones. Crea una si tienes recetas base (ej. "Salsa verde").</div>`; return; }
      if (!arr.length) { lp.innerHTML = `<div class="vacio">Ninguna preparación con ese filtro.</div>`; return; }

      lp.innerHTML = arr.map(({ nom, completa }) => {
        const fila = store.state.recetas.find((r) => r.producto === nom && r.es_preparacion) || {};
        const rend = fila.rendimiento || 1;
        const unidad = store.unidadPreparacion(nom);
        // La casilla marca terminada/en proceso sin abrir la receta; el resto de
        // la fila sigue abriendo la ficha. Son dos botones para no anidarlos.
        return `
          <div style="display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--linea);padding:6px 2px">
            <button class="chkPrep" data-p="${esc(nom)}" aria-pressed="${completa}"
              title="${completa ? "Terminada — toca para marcarla en proceso" : "En proceso — toca para marcarla terminada"}"
              style="flex:0 0 auto;width:26px;height:26px;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1;padding:0;
                     border:1.5px solid ${completa ? "var(--verde)" : "var(--linea)"};background:${completa ? "var(--verde)" : "#fff"};color:#fff">${completa ? "✓" : ""}</button>
            <button class="abrirPrep" data-p="${esc(nom)}" style="flex:1;min-width:0;text-align:left;background:none;border:none;padding:8px 0;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px">
              <span style="min-width:0">
                <b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(nom)}</b>
                <span class="sub" style="font-size:12px">rinde ${esc(String(rend))} ${esc(unidad)}${completa ? "" : " · ⏳ en proceso"}</span>
              </span>
              <span class="monto" style="font-size:14px;white-space:nowrap">${money(store.costoInsumo(nom))}${unidad ? `<span class="sub" style="font-weight:400">/${esc(unidad)}</span>` : ""}</span>
            </button>
          </div>`;
      }).join("");

      lp.querySelectorAll(".abrirPrep").forEach((b) =>
        b.addEventListener("click", () => { editando = { nombre: b.dataset.p, esPrep: true }; pintar(); }));

      lp.querySelectorAll(".chkPrep").forEach((b) => b.addEventListener("click", async () => {
        const nom = b.dataset.p;
        b.disabled = true;
        try {
          // guardarFicha reemplaza la fila entera: hay que mandar la ficha
          // completa con el flag volteado, o se borrarían pasos y foto.
          const f = store.fichaDe(nom);
          await store.guardarFicha(nom, { ...f, completa: !f.completa });
          pintar();
        } catch (e) {
          b.disabled = false;
          alert("No pude guardarlo: " + ((e && e.message) || e));
        }
      }));
    }

    cont.querySelector("#nueva").addEventListener("click", () => { editando = { nombre: "", esPrep: true }; pintar(); });
    pintarChips();
    pintarLista();
  }

  // ───────────── Ficha técnica (editor) ─────────────
  function editor(cont, nombre, esPrep) {
    const existentes = nombre ? store.recetasDe(nombre) : [];
    const filaPrep = esPrep && nombre ? store.state.recetas.find((r) => r.producto === nombre && r.es_preparacion) : null;
    const plat = !esPrep ? platillos().find((p) => p.producto === nombre) : null;
    const fichaAct = nombre ? store.fichaDe(nombre) : { categoria: "", tiempo: 0, procedimiento: "", pasos: [], foto: "" };

    let items = existentes.map((r) => ({ insumo: r.insumo, cantidad: r.cantidad, unidad: r.unidad || "", merma: r.merma || "", modo: store.tieneReceta(r.insumo) ? "subreceta" : "insumo" }));
    if (!items.length) items = [{ insumo: "", cantidad: "", unidad: "", merma: "", modo: "insumo" }];
    let nom = nombre || "";
    let rendimiento = filaPrep ? filaPrep.rendimiento : 1;
    let unidadRinde = esPrep && nombre ? store.unidadPreparacion(nombre) : "";
    let porciones = !esPrep && nombre ? store.porcionesDe(nombre) : 1;
    let objetivo = 70;   // % de margen deseado (sobre precio neto)
    let categoria = fichaAct.categoria || (plat ? plat.categoria : "");
    let tiempo = fichaAct.tiempo || "";
    let pasos = Array.isArray(fichaAct.pasos) && fichaAct.pasos.length
      ? fichaAct.pasos.map((p) => ({ descripcion: p.descripcion || "", tiempo: p.tiempo || "" }))
      : String(fichaAct.procedimiento || "").split(/\n/).map((s) => s.trim()).filter(Boolean).map((d) => ({ descripcion: d, tiempo: "" }));
    let foto = fichaAct.foto || "";
    let numero = fichaAct.numero || "";
    let observaciones = fichaAct.observaciones || "";
    let completa = !!fichaAct.completa;   // el usuario la marcó como terminada/verificada
    let pasoTmp = { descripcion: "", tiempo: "" };

    const precioVenta = plat ? plat.precio : 0;
    const insumosLista = store.preciosPorInsumo();
    // El autocompletar incluye también los ingredientes del Registro Maestro.
    const nombresTodos = [...new Set([...insumosLista.map((i) => i.nombre), ...(store.state.ingredientesMaestro || []).map((x) => x.nombre)])];
    const datalist = `<datalist id="dl-insumos">${nombresTodos.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;
    // Unidades medibles sugeridas (peso, volumen, conteo). Se convierten al costear.
    const dlUnidades = `<datalist id="dl-unidades">${["g", "kg", "mg", "oz", "lb", "ml", "l", "taza", "cda", "cdta", "fl oz", "pza", "docena"].map((u) => `<option value="${u}">`).join("")}</datalist>`;
    // Componentes que se pueden agregar como subreceta: preparaciones + platillos que ya tienen receta.
    const prepsDisp = () => {
      const set = new Set(preparaciones());
      for (const r of store.state.recetas || []) if (!r.es_preparacion && r.producto) set.add(r.producto);
      return [...set].filter((p) => p && p !== nombre && p !== nom).sort();
    };
    const unidadDe = (insumo) => store.maestroDe(insumo) ? "g" : store.sugerirUnidadReceta(store.unidadInsumo(insumo));

    function draw() {
      const costoTotal = items.reduce((a, it) => a + store.costoLinea(it.insumo, it.cantidad, it.unidad || unidadDe(it.insumo)), 0);
      const costoUnit = esPrep && num(rendimiento) > 0 ? costoTotal / num(rendimiento) : costoTotal;
      const nPorc = num(porciones) > 0 ? num(porciones) : 1;
      const costoPorcion = costoTotal / nPorc;
      const precioNeto = precioVenta / (1 + IVA);
      const margen = precioNeto - costoPorcion;
      const margPct = precioNeto > 0 ? margen / precioNeto * 100 : null;
      const foodPct = precioNeto > 0 ? costoPorcion / precioNeto * 100 : null;
      // Precio sugerido por % de MARGEN (sobre precio neto): precio_neto = costo / (1 − margen%).
      const mgObj = num(objetivo);
      const sugConIva = (mgObj > 0 && mgObj < 100 ? costoPorcion / (1 - mgObj / 100) : 0) * (1 + IVA);

      cont.innerHTML = `
        ${datalist}${dlUnidades}
        <div class="card">
          <button class="btn sec chico" id="volver" style="margin-bottom:10px">← Volver</button>

          <div class="sub" style="font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--verde);font-weight:700">Ficha técnica</div>
          <label class="campo" style="margin-top:6px"><span>Nº de receta</span><input id="num" placeholder="Ej. S1" value="${esc(numero)}" style="max-width:160px" /></label>
          ${esPrep
            ? `<label class="campo"><span>Nombre de la preparación</span><input id="nom" placeholder="Ej. Salsa verde" value="${esc(nom)}" /></label>
               <div class="fila" style="gap:8px">
                 <label class="campo" style="flex:1;margin:0"><span>Rinde</span><input id="rend" type="number" inputmode="decimal" min="0" step="any" value="${esc(String(rendimiento))}" /></label>
                 <label class="campo" style="flex:1;margin:0"><span>Unidad</span><input id="urinde" placeholder="L, kg, pza" value="${esc(unidadRinde)}" /></label>
               </div>`
            : `<h2 style="margin:2px 0 2px">${esc(nombre)}</h2>
               <p class="sub" style="margin:0 0 8px">${precioVenta ? "Se vende en " + money(precioVenta) + " c/IVA" : "Sin precio de venta registrado"}</p>
               <label class="campo"><span>Categoría</span><input id="cat" placeholder="Entrada / Plato fuerte / Postre…" value="${esc(categoria)}" /></label>
               <div class="fila" style="gap:8px">
                 <label class="campo" style="flex:1;margin:0"><span>Rinde (porciones)</span><input id="porc" type="number" min="1" step="any" value="${esc(String(porciones))}" /></label>
                 <label class="campo" style="flex:1;margin:0"><span>Tiempo (min)</span><input id="tiempo" type="number" min="0" step="any" placeholder="0" value="${esc(String(tiempo))}" /></label>
               </div>`}

          <div style="margin-top:14px;font-weight:700;font-size:13px">Ingredientes</div>
          <div id="rows"></div>
          <div class="fila" style="gap:8px;margin-top:10px">
            <button class="btn sec chico" id="add" style="flex:1">＋ Ingrediente</button>
            <button class="btn sec chico" id="addprep" style="flex:1"${prepsDisp().length ? "" : " disabled"}>＋ Subreceta</button>
          </div>

          <div style="margin-top:18px;border-top:1px solid var(--linea);padding-top:12px">
            <div class="sub" style="font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--verde);font-weight:700;margin-bottom:6px">Desglose financiero</div>
            <div class="fila" style="justify-content:space-between"><span class="sub">Costo de la receta</span><b>${money(costoTotal)}</b></div>
            ${esPrep
              ? `<div class="fila" style="justify-content:space-between"><span class="sub">Costo por ${esc(unidadRinde || "unidad")}</span><b>${money(costoUnit)}</b></div>`
              : `<div class="fila" style="justify-content:space-between"><span class="sub">Costo por porción</span><b>${money(costoPorcion)}</b></div>
                 <div class="fila" style="justify-content:space-between"><span class="sub">Precio venta (s/IVA)</span><b>${money(precioNeto)}</b></div>
                 <div class="fila" style="justify-content:space-between"><span class="sub">Food cost</span><b style="color:${colorFood(foodPct)}">${foodPct != null ? foodPct.toFixed(0) + "%" : "—"}</b></div>
                 <div class="fila" style="justify-content:space-between"><span class="sub">Margen por porción</span><b style="color:${colorMargen(margPct)}">${money(margen)}${margPct != null ? " · " + margPct.toFixed(0) + "%" : ""}</b></div>
                 <div class="fila" style="justify-content:space-between;align-items:center;margin-top:6px;border-top:1px dashed var(--linea);padding-top:8px">
                   <span class="sub">Precio sugerido a <input id="obj" type="number" min="1" max="95" value="${esc(String(objetivo))}" style="width:42px;padding:2px 4px;text-align:center;font-size:12px" />% de margen</span>
                   <b style="color:var(--verde)">${money(sugConIva)}<span class="sub" style="font-weight:400"> c/IVA</span></b>
                 </div>`}
          </div>

          <div style="margin-top:18px;border-top:1px solid var(--linea);padding-top:12px">
            <div class="sub" style="font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--verde);font-weight:700;margin-bottom:6px">Foto del platillo</div>
            <label style="display:block;border:2px dashed var(--linea);border-radius:12px;padding:14px;text-align:center;cursor:pointer">
              <input type="file" id="foto" accept="image/*" style="display:none" />
              ${foto ? `<img src="${foto}" alt="platillo" style="max-width:100%;max-height:220px;border-radius:10px" />` : `<span class="sub">📸 Toca para subir una foto</span>`}
            </label>
            ${foto ? `<button class="btn sec chico" id="quitarFoto" style="margin-top:8px;color:var(--rojo)">Quitar foto</button>` : ""}
          </div>

          <div style="margin-top:18px;border-top:1px solid var(--linea);padding-top:12px">
            <div class="sub" style="font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--verde);font-weight:700;margin-bottom:6px">Procedimiento (pasos)</div>
            <div id="pasos"></div>
            <div class="fila" style="gap:6px;margin-top:8px;align-items:flex-start">
              <textarea id="pasoDesc" rows="2" placeholder="Describe el paso…" style="flex:1;font-family:inherit;font-size:14px;padding:8px;border-radius:10px;border:1px solid var(--linea);resize:vertical">${esc(pasoTmp.descripcion)}</textarea>
              <input id="pasoMin" type="number" min="0" placeholder="min" value="${esc(String(pasoTmp.tiempo))}" style="width:52px;text-align:center" />
              <button class="btn sec chico" id="pasoAdd" style="flex:0 0 auto">＋ Paso</button>
            </div>
          </div>

          <div style="margin-top:18px;border-top:1px solid var(--linea);padding-top:12px">
            <div class="sub" style="font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--verde);font-weight:700;margin-bottom:6px">Observaciones</div>
            <textarea id="obs" rows="4" placeholder="Notas de preparación, almacenamiento, cuidados…" style="width:100%;font-family:inherit;font-size:14px;padding:10px;border-radius:10px;border:1px solid var(--linea);resize:vertical">${esc(observaciones)}</textarea>
          </div>

          <label id="lblCompleta" style="display:flex;align-items:center;gap:10px;margin-top:16px;padding:12px;border-radius:12px;border:1.5px solid ${completa ? "var(--verde)" : "var(--linea)"};background:${completa ? "#eafaf0" : "#fff"};cursor:pointer">
            <input type="checkbox" id="completa" ${completa ? "checked" : ""} style="width:20px;height:20px;flex:0 0 auto;accent-color:var(--verde)" />
            <span style="min-width:0"><b style="font-size:14px">✅ Receta terminada</b><br><span class="sub" style="font-size:11.5px">Márcala cuando esté 100% verificada (ingredientes, cantidades y costo correctos).</span></span>
          </label>

          <button class="btn" id="guardar" style="margin-top:12px">💾 Guardar ficha</button>
          <button class="btn sec" id="fichaPdf" style="margin-top:8px">📄 Ficha técnica (PDF)</button>
          ${existentes.length ? `<button class="btn sec chico" id="borrar" style="margin-top:6px;color:var(--rojo)">Borrar receta</button>` : ""}
          <div id="msg" class="sub" style="text-align:center;margin-top:8px;min-height:1em"></div>
        </div>`;

      // ── Tarjetas de ingredientes ──
      const rows = cont.querySelector("#rows");
      rows.innerHTML = items.map((it, i) => {
        const uLinea = it.unidad || unidadDe(it.insumo);
        const linea = store.costoLinea(it.insumo, it.cantidad, uLinea);
        const uCompra = store.unidadInsumo(it.insumo);
        const precioU = store.costoInsumo(it.insumo);
        const neta = store.cantidadNeta(it.cantidad, it.merma);
        const campo = it.modo === "subreceta"
          ? `<select class="rin" style="flex:1;min-width:0"><option value="">— elige subreceta o platillo —</option>${prepsDisp().map((p) => `<option value="${esc(p)}"${p === it.insumo ? " selected" : ""}>${esc(p)}</option>`).join("")}</select>`
          : `<input class="rin" list="dl-insumos" placeholder="Nombre del insumo" value="${esc(it.insumo)}" style="flex:1;min-width:0" />`;
        return `
          <div data-i="${i}" style="border:1px solid var(--linea);border-radius:12px;padding:12px;margin-top:10px;background:#fff">
            <div class="fila" style="gap:8px;align-items:center">
              ${campo}
              <button class="rx" title="Quitar" style="background:none;border:none;color:var(--rojo);cursor:pointer;font-size:20px;width:26px;flex:0 0 auto">×</button>
            </div>
            <div class="fila" style="gap:8px;margin-top:8px">
              <label class="campo" style="flex:1.2;margin:0"><span>Cantidad bruta</span><input class="rc" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="${esc(String(it.cantidad))}" /></label>
              <label class="campo" style="flex:.8;margin:0"><span>Unidad</span><input class="ru" list="dl-unidades" placeholder="g, kg, oz, lb, ml, taza…" value="${esc(uLinea)}" /></label>
              <label class="campo" style="flex:.8;margin:0"><span>Merma %</span><input class="rm" type="number" min="0" max="99" placeholder="0" value="${esc(String(it.merma || ""))}" /></label>
            </div>
            <div class="fila" style="justify-content:space-between;align-items:center;margin-top:8px">
              <span class="sub" style="font-size:11.5px">
                ${precioU ? money(precioU) + (uCompra ? "/" + esc(uCompra) : "") : `<span style="color:var(--rojo)">${it.insumo ? (it.modo === "subreceta" ? "esta subreceta cuesta $0 — cuéstala primero" : "sin precio de compra") : ""}</span>`}${num(it.merma) > 0 ? ` · neta ${redondo(neta)} ${esc(uLinea)}` : ""}${it.modo === "subreceta" ? " 🧪" : ""}${precioU && uLinea && it.modo !== "subreceta" && !store.unidadesCompatibles(uLinea, uCompra) ? ` <b style="color:var(--rojo)">⚠️ unidad de compra: ${esc(uCompra || "sin unidad")} — no convierte con ${esc(uLinea)}</b>` : ""}
              </span>
              <b style="font-size:15px">${linea ? money(linea) : "—"}</b>
            </div>
          </div>`;
      }).join("");

      rows.querySelectorAll("[data-i]").forEach((fila) => {
        const i = +fila.dataset.i;
        const rin = fila.querySelector(".rin"), rc = fila.querySelector(".rc"), ru = fila.querySelector(".ru"), rm = fila.querySelector(".rm");
        rin.addEventListener("change", () => { items[i].insumo = rin.value; items[i].unidad = unidadDe(rin.value); if (it.modo === "subreceta" && !num(items[i].cantidad)) items[i].cantidad = 1; draw(); });
        rin.addEventListener("blur", () => { if (items[i].insumo !== rin.value) { items[i].insumo = rin.value; items[i].unidad = unidadDe(rin.value); draw(); } });
        rc.addEventListener("input", () => { items[i].cantidad = rc.value; });
        rc.addEventListener("blur", draw);
        ru.addEventListener("input", () => { items[i].unidad = ru.value; });
        ru.addEventListener("blur", draw);
        rm.addEventListener("input", () => { items[i].merma = rm.value; });
        rm.addEventListener("blur", draw);
        fila.querySelector(".rx").addEventListener("click", () => { items.splice(i, 1); if (!items.length) items.push({ insumo: "", cantidad: "", unidad: "", merma: "", modo: "insumo" }); draw(); });
      });

      // ── Eventos generales ──
      cont.querySelector("#volver").addEventListener("click", () => { editando = null; pintar(); });
      cont.querySelector("#add").addEventListener("click", () => { items.push({ insumo: "", cantidad: "", unidad: "", merma: "", modo: "insumo" }); draw(); });
      const ap = cont.querySelector("#addprep");
      if (ap) ap.addEventListener("click", () => { items.push({ insumo: "", cantidad: 1, unidad: "", merma: "", modo: "subreceta" }); draw(); });
      // Foto
      const fotoInput = cont.querySelector("#foto");
      if (fotoInput) fotoInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0]; if (!file) return;
        try { foto = await comprimirImagen(file); draw(); } catch (err) { alert("No se pudo cargar la foto."); }
      });
      const qf = cont.querySelector("#quitarFoto");
      if (qf) qf.addEventListener("click", () => { foto = ""; draw(); });

      // Pasos numerados
      const pasosEl = cont.querySelector("#pasos");
      pasosEl.innerHTML = pasos.map((p, i) => `
        <div class="fila" style="gap:8px;align-items:flex-start;margin-bottom:6px;background:var(--paper,#f4efe2);border-radius:10px;padding:8px 10px;border-left:3px solid var(--verde)">
          <b style="color:var(--verde);font-size:12px;flex:0 0 auto">${i + 1}.</b>
          <span style="flex:1;font-size:13px">${esc(p.descripcion)}${p.tiempo ? ` <span class="sub">· ${esc(String(p.tiempo))} min</span>` : ""}</span>
          <button class="pasoDel" data-i="${i}" style="background:none;border:none;color:var(--rojo);cursor:pointer;font-size:16px;flex:0 0 auto">×</button>
        </div>`).join("");
      pasosEl.querySelectorAll(".pasoDel").forEach((b) => b.addEventListener("click", () => { pasos.splice(+b.dataset.i, 1); draw(); }));
      const pd = cont.querySelector("#pasoDesc"), pm = cont.querySelector("#pasoMin");
      pd.addEventListener("input", (e) => { pasoTmp.descripcion = e.target.value; });
      pm.addEventListener("input", (e) => { pasoTmp.tiempo = e.target.value; });
      cont.querySelector("#pasoAdd").addEventListener("click", () => {
        if (!pasoTmp.descripcion.trim()) return;
        pasos.push({ descripcion: pasoTmp.descripcion.trim(), tiempo: num(pasoTmp.tiempo) || "" });
        pasoTmp = { descripcion: "", tiempo: "" }; draw();
      });
      if (esPrep) {
        cont.querySelector("#nom").addEventListener("input", (e) => { nom = e.target.value; });
        cont.querySelector("#rend").addEventListener("input", (e) => { rendimiento = e.target.value; });
        cont.querySelector("#urinde").addEventListener("input", (e) => { unidadRinde = e.target.value; });
      } else {
        cont.querySelector("#cat").addEventListener("input", (e) => { categoria = e.target.value; });
        cont.querySelector("#tiempo").addEventListener("input", (e) => { tiempo = e.target.value; });
        const op = cont.querySelector("#porc"); op.addEventListener("input", (e) => { porciones = e.target.value; }); op.addEventListener("change", draw);
        const ob = cont.querySelector("#obj"); ob.addEventListener("input", (e) => { objetivo = e.target.value; }); ob.addEventListener("change", draw);
      }
      cont.querySelector("#num").addEventListener("input", (e) => { numero = e.target.value; });
      cont.querySelector("#obs").addEventListener("input", (e) => { observaciones = e.target.value; });
      const chkC = cont.querySelector("#completa");
      if (chkC) chkC.addEventListener("change", (e) => {
        completa = e.target.checked;
        const l = cont.querySelector("#lblCompleta");
        if (l) { l.style.borderColor = completa ? "var(--verde)" : "var(--linea)"; l.style.background = completa ? "#eafaf0" : "#fff"; }
      });
      cont.querySelector("#guardar").addEventListener("click", guardar);
      cont.querySelector("#fichaPdf").addEventListener("click", () => fichaPDF({
        nombre: (esPrep ? nom : nombre) || "Receta", numero,
        rendimiento: esPrep ? rendimiento : porciones, unidad: esPrep ? (unidadRinde || "") : "porciones",
        items, pasos, observaciones, unidadDe,
      }));
      const bb = cont.querySelector("#borrar");
      if (bb) bb.addEventListener("click", borrar);
    }

    async function guardar() {
      const destino = esPrep ? nom.trim() : nombre;
      const msg = cont.querySelector("#msg");
      if (esPrep && !destino) { msg.textContent = "Ponle nombre a la preparación."; return; }
      const limpios = items.filter((it) => it.insumo.trim() && num(it.cantidad) > 0);
      if (!limpios.length) { msg.textContent = "Agrega al menos un ingrediente con cantidad."; return; }
      msg.textContent = "Guardando…";
      try {
        const ficha = { categoria, tiempo: num(tiempo), pasos: pasos.filter((p) => p.descripcion.trim()), foto, numero, observaciones, completa };
        await store.guardarReceta(
          destino,
          limpios.map((it) => ({ insumo: it.insumo.trim(), cantidad: num(it.cantidad), unidad: it.unidad || unidadDe(it.insumo), merma: num(it.merma) || 0 })),
          esPrep
            ? { es_preparacion: true, rendimiento: num(rendimiento) || 1, rinde_unidad: unidadRinde, ficha }
            : { porciones: num(porciones) || 1, ficha }
        );
        editando = null; shell();
      } catch (e) { msg.textContent = "Error: " + (e.message || e); }
    }
    async function borrar() {
      if (!confirm("¿Borrar la receta de " + (nombre || nom) + "?")) return;
      try { await store.borrarReceta(nombre || nom); if (!esPrep) await store.borrarCostoPlatillo(nombre); editando = null; shell(); }
      catch (e) { cont.querySelector("#msg").textContent = "Error: " + (e.message || e); }
    }

    draw();
  }

  shell();
  return () => {};
}

// ── Ficha técnica en PDF (formato de cocina) con costeo desde tus tickets ──
// Carga una imagen del sitio y la devuelve como dataURL + dimensiones (para el PDF).
function cargarImagenPDF(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        resolve({ dataUrl: c.toDataURL("image/png"), w: img.naturalWidth, h: img.naturalHeight });
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function fichaPDF(data) {
  const fmtC = (n) => { const r = Math.round(num(n) * 1000) / 1000; return String(r); };
  const filas = (data.items || [])
    .filter((it) => (it.insumo || "").trim() && num(it.cantidad) > 0)
    .map((it) => {
      const uLinea = it.unidad || data.unidadDe(it.insumo);
      const importe = store.costoLinea(it.insumo, it.cantidad, uLinea);
      const cant = num(it.cantidad);
      return {
        codigo: store.codigoDeInsumo(it.insumo) || "",
        insumo: it.insumo, cantidad: cant, unidad: uLinea,
        precioUnit: cant > 0 ? importe / cant : 0, importe,
      };
    });
  const total = filas.reduce((a, f) => a + f.importe, 0);
  const d = new Date();
  const fechaTxt = `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
  const restaurante = (store.state.config.marcaNombre || store.state.orgNombre || "").trim();

  try {
    const mod = await import("https://esm.sh/jspdf@2.5.2");
    const JsPDF = mod.jsPDF || (mod.default && mod.default.jsPDF) || mod.default;
    const doc = new JsPDF({ unit: "mm", format: "a4" });
    const M = 14, W = 210, H = 297;
    const cols = [14, 36, 96, 120, 148, 172, 196];   // Código|Ingrediente|Cantidad|Un.|P.Unit|Importe
    const wm = await cargarImagenPDF("assets/platify-wordmark.png");   // branding Platify

    // Encabezado de marca: barra Platify + wordmark arriba a la izquierda.
    doc.setFillColor(14, 58, 57); doc.rect(0, 0, W, 3, "F");
    if (wm) { const ww = 22, wh = ww * wm.h / wm.w; doc.addImage(wm.dataUrl, "PNG", M, 6.5, ww, wh); }
    let y = 18;

    doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(14, 58, 57);
    doc.text(String(data.nombre || "Receta").toUpperCase(), W / 2, y, { align: "center" }); y += 6.5;
    if (restaurante) { doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(150, 145, 132); doc.text(restaurante, W / 2, y, { align: "center" }); y += 5; }
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(60, 60, 60);
    const meta = [data.numero ? "Nº " + data.numero : "", data.rendimiento ? "Rendimiento: " + fmtC(data.rendimiento) + " " + (data.unidad || "") : "", "Fecha: " + fechaTxt].filter(Boolean).join("      ·      ");
    doc.text(meta, W / 2, y, { align: "center" }); y += 6;

    // Tabla de ingredientes
    const tableTop = y, headH = 8, rowH = 7;
    doc.setFillColor(230, 236, 230); doc.rect(cols[0], y, cols[6] - cols[0], headH, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.8); doc.setTextColor(14, 58, 57);
    doc.text("CÓDIGO", cols[0] + 2, y + 5.2);
    doc.text("INGREDIENTE", cols[1] + 2, y + 5.2);
    doc.text("CANT.", cols[2] + 2, y + 5.2);
    doc.text("UN.", cols[3] + 2, y + 5.2);
    doc.text("P. UNIT.", cols[5] - 2, y + 5.2, { align: "right" });
    doc.text("IMPORTE", cols[6] - 2, y + 5.2, { align: "right" });
    y += headH;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(34, 32, 26);
    for (const f of filas) {
      doc.text(String(f.codigo).slice(0, 10), cols[0] + 2, y + 4.8);
      doc.text(String(f.insumo).slice(0, 40), cols[1] + 2, y + 4.8);
      doc.text(fmtC(f.cantidad), cols[2] + 2, y + 4.8);
      doc.text(String(f.unidad || "").slice(0, 8), cols[3] + 2, y + 4.8);
      doc.text(f.precioUnit ? money(f.precioUnit) : "—", cols[5] - 2, y + 4.8, { align: "right" });
      doc.text(f.importe ? money(f.importe) : "—", cols[6] - 2, y + 4.8, { align: "right" });
      y += rowH;
    }
    // Fila TOTAL
    doc.setFont("helvetica", "bold"); doc.setTextColor(14, 58, 57);
    doc.text("TOTAL", cols[4] + 2, y + 4.8);
    doc.text(money(total), cols[6] - 2, y + 4.8, { align: "right" });
    const costoUnidad = num(data.rendimiento) > 0 ? total / num(data.rendimiento) : 0;
    y += rowH;

    // Rejilla de la tabla
    doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.2);
    for (const cx of cols) doc.line(cx, tableTop, cx, y);
    let hy = tableTop; doc.line(cols[0], hy, cols[6], hy); hy += headH; doc.line(cols[0], hy, cols[6], hy);
    for (let i = 0; i < filas.length + 1; i++) { hy += rowH; doc.line(cols[0], hy, cols[6], hy); }

    if (costoUnidad > 0) {
      y += 5; doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110, 106, 92);
      doc.text(`Costo por ${data.unidad || "unidad"}: ${money(costoUnidad)}   (los precios salen de tus tickets)`, M, y);
    }

    const salto = (extra) => { if (y + (extra || 0) > H - 16) { doc.addPage(); y = 18; } };
    const seccion = (titulo) => {
      y += 9; salto(10);
      doc.setFont("helvetica", "bold"); doc.setFontSize(11.5); doc.setTextColor(14, 58, 57);
      doc.text(titulo, W / 2, y, { align: "center" }); y += 2;
      doc.setDrawColor(14, 58, 57); doc.setLineWidth(0.4); doc.line(M, y, W - M, y); y += 5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(34, 32, 26);
    };

    if ((data.pasos || []).length) {
      seccion("PROCEDIMIENTO");
      (data.pasos || []).forEach((p, i) => {
        const linhas = doc.splitTextToSize(`${i + 1}. ${p.descripcion}`, W - 2 * M);
        salto(linhas.length * 4.7);
        doc.text(linhas, M, y); y += linhas.length * 4.7 + 1.5;
      });
    }
    const obs = String(data.observaciones || "").split(/\n/).map((s) => s.trim()).filter(Boolean);
    if (obs.length) {
      seccion("OBSERVACIONES");
      obs.forEach((o) => {
        const linhas = doc.splitTextToSize("• " + o, W - 2 * M);
        salto(linhas.length * 4.7);
        doc.text(linhas, M, y); y += linhas.length * 4.7 + 1.5;
      });
    }

    // Pie con branding Platify (wordmark + tagline).
    if (wm) {
      const ww = 24, wh = ww * wm.h / wm.w;
      doc.addImage(wm.dataUrl, "PNG", (W - ww) / 2, H - 13.5, ww, wh);
      doc.setFont("helvetica", "italic"); doc.setFontSize(6.5); doc.setTextColor(168, 162, 150);
      doc.text("Del plato a la boca se cae el margen", W / 2, H - 4, { align: "center" });
    } else {
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(168, 162, 150);
      doc.text("Generado con Platify", W / 2, H - 9, { align: "center" });
    }

    const arch = ("Ficha " + (data.numero ? data.numero + " " : "") + (data.nombre || "receta")).replace(/[\/\\:*?"<>|]/g, "").trim();
    doc.save(arch + ".pdf");
  } catch (err) {
    alert("No pude generar el PDF: " + ((err && err.message) || err));
  }
}
