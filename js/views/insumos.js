// Pantalla: inventario de precios, con búsqueda, filtro por área y orden.
import * as store from "../store.js";
import { COLOR_AREA, AREAS, money, fechaBonita } from "../store.js";
import { descargarCSV } from "../csv.js";
import * as capturar from "./capturar.js";
import * as tickets from "./tickets.js";
import * as proveedores from "./proveedores.js";
import * as ritmo from "./ritmo.js";
import * as requisicion from "./requisicion.js";
import { verFoto } from "../lightbox.js";

// Comprime una foto (para que pese poco antes de guardarla en base64).
function comprimirFoto(file, max = 640) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > max || height > max) { const s = max / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); }
        const c = document.createElement("canvas"); c.width = width; c.height = height;
        c.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(c.toDataURL("image/jpeg", 0.68));
      };
      img.onerror = reject; img.src = r.result;
    };
    r.onerror = reject; r.readAsDataURL(file);
  });
}

// Hub de Insumos: Capturar · Tickets · Requisición · Precios · Proveedores · Ritmo.
export function render(el, ctx) {
  // Roles de área (barista / ayudante): solo Requisición. Capturar, Tickets,
  // Precios y Proveedores exponen lo que le pagamos a cada proveedor.
  const soloRequis = !store.esJefe();
  let sub = soloRequis ? "requisicion" : "capturar";
  let limpiar = null;
  el.innerHTML = `
    <div class="segmented" style="font-size:12.5px"${soloRequis ? ' hidden' : ''}>
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
    <p class="sub" style="margin:2px 2px 8px">Precio más reciente de cada insumo y cómo cambió. Toca uno para ver su historial.</p>
    <p class="sub" style="margin:0 2px 12px;font-size:11.5px">Palomea ✅ el nombre <b>oficial</b> de un insumo: los tickets que entren escritos parecido (80% o más) se guardarán con ese nombre, para que no se te abra un insumo nuevo por una tilde.</p>
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

    const q = st.q.trim();
    let items = store.preciosPorInsumo();
    if (st.area !== "todas") items = items.filter((i) => (i.area || "otro") === st.area);
    if (q) items = items.filter((i) => store.coincide(i.nombre + " " + (i.codigo || ""), q));
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
            <input type="checkbox" class="ofic" data-of="${escapar(i.nombre)}"${store.esOficial(i.nombre) ? " checked" : ""}
                   title="Marcar este nombre como el oficial: los tickets que entren con un nombre parecido se guardarán así"
                   style="width:17px;height:17px;flex:none;accent-color:var(--verde);margin-right:8px;cursor:pointer" />
            <span class="prov" style="font-size:14px">${escapar(i.nombre)}</span>
            <span class="monto" style="font-size:14px">${money(i.precioActual)}${i.unidad ? `<span class="sub" style="font-weight:400">/${i.unidad}</span>` : ""}</span>
          </div>
          <div class="meta" style="display:flex;justify-content:space-between;align-items:center">
            <span><span class="chip" style="background:${COLOR_AREA[i.area] || "#9c9482"}">${i.area || "otro"}</span> · ${i.veces} compra(s)${i.codigo ? ` · <span class="sub">SKU ${escapar(i.codigo)}</span>` : ""}${i.presentacion ? ` · <span class="sub">📦 ${escapar(i.presentacion)}</span>` : ""}${store.esOficial(i.nombre) ? ` · <span class="sub" style="color:var(--verde);font-weight:700" title="Nombre oficial: absorbe los parecidos">✔ oficial</span>` : ""}${etiquetaCriterio(i)}${i.mezclado ? ` · <span class="sub" style="color:#b06a00" title="Hay compras en otra unidad que no se pueden comparar">⚠️ unidades</span>` : ""}</span>
            <span>${flecha}</span>
          </div>
        </div>`;
    }).join("");

    lista.querySelectorAll("[data-n]").forEach((row) =>
      row.addEventListener("click", () => abrir(decodeURIComponent(row.dataset.n))));

    // ✔ Nombre oficial. De aquí en adelante, todo ticket que entre con un
    // nombre 80% parecido se guarda con ÉSTE. Lo que ya está en el sistema no
    // se toca solo: se ofrece unificarlo, con la lista a la vista.
    lista.querySelectorAll(".ofic").forEach((c) => {
      c.addEventListener("click", (e) => e.stopPropagation());   // no abrir el modal
      c.addEventListener("change", async (e) => {
        e.stopPropagation();
        const nombre = c.dataset.of, activo = c.checked;
        c.disabled = true;
        try {
          await store.marcarOficial(nombre, activo);
          if (activo) {
            const sim = store.similaresA(nombre);
            if (sim.length) {
              const lst = sim.slice(0, 12).map((s) => `  · ${s.nombre}  (${s.veces} compra${s.veces === 1 ? "" : "s"}, ${Math.round(s.parecido * 100)}% parecido)`).join("\n");
              const extra = sim.length > 12 ? `\n  …y ${sim.length - 12} más` : "";
              if (confirm(`"${nombre}" ya es el nombre oficial: los tickets NUEVOS que se le parezcan entrarán con ese nombre.\n\nEn el sistema ya hay ${sim.length} insumo(s) parecidos:\n\n${lst}${extra}\n\n¿Los paso también a "${nombre}"? Se corrigen sus tickets y las recetas se recalculan.`)) {
                let n = 0;
                for (const s of sim) { try { n += await store.renombrarInsumo(s.nombre, nombre, ""); } catch (err) {} }
                alert(`Listo: se unificaron ${sim.length} insumo(s) en ${n} ticket(s).`);
              }
            }
          }
        } catch (err) { alert("No se pudo guardar: " + ((err && err.message) || err)); c.checked = !activo; }
        c.disabled = false;
        pintar();
      });
    });
  }

  function abrir(key) {
    const item = store.preciosPorInsumo().find((i) => i.nombre.toLowerCase() === key);
    if (!item) return;
    // orden ascendente por fecha para la gráfica
    const asc = item.registros.slice().sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    // preciosPorInsumo() ya llevó cada compra a una unidad base común
    // (r.precioBase). Las estadísticas van sobre eso, NO sobre el número crudo
    // del ticket: "6 L por $176.93" y "1 L por $29.49" son el mismo precio.
    const uMuestra = item.unidad || "";
    const valor = (r) => (r.precioBase != null ? r.precioBase : store.num(r.precio));
    const compar = asc.filter((r) => r.precioBase != null);
    const precios = (compar.length ? compar : asc).map(valor);
    const min = Math.min(...precios), max = Math.max(...precios);
    const prom = precios.reduce((a, b) => a + b, 0) / precios.length;
    const prim = precios[0], ult = precios[precios.length - 1];
    const varTot = prim ? (ult - prim) / prim : 0;
    const gastoTot = asc.reduce((a, r) => a + store.num(r.monto), 0);

    // Proveedores: último precio + tendencia (vs su compra anterior con precio distinto).
    const provReg = new Map();
    for (const r of item.registros) {   // registros vienen recientes primero
      const p = (r.proveedor || "").trim();
      if (!provReg.has(p)) provReg.set(p, []);
      provReg.get(p).push(r);
    }
    const provs = [...provReg.entries()].map(([p, regs]) => {
      const ult = regs[0];
      const prev = regs.find((r) => store.num(r.precio) !== store.num(ult.precio));
      return {
        proveedor: p, label: p || "Sin proveedor",
        precio: store.num(ult.precio), unidad: ult.unidad || item.unidad || "",
        codigo: (ult.codigo || "").toString().trim(),
        cambio: prev ? store.num(ult.precio) - store.num(prev.precio) : 0, veces: regs.length,
      };
    });
    // Normaliza a una unidad BASE (kg / L / pza) para comparar de a de veras.
    const parsePres = (txt) => { const m = String(txt || "").match(/(\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|g|gr|grs|gramos?|lts?|l|litros?|ml|pzas?|pz|piezas?)/i); return m ? { qty: parseFloat(m[1].replace(",", ".")), unit: m[2].toLowerCase() } : null; };
    const parseNum = (txt) => { const m = String(txt || "").match(/(\d+(?:[.,]\d+)?)/); return m ? parseFloat(m[1].replace(",", ".")) : null; };
    provs.forEach((p) => { p.pres = store.presentacionDe(item.nombre, p.proveedor); p.presP = parsePres(p.pres); p.presNum = parseNum(p.pres); });
    const cand = provs.flatMap((p) => [p.unidad, p.presP && p.presP.unit]).filter(Boolean);
    let base = ""; for (const fam of ["kg", "L", "pza"]) { if (cand.some((u) => store.unidadesCompatibles(u, fam))) { base = fam; break; } }
    // Si no hay unidad de peso/volumen pero sí presentación (ej. huevo "300"), compara por PIEZA.
    if (!base && provs.some((p) => p.presP || p.presNum)) base = "pza";
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
    // Registro maestro (precio por gramo) de ESTE insumo, para el costeo de recetas.
    const mae = store.maestroDe(item.nombre) || {};
    const maeU = mae.unidad_base || "g";
    const pgFmt = (n, u) => "$" + (Math.round(store.num(n) * 10000) / 10000) + "/" + (u || "g");
    const calcPg = (total, pz, gpz) => { const d = store.num(pz) * store.num(gpz); return d > 0 ? store.num(total) / d : 0; };
    const selU = (cur) => `<select id="mU" style="min-width:0">${["g", "kg", "ml", "L", "pza"].map((u) => `<option${u.toLowerCase() === String(cur || "g").toLowerCase() ? " selected" : ""}>${u}</option>`).join("")}${["g", "kg", "ml", "L", "pza"].some((u) => u.toLowerCase() === String(cur || "g").toLowerCase()) ? "" : `<option selected>${escapar(cur)}</option>`}</select>`;

    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `
      <div class="modal">
        <h2>${escapar(item.nombre)}</h2>
        <p class="sub" style="margin-top:0">Análisis de precio ${uMuestra ? "(por " + escapar(uMuestra) + ")" : ""}</p>
        ${avisoPrecio(item, uMuestra)}

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

        <div class="titulo-seccion" style="margin-top:16px">⚖️ Precio que se usa para costear</div>
        <div class="fila" style="gap:8px;align-items:flex-end">
          <label class="campo" style="flex:1.5;margin:0"><span>Criterio</span>
            <select id="crModo">
              ${[["reciente", "El más reciente"], ["barato", "El más barato"], ["caro", "El más caro"],
                 ["promedio", "Promedio de todas"], ["fijo", "Yo lo fijo"]].map(([k, l]) =>
                `<option value="${k}"${item.criterio === k ? " selected" : ""}>${l}${k === "reciente" ? " · normal" : ""}</option>`).join("")}
            </select>
          </label>
          <label class="campo" id="crFijoBox" style="flex:1;margin:0;${item.criterio === "fijo" ? "" : "display:none"}"><span>Precio${uMuestra ? " por " + escapar(uMuestra) : ""}</span>
            <input id="crFijo" type="number" inputmode="decimal" step="any" min="0" value="${escapar(String(store.num(item.criterioValor) || store.num(item.precioActual) || ""))}" /></label>
        </div>
        <div class="sub" id="crOut" style="font-size:11.5px;margin:5px 0 2px"></div>
        ${store.maestroDe(item.nombre) ? `<div class="sub" style="font-size:11px;color:#b06a00;margin-bottom:4px">Ojo: este insumo tiene <b>Registro Maestro</b> (más abajo), y ése manda sobre todo lo de aquí.</div>` : ""}

        <div class="titulo-seccion" style="margin-top:16px">Compras (${asc.length})</div>
        <div>
          ${item.registros.map((r, ix) => {
            const vb = r.precioBase != null ? r.precioBase : null;
            const dif = vb != null && Math.abs(vb - store.num(r.precio)) > 0.005;
            return `
            <div class="barra-row" style="justify-content:space-between;gap:6px">
              <span class="etq" style="width:auto">${fechaBonita(r.fecha)}</span>
              <span class="sub" style="flex:1;text-align:center;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapar(r.proveedor || "—")}</span>
              <span style="flex:0 0 auto;text-align:right">
                <span class="val"${vb == null ? ' style="color:#b06a00"' : ""}>${money(vb != null ? vb : r.precio)}${vb != null && uMuestra ? "/" + escapar(uMuestra) : r.unidad ? "/" + escapar(r.unidad) : ""}</span>
                ${dif ? `<div class="sub" style="font-size:10px;margin-top:-2px">ticket: ${store.num(r.cantidad) || "?"} ${escapar(r.unidad || "")} · ${money(r.monto)}</div>` : ""}
                ${vb == null ? `<div class="sub" style="font-size:10px;margin-top:-2px;color:#b06a00">no compara${r.deducido ? ` · parece que trae ${r.deducido}` : ""}</div>` : ""}
              </span>
              ${r.ticketId
                ? `<button type="button" class="edToggle" data-ix="${ix}" title="Corregir esta compra" style="flex:0 0 auto;background:none;border:none;cursor:pointer;font-size:15px;padding:0 2px;line-height:1">✏️</button>`
                : `<span style="flex:0 0 auto;opacity:.28;font-size:15px">✏️</span>`}
              ${r.fotoTicket
                ? `<a href="${escapar(r.fotoTicket)}" target="_blank" rel="noopener" title="Ver foto del ticket" style="flex:0 0 auto;text-decoration:none;font-size:16px" onclick="event.stopPropagation()">🧾</a>`
                : `<span title="Este ticket no tiene foto" style="flex:0 0 auto;opacity:.28;font-size:16px">🧾</span>`}
            </div>
            ${r.ticketId ? `
            <div class="edCompra" data-ix="${ix}" data-t="${escapar(r.ticketId)}" style="display:none;border:1px solid var(--linea);border-left:3px solid var(--verde);border-radius:8px;padding:9px 10px;margin:2px 0 8px;background:#fbfaf6">
              <div class="sub" style="font-size:11px;margin-bottom:6px">Corrige lo que trae de verdad. <b>Lo pagado no se toca</b> salvo que lo cambies; el precio unitario se recalcula solo.</div>
              <div class="fila" style="gap:6px">
                <label class="campo" style="flex:1;margin:0"><span>Cantidad</span><input class="ecCant" type="number" inputmode="decimal" step="any" min="0" value="${escapar(String(store.num(r.cantidad) || ""))}" /></label>
                <label class="campo" style="flex:.9;margin:0"><span>Unidad</span><input class="ecUni" value="${escapar(r.unidad || "")}" placeholder="L, kg, pza…" /></label>
                <label class="campo" style="flex:1;margin:0"><span>Total pagado</span><input class="ecMonto" type="number" inputmode="decimal" step="any" min="0" value="${escapar(String(store.num(r.monto) || ""))}" /></label>
              </div>
              <div class="sub ecCalc" style="font-size:11.5px;margin:2px 0 7px"></div>
              <div class="fila" style="gap:6px">
                <button type="button" class="btn chico ecSave" style="flex:1;margin:0">💾 Guardar esta compra</button>
                <button type="button" class="btn sec chico ecUsar" data-p="${vb != null ? vb : store.num(r.precio)}" style="flex:0 0 auto;margin:0" title="Costear con el precio de esta compra">Usar éste</button>
                <button type="button" class="btn sec chico ecTicket" style="flex:0 0 auto;margin:0">Abrir ticket</button>
              </div>
            </div>` : ""}`; }).join("")}
        </div>
        ${provs.length ? `<div class="titulo-seccion" style="margin-top:16px">📦 Comparativa por proveedor${base ? " · costo por " + base : ""}</div>
        <div class="sub" style="font-size:11px;margin:-4px 0 6px">Se compara por <b>costo por ${base || "unidad"}</b> (normalizado con la presentación). Pon la presentación con su cantidad: ej. <b>1.5 kg</b>, <b>4 kg</b>, o para huevo la caja/cartera como <b>300</b> o <b>12</b> (piezas). Así compara aunque cada proveedor traiga distinta presentación.</div>
        ${provs.map((p) => {
          const skuVal = store.skuProvDe(item.nombre, p.proveedor) || p.codigo;
          return `<div class="prov-row" data-prov="${escapar(p.proveedor)}" data-precio="${p.precio}" data-unidad="${escapar(p.unidad || "")}" style="border:1px solid var(--linea);border-radius:10px;padding:10px;margin-top:6px;background:#fff">
            <div class="fila" style="justify-content:space-between;align-items:baseline;gap:8px">
              <b style="font-size:13.5px;flex:1;min-width:0">${escapar(p.label)} <span class="barato-tag" style="color:var(--verde);font-weight:600;font-size:11px"></span></b>
              <span class="cost-out" style="white-space:nowrap"></span>
            </div>
            <div class="cost-compra sub" style="font-size:10.5px;margin-top:2px">Compra: ${money(p.precio)}/${escapar(p.unidad || "u")}</div>
            ${p.veces > 1 ? `<div class="sub" style="font-size:10.5px;margin-top:1px">${p.cambio >= 1 ? `<span style="color:var(--rojo)">▲ subió ${money(p.cambio)} vs su compra anterior</span>` : p.cambio <= -1 ? `<span style="color:var(--verde)">▼ bajó ${money(Math.abs(p.cambio))} vs su compra anterior</span>` : `<span>= mismo precio que antes</span>`} · ${p.veces} compras</div>` : `<div class="sub" style="font-size:10.5px;margin-top:1px">1ª compra registrada</div>`}
            <div class="fila" style="gap:8px;margin-top:8px">
              <input class="edPres" value="${escapar(p.pres)}" placeholder="${base ? "Presentación en " + base + " (ej. 1.5)" : "Presentación (ej. 1.5 kg)"}" style="flex:1.4;min-width:0" />
              <input class="edSkuP" value="${escapar(skuVal)}" placeholder="SKU" style="flex:1;min-width:0" />
            </div>
            <div class="fila prov-foto" style="gap:8px;margin-top:8px;align-items:center">
              <div class="foto-thumb" style="width:52px;height:52px;flex:0 0 auto;border:1px solid var(--linea);border-radius:8px;overflow:hidden;background:#f6f4ee;display:flex;align-items:center;justify-content:center">
                <span class="foto-vacia sub" style="font-size:18px">📷</span>
                <img class="foto-img" alt="presentación" style="display:none;width:100%;height:100%;object-fit:cover;cursor:pointer" />
              </div>
              <label class="btn sec chico foto-sube" style="flex:1;margin:0;cursor:pointer;text-align:center"><span class="foto-lbl">📷 Subir foto de la presentación</span>
                <input type="file" class="foto-file" accept="image/*" style="display:none" />
              </label>
              <button type="button" class="btn sec chico foto-quita" style="flex:0 0 auto;color:var(--rojo);display:none">Quitar</button>
            </div>
          </div>`;
        }).join("")}` : ""}

        <div class="titulo-seccion" style="margin-top:16px">⚖️ Precio por unidad (para recetas)</div>
        <div class="sub" style="font-size:11px;margin:-4px 0 6px">Cuánto pagas y cuánto trae, para costear recetas por unidad. Elige la unidad base: <b>g</b> (crema 4000 g), <b>pza</b> (huevo 300), <b>ml</b>, etc. Manda sobre el ticket.</div>
        <div class="fila" style="gap:8px;align-items:flex-end">
          <label class="campo" style="flex:1;margin:0"><span>Compra (Pz)</span><input id="mPz" type="number" inputmode="decimal" step="any" min="0" value="${escapar(String(mae.compra_pz != null ? mae.compra_pz : 1))}" /></label>
          <label class="campo" style="flex:1.2;margin:0"><span>Contenido c/u</span><input id="mGpz" type="number" inputmode="decimal" step="any" min="0" value="${escapar(String(mae.gramos_pz != null ? mae.gramos_pz : ""))}" /></label>
          <label class="campo" style="width:72px;margin:0"><span>Unidad</span>${selU(maeU)}</label>
        </div>
        <label class="campo"><span>Precio total pagado</span><input id="mTot" type="number" inputmode="decimal" step="any" min="0" value="${escapar(String(mae.precio_total != null ? mae.precio_total : ""))}" /></label>
        <div style="text-align:center;padding:8px;border-radius:10px;background:#eafaf0;margin-bottom:4px">
          <span class="sub">Precio por unidad (recetas)</span>
          <div id="mPg" style="font-size:19px;font-weight:800;color:#16514f">${pgFmt(calcPg(mae.precio_total, mae.compra_pz != null ? mae.compra_pz : 1, mae.gramos_pz), maeU)}</div>
        </div>

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
    // ── Qué precio manda para costear ──────────────────────────────────
    (function criterioPrecio() {
      const sel = bg.querySelector("#crModo"), fijoBox = bg.querySelector("#crFijoBox");
      const fijo = bg.querySelector("#crFijo"), out = bg.querySelector("#crOut");
      const vals = asc.filter((r) => r.precioBase != null).map((r) => r.precioBase);
      const serie = vals.length ? vals : precios;
      const uTxt = uMuestra ? " por " + escapar(uMuestra) : "";
      const calc = (modo) => {
        if (!serie.length) return 0;
        if (modo === "barato") return Math.min(...serie);
        if (modo === "caro") return Math.max(...serie);
        if (modo === "promedio") return serie.reduce((a, b) => a + b, 0) / serie.length;
        if (modo === "fijo") return store.num(fijo.value);
        return precios[precios.length - 1];
      };
      const pinta = () => {
        const modo = sel.value;
        fijoBox.style.display = modo === "fijo" ? "" : "none";
        const v = calc(modo);
        out.innerHTML = v > 0
          ? `Las recetas van a costear con <b>${money(v)}</b>${uTxt}.`
          : `<span style="color:#b06a00">Pon un precio para poder costear.</span>`;
      };
      const guarda = async () => {
        try { await store.guardarCriterioPrecio(item.nombre, sel.value, fijo.value); }
        catch (e) { alert("No se pudo guardar: " + ((e && e.message) || e)); }
      };
      sel.addEventListener("change", () => { pinta(); guarda(); });
      fijo.addEventListener("input", pinta);
      fijo.addEventListener("change", guarda);
      // "Usar éste" en una compra = fijar ese precio.
      bg.querySelectorAll(".ecUsar").forEach((b) => b.addEventListener("click", async () => {
        sel.value = "fijo"; fijo.value = store.num(b.dataset.p); pinta(); await guarda();
        cerrar(); pintar(); abrir(key);
      }));
      pinta();
    })();

    // ── Corregir una compra sin salir de aquí ──────────────────────────
    bg.querySelectorAll(".edToggle").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const caja = bg.querySelector(`.edCompra[data-ix="${b.dataset.ix}"]`);
      if (!caja) return;
      const abierta = caja.style.display !== "none";
      caja.style.display = abierta ? "none" : "block";
      if (!abierta) { calcEd(caja); const c = caja.querySelector(".ecCant"); if (c) c.focus(); }
    }));
    // Muestra a cuánto sale la unidad mientras escribe, para que vea el efecto.
    function calcEd(caja) {
      const cant = store.num(caja.querySelector(".ecCant").value);
      const uni = caja.querySelector(".ecUni").value.trim();
      const monto = store.num(caja.querySelector(".ecMonto").value);
      const out = caja.querySelector(".ecCalc");
      out.innerHTML = cant > 0 && monto > 0
        ? `Queda en <b>${money(monto / cant)}</b> por ${escapar(uni || "unidad")}.`
        : `<span style="color:#b06a00">Pon cantidad y total para calcular el precio unitario.</span>`;
    }
    bg.querySelectorAll(".edCompra").forEach((caja) => {
      caja.querySelectorAll(".ecCant, .ecUni, .ecMonto").forEach((i) => i.addEventListener("input", () => calcEd(caja)));
      caja.querySelector(".ecTicket").addEventListener("click", () => {
        cerrar(); location.hash = "#/tickets?t=" + encodeURIComponent(caja.dataset.t);
      });
      caja.querySelector(".ecSave").addEventListener("click", async () => {
        const b = caja.querySelector(".ecSave");
        const cant = store.num(caja.querySelector(".ecCant").value);
        const monto = store.num(caja.querySelector(".ecMonto").value);
        if (!(cant > 0)) { alert("La cantidad tiene que ser mayor que cero."); return; }
        if (!(monto > 0)) { alert("El total pagado tiene que ser mayor que cero."); return; }
        b.disabled = true; b.textContent = "Guardando…";
        try {
          await store.editarCompra(caja.dataset.t, item.nombre, {
            cantidad: cant, unidad: caja.querySelector(".ecUni").value.trim(), monto,
          });
          cerrar(); pintar(); abrir(key);   // se reabre con los números ya recalculados
        } catch (e) {
          b.disabled = false; b.textContent = "💾 Guardar esta compra";
          alert("No se pudo guardar: " + ((e && e.message) || e));
        }
      });
    });
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

    // Fotos de la presentación por proveedor (subir / cambiar / quitar; carga bajo demanda)
    (function fotosPorProveedor() {
      const setThumb = (row, dataUrl) => {
        const img = row.querySelector(".foto-img"), vacia = row.querySelector(".foto-vacia");
        const quita = row.querySelector(".foto-quita"), lbl = row.querySelector(".foto-lbl");
        if (dataUrl) { img.src = dataUrl; img.style.display = "block"; vacia.style.display = "none"; quita.style.display = ""; lbl.textContent = "📷 Cambiar foto"; }
        else { img.removeAttribute("src"); img.style.display = "none"; vacia.style.display = ""; quita.style.display = "none"; lbl.textContent = "📷 Subir foto de la presentación"; }
      };
      const rows = [...bg.querySelectorAll(".prov-row")];
      rows.forEach((row) => {
        const prov = row.dataset.prov;
        const file = row.querySelector(".foto-file"), lbl = row.querySelector(".foto-lbl"), quita = row.querySelector(".foto-quita");
        row.querySelector(".foto-img").addEventListener("click", (e) => { const img = e.currentTarget; if (img.src) verFoto(img.src, item.nombre + (row.dataset.prov ? " · " + row.dataset.prov : "")); });
        file.addEventListener("change", async () => {
          const f = file.files && file.files[0]; if (!f) return;
          const prev = lbl.textContent; lbl.textContent = "Subiendo…";
          try { const dataUrl = await comprimirFoto(f); await store.guardarFotoInsumo(item.nombre, prov, dataUrl); setThumb(row, dataUrl); }
          catch (e) { alert("No se pudo subir la foto: " + ((e && e.message) || e)); lbl.textContent = prev; }
          file.value = "";
        });
        quita.addEventListener("click", async () => {
          if (!confirm("¿Quitar la foto de este proveedor?")) return;
          try { await store.borrarFotoInsumo(item.nombre, prov); setThumb(row, ""); } catch (e) { alert("Error: " + ((e && e.message) || e)); }
        });
      });
      store.fotosDeInsumo(item.nombre).then((m) => { rows.forEach((row) => { const f = m.get(store.normProv(row.dataset.prov)); if (f) setThumb(row, f); }); }).catch(() => {});
    })();

    // Precio por gramo (maestro) en vivo
    const recalcMae = () => { const o = bg.querySelector("#mPg"); if (o) o.textContent = pgFmt(calcPg(bg.querySelector("#mTot").value, bg.querySelector("#mPz").value, bg.querySelector("#mGpz").value), bg.querySelector("#mU") ? bg.querySelector("#mU").value : "g"); };
    ["#mPz", "#mGpz", "#mTot", "#mU"].forEach((s) => { const n = bg.querySelector(s); if (n) { n.addEventListener("input", recalcMae); n.addEventListener("change", recalcMae); } });

    bg.querySelector("#edSave").addEventListener("click", async () => {
      const nn = bg.querySelector("#edN").value.trim();
      const nu = bg.querySelector("#edU").value.trim();
      if (!nn) { alert("El nombre no puede quedar vacío."); return; }
      const b = bg.querySelector("#edSave"); b.disabled = true; b.textContent = "Guardando…";
      try {
        const n = await store.renombrarInsumo(item.nombre, nn, nu);
        if (nn !== item.nombre) { try { await store.migrarFotosInsumo(item.nombre, nn); } catch (e) {} }
        for (const row of bg.querySelectorAll(".prov-row")) {
          const prov = row.dataset.prov;
          await store.guardarPresentacion(nn, prov, row.querySelector(".edPres").value.trim());
          await store.guardarSkuProv(nn, prov, row.querySelector(".edSkuP").value.trim());
        }
        // Precio por gramo (maestro): guarda si tiene datos, borra si lo vaciaron.
        const mGpz = store.num(bg.querySelector("#mGpz").value), mTot = store.num(bg.querySelector("#mTot").value);
        if (mGpz > 0 && mTot > 0) {
          await store.guardarIngredienteMaestro({ id: mae.id, nombre: nn, compra_pz: bg.querySelector("#mPz").value, gramos_pz: mGpz, precio_total: mTot, unidad_base: bg.querySelector("#mU").value });
        } else if (mae.id) { await store.borrarIngredienteMaestro(mae.id); }
        cerrar(); pintar();
        alert(`Listo: se corrigieron ${n} ticket(s). Presentación, SKU y precio/g guardados.`);
      } catch (e) { b.disabled = false; b.textContent = "💾 Guardar cambios"; alert("Error: " + ((e && e.message) || e)); }
    });
  }

  return off;
}

const MESES_I = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaCorta(iso) {
  const p = String(iso || "").split("-");
  if (p.length !== 3) return "";
  return store.fechaDMA(iso);
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

// El criterio por defecto (más reciente) no se anuncia; los demás sí, para que
// no se te olvide que ese insumo tiene el precio amarrado a mano.
const NOMBRE_CRITERIO = { barato: "más barato", caro: "más caro", promedio: "promedio", fijo: "precio fijo" };
function etiquetaCriterio(i) {
  const n = NOMBRE_CRITERIO[i.criterio];
  return n ? ` · <span class="sub" title="Precio elegido para costear">⚖️ ${n}</span>` : "";
}

// Aviso arriba del análisis: por qué el precio se ve como se ve.
// El caso que más confunde: la misma leche facturada "6 L por $176.93" y
// "1 L por $29.49" es EXACTAMENTE el mismo precio, pero comparando los números
// crudos del ticket parece que se desplomó.
function avisoPrecio(item, uMuestra) {
  const caja = "border-radius:10px;padding:9px 11px;margin:0 0 12px;font-size:12px;line-height:1.45";
  const sin = item.sinNormalizar || [];
  if (item.mezclado && sin.length) {
    const lista = sin.slice(0, 4).map((r) =>
      `<li>${fechaBonita(r.fecha)} · ${escapar(r.proveedor || "sin proveedor")} — ${money(r.precio)}${r.unidad ? "/" + escapar(r.unidad) : ""}${
        r.deducido ? ` <b>(parece que trae ${r.deducido} ${escapar(uMuestra || "")})</b>` : ""}</li>`).join("");
    return `<div style="${caja};background:#fff6e5;border:1px solid #f0d9a8;color:#7a4d00">
      ⚠️ <b>Hay compras que no se pueden comparar</b> porque vienen en otra unidad.
      El precio y la tendencia de arriba se calculan solo con las que sí están en <b>${escapar(uMuestra || "la misma unidad")}</b>,
      para no marcar subidas ni bajadas falsas.
      <ul style="margin:6px 0 0 16px;padding:0">${lista}${sin.length > 4 ? `<li>y ${sin.length - 4} más…</li>` : ""}</ul>
      <div style="margin-top:6px">Toca <b>✏️</b> en esa compra y corrige la cantidad y la unidad (ej. 1 caja → <b>6 L</b>). Lo pagado no se mueve.</div></div>`;
  }
  if (item.normalizado && item.veces > 1) {
    return `<div style="${caja};background:#eafaf0;border:1px solid #bfe6cd;color:#16514f">
      ✅ Las ${item.veces} compras están comparadas <b>por ${escapar(uMuestra || "unidad")}</b>, sin importar si el proveedor facturó por caja o por pieza.</div>`;
  }
  const crudos = (item.registros || []).map((r) => store.num(r.precio)).filter((n) => n > 0);
  if (crudos.length < 2) return "";
  const min = Math.min(...crudos), max = Math.max(...crudos);
  if (!(min > 0) || max / min < 3) return "";
  const razon = max / min;
  const cerca = [2, 3, 4, 6, 8, 10, 12, 20, 24, 30, 48, 60, 100].find((n) => Math.abs(razon - n) / n < 0.06);
  return `<div style="${caja};background:#fff6e5;border:1px solid #f0d9a8;color:#7a4d00">
    ⚠️ El precio unitario está brincando: de <b>${money(min)}</b> a <b>${money(max)}</b>${cerca ? `, justo <b>${cerca}×</b>` : ""}.
    ${cerca
      ? `Eso casi siempre es que un ticket registró la <b>caja de ${cerca}</b> y otro la pieza suelta.`
      : `Suele ser que un ticket registró la caja o el bulto y otro la unidad suelta.`}
    <br>Toca <b>✏️</b> en la compra que esté mal y pon la cantidad y unidad reales.</div>`;
}

function escapar(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
