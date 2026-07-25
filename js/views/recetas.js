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
  return [...m.values()].map((o) => {
    const fcat = (store.fichaDe(o.producto) || {}).categoria;   // la categoría de la ficha tiene prioridad
    return { ...o, categoria: fcat || o.categoria || "", precio: o.cantidad > 0 ? o.venta / o.cantidad : 0 };
  }).sort((a, b) => b.venta - a.venta);
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
    const st = { q: "", cat: "todas" };
    function draw() {
      const costos = store.mapaCostos();
      const q = st.q.trim().toLowerCase();
      const arr = platillos().filter((p) => (!q || p.producto.toLowerCase().includes(q)) && (st.cat === "todas" || (p.categoria || "") === st.cat));
      const conReceta = arr.filter((p) => store.recetasDe(p.producto).length).length;
      cont.innerHTML = `
        <div class="card">
          <h2 style="margin-bottom:2px">Fichas técnicas</h2>
          <p class="sub" style="margin-top:0">Con receta: <b>${conReceta}</b> de ${arr.length}. Captura la receta y el costo/margen salen solos de tus compras.</p>
          <div class="fila" style="gap:8px;margin:8px 0 4px;flex-wrap:wrap">
            <button class="btn sec chico" id="impcsv" style="flex:1">⬆ Importar CSV</button>
            <button class="btn sec chico" id="plantilla" style="flex:1">⬇ Formato vacío</button>
            <button class="btn sec chico" id="exptabla" style="flex:1 1 100%">⬇ Descargar recetas (tabla)</button>
          </div>
          <input type="file" id="fcsv" accept=".csv,text/csv" style="display:none" />
          <input id="bq" placeholder="Buscar platillo…" style="margin:6px 0 8px" value="${esc(st.q)}" />
          <select id="fcat" style="width:100%;margin-bottom:12px">
            <option value="todas"${st.cat === "todas" ? " selected" : ""}>Todas las categorías</option>
            ${categoriasPlatillos().map((c) => `<option value="${esc(c)}"${st.cat === c ? " selected" : ""}>${esc(c)}</option>`).join("")}
          </select>
          <div id="lista"></div>
        </div>`;
      const lista = cont.querySelector("#lista");
      if (!arr.length) lista.innerHTML = `<div class="vacio">No hay platillos. Importa tus ventas (productos_venta) primero.</div>`;
      else lista.innerHTML = arr.map((p) => {
        const tiene = store.recetasDe(p.producto).length > 0;
        const costo = costos.has(p.producto) ? costos.get(p.producto) : null;
        const neto = p.precio / (1 + IVA);
        const margPct = tiene && costo != null && neto > 0 ? (neto - costo / store.porcionesDe(p.producto)) / neto * 100 : null;
        return `
          <button class="fila-item" data-p="${esc(p.producto)}" style="width:100%;text-align:left;background:none;border:none;border-bottom:1px solid var(--linea);padding:12px 2px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px">
            <span style="min-width:0">
              <b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.producto)}</b>
              <span class="sub" style="font-size:12px">${esc(p.categoria || "")}${p.precio ? " · vende " + money(p.precio) : ""}</span>
            </span>
            <span style="text-align:right;white-space:nowrap">
              ${tiene && costo != null
                ? `<span class="monto" style="font-size:14px">${money(costo)}</span><br><span class="sub" style="font-size:11.5px;color:${colorMargen(margPct)};font-weight:700">${margPct != null ? "margen " + margPct.toFixed(0) + "%" : ""}</span>`
                : `<span class="sub" style="font-size:12px;color:var(--rojo)">Sin receta →</span>`}
            </span>
          </button>`;
      }).join("");

      const bq = cont.querySelector("#bq");
      bq.addEventListener("input", () => { st.q = bq.value; const s = bq.selectionStart; draw(); const nb = cont.querySelector("#bq"); nb.focus(); nb.setSelectionRange(s, s); });
      const fcat = cont.querySelector("#fcat");
      fcat.addEventListener("change", () => { st.cat = fcat.value; draw(); });
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
          else { const n = await store.importarRecetas(grupos); alert(`Listo: ${n} recetas/subrecetas importadas.`); draw(); }
        } catch (e) { alert("Error al importar: " + (e.message || e)); }
        fcsv.value = ""; const b2 = cont.querySelector("#impcsv"); if (b2) b2.textContent = "⬆ Importar CSV";
      });
      cont.querySelectorAll(".fila-item").forEach((b) => b.addEventListener("click", () => { editando = { nombre: b.dataset.p, esPrep: false }; pintar(); }));
    }
    draw();
  }

  // ───────────── Lista de preparaciones ─────────────
  function listaPreparaciones(cont) {
    const preps = preparaciones();
    cont.innerHTML = `
      <div class="card">
        <h2 style="margin-bottom:2px">Preparaciones base</h2>
        <p class="sub" style="margin-top:0">Salsas, masas, aderezos… que usas en varios platillos. Se costean una vez y se reutilizan como un insumo más.</p>
        <button class="btn" id="nueva" style="margin:8px 0 12px">＋ Nueva preparación</button>
        <div id="lp"></div>
      </div>`;
    const lp = cont.querySelector("#lp");
    if (!preps.length) lp.innerHTML = `<div class="vacio">Aún no hay preparaciones. Crea una si tienes recetas base (ej. "Salsa verde").</div>`;
    else lp.innerHTML = preps.map((nom) => {
      const fila = store.state.recetas.find((r) => r.producto === nom && r.es_preparacion) || {};
      const rend = fila.rendimiento || 1;
      const unidad = store.unidadPreparacion(nom);
      return `
        <button class="fila-item" data-p="${esc(nom)}" style="width:100%;text-align:left;background:none;border:none;border-bottom:1px solid var(--linea);padding:12px 2px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">
          <span><b>${esc(nom)}</b><br><span class="sub" style="font-size:12px">rinde ${esc(String(rend))} ${esc(unidad)}</span></span>
          <span class="monto" style="font-size:14px">${money(store.costoInsumo(nom))}${unidad ? `<span class="sub" style="font-weight:400">/${esc(unidad)}</span>` : ""}</span>
        </button>`;
    }).join("");
    cont.querySelector("#nueva").addEventListener("click", () => { editando = { nombre: "", esPrep: true }; pintar(); });
    cont.querySelectorAll(".fila-item").forEach((b) => b.addEventListener("click", () => { editando = { nombre: b.dataset.p, esPrep: true }; pintar(); }));
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
    let objetivo = 30;
    let categoria = fichaAct.categoria || (plat ? plat.categoria : "");
    let tiempo = fichaAct.tiempo || "";
    let pasos = Array.isArray(fichaAct.pasos) && fichaAct.pasos.length
      ? fichaAct.pasos.map((p) => ({ descripcion: p.descripcion || "", tiempo: p.tiempo || "" }))
      : String(fichaAct.procedimiento || "").split(/\n/).map((s) => s.trim()).filter(Boolean).map((d) => ({ descripcion: d, tiempo: "" }));
    let foto = fichaAct.foto || "";
    let pasoTmp = { descripcion: "", tiempo: "" };

    const precioVenta = plat ? plat.precio : 0;
    const insumosLista = store.preciosPorInsumo();
    const datalist = `<datalist id="dl-insumos">${insumosLista.map((i) => `<option value="${esc(i.nombre)}">`).join("")}</datalist>`;
    // Componentes que se pueden agregar como subreceta: preparaciones + platillos que ya tienen receta.
    const prepsDisp = () => {
      const set = new Set(preparaciones());
      for (const r of store.state.recetas || []) if (!r.es_preparacion && r.producto) set.add(r.producto);
      return [...set].filter((p) => p && p !== nombre && p !== nom).sort();
    };
    const unidadDe = (insumo) => store.sugerirUnidadReceta(store.unidadInsumo(insumo));

    function draw() {
      const costoTotal = items.reduce((a, it) => a + store.costoLinea(it.insumo, it.cantidad, it.unidad || unidadDe(it.insumo)), 0);
      const costoUnit = esPrep && num(rendimiento) > 0 ? costoTotal / num(rendimiento) : costoTotal;
      const nPorc = num(porciones) > 0 ? num(porciones) : 1;
      const costoPorcion = costoTotal / nPorc;
      const precioNeto = precioVenta / (1 + IVA);
      const margen = precioNeto - costoPorcion;
      const margPct = precioNeto > 0 ? margen / precioNeto * 100 : null;
      const foodPct = precioNeto > 0 ? costoPorcion / precioNeto * 100 : null;
      const sugConIva = (num(objetivo) > 0 ? costoPorcion / (num(objetivo) / 100) : 0) * (1 + IVA);

      cont.innerHTML = `
        ${datalist}
        <div class="card">
          <button class="btn sec chico" id="volver" style="margin-bottom:10px">← Volver</button>

          <div class="sub" style="font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--verde);font-weight:700">Ficha técnica</div>
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
                   <span class="sub">Precio sugerido a <input id="obj" type="number" min="1" max="99" value="${esc(String(objetivo))}" style="width:42px;padding:2px 4px;text-align:center;font-size:12px" />% food cost</span>
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

          <button class="btn" id="guardar" style="margin-top:14px">💾 Guardar ficha</button>
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
              <label class="campo" style="flex:.8;margin:0"><span>Unidad</span><input class="ru" placeholder="g, ml, pza" value="${esc(uLinea)}" /></label>
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
      cont.querySelector("#guardar").addEventListener("click", guardar);
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
        const ficha = { categoria, tiempo: num(tiempo), pasos: pasos.filter((p) => p.descripcion.trim()), foto };
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
