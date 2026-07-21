// Dashboard del rol COMPRAS: precios de insumos, variación y alertas de subidas.
// Usa el historial real de tickets (store.preciosPorInsumo).
import * as store from "../store.js";
import { money } from "../store.js";

function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

const ALERTA = 0.08; // subida ≥ 8% = foco rojo

export function render(el) {
  const unsub = store.subscribe(pintar);
  pintar();

  function pintar() {
    if (!store.state.listo) { el.innerHTML = `<div class="vacio">Cargando…</div>`; return; }
    const insumos = store.preciosPorInsumo();
    if (!insumos.length) {
      el.innerHTML = `<div class="card"><h2>Compras</h2>
        <div class="aviso-box" style="margin-top:8px">Aún no hay insumos. Captura tickets de compra (pestaña Capturar) y aquí verás precios y variaciones.</div></div>`;
      return;
    }
    const subidas = insumos.filter((i) => i.variacion >= ALERTA).sort((a, b) => b.variacion - a.variacion);
    const lista = insumos.slice().sort((a, b) => Math.abs(b.variacion) - Math.abs(a.variacion) || b.veces - a.veces);

    el.innerHTML = `
      <div class="card">
        <h2>Compras — precios</h2>
        <p class="sub" style="margin-top:-4px">El precio más reciente de cada insumo y cómo cambió respecto a la compra anterior.</p>
        <div class="row-stats" style="margin-top:8px">
          <div class="stat"><div class="n">${insumos.length}</div><div class="l">Insumos</div></div>
          <div class="stat"><div class="n" style="color:${subidas.length ? "var(--rojo)" : "var(--verde)"}">${subidas.length}</div><div class="l">Subieron ≥${Math.round(ALERTA * 100)}%</div></div>
        </div>
      </div>

      ${subidas.length ? `<div class="card" style="border-left:4px solid var(--flame)">
        <h2 style="margin-bottom:8px">🔺 Alertas de precio</h2>
        ${subidas.map((i) => `<div style="font-size:13px;padding:5px 0;border-bottom:1px solid var(--linea)">
          <b>${esc(i.nombre)}</b> subió <b style="color:var(--rojo)">${Math.round(i.variacion * 100)}%</b> → ${money(i.precioActual)}<span class="sub">/${esc(i.unidad || "")}</span></div>`).join("")}
      </div>` : `<div class="card"><div class="ok-box">✅ Sin subidas fuertes de precio esta semana.</div></div>`}

      <div class="card">
        <h2>Todos los insumos</h2>
        <input id="bq" placeholder="Buscar insumo…" style="margin-bottom:10px" />
        <div id="lst">${filaLista(lista)}</div>
        <div class="leyenda" style="margin-top:8px">
          <span><i style="background:var(--rojo)"></i>subió</span>
          <span><i style="background:var(--verde)"></i>bajó</span>
          <span><i style="background:var(--gris)"></i>igual</span>
        </div>
      </div>`;

    const bq = el.querySelector("#bq");
    bq.addEventListener("input", () => {
      const q = bq.value.trim().toLowerCase();
      el.querySelector("#lst").innerHTML = filaLista(lista.filter((i) => i.nombre.toLowerCase().includes(q)));
    });
  }

  return unsub;
}

function filaLista(items) {
  if (!items.length) return `<div class="sub">Sin resultados.</div>`;
  return items.map((i) => {
    const v = i.variacion;
    const col = !v ? "var(--gris)" : v > 0 ? "var(--rojo)" : "var(--verde)";
    const arrow = !v ? "=" : v > 0 ? "▲" : "▼";
    return `<div class="barra-row" style="justify-content:space-between;border-bottom:1px solid var(--linea);padding:7px 0">
      <span class="etq" style="width:auto;flex:1">${esc(i.nombre)}</span>
      <span class="val">${money(i.precioActual)}<span class="sub">/${esc(i.unidad || "")}</span></span>
      <span style="width:60px;text-align:right;color:${col};font-size:12px;font-weight:700">${v ? arrow + " " + Math.abs(Math.round(v * 100)) + "%" : "="}</span>
    </div>`;
  }).join("");
}
