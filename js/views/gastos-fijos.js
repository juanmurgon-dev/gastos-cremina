// Editor de gastos fijos (renta, sueldos, servicios…). Reutilizable.
import * as store from "../store.js";
import { money, num } from "../store.js";

function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

export function montar(el) {
  const unsub = store.subscribe(pintar);
  pintar();

  function pintar() {
    if (!store.state.listo) { el.innerHTML = `<div class="vacio">Cargando…</div>`; return; }
    const gf = (store.state.gastosFijos || []).slice().sort((a, b) => num(b.monto_mensual) - num(a.monto_mensual));
    const mes = store.gastoFijoMensual();

    el.innerHTML = `
      <div class="card">
        <h2>Gastos fijos</h2>
        <p class="sub" style="margin-top:-4px">Lo que pagas cada mes pase lo que pase: renta, sueldos, luz, internet…</p>
        <div class="row-stats" style="margin:10px 0 12px">
          <div class="stat"><div class="n">${money(mes)}</div><div class="l">Mensual</div></div>
          <div class="stat"><div class="n">${money(mes / 30 * 7)}</div><div class="l">Semanal</div></div>
          <div class="stat"><div class="n">${money(mes / 30)}</div><div class="l">Diario</div></div>
        </div>
        <div>${gf.length ? gf.map(fila).join("") : `<div class="sub">Aún no hay gastos fijos. Agrégalos abajo.</div>`}</div>
      </div>
      <div class="card">
        <h2>Agregar gasto fijo</h2>
        <label class="campo"><span>Concepto</span><input id="gfc" placeholder="Ej. Renta, Sueldos, Luz, Internet…" /></label>
        <label class="campo"><span>Monto mensual (MXN)</span><input id="gfm" type="number" step="any" inputmode="decimal" placeholder="0" /></label>
        <button class="btn" id="gfadd">Agregar</button>
      </div>`;

    el.querySelector("#gfadd").addEventListener("click", async () => {
      const c = el.querySelector("#gfc").value.trim();
      const m = num(el.querySelector("#gfm").value);
      if (!c || !m) return;
      try { await store.guardarGastoFijo({ concepto: c, monto_mensual: m }); }
      catch (e) { alert("No pude guardar: " + ((e && e.message) || e)); }
    });
    el.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("¿Borrar este gasto fijo?")) return;
        try { await store.borrarGastoFijo(b.dataset.del); }
        catch (e) { alert("No pude borrar: " + ((e && e.message) || e)); }
      }));
  }

  return unsub;
}

function fila(g) {
  return `<div class="barra-row" style="justify-content:space-between">
    <span class="etq" style="width:auto;flex:1">${esc(g.concepto || "—")}</span>
    <span class="val">${money(g.monto_mensual)}/mes</span>
    <button class="linkbtn" data-del="${g.id}" style="color:var(--rojo);padding:0 6px;font-size:16px">✕</button>
  </div>`;
}
