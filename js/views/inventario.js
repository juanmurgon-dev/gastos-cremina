// Pantalla: Inventario — 3 pantallas: Conteo (mensual, móvil, auto-guardado),
// Catálogo (CRUD reutilizable) y Cierre de mes (COGS a partir de dos conteos).
// Enlaza con inventario_articulos / inventario_conteos / cierres_mensuales.
import * as store from "../store.js";
import { money, num } from "../store.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hoyISO = () => new Date().toISOString().slice(0, 10);
const horaAhora = () => new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
const primerDiaMes = (iso) => (iso || hoyISO()).slice(0, 8) + "01";
const mesLabel = (iso) => {
  const M = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const [y, m] = (iso || hoyISO()).split("-"); return `${M[+m - 1]} ${y}`;
};

// CSS propio (una vez): inputs 16px (evita zoom iOS), áreas táctiles ≥44px.
function inyectarCSS() {
  if (document.getElementById("inv-css")) return;
  const st = document.createElement("style"); st.id = "inv-css";
  st.textContent = `
    .inv-in{font-size:16px;min-height:44px;padding:8px 10px;border:1px solid var(--linea);border-radius:10px;background:var(--fondo,#fff);width:100%;box-sizing:border-box}
    .inv-num{font-size:16px;min-height:44px;text-align:right}
    .inv-linea{padding:10px 12px;border-bottom:1px solid var(--linea)}
    .inv-linea .nom{font-weight:600;margin-bottom:6px}
    .inv-grid{display:grid;grid-template-columns:1fr auto 1fr auto;gap:6px;align-items:center}
    .inv-lbl{font-size:11px;color:var(--gris);display:block;margin-bottom:2px}
    details.inv-cat{border-bottom:1px solid var(--linea)}
    details.inv-cat>summary{list-style:none;cursor:pointer;padding:12px;min-height:44px;display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:700;background:var(--fondo-2,#f6f6f4)}
    details.inv-cat>summary::-webkit-details-marker{display:none}
    .inv-btn44{min-height:44px;min-width:44px}
    .inv-foot{padding-bottom:env(safe-area-inset-bottom,0)}
  `;
  document.head.appendChild(st);
}

export function render(el) {
  inyectarCSS();
  let seg = "conteo", boot = false;
  el.innerHTML = `
    <div class="segmented" style="font-size:13px"><button data-s="conteo">Conteo</button><button data-s="catalogo">Catálogo</button><button data-s="cierre">Cierre de mes</button></div>
    <div id="invsub"></div>`;
  const sub = el.querySelector("#invsub");
  const btns = [...el.querySelectorAll(".segmented button")];
  const marcar = () => btns.forEach((b) => b.classList.toggle("act", b.dataset.s === seg));
  btns.forEach((b) => b.addEventListener("click", () => { seg = b.dataset.s; marcar(); pintarSeg(); }));

  const unsub = store.subscribe(() => { if (store.state.listo && !boot) { boot = true; marcar(); pintarSeg(); } });
  if (store.state.listo) { boot = true; marcar(); pintarSeg(); }
  else sub.innerHTML = `<div class="vacio">Cargando…</div>`;

  function pintarSeg() {
    if (seg === "conteo") screenConteo(sub);
    else if (seg === "catalogo") screenCatalogo(sub);
    else screenCierre(sub);
  }
  return () => { if (typeof unsub === "function") unsub(); };
}

