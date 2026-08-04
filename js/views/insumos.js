// Pantalla: inventario de precios, con búsqueda, filtro por área y orden.
import * as store from "../store.js";
import { COLOR_AREA, AREAS, money, fechaBonita } from "../store.js";
import { descargarCSV } from "../csv.js";
import * as capturar from "./capturar.js";
import * as tickets from "./tickets.js";
import * as proveedores from "./proveedores.js";
import * as ritmo from "./ritmo.js";
import * as requisicion from "./requisicion.js";

// Hub de Insumos: Capturar · Tickets · Requisición · Precios · Proveedores · Ritmo.
export function render(el, ctx) {
  let sub = "capturar", limpiar = null;
  el.innerHTML = `
    <div class="segmented" style="font-size:12.5px">
      <button data-s="capturar">Capturar</button>
      <button data-s="tickets">Tickets</button>
      <button data-s="requisicion">Requis.</button>
      <button data-s="precios">Precios</button>
      <button data-s="proveedores">Prov.</button>
    </div>
    <div id="isub"></div>`;
  const subEl = el.querySelector("#isub");
  const btns = [...el.querySelectorAll(".segmented button")];
  btns.forEach((b) => b.addEventListener("click", () => { sub = b.dataset.s; marcar(); renderSub(); }));
  function marcar() { btns.forEach((b) => b.classList.toggle("act", b.dataset.s === sub)); }
  function renderSub() {
    if (typeof limpiar === "function") { try { limpiar(); } catch (e) {} }
    subEl.innerHTML = "";
    limpiar = sub === "capturar" ? capturar.render(subEl, ctx)
      : sub === "tickets" ? tickets.render(subEl, ctx)
      : sub === "requisicion" ? requisicion.render(subEl, ctx)
      : sub === "proveedores" ? proveedores.render(subEl, ctx)
      : renderPrecios(subEl);
  }
  marcar(); renderSub();
  return () => { if (typeof limpiar === "function") limpiar(); };
}

