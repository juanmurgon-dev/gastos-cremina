// Cálculo de meta de compras (antes vivía en Proyección). Se usa como
// sub-pestaña de Gastos. Sugiere cuánto gastar en insumos según la venta
// proyectada (semana pasada +5%) y un % objetivo; guarda como meta semanal.
import * as store from "../store.js";
import { money, num, toISO, lunesDe } from "../store.js";

let proyPct = 0.05;       // proyección de crecimiento sobre la semana pasada (editable)
let pctSel = 0.26;        // % objetivo (máx 26%)
let ventaBaseEd = null;   // override editable de la venta de la SEMANA PASADA (base)

// Venta de la última semana COMPLETA con ventas.
function ventaSemanaAnterior() {
  const sems = store.ventasSemanas(8) || [];
  for (let i = 1; i < sems.length; i++) if (sems[i].venta > 0) return sems[i].venta;
  return sems[0] && sems[0].venta > 0 ? sems[0].venta : 0;
}

export function montar(el) {
  ventaBaseEd = null;     // cada visita arranca desde la venta detectada
  const unsub = store.subscribe(pintar);
  pintar();

  function pintar() {
    if (!store.state.listo) { el.innerHTML = `<div class="vacio">Cargando…</div>`; return; }
    const base = ventaBaseEd != null ? ventaBaseEd : ventaSemanaAnterior();
    const proj = Math.round(base * (1 + proyPct));   // proyección = base + % de crecimiento
    el.innerHTML = `<div class="card"><h2>Cálculo de meta de compras</h2>${cuerpo(base, proj, pctSel, proyPct)}</div>`;

    const pctSelEl = el.querySelector("#pctSel");
    if (pctSelEl) pctSelEl.addEventListener("change", () => { pctSel = num(pctSelEl.value) / 100; pintar(); });
    const inpProy = el.querySelector("#proyPct");
    if (inpProy) inpProy.addEventListener("change", () => { proyPct = num(inpProy.value) / 100; pintar(); });
    const inpBase = el.querySelector("#vBase");
    if (inpBase) inpBase.addEventListener("change", () => { ventaBaseEd = num(inpBase.value); pintar(); });
    const usar = el.querySelector("#usarPresu");
    if (usar) usar.addEventListener("click", async () => {
      const sug = Math.round(pctSel * proj);       // meta = % × (semana pasada +5%)
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

function cuerpo(base, proj, pct, proy) {
  const opciones = [26, 24, 22, 20, 18, 15];
  const pctInt = Math.round(pct * 100);
  const proyInt = Math.round(proy * 100);
  const sugerido = Math.round(pct * proj);
  const selHtml = `<select id="pctSel">${opciones.map((p) =>
    `<option value="${p}"${p === pctInt ? " selected" : ""}>${p}%${p === 26 ? " (tu ritmo sano)" : ""}</option>`).join("")}</select>`;

  const cabeza = `
    <p class="sub" style="margin-top:-4px">Cuánto gastar en insumos esta semana, según tu venta proyectada.</p>
    <label class="campo"><span>Meta de gasto (% de la venta)</span>${selHtml}</label>
    <div class="fila">
      <label class="campo" style="flex:1"><span>Venta de la semana pasada</span>
        <input id="vBase" type="number" inputmode="decimal" value="${Math.round(base)}" /></label>
      <label class="campo" style="width:120px"><span>Proyección (%)</span>
        <input id="proyPct" type="number" inputmode="decimal" value="${proyInt}" /></label>
    </div>`;

  if (proj <= 0)
    return cabeza + `<div class="sub" style="margin-top:8px">Necesito la venta de la semana pasada (cortes) para proyectar; o escríbela arriba.</div>`;

  return cabeza + `
    <div class="aviso-box" style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
      <span>Venta proyectada (<b>+${proyInt}%</b> sobre la semana pasada)</span>
      <b>${money(proj)}</b>
    </div>
    <div class="row-stats" style="margin-top:12px">
      <div class="stat"><div class="n" style="color:var(--verde)">${money(sugerido)}</div><div class="l">meta / semana</div></div>
      <div class="stat"><div class="n">${money(sugerido / 7)}</div><div class="l">por día</div></div>
    </div>
    <div class="sub" style="margin-top:6px">= ${pctInt}% × ${money(proj)}  ·  proyección = ${money(base)} + ${proyInt}% = ${money(proj)}.</div>
    <button class="btn" id="usarPresu" style="margin-top:12px">Usar como meta semanal</button>`;
}