// ═══════════════ PANTALLA 1 · CONTEO ═══════════════
async function screenConteo(cont) {
  cont.innerHTML = `<div class="vacio">Cargando…</div>`;
  const borrador = store.conteoBorrador();

  if (!borrador) {
    cont.innerHTML = `
      <div class="card">
        <h2 style="margin-top:0">Nuevo conteo</h2>
        <p class="sub">No hay un conteo en curso. Crea uno para empezar a capturar existencias.</p>
        <label class="campo"><span>Fecha del conteo</span><input class="inv-in" id="fch" type="date" value="${hoyISO()}" /></label>
        <button class="btn" id="crear" style="margin-top:8px">Crear conteo de ${store.articulosActivos().length} artículos</button>
      </div>
      ${histConteos()}`;
    cont.querySelector("#crear").onclick = async (e) => {
      const f = cont.querySelector("#fch").value || hoyISO();
      e.target.disabled = true; e.target.textContent = "Creando…";
      try { await store.crearConteo(f); screenConteo(cont); }
      catch (err) { e.target.disabled = false; e.target.textContent = "Crear conteo"; alert("No se pudo crear: " + (err.message || err) + (String(err.message).includes("duplicate") ? " (ya existe un conteo con esa fecha)" : "")); }
    };
    return;
  }

  let lineas;
  try { lineas = await store.lineasDeConteo(borrador.conteo_id); }
  catch (err) { cont.innerHTML = `<div class="card"><div class="error-box">No pude cargar el conteo: ${esc(err.message || err)}. ¿Corriste inventario.sql?</div></div>`; return; }

  // Agrupar por categoría (conserva el orden de aparición).
  const cats = [];
  const mapa = new Map();
  for (const l of lineas) {
    const c = l.categoria_snapshot || "Sin categoría";
    if (!mapa.has(c)) { mapa.set(c, []); cats.push(c); }
    mapa.get(c).push(l);
  }

  cont.innerHTML = `
    <div class="card" style="position:sticky;top:0;z-index:5">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div style="min-width:0">
          <div class="sub" style="font-size:11.5px">Conteo ${esc(borrador.fecha)} · borrador</div>
          <div style="font-size:clamp(18px,6vw,26px);font-weight:800;color:#16514f"><span id="inv-total">$0</span></div>
        </div>
        <div style="text-align:right">
          <div id="inv-status" class="sub" style="font-size:11.5px">&nbsp;</div>
          <button class="btn sec chico inv-btn44" id="cerrar">Cerrar conteo</button>
        </div>
      </div>
      <div class="sub" style="font-size:11px;margin-top:6px">💡 Captura todo <b>SIN IVA</b> (el IVA que pagas al proveedor se acredita, no es costo).</div>
    </div>

    ${cats.map((c, i) => `
      <details class="inv-cat" name="invcat" ${i === 0 ? "open" : ""} data-cat="${esc(c)}">
        <summary><span>${esc(c)}</span><span class="sub" style="font-weight:600">$<span class="inv-sub">0</span> · ${mapa.get(c).length}</span></summary>
        <div>${mapa.get(c).map(filaLinea).join("")}</div>
      </details>`).join("")}

    <div class="card">
      <button class="btn sec" id="addart">+ Agregar artículo fuera del catálogo</button>
      <div id="addform"></div>
    </div>
    <div class="inv-foot" style="height:8px"></div>`;

  // ── Auto-guardado con debounce por línea ──
  const timers = {};
  const status = cont.querySelector("#inv-status");
  const setStatus = (t) => { if (status) status.textContent = t; };
  function recalc() {
    let grand = 0;
    cont.querySelectorAll("details[data-cat]").forEach((d) => {
      let sub = 0;
      d.querySelectorAll("[data-linea]").forEach((r) => {
        const v = num(r.querySelector(".inv-cant").value) * num(r.querySelector(".inv-costo").value);
        r.querySelector(".inv-val").textContent = money(v); sub += v;
      });
      const s = d.querySelector(".inv-sub"); if (s) s.textContent = Math.round(sub).toLocaleString("es-MX");
      grand += sub;
    });
    const tt = cont.querySelector("#inv-total"); if (tt) tt.textContent = money(grand);
  }
  function guardar(id, row) {
    setStatus("Guardando…");
    store.guardarLinea(id, {
      cantidad: row.querySelector(".inv-cant").value,
      costo_unitario: row.querySelector(".inv-costo").value,
      nombre_snapshot: row.querySelector(".inv-nom").value,
      unidad_snapshot: row.querySelector(".inv-uni").value,
    }).then(() => setStatus("Guardado " + horaAhora())).catch(() => setStatus("⚠ error al guardar"));
  }
  cont.querySelectorAll("[data-linea]").forEach((row) => {
    const id = row.dataset.linea;
    row.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("input", () => {
        recalc();
        clearTimeout(timers[id]); timers[id] = setTimeout(() => guardar(id, row), 800);
      });
    });
  });
  recalc();

  cont.querySelector("#cerrar").onclick = async (e) => {
    if (!confirm("¿Cerrar este conteo? Se actualizarán los costos del catálogo con lo que capturaste. Ya no podrás editarlo.")) return;
    e.target.disabled = true; e.target.textContent = "Cerrando…";
    try { await store.cerrarConteo(borrador.conteo_id); screenConteo(cont); }
    catch (err) { e.target.disabled = false; e.target.textContent = "Cerrar conteo"; alert("No se pudo cerrar: " + (err.message || err)); }
  };

  // ── Agregar artículo fuera de catálogo ──
  cont.querySelector("#addart").onclick = () => {
    const f = cont.querySelector("#addform");
    if (f.innerHTML) { f.innerHTML = ""; return; }
    f.innerHTML = `
      <div style="margin-top:10px;display:grid;gap:8px">
        <input class="inv-in" id="a-nom" placeholder="Nombre del artículo" />
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <input class="inv-in" id="a-cat" placeholder="Categoría" value="${esc(cats[0] || "")}" />
          <input class="inv-in" id="a-uni" placeholder="Unidad (kg, L, pza)" value="pza" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <input class="inv-in inv-num" id="a-cant" type="number" inputmode="decimal" placeholder="Cantidad" />
          <input class="inv-in inv-num" id="a-costo" type="number" inputmode="decimal" placeholder="Costo unit." />
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" id="a-cat2" checked style="width:auto;min-height:auto" /> Guardarlo en el catálogo para el próximo mes</label>
        <button class="btn" id="a-add">Agregar al conteo</button>
      </div>`;
    f.querySelector("#a-add").onclick = async (e) => {
      const nom = f.querySelector("#a-nom").value.trim();
      if (!nom) { f.querySelector("#a-nom").focus(); return; }
      e.target.disabled = true;
      try {
        await store.agregarLineaAdHoc(borrador.conteo_id, {
          nombre: nom, categoria: f.querySelector("#a-cat").value.trim() || "Sin categoría",
          unidad: f.querySelector("#a-uni").value.trim() || "pza",
          cantidad: f.querySelector("#a-cant").value, costo_unitario: f.querySelector("#a-costo").value,
        }, f.querySelector("#a-cat2").checked);
        screenConteo(cont);
      } catch (err) { e.target.disabled = false; alert("No se pudo agregar: " + (err.message || err)); }
    };
  };
}