function renderPrecios(el) {
  const st = { q: "", area: "todas", orden: "az" };

  el.innerHTML = `
    <p class="sub" style="margin:2px 2px 12px">Precio más reciente de cada insumo y cómo cambió. Toca uno para ver su historial.</p>
    <input id="buscar" placeholder="Buscar insumo o SKU…" style="margin-bottom:10px" />
    <div class="fila" style="margin-bottom:14px">
      <select id="area">
        <option value="todas">Todas las áreas</option>
        ${AREAS.map((a) => `<option value="${a}">${a}</option>`).join("")}
      </select>
      <select id="orden">
        <option value="az">A → Z</option>
        <option value="za">Z → A</option>
        <option value="veces">Más comprado</option>
        <option value="precio-desc">Precio: mayor</option>
        <option value="precio-asc">Precio: menor</option>
        <option value="alza">Mayor alza ▲</option>
        <option value="baja">Mayor baja ▼</option>
      </select>
    </div>
    <button class="btn sec chico" id="exp" style="margin-bottom:12px">⬇ Exportar CSV</button>
    <div id="conteo" class="sub" style="margin:0 2px 8px"></div>
    <div id="lista"></div>`;

  el.querySelector("#buscar").addEventListener("input", (e) => { st.q = e.target.value; pintar(); });
  el.querySelector("#area").addEventListener("change", (e) => { st.area = e.target.value; pintar(); });
  el.querySelector("#orden").addEventListener("change", (e) => { st.orden = e.target.value; pintar(); });
  el.querySelector("#exp").addEventListener("click", () => {
    const filas = store.preciosPorInsumo().map((i) => [
      i.nombre, i.area || "otro", i.precioActual, i.unidad || "", i.veces,
      (i.variacion * 100).toFixed(0) + "%"]);
    descargarCSV("insumos-cremina", ["Insumo", "Área", "Precio actual", "Unidad", "Compras", "Variación"], filas);
  });

  const off = store.subscribe(pintar);
  pintar();

  function ordenar(items) {
    const arr = items.slice();
    switch (st.orden) {
      case "az": return arr.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
      case "za": return arr.sort((a, b) => b.nombre.localeCompare(a.nombre, "es"));
      case "veces": return arr.sort((a, b) => b.veces - a.veces);
      case "precio-desc": return arr.sort((a, b) => b.precioActual - a.precioActual);
      case "precio-asc": return arr.sort((a, b) => a.precioActual - b.precioActual);
      case "alza": return arr.sort((a, b) => b.variacion - a.variacion);
      case "baja": return arr.sort((a, b) => a.variacion - b.variacion);
      default: return arr;
    }
  }

  function pintar() {
    const lista = el.querySelector("#lista");
    const conteo = el.querySelector("#conteo");
    if (!store.state.listo) { lista.innerHTML = `<div class="vacio">Cargando…</div>`; return; }

    const q = st.q.trim().toLowerCase();
    let items = store.preciosPorInsumo();
    if (st.area !== "todas") items = items.filter((i) => (i.area || "otro") === st.area);
    if (q) items = items.filter((i) => i.nombre.toLowerCase().includes(q) || (i.codigo || "").toLowerCase().includes(q));
    items = ordenar(items);

    conteo.textContent = `${items.length} insumo(s)`;

    if (!items.length) {
      lista.innerHTML = `<div class="vacio">${q || st.area !== "todas" ? "Sin resultados." : "Aún no hay insumos registrados."}</div>`;
      return;
    }

    lista.innerHTML = items.slice(0, 300).map((i) => {
      const v = i.variacion;
      // Solo marca alza/baja si el precio se movió al menos $1 (evita ruido por centavos).
      const flecha = i.cambio >= 1 ? `<span class="up">▲ ${money(i.cambio)} (${(v * 100).toFixed(0)}%)</span>`
        : i.cambio <= -1 ? `<span class="down">▼ ${money(Math.abs(i.cambio))} (${(Math.abs(v) * 100).toFixed(0)}%)</span>`
        : `<span class="sub">=</span>`;
      return `
        <div class="ticket" data-n="${encodeURIComponent(i.nombre.toLowerCase())}">
          <div class="cab">
            <span class="prov" style="font-size:14px">${escapar(i.nombre)}</span>
            <span class="monto" style="font-size:14px">${money(i.precioActual)}${i.unidad ? `<span class="sub" style="font-weight:400">/${i.unidad}</span>` : ""}</span>
          </div>
          <div class="meta" style="display:flex;justify-content:space-between;align-items:center">
            <span><span class="chip" style="background:${COLOR_AREA[i.area] || "#9c9482"}">${i.area || "otro"}</span> · ${i.veces} compra(s)${i.codigo ? ` · <span class="sub">SKU ${escapar(i.codigo)}</span>` : ""}${i.presentacion ? ` · <span class="sub">📦 ${escapar(i.presentacion)}</span>` : ""}</span>
            <span>${flecha}</span>
          </div>
        </div>`;
    }).join("");

    lista.querySelectorAll("[data-n]").forEach((row) =>
      row.addEventListener("click", () => abrir(decodeURIComponent(row.dataset.n))));
  }

  function abrir(key) {
    const item = store.preciosPorInsumo().find((i) => i.nombre.toLowerCase() === key);
    if (!item) return;
    // orden ascendente por fecha para la gráfica
    const asc = item.registros.slice().sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    const precios = asc.map((r) => store.num(r.precio));
    const min = Math.min(...precios), max = Math.max(...precios);
    const prom = precios.reduce((a, b) => a + b, 0) / precios.length;
    const prim = precios[0], ult = precios[precios.length - 1];
    const varTot = prim ? (ult - prim) / prim : 0;
    const gastoTot = asc.reduce((a, r) => a + store.num(r.monto), 0);

    // Proveedores distintos con su ÚLTIMO precio, código y unidad (registros recientes primero).
    const provMap = new Map();
    for (const r of item.registros) {
      const p = (r.proveedor || "").trim();
      if (provMap.has(p)) continue;
      provMap.set(p, { proveedor: p, label: p || "Sin proveedor", precio: store.num(r.precio), unidad: r.unidad || item.unidad || "", codigo: (r.codigo || "").toString().trim() });
    }
    const provs = [...provMap.values()];
    // Normaliza a una unidad BASE (kg / L / pza) para comparar de a de veras.
    const parsePres = (txt) => { const m = String(txt || "").match(/(\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|g|gr|grs|gramos?|lts?|l|litros?|ml|pzas?|pz|piezas?)/i); return m ? { qty: parseFloat(m[1].replace(",", ".")), unit: m[2].toLowerCase() } : null; };
    const parseNum = (txt) => { const m = String(txt || "").match(/(\d+(?:[.,]\d+)?)/); return m ? parseFloat(m[1].replace(",", ".")) : null; };
    provs.forEach((p) => { p.pres = store.presentacionDe(item.nombre, p.proveedor); p.presP = parsePres(p.pres); p.presNum = parseNum(p.pres); });
    const cand = provs.flatMap((p) => [p.unidad, p.presP && p.presP.unit]).filter(Boolean);
    let base = ""; for (const fam of ["kg", "L", "pza"]) { if (cand.some((u) => store.unidadesCompatibles(u, fam))) { base = fam; break; } }
    provs.forEach((p) => {
      let cb = null;
      // La PRESENTACIÓN manda: "1.5 kg" ⇒ precio de compra ÷ 1.5. Un número solo ("1.5")
      // se toma como cantidad en la unidad base. Si no hay presentación, cae a la unidad del ticket.
      if (base && p.presP && p.presP.qty > 0 && store.unidadesCompatibles(p.presP.unit, base)) cb = p.precio / (p.presP.qty * store.factorConversion(p.presP.unit, base));
      else if (base && p.presNum && p.presNum > 0) cb = p.precio / p.presNum;
      else if (base && p.unidad && store.unidadesCompatibles(p.unidad, base)) cb = p.precio * store.factorConversion(base, p.unidad);
      p.costoBase = cb;   // precio por unidad base (kg/L/pza), o null si falta info
    });
    provs.sort((a, b) => (a.costoBase == null ? Infinity : a.costoBase) - (b.costoBase == null ? Infinity : b.costoBase) || a.precio - b.precio);
    const minCB = provs.reduce((m, p) => (p.costoBase != null && p.costoBase < m ? p.costoBase : m), Infinity);

    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `
      <div class="modal">
        <h2>${escapar(item.nombre)}</h2>
        <p class="sub" style="margin-top:0">Análisis de precio ${item.unidad ? "(por " + escapar(item.unidad) + ")" : ""}</p>

        <div class="row-stats" style="margin-bottom:12px">
          <div class="stat"><div class="n" style="font-size:19px">${money(ult)}</div><div class="l">Actual</div></div>
          <div class="stat"><div class="n" style="font-size:19px">${money(prom)}</div><div class="l">Promedio</div></div>
          <div class="stat"><div class="n" style="font-size:19px;color:${varTot > 0.005 ? "var(--rojo)" : varTot < -0.005 ? "var(--verde)" : "var(--tinta)"}">${varTot > 0 ? "▲" : varTot < 0 ? "▼" : ""}${Math.abs(Math.round(varTot * 100))}%</div><div class="l">vs. 1ª compra</div></div>
        </div>

        ${grafica(asc)}

        <div class="row-stats" style="margin:12px 0">
          <div class="stat"><div class="n" style="font-size:16px;color:var(--verde)">${money(min)}</div><div class="l">Más barato</div></div>
          <div class="stat"><div class="n" style="font-size:16px;color:var(--rojo)">${money(max)}</div><div class="l">Más caro</div></div>
          <div class="stat"><div class="n" style="font-size:16px">${money(gastoTot)}</div><div class="l">Gasto total</div></div>
        </div>

        <div class="titulo-seccion">Compras (${asc.length})</div>
        <div>
          ${item.registros.map((r) => `
            <div class="barra-row" style="justify-content:space-between">
              <span class="etq" style="width:auto">${fechaBonita(r.fecha)}</span>
              <span class="sub" style="flex:1;text-align:center">${escapar(r.proveedor || "—")}</span>
              <span class="val">${money(r.precio)}${r.unidad ? "/" + r.unidad : ""}</span>
            </div>`).join("")}
        </div>
        ${provs.length ? `<div class="titulo-seccion" style="margin-top:16px">📦 Comparativa por proveedor${base ? " · costo por " + base : ""}</div>
        <div class="sub" style="font-size:11px;margin:-4px 0 6px">Se compara por <b>costo por ${base || "unidad"}</b> (normalizado con la presentación). Escribe la presentación con su cantidad, ej. <b>1.5 kg</b>, para que compare bien.</div>
        ${provs.map((p) => {
          const skuVal = store.skuProvDe(item.nombre, p.proveedor) || p.codigo;
          return `<div class="prov-row" data-prov="${escapar(p.proveedor)}" data-precio="${p.precio}" data-unidad="${escapar(p.unidad || "")}" style="border:1px solid var(--linea);border-radius:10px;padding:10px;margin-top:6px;background:#fff">
            <div class="fila" style="justify-content:space-between;align-items:baseline;gap:8px">
              <b style="font-size:13.5px;flex:1;min-width:0">${escapar(p.label)} <span class="barato-tag" style="color:var(--verde);font-weight:600;font-size:11px"></span></b>
              <span class="cost-out" style="white-space:nowrap"></span>
            </div>
            <div class="cost-compra sub" style="font-size:10.5px;margin-top:2px">Compra: ${money(p.precio)}/${escapar(p.unidad || "u")}</div>
            <div class="fila" style="gap:8px;margin-top:8px">
              <input class="edPres" value="${escapar(p.pres)}" placeholder="${base ? "Presentación en " + base + " (ej. 1.5)" : "Presentación (ej. 1.5 kg)"}" style="flex:1.4;min-width:0" />
              <input class="edSkuP" value="${escapar(skuVal)}" placeholder="SKU" style="flex:1;min-width:0" />
            </div>
          </div>`;
        }).join("")}` : ""}

        <div class="titulo-seccion" style="margin-top:16px">✏️ Corregir insumo</div>
        <div class="fila" style="gap:8px">
          <input id="edN" value="${escapar(item.nombre)}" placeholder="Nombre" style="flex:2" />
          <input id="edU" value="${escapar(item.unidad || "")}" placeholder="Unidad" style="flex:1" />
        </div>
        <div class="sub" style="font-size:11px;margin-top:4px">Cambia el nombre o la unidad (L, kg, g, ml, pza…). Se corrigen todos los tickets de este insumo y las recetas se recalculan solas.</div>
        <button class="btn" id="edSave" style="margin-top:8px">💾 Guardar cambios</button>
        <button class="btn sec" data-cerrar style="margin-top:8px">Cerrar</button>
      </div>`;
    document.body.appendChild(bg);
    const cerrar = () => bg.remove();
    bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
    bg.querySelector("[data-cerrar]").addEventListener("click", cerrar);
    // Recalcula el costo por unidad base EN VIVO al escribir la presentación (sin guardar/reabrir).
    function recompara() {
      const data = [...bg.querySelectorAll(".prov-row")].map((r) => {
        const precio = store.num(r.dataset.precio), unidad = r.dataset.unidad;
        const txt = r.querySelector(".edPres").value;
        const pp = parsePres(txt), pn = parseNum(txt);
        let cb = null;
        if (base && pp && pp.qty > 0 && store.unidadesCompatibles(pp.unit, base)) cb = precio / (pp.qty * store.factorConversion(pp.unit, base));
        else if (base && pn && pn > 0) cb = precio / pn;
        else if (base && unidad && store.unidadesCompatibles(unidad, base)) cb = precio * store.factorConversion(base, unidad);
        return { r, precio, unidad, cb };
      });
      const minCB = data.reduce((m, d) => (d.cb != null && d.cb < m ? d.cb : m), Infinity);
      const conCB = data.filter((d) => d.cb != null).length;
      for (const d of data) {
        const barato = d.cb != null && minCB !== Infinity && Math.abs(d.cb - minCB) < 0.01 && conCB > 1;
        const dif = (d.cb != null && minCB !== Infinity) ? d.cb - minCB : 0;
        d.r.querySelector(".cost-out").innerHTML = d.cb != null
          ? `<b style="font-size:15px">${money(d.cb)}</b><span class="sub">/${base}</span>${dif > 0.01 ? ` <span class="sub" style="color:var(--rojo)">+${money(dif)}</span>` : ""}`
          : `<b>${money(d.precio)}</b><span class="sub">/${escapar(d.unidad || "u")}</span>`;
        d.r.querySelector(".barato-tag").textContent = barato ? "· más barato" : "";
        d.r.style.border = "1px solid " + (barato ? "var(--verde)" : "var(--linea)");
        d.r.style.background = barato ? "#eafaf0" : "#fff";
        const cc = d.r.querySelector(".cost-compra");
        if (cc) cc.innerHTML = `Compra: ${money(d.precio)}/${escapar(d.unidad || "u")}${d.cb == null && base ? ` · <span style="color:#b06a00">agrega la presentación (ej. 1.5 ${base}) para comparar</span>` : ""}`;
      }
    }
    bg.querySelectorAll(".edPres").forEach((inp) => inp.addEventListener("input", recompara));
    recompara();

    bg.querySelector("#edSave").addEventListener("click", async () => {
      const nn = bg.querySelector("#edN").value.trim();
      const nu = bg.querySelector("#edU").value.trim();
      if (!nn) { alert("El nombre no puede quedar vacío."); return; }
      const b = bg.querySelector("#edSave"); b.disabled = true; b.textContent = "Guardando…";
      try {
        const n = await store.renombrarInsumo(item.nombre, nn, nu);
        for (const row of bg.querySelectorAll(".prov-row")) {
          const prov = row.dataset.prov;
          await store.guardarPresentacion(nn, prov, row.querySelector(".edPres").value.trim());
          await store.guardarSkuProv(nn, prov, row.querySelector(".edSkuP").value.trim());
        }
        cerrar(); pintar();
        alert(`Listo: se corrigieron ${n} ticket(s). Presentación y SKU por proveedor guardados.`);
      } catch (e) { b.disabled = false; b.textContent = "💾 Guardar cambios"; alert("Error: " + ((e && e.message) || e)); }
    });
  }

  return off;
}

