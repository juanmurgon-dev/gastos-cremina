// Pantalla: Margen — margen por platillo (costo directo por platillo).
//   precio  = venta / unidades   (de productos_venta / variantes_venta)
//   margen  = precio - costo      (costo capturado a mano)
//   margen% = margen / precio
// Desglosa por VARIANTE del grupo modificador: p. ej. "Chilaquiles Poblanos",
// "Chilaquiles Rojos", etc. Cada variante puede tener su costo, o heredar el
// "costo base" del platillo. Muestra mina de oro y alertas de margen bajo.
import * as store from "../store.js";
import { money } from "../store.js";
import * as info from "../info.js";

const ES_CORTESIA = /pan de cortes[íi]a/i;
// La leche/temperatura no es el grupo principal (para no confundir el desglose).
const ES_SECUNDARIO = /leche|fr[íi]o|caliente|shot|cold foam|temperatura/i;

function escapar(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Color según qué tan sano es el margen (%).
function cColor(pct) {
  if (pct == null) return "#7ea8a2";
  if (pct < 15) return "#e5484d";
  if (pct < 30) return "#ff9f1c";
  if (pct < 45) return "#2ec4b6";
  return "#148b7f";
}

// Elige el grupo modificador principal de un platillo (igual que en Ventas).
function elegirGrupo(grupos) {
  const unidades = (g) => grupos[g].reduce((a, r) => a + store.num(r.unidades), 0);
  const pool = Object.keys(grupos).filter((n) => !ES_SECUNDARIO.test(n));
  const base = pool.length ? pool : Object.keys(grupos);
  let cand = base.filter((n) => n.toLowerCase().startsWith("tipo"));
  if (!cand.length) cand = base.filter((n) => n.toLowerCase().startsWith("sabor"));
  if (!cand.length) cand = base;
  return cand.sort((a, b) => unidades(b) - unidades(a))[0];
}

export function render(el) {
  el.innerHTML = `<div id="mroot"></div>`;
  const root = el.querySelector("#mroot");
  let periodo = null;
  let vistaItems = [];   // items del render actual, para abrir el editor por índice

  function listaPeriodos() {
    const pmap = new Map();
    for (const p of store.state.productos || []) if (!pmap.has(p.periodo)) pmap.set(p.periodo, p.desde);
    for (const v of store.state.variantes || []) if (!pmap.has(v.periodo)) pmap.set(v.periodo, v.desde);
    return [...pmap.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map((e) => e[0]);
  }

  // Arma la lista de "renglones": una por variante (platillo + opción), o una
  // por platillo cuando no tiene grupo modificador.
  function construirItems(periodo) {
    // En modo "solo artículo" ignoramos las variantes: el margen se arma a
    // nivel platillo (el costo se captura por platillo, no por variante).
    const varAll = store.usaVariantes() ? (store.state.variantes || []) : [];
    const vars = varAll.filter((v) =>
      v.periodo === periodo && !ES_CORTESIA.test(v.producto || "") && !ES_CORTESIA.test(v.opcion || ""));

    const porProd = new Map();
    for (const v of vars) {
      if (!porProd.has(v.producto)) porProd.set(v.producto, {});
      const g = porProd.get(v.producto);
      (g[v.grupo] = g[v.grupo] || []).push(v);
    }

    const items = [];
    const conVariantes = new Set();
    for (const [prod, grupos] of porProd) {
      const gname = elegirGrupo(grupos);
      const porOp = new Map();
      for (const r of (grupos[gname] || [])) {
        const o = porOp.get(r.opcion) || { unidades: 0, venta: 0 };
        o.unidades += store.num(r.unidades); o.venta += store.num(r.venta);
        porOp.set(r.opcion, o);
      }
      let alguna = false;
      for (const [opcion, o] of porOp) {
        if (o.venta <= 0) continue;
        items.push({ tipo: "var", prod, opcion, label: `${prod} ${opcion}`,
          key: `${prod} · ${opcion}`, baseKey: prod, unidades: o.unidades, venta: o.venta });
        alguna = true;
      }
      if (alguna) conVariantes.add(prod);
    }

    // Platillos sin grupo modificador → un solo renglón (de productos_venta).
    const agg = new Map();
    for (const p of store.state.productos || []) {
      if (p.periodo !== periodo) continue;
      const nom = p.producto || "";
      if (ES_CORTESIA.test(nom) || ES_CORTESIA.test(p.categoria || "")) continue;
      if (conVariantes.has(nom)) continue;      // ya está desglosado por variante
      const venta = store.num(p.venta), uds = store.num(p.cantidad);
      if (venta <= 0) continue;
      const a = agg.get(nom) || { unidades: 0, venta: 0 };
      a.unidades += uds; a.venta += venta; agg.set(nom, a);
    }
    for (const [prod, a] of agg)
      items.push({ tipo: "dish", prod, label: prod, key: prod, baseKey: null, unidades: a.unidades, venta: a.venta });

    return items;
  }

  function pintar() {
    if (!store.state.listo) { root.innerHTML = `<div class="vacio">Cargando…</div>`; return; }
    const prodAll = store.state.productos || [], varAll = store.state.variantes || [];
    if (!prodAll.length && !varAll.length) {
      root.innerHTML = `<div class="card"><div class="aviso-box">Aún no hay ventas por producto. Corre <b>importar-productos.sql</b> e <b>importar-variantes.sql</b> en Supabase.</div></div>`;
      return;
    }
    const pers = listaPeriodos();
    if (!periodo || !pers.includes(periodo)) periodo = pers[0];

    const costos = store.mapaCostos();
    const items = construirItems(periodo).map((it) => {
      const precio = it.unidades > 0 ? it.venta / it.unidades : 0;
      const propio = costos.has(it.key);
      const heredado = !propio && it.baseKey && costos.has(it.baseKey);
      const costo = propio ? costos.get(it.key) : (heredado ? costos.get(it.baseKey) : null);
      const tiene = costo != null;
      const margen = tiene ? precio - costo : null;
      const margenPct = tiene && precio > 0 ? margen / precio * 100 : null;
      const utilidad = tiene ? margen * it.unidades : null;
      return { ...it, precio, costo, tiene, heredado, margen, margenPct, utilidad };
    });

    const conCosto = items.filter((i) => i.tiene).sort((a, b) => b.utilidad - a.utilidad);
    const sinCosto = items.filter((i) => !i.tiene).sort((a, b) => b.venta - a.venta);
    vistaItems = [...conCosto, ...sinCosto];

    const ventaCosteada = conCosto.reduce((s, r) => s + r.venta, 0);
    const utilTotal = conCosto.reduce((s, r) => s + r.utilidad, 0);
    const margenProm = ventaCosteada > 0 ? utilTotal / ventaCosteada * 100 : null;
    const mina = conCosto[0] || null;
    const bajos = conCosto.filter((r) => r.margenPct != null && r.margenPct < 30).length;

    root.innerHTML = `
      <div class="card" style="padding:10px">
        <select id="per">${pers.map((p) => `<option value="${escapar(p)}"${p === periodo ? " selected" : ""}>${escapar(p)}</option>`).join("")}</select>
      </div>

      <div class="card">
        <div class="row-stats">
          <div class="stat"><div class="n" style="color:${cColor(margenProm)}">${margenProm == null ? "—" : Math.round(margenProm) + "%"}</div><div class="l">Margen prom.${info.icono("margen")}</div></div>
          <div class="stat"><div class="n" style="font-size:15px">${mina ? escapar(mina.label) : "—"}</div><div class="l">🏆 Mina de oro${info.icono("minaOro")}</div></div>
          <div class="stat"><div class="n">${sinCosto.length}</div><div class="l">Sin costo</div></div>
        </div>
        ${margenProm == null
          ? `<p class="sub" style="margin:10px 2px 0">Captura el costo de cada variante (o un costo base del platillo). Empieza por los más vendidos 👇</p>`
          : (bajos ? `<p class="sub" style="margin:10px 2px 0">⚠️ ${bajos} con margen bajo (&lt;30%).</p>` : "")}
      </div>

      ${conCosto.length ? `<div class="card">
        <h2>Margen por platillo y variante</h2>
        <p class="sub" style="margin-top:-4px">Ordenados por utilidad. Toca uno para editar su costo.</p>
        <div id="lc">${conCosto.map((it, i) => fila(it, i)).join("")}</div>
      </div>` : ""}

      <div class="card">
        <h2>Falta capturar costo${sinCosto.length ? ` (${sinCosto.length})` : ""}</h2>
        ${sinCosto.length
          ? `<div id="ls">${sinCosto.slice(0, 60).map((it, i) => filaSinCosto(it, conCosto.length + i)).join("")}</div>`
          : `<div class="sub">¡Todo tiene costo! 🎉</div>`}
      </div>`;

    root.querySelector("#per").addEventListener("change", (e) => { periodo = e.target.value; pintar(); });
    root.querySelectorAll("[data-idx]").forEach((n) =>
      n.addEventListener("click", () => editarCosto(vistaItems[+n.dataset.idx])));
  }

  function fila(it, idx) {
    const w = Math.max(0, Math.min(100, it.margenPct || 0));
    const nota = it.heredado ? ` · <span style="color:#7ea8a2">costo base</span>` : "";
    return `<div data-idx="${idx}" style="cursor:pointer;padding:10px 2px;border-top:1px solid #eef2f1">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">
        <b style="font-size:15px">${escapar(it.label)}</b>
        <span style="color:${cColor(it.margenPct)};font-weight:700">${Math.round(it.margenPct)}%</span>
      </div>
      <div style="height:8px;background:#eef2f1;border-radius:6px;overflow:hidden;margin:6px 0">
        <div style="height:100%;width:${w}%;background:${cColor(it.margenPct)};border-radius:6px"></div>
      </div>
      <div class="sub" style="display:flex;justify-content:space-between;gap:8px;font-size:12px">
        <span>Precio ${money(it.precio)} · Costo ${money(it.costo)}${nota} · ${it.unidades} vend.</span>
        <span>Utilidad ${money(it.utilidad)}</span>
      </div>
    </div>`;
  }

  function filaSinCosto(it, idx) {
    return `<div data-idx="${idx}" style="cursor:pointer;padding:10px 2px;border-top:1px solid #eef2f1;display:flex;justify-content:space-between;gap:10px;align-items:center">
      <div><b style="font-size:15px">${escapar(it.label)}</b><div class="sub" style="font-size:12px">Precio ${money(it.precio)} · ${it.unidades} vend. · ${money(it.venta)}</div></div>
      <span class="btn sec chico" style="pointer-events:none;flex:none">Poner costo</span>
    </div>`;
  }

  function editarCosto(it) {
    if (!it) return;
    const costos = store.mapaCostos();
    const actual = costos.has(it.key) ? costos.get(it.key) : "";
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `
      <div class="modal">
        <h2 style="margin-bottom:2px">${escapar(it.label)}</h2>
        <div class="sub" style="margin:0 2px 12px">Precio de venta: <b>${money(it.precio)}</b></div>
        <label class="campo"><span>Costo por porción (MXN)</span>
          <input id="c" type="number" inputmode="decimal" min="0" step="1" value="${actual}" placeholder="ej. 38" /></label>
        <div id="prev" class="sub" style="margin:8px 2px 0"></div>
        <div id="err"></div>
        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
          <button class="btn" id="g" style="flex:1;min-width:120px">Guardar</button>
          ${it.tipo === "var" ? `<button class="btn sec" id="base" style="flex:none">Aplicar a todo "${escapar(it.prod)}"</button>` : ""}
        </div>
        ${costos.has(it.key) ? `<button class="btn sec" id="b" style="margin-top:10px;width:100%">Quitar costo de esta variante</button>` : ""}
        <button class="btn sec" id="x" style="margin-top:10px;width:100%">Cancelar</button>
      </div>`;
    document.body.appendChild(bg);
    const inp = bg.querySelector("#c"), prev = bg.querySelector("#prev"), err = bg.querySelector("#err");
    const cerrar = () => bg.remove();

    function preview() {
      if (!(it.precio > 0) || inp.value === "") { prev.textContent = ""; return; }
      const m = it.precio - store.num(inp.value), pct = m / it.precio * 100;
      prev.innerHTML = `Margen: <b style="color:${cColor(pct)}">${money(m)} (${Math.round(pct)}%)</b>`;
    }
    inp.addEventListener("input", preview); preview();

    async function guardar(clave, btn) {
      btn.disabled = true; const t = btn.textContent; btn.textContent = "Guardando…"; err.innerHTML = "";
      try { await store.guardarCostoPlatillo(clave, store.num(inp.value)); cerrar(); }
      catch (e) {
        err.innerHTML = `<div class="error-box">No se pudo guardar. ¿Corriste <b>costos-platillo.sql</b>?</div>`;
        btn.disabled = false; btn.textContent = t;
      }
    }

    bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
    bg.querySelector("#x").addEventListener("click", cerrar);
    bg.querySelector("#g").addEventListener("click", (e) => guardar(it.key, e.currentTarget));
    const baseBtn = bg.querySelector("#base");
    if (baseBtn) baseBtn.addEventListener("click", (e) => guardar(it.baseKey, e.currentTarget));
    const bBtn = bg.querySelector("#b");
    if (bBtn) bBtn.addEventListener("click", async () => {
      try { await store.borrarCostoPlatillo(it.key); cerrar(); }
      catch (e) { err.innerHTML = `<div class="error-box">No se pudo guardar.</div>`; }
    });
    inp.focus();
  }

  const off = store.subscribe(pintar);
  pintar();
  return off;
}