function filaLinea(l) {
  return `
    <div class="inv-linea" data-linea="${l.id}">
      <input class="inv-in inv-nom" style="min-height:40px" value="${esc(l.nombre_snapshot)}" />
      <div class="inv-grid" style="margin-top:6px">
        <div><span class="inv-lbl">Cantidad</span><input class="inv-in inv-num inv-cant" type="number" inputmode="decimal" min="0" step="any" value="${num(l.cantidad) || ""}" placeholder="0" /></div>
        <div style="width:56px"><span class="inv-lbl">Unidad</span><input class="inv-in inv-uni" style="text-align:center;padding:8px 4px" value="${esc(l.unidad_snapshot)}" /></div>
        <div><span class="inv-lbl">Costo unit.</span><input class="inv-in inv-num inv-costo" type="number" inputmode="decimal" min="0" step="any" value="${num(l.costo_unitario) || ""}" placeholder="0" /></div>
        <div style="text-align:right;min-width:64px"><span class="inv-lbl">Valor</span><span class="inv-val" style="font-weight:700;color:#16514f">$0</span></div>
      </div>
    </div>`;
}

function histConteos() {
  const cs = store.state.invConteos || [];
  if (!cs.length) return "";
  return `<div class="card"><h2 style="margin-top:0">Conteos anteriores</h2>
    ${cs.slice(0, 12).map((c) => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--linea);font-size:13.5px">
      <span>${esc(c.fecha)} · <span class="sub">${c.estado}</span></span><b>${money(c.total)}</b></div>`).join("")}</div>`;
}

// ═══════════════ PANTALLA 2 · CATÁLOGO ═══════════════
function screenCatalogo(cont) {
  let filtro = "", catF = "";
  render();
  function render() {
    const arts = store.state.invArticulos || [];
    const cats = [...new Set(arts.map((a) => a.categoria))];
    let vis = arts.filter((a) => (!catF || a.categoria === catF) && (!filtro || a.nombre.toLowerCase().includes(filtro.toLowerCase())));
    // agrupar por categoría, respetando orden
    const grupos = [];
    const mapa = new Map();
    for (const a of vis) { if (!mapa.has(a.categoria)) { mapa.set(a.categoria, []); grupos.push(a.categoria); } mapa.get(a.categoria).push(a); }
    for (const g of grupos) mapa.get(g).sort((x, y) => (x.orden - y.orden) || x.nombre.localeCompare(y.nombre));

    cont.innerHTML = `
      <div class="card" style="padding:10px">
        <input class="inv-in" id="busc" placeholder="Buscar artículo…" value="${esc(filtro)}" style="margin-bottom:8px" />
        <select class="inv-in" id="catf"><option value="">Todas las categorías</option>${cats.map((c) => `<option${c === catF ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <button class="btn sec" id="nuevo" style="flex:1">+ Nuevo artículo</button>
          <button class="btn sec" id="importar" style="flex:1">⬇ Traer insumos de mis tickets</button>
        </div>
        <div id="nform"></div>
      </div>
      ${grupos.map((g) => `<div class="card" style="padding:0"><div style="padding:10px 12px;font-weight:700;background:var(--fondo-2,#f6f6f4)">${esc(g)}</div>
        ${mapa.get(g).map((a, i, arr) => filaArt(a, i, arr.length)).join("")}</div>`).join("") || `<div class="card"><div class="sub">Sin artículos.</div></div>`}
    `;
    const busc = cont.querySelector("#busc");
    busc.addEventListener("input", (e) => { filtro = e.target.value; render(); setTimeout(() => { const b = cont.querySelector("#busc"); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }, 0); });
    cont.querySelector("#catf").addEventListener("change", (e) => { catF = e.target.value; render(); });
    cont.querySelector("#nuevo").onclick = () => formNuevo(cont.querySelector("#nform"), cats, render);
    cont.querySelector("#importar").onclick = async (e) => {
      if (!confirm("Traer al catálogo los insumos de tus tickets (de 'costo de venta'), usando el área como categoría y el último precio como costo. Los operativos (limpieza, etc.) se omiten. ¿Continuar?")) return;
      e.target.disabled = true; e.target.textContent = "Importando…";
      try {
        const r = await store.importarInsumosACatalogo();
        render();
        alert(r.agregados ? `Se agregaron ${r.agregados} insumos de tus tickets${r.yaEstaban ? " (" + r.yaEstaban + " ya estaban)" : ""}. Revisa que los precios sean SIN IVA.` : "No hay insumos nuevos por traer (ya están todos en el catálogo).");
      } catch (err) { e.target.disabled = false; e.target.textContent = "⬇ Traer insumos de mis tickets"; alert("No se pudo importar: " + (err.message || err)); }
    };

    cont.querySelectorAll("[data-art]").forEach((row) => {
      const id = row.dataset.art;
      const art = arts.find((a) => a.id === id);
      const timers = {};
      row.querySelectorAll("input[data-f]").forEach((inp) => {
        inp.addEventListener("input", () => {
          clearTimeout(timers.t); timers.t = setTimeout(() => {
            store.guardarArticulo({ id, nombre: row.querySelector('[data-f="nombre"]').value, unidad: row.querySelector('[data-f="unidad"]').value, categoria: art.categoria, costo_unitario: row.querySelector('[data-f="costo"]').value, orden: art.orden, activo: art.activo }).catch(() => {});
          }, 700);
        });
      });
      const baja = row.querySelector("[data-baja]");
      if (baja) baja.onclick = async () => { await (art.activo ? store.bajaArticulo(id) : store.reactivarArticulo(id)); render(); };
      const up = row.querySelector("[data-up]"), dn = row.querySelector("[data-dn]");
      if (up) up.onclick = () => mover(art, -1, arts, render);
      if (dn) dn.onclick = () => mover(art, +1, arts, render);
    });
  }
}

