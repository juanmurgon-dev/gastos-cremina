// Cálculo de meta de compras (antes vivía en Proyección). Se usa como
// sub-pestaña de Gastos. Sugiere cuánto gastar en insumos según la venta
// proyectada (semana pasada +5%) y un % objetivo; guarda como meta semanal.
import * as store from "../store.js";
import { money, num, toISO, lunesDe } from "../store.js";

let pctSel = 0.26;        // % objetivo (máx 26%)
let ventaEsperEd = null;  // override editable de la venta proyectada

// Venta de la última semana COMPLETA con ventas.
function ventaSemanaAnterior() {
  const sems = store.ventasSemanas(8) || [];
  for (let i = 1; i < sems.length; i++) if (sems[i].venta > 0) return sems[i].venta;
  return sems[0] && sems[0].venta > 0 ? sems[0].venta : 0;
}

export function montar(el) {
  const unsub = store.subscribe(pintar);
  pintar();

  function pintar() {
    if (!store.state.listo) { el.innerHTML = `<div class="vacio">Cargando…</div>`; return; }
    const proj = ventaEsperEd != null ? ventaEsperEd : Math.round(ventaSemanaAnterior() * 1.05);
    el.innerHTML = `<div class="card"><h2>Cálculo de meta de compras</h2>${cuerpo(proj, pctSel)}</div>`;

    const pctSelEl = el.querySelector("#pctSel");
    if (pctSelEl) pctSelEl.addEventListener("change", () => { pctSel = num(pctSelEl.value) / 100; pintar(); });
    const inpVE = el.querySelector("#veEsper");
    if (inpVE) inpVE.addEventListener("change", () => { ventaEsperEd = num(inpVE.value); pintar(); });
    const usar = el.querySelector("#usarPresu");
    if (usar) usar.addEventListener("click", async () => {
      const sug = Math.round(pctSel * proj);
      if (sug <= 0) return;
      usar.disabled = true; usar.textContent = "Guardando…";
      try {
        await store.guardarMetaSemana(toISO(lunesDe(new Date())), sug);  // meta de esta semana en adelante
        usar.textContent = "✅ Guardado como meta";
      } catch (e) {
        alert("No pude guardar: " + ((e && e.message) || e));
        usar.disabled = false; usar.textContent = "Usar como meta semanal";
      }
    });
  }

  return unsub;
}

function cuerpo(proj, pct) {
  const opciones = [26, 24, 22, 20, 18, 15];
  const pctInt = Math.round(pct * 100);
  const sugerido = Math.round(pct * proj);
  const selHtml = `<select id="pctSel">${opciones.map((p) =>
    `<option value="${p}"${p === pctInt ? " selected" : ""}>${p}%${p === 26 ? " (tu ritmo sano)" : ""}</option>`).join("")}</select>`;

  const cabeza = `
    <p class="sub" style="margin-top:-4px">Cuánto gastar en insumos esta semana, según tu venta proyectada.</p>
    <label class="campo"><span>Meta de gasto (% de la venta)</span>${selHtml}</label>
    <label class="campo"><span>Venta proyectada (semana pasada +5%)</span><input id="veEsper" type="number" inputmode="decimal" value="${Math.round(proj)}" /></label>`;

  if (proj <= 0)
    return cabeza + `<div class="sub" style="margin-top:8px">Necesito la venta de la semana pasada (cortes) para proyectar; o escríbela arriba.</div>`;

  return cabeza + `
    <div class="row-stats" style="margin-top:12px">
      <div class="stat"><div class="n" style="color:var(--verde)">${money(sugerido)}</div><div class="l">meta / semana</div></div>
      <div class="stat"><div class="n">${money(sugerido / 7)}</div><div class="l">por día</div></div>
    </div>
    <div class="sub" style="margin-top:6px">= ${pctInt}% × ${money(proj)} (semana pasada +5%).</div>
    <button class="btn" id="usarPresu" style="margin-top:12px">Usar como meta semanal</button>`;
}
