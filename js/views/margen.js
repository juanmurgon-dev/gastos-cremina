// Pantalla: Margen — margen por platillo (costo directo por platillo).
//   precio  = venta / unidades   (de productos_venta)
//   margen  = precio - costo      (costo capturado a mano por platillo)
//   margen% = margen / precio
// Muestra los platillos ordenados por utilidad, marca la "mina de oro",
// avisa de márgenes bajos y deja capturar el costo con un toque.
import * as store from "../store.js";
import { money } from "../store.js";

const ES_CORTESIA = /pan de cortes[íi]a/i;
function escapar(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Color según qué tan sano es el margen (%).
function cColor(pct) {
  if (pct == null) return "#7ea8a2";
  if (pct < 15) return "#e5484d";   // rojo: pierde o casi
  if (pct < 30) return "#ff9f1c";   // naranja: bajo
  if (pct < 45) return "#2ec4b6";   // teal: sano
  return "#148b7f";                 // verde: excelente
}

export function render(el) {
  el.innerHTML = `<div id="mroot"></div>`;
  const root = el.querySelector("#mroot");
  let periodo = null;   // se recuerda entre redibujos

  function listaPeriodos() {
    const pmap = new Map();
    for (const p of store.state.productos || []) if (!pmap.has(p.periodo)) pmap.set(p.periodo, p.desde);
    return [...pmap.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map((e) => e[0]);
  }

  function pintar() {
    if (!store.state.listo) { root.innerHTML = `<div class="vacio">Cargando…</div>`; return; }
    const prodAll = store.state.productos || [];
    if (!prodAll.length) {
      root.innerHTML = `<div class="card"><div class="aviso-box">Aún no hay ventas por producto. Corre <b>importar-productos.sql</b> en Supabase.</div></div>`;
      return;
    }
    const pers = listaPeriodos();
    if (!periodo || !pers.includes(periodo)) periodo = pers[0];

    // Sumar ventas por platillo en el periodo (junta el mismo nombre entre categorías).
    const agg = new Map();
    for (const p of prodAll) {
      if (p.periodo !== periodo) continue;
      const nom = p.producto || "";
      if (ES_CORTESIA.test(nom) || ES_CORTESIA.test(p.categoria || "")) continue;
      const venta = store.num(p.venta), uds = store.num(p.cantidad);
      if (venta <= 0) continue;                // cortesías/regalos: sin venta
      const a = agg.get(nom) || { unidades: 0, venta: 0 };
      a.unidades += uds; a.venta += venta; agg.set(nom, a);
    }

    const costos = store.mapaCostos();
    const rows = [...agg.entries()].map(([prod, a]) => {
      const precio = a.unidades > 0 ? a.venta / a.unidades : 0;
      const tiene = costos.has(prod);
      const costo = tiene ? costos.get(prod) : null;
      const margen = tiene ? precio - costo : null;
      const margenPct = tiene && precio > 0 ? margen / precio * 100 : null;
      const utilidad = tiene ? margen * a.unidades : null;
      return { prod, unidades: a.unidades, venta: a.venta, precio, tiene, costo, margen, margenPct, utilidad };
    });

    const conCosto = rows.filter((r) => r.tiene).sort((x, y) => y.utilidad - x.utilidad);
    const sinCosto = rows.filter((r) => !r.tiene).sort((x, y) => y.venta - x.venta);

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
          <div class="stat"><div class="n" style="color:${cColor(margenProm)}">${margenProm == null ? "—" : Math.round(margenProm) + "%"}</div><div class="l">Margen prom.</div></div>
          <div class="stat"><div class="n" style="font-size:16px">${mina ? escapar(mina.prod) : "—"}</div><div class="l">🏆 Mina de oro</div></div>
          <div class="stat"><div class="n">${sinCosto.length}</div><div class="l">Sin costo</div></div>
        </div>
        ${margenProm == null
          ? `<p class="sub" style="margin:10px 2px 0">Captura el costo de tus platillos para ver el margen. Empieza por los más vendidos 👇</p>`
          : (bajos ? `<p class="sub" style="margin:10px 2px 0">⚠️ ${bajos} platillo(s) con margen bajo (&lt;30%).</p>` : "")}
      </div>

      ${conCosto.length ? `<div class="card">
        <h2>Margen por platillo</h2>
        <p class="sub" style="margin-top:-4px">Ordenados por utilidad del periodo. Toca uno para editar su costo.</p>
        <div id="lc">${conCosto.map(filaConCosto).join("")}</div>
      </div>` : ""}

      <div class="card">
        <h2>Falta capturar costo${sinCosto.length ? ` (${sinCosto.length})` : ""}</h2>
        ${sinCosto.length
          ? `<p class="sub" style="margin-top:-4px">Toca un platillo y pon su costo por porción.</p><div id="ls">${sinCosto.slice(0, 50).map(filaSinCosto).join("")}</div>`
          : `<div class="sub">¡Todos tus platillos vendidos tienen costo! 🎉</div>`}
      </div>`;

    root.querySelector("#per").addEventListener("change", (e) => { periodo = e.target.value; pintar(); });
    root.querySelectorAll("[data-prod]").forEach((n) =>
      n.addEventListener("click", () => editarCosto(n.dataset.prod, store.num(n.dataset.precio))));
  }

  function filaConCosto(r) {
    const w = Math.max(0, Math.min(100, r.margenPct || 0));
    return `<div data-prod="${escapar(r.prod)}" data-precio="${r.precio}" style="cursor:pointer;padding:10px 2px;border-top:1px solid #eef2f1">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">
        <b style="font-size:15px">${escapar(r.prod)}</b>
        <span style="color:${cColor(r.margenPct)};font-weight:700">${Math.round(r.margenPct)}%</span>
      </div>
      <div style="height:8px;background:#eef2f1;border-radius:6px;overflow:hidden;margin:6px 0">
        <div style="height:100%;width:${w}%;background:${cColor(r.margenPct)};border-radius:6px"></div>
      </div>
      <div class="sub" style="display:flex;justify-content:space-between;gap:8px;font-size:12px">
        <span>Precio ${money(r.precio)} · Costo ${money(r.costo)} · ${r.unidades} vend.</span>
        <span>Utilidad ${money(r.utilidad)}</span>
      </div>
    </div>`;
  }

  function filaSinCosto(r) {
    return `<div data-prod="${escapar(r.prod)}" data-precio="${r.precio}" style="cursor:pointer;padding:10px 2px;border-top:1px solid #eef2f1;display:flex;justify-content:space-between;gap:10px;align-items:center">
      <div><b style="font-size:15px">${escapar(r.prod)}</b><div class="sub" style="font-size:12px">Precio ${money(r.precio)} · ${r.unidades} vend. · ${money(r.venta)}</div></div>
      <span class="btn sec chico" style="pointer-events:none;flex:none">Poner costo</span>
    </div>`;
  }

  function editarCosto(prod, precio) {
    const actual = store.mapaCostos().get(prod);
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `
      <div class="modal">
        <h2 style="margin-bottom:2px">${escapar(prod)}</h2>
        <div class="sub" style="margin:0 2px 12px">Precio de venta: <b>${money(precio)}</b></div>
        <label class="campo"><span>Costo por porción (MXN)</span>
          <input id="c" type="number" inputmode="decimal" min="0" step="1" value="${actual != null ? actual : ""}" placeholder="ej. 38" /></label>
        <div id="prev" class="sub" style="margin:8px 2px 0"></div>
        <div id="err"></div>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button class="btn" id="g" style="flex:1">Guardar</button>
          ${actual != null ? `<button class="btn sec" id="b" style="flex:none">Quitar</button>` : ""}
        </div>
        <button class="btn sec" id="x" style="margin-top:10px;width:100%">Cancelar</button>
      </div>`;
    document.body.appendChild(bg);
    const inp = bg.querySelector("#c");
    const prev = bg.querySelector("#prev");
    const err = bg.querySelector("#err");
    const cerrar = () => bg.remove();

    function preview() {
      if (!(precio > 0) || inp.value === "") { prev.textContent = ""; return; }
      const m = precio - store.num(inp.value), pct = m / precio * 100;
      prev.innerHTML = `Margen: <b style="color:${cColor(pct)}">${money(m)} (${Math.round(pct)}%)</b>`;
    }
    inp.addEventListener("input", preview); preview();

    bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
    bg.querySelector("#x").addEventListener("click", cerrar);
    const bBtn = bg.querySelector("#b");
    if (bBtn) bBtn.addEventListener("click", async () => {
      try { await store.borrarCostoPlatillo(prod); cerrar(); }
      catch (e) { err.innerHTML = `<div class="error-box">No se pudo guardar.</div>`; }
    });
    bg.querySelector("#g").addEventListener("click", async () => {
      const g = bg.querySelector("#g");
      g.disabled = true; g.textContent = "Guardando…"; err.innerHTML = "";
      try { await store.guardarCostoPlatillo(prod, store.num(inp.value)); cerrar(); }
      catch (e) {
        err.innerHTML = `<div class="error-box">No se pudo guardar. ¿Corriste <b>costos-platillo.sql</b> en Supabase?</div>`;
        g.disabled = false; g.textContent = "Guardar";
      }
    });
    inp.focus();
  }

  const off = store.subscribe(pintar);
  pintar();
  return off;
}