function filaArt(a, i, n) {
  const dim = a.activo ? "" : "opacity:.45";
  return `
    <div class="inv-linea" data-art="${a.id}" style="${dim}">
      <div style="display:flex;gap:6px;align-items:center">
        <input class="inv-in" data-f="nombre" value="${esc(a.nombre)}" style="flex:1;min-height:40px" />
        <button class="btn sec chico inv-btn44" data-up ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="btn sec chico inv-btn44" data-dn ${i === n - 1 ? "disabled" : ""}>↓</button>
      </div>
      <div class="inv-grid" style="margin-top:6px;grid-template-columns:1fr 70px 1fr">
        <div><span class="inv-lbl">Costo unit. (sin IVA)</span><input class="inv-in inv-num" data-f="costo" type="number" inputmode="decimal" min="0" step="any" value="${num(a.costo_unitario) || ""}" placeholder="0" /></div>
        <div><span class="inv-lbl">Unidad</span><input class="inv-in" data-f="unidad" value="${esc(a.unidad)}" style="text-align:center;padding:8px 4px" /></div>
        <div style="align-self:end"><button class="btn sec chico inv-btn44" data-baja style="width:100%">${a.activo ? "Dar de baja" : "Reactivar"}</button></div>
      </div>
    </div>`;
}