const MESES_I = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaCorta(iso) {
  const p = String(iso || "").split("-");
  if (p.length !== 3) return "";
  return `${parseInt(p[2], 10)} ${MESES_I[parseInt(p[1], 10) - 1] || ""}`;
}

// Gráfica de línea: precio pagado a lo largo del tiempo.
function grafica(asc) {
  if (asc.length < 2) return `<div class="sub" style="text-align:center;padding:14px 0">Solo hay una compra; aún no hay tendencia de precio.</div>`;
  const W = 320, H = 132, padL = 6, padR = 6, padT = 14, padB = 20;
  const val = (r) => store.num(r.precio);
  let min = Math.min(...asc.map(val)), max = Math.max(...asc.map(val));
  if (min === max) { min = min * 0.9; max = max * 1.1 || 1; }
  const n = asc.length;
  const X = (i) => padL + i * (W - padL - padR) / (n - 1);
  const Y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const line = asc.map((r, i) => `${X(i).toFixed(1)},${Y(val(r)).toFixed(1)}`).join(" ");
  const area = `${X(0).toFixed(1)},${(H - padB).toFixed(1)} ${line} ${X(n - 1).toFixed(1)},${(H - padB).toFixed(1)}`;
  const dots = asc.map((r, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(val(r)).toFixed(1)}" r="2.6" fill="#ff9f1c"/>`).join("");
  return `
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;background:#eafaf8;border-radius:12px">
      <polygon points="${area}" fill="rgba(46,196,182,.16)"/>
      <polyline points="${line}" fill="none" stroke="#2ec4b6" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      <text x="${padL + 2}" y="${H - 6}" font-size="8" fill="#3f827b">${fechaCorta(asc[0].fecha)}</text>
      <text x="${W - padR - 2}" y="${H - 6}" font-size="8" fill="#3f827b" text-anchor="end">${fechaCorta(asc[n - 1].fecha)}</text>
    </svg>`;
}

function escapar(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