function formNuevo(host, cats, onDone) {
  if (host.innerHTML) { host.innerHTML = ""; return; }
  host.innerHTML = `
    <div style="margin-top:10px;display:grid;gap:8px">
      <input class="inv-in" id="n-nom" placeholder="Nombre" />
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <input class="inv-in" id="n-cat" placeholder="Categoría" list="n-cats" value="${esc(cats[0] || "")}" />
        <datalist id="n-cats">${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</datalist>
        <input class="inv-in" id="n-uni" placeholder="Unidad" value="pza" />
      </div>
      <input class="inv-in inv-num" id="n-costo" type="number" inputmode="decimal" placeholder="Costo unit. (sin IVA)" />
      <button class="btn" id="n-add">Guardar artículo</button>
    </div>`;
  host.querySelector("#n-add").onclick = async (e) => {
    const nom = host.querySelector("#n-nom").value.trim();
    if (!nom) { host.querySelector("#n-nom").focus(); return; }
    e.target.disabled = true;
    try {
      await store.guardarArticulo({ nombre: nom, categoria: host.querySelector("#n-cat").value.trim() || "Sin categoría", unidad: host.querySelector("#n-uni").value.trim() || "pza", costo_unitario: host.querySelector("#n-costo").value, orden: 999 });
      onDone();
    } catch (err) { e.target.disabled = false; alert("No se pudo guardar: " + (err.message || err)); }
  };
}

async function mover(art, dir, arts, onDone) {
  const hermanos = arts.filter((a) => a.categoria === art.categoria).sort((x, y) => x.orden - y.orden);
  const idx = hermanos.findIndex((a) => a.id === art.id);
  const otro = hermanos[idx + dir];
  if (!otro) return;
  const o1 = art.orden, o2 = otro.orden;
  await store.guardarArticulo({ ...art, orden: o2 });
  await store.guardarArticulo({ ...otro, orden: o1 });
  onDone();
}

// ═══════════════ PANTALLA 3 · CIERRE DE MES ═══════════════
function screenCierre(cont) {
  render();
  function render() {
    const conteos = (store.state.invConteos || []).filter((c) => c.estado === "cerrado" || c.estado === "borrador");
    const cierres = store.state.cierres || [];
    const opt = (sel) => `<option value="">—</option>` + conteos.map((c) => `<option value="${c.conteo_id}"${c.conteo_id === sel ? " selected" : ""}>${esc(c.fecha)} · ${money(c.total)}</option>`).join("");
    const periodo = primerDiaMes();
    const existente = cierres.find((c) => c.periodo === periodo) || {};

    cont.innerHTML = `
      <div class="card">
        <h2 style="margin-top:0">Cierre de mes · ${mesLabel(periodo)}</h2>
        ${conteos.length < 2 ? `<div class="aviso-box" style="margin-bottom:10px">El COGS necesita <b>dos conteos</b> (inicio y fin de mes). Llevas ${conteos.length}. El primer mes no habrá COGS todavía — en cuanto tengas el segundo conteo aparece aquí.</div>` : ""}
        <label class="campo"><span>Conteo inicial (inventario al arranque)</span><select class="inv-in" id="ci">${opt(existente.conteo_inicial_id)}</select></label>
        <label class="campo"><span>Conteo final (inventario al cierre)</span><select class="inv-in" id="cf">${opt(existente.conteo_final_id)}</select></label>
        <label class="campo"><span>Compras del mes (sin IVA)</span><input class="inv-in inv-num" id="cmp" type="number" inputmode="decimal" value="${existente.compras_sin_iva != null ? existente.compras_sin_iva : ""}" placeholder="0" /></label>
        <label class="campo"><span>Consumo de la familia (retiro de socios)</span><input class="inv-in inv-num" id="cfam" type="number" inputmode="decimal" value="${existente.consumo_familia != null ? existente.consumo_familia : ""}" placeholder="0" /></label>
        <label class="campo"><span>Venta neta del mes (sin IVA · frontera 8%)</span><input class="inv-in inv-num" id="cvn" type="number" inputmode="decimal" value="${existente.venta_neta != null ? existente.venta_neta : ""}" placeholder="0" /></label>
        <button class="btn" id="guardar" style="margin-top:8px">Guardar cierre</button>
      </div>
      <div id="resultado">${existente.id ? bloqueResultado(existente) : ""}</div>
      ${cierres.length ? `<div class="card"><h2 style="margin-top:0">Cierres anteriores</h2>
        ${cierres.map((c) => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--linea);font-size:13.5px">
          <span>${esc(mesLabel(c.periodo))}</span>${c.cogs_pct != null ? `<b style="color:${colCogs(c.cogs_pct * 100)}">${(c.cogs_pct * 100).toFixed(1)}% COGS</b>` : `<span class="sub">sin COGS</span>`}</div>`).join("")}</div>` : ""}
    `;

    cont.querySelector("#guardar").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Guardando…";
      try {
        await store.guardarCierre({
          periodo,
          conteo_inicial_id: cont.querySelector("#ci").value,
          conteo_final_id: cont.querySelector("#cf").value,
          compras_sin_iva: cont.querySelector("#cmp").value,
          consumo_familia: cont.querySelector("#cfam").value,
          venta_neta: cont.querySelector("#cvn").value,
        });
        render();
      } catch (err) { e.target.disabled = false; e.target.textContent = "Guardar cierre"; alert("No se pudo guardar: " + (err.message || err)); }
    };
  }
}

function bloqueResultado(c) {
  const falta = c.inventario_inicial == null || c.inventario_final == null;
  if (falta) return `<div class="card"><div class="aviso-box">Faltan los dos conteos (inicial y final) para calcular el COGS de este mes.</div></div>`;
  const pct = c.cogs_pct != null ? c.cogs_pct * 100 : null;
  const col = pct != null ? colCogs(pct) : "var(--gris)";
  const fila = (l, v, b) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--linea)"><span class="sub">${l}</span><span style="${b ? "font-weight:800" : ""}">${v}</span></div>`;
  return `
    <div class="card">
      <div style="text-align:center;padding:10px;border-radius:12px;background:var(--fondo-2,#f6f6f4);margin-bottom:12px">
        <div class="sub">COGS del mes</div>
        <div style="font-size:clamp(26px,9vw,40px);font-weight:800;color:${col}">${pct != null ? pct.toFixed(1) + "%" : "—"}</div>
        <div class="sub">${money(c.cogs)} de costo${c.venta_neta > 0 ? " · sobre " + money(c.venta_neta) + " de venta" : ""}</div>
      </div>
      ${fila("Inventario inicial", money(c.inventario_inicial))}
      ${fila("+ Compras (sin IVA)", money(c.compras_sin_iva))}
      ${fila("− Inventario final", money(c.inventario_final))}
      ${fila("= Consumo", money(c.consumo), true)}
      ${fila("− Consumo familia", money(c.consumo_familia))}
      ${fila("= COGS", money(c.cogs), true)}
      <div class="sub" style="font-size:11px;margin-top:8px">consumo = inicial + compras − final · cogs = consumo − consumo familia · cogs% = cogs / venta neta</div>
    </div>`;
}

const colCogs = (pct) => pct < 35 ? "var(--verde)" : pct <= 40 ? "var(--amarillo)" : "var(--rojo)";
