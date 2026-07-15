// Pantalla: presupuesto (meta) semanal y alertas, con selector de semana.
import * as store from "../store.js";
import { COLOR_AREA, money, num, toISO, lunesDe, etiquetaSemana, AREAS } from "../store.js";

export function render(el) {
  let semanaOff = 0; // 0 = esta semana, 1 = pasada, ...

  el.innerHTML = `
    <div class="card" style="padding:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <button class="btn sec chico" id="ant">◀</button>
        <div id="etq" style="font-weight:700;text-align:center;flex:1">—</div>
        <button class="btn sec chico" id="sig">▶</button>
      </div>
    </div>
    <div id="cuerpo"></div>`;

  el.querySelector("#ant").addEventListener("click", () => { semanaOff++; pintar(); });
  el.querySelector("#sig").addEventListener("click", () => { semanaOff = Math.max(0, semanaOff - 1); pintar(); });

  const off = store.subscribe(pintar);
  pintar();

  function semana() {
    const l = lunesDe(new Date());
    l.setDate(l.getDate() - semanaOff * 7);
    const d = new Date(l); d.setDate(l.getDate() + 6);
    return { desde: toISO(l), hasta: toISO(d), lunes: l };
  }

  function pintar() {
    if (!store.state.listo) { el.querySelector("#cuerpo").innerHTML = `<div class="vacio">Cargando…</div>`; return; }

    const { desde, hasta, lunes } = semana();
    el.querySelector("#etq").textContent = etiquetaSemana(lunes) + (semanaOff === 0 ? " (esta)" : "");

    const meta = num(store.state.config.presupuestoSemanal) || 0;
    const lineas = store.lineasEnRango(desde, hasta);
    const gastado = lineas.reduce((a, l) => a + num(l.monto), 0);
    const rest = meta - gastado;
    const pct = meta > 0 ? Math.min(100, 100 * gastado / meta) : 0;
    const color = pct >= 100 ? "var(--rojo)" : pct >= 85 ? "var(--amarillo)" : "var(--verde)";

    let alerta = "";
    if (meta > 0 && gastado > meta) {
      alerta = `<div class="error-box">🔴 Se pasó de la meta por <b>${money(gastado - meta)}</b> esta semana.</div>`;
    } else if (meta > 0 && pct >= 85) {
      alerta = `<div class="aviso-box">🟡 Va al ${Math.round(pct)}% de la meta. Quedan ${money(rest)}.</div>`;
    }

    const porArea = store.sumaPor(lineas, "area");

    el.querySelector("#cuerpo").innerHTML = `
      ${alerta}
      <div class="card">
        <div class="row-stats" style="margin-bottom:14px">
          <div class="stat"><div class="n">${money(gastado)}</div><div class="l">Gastado</div></div>
          <div class="stat"><div class="n" style="color:${rest < 0 ? "var(--rojo)" : "var(--verde)"}">${money(rest)}</div><div class="l">${rest < 0 ? "Excedido" : "Disponible"}</div></div>
        </div>
        <div class="barra-track" style="height:14px"><span class="barra-fill" style="width:${pct}%;background:${color}"></span></div>
        <div class="sub" style="margin-top:6px">${meta > 0 ? `Meta: ${money(meta)} · ${Math.round(pct)}% usado` : "Sin meta definida"}</div>
      </div>

      <div class="card">
        <h2>Gasto por área (esta semana)</h2>
        ${areasHTML(porArea)}
      </div>

      <div class="card">
        <h2>Configurar meta</h2>
        <label class="campo"><span>Meta de gasto por semana (MXN)</span>
          <input id="meta" type="number" step="any" inputmode="decimal" value="${meta || ""}" placeholder="45000" /></label>
        <button class="btn" id="guardar">Guardar meta</button>
        <div id="ok"></div>
      </div>`;

    el.querySelector("#guardar").addEventListener("click", async () => {
      const v = num(el.querySelector("#meta").value);
      try {
        await store.guardarConfig({ presupuestoSemanal: v });
        el.querySelector("#ok").innerHTML = `<div class="ok-box" style="margin-top:10px">Meta guardada.</div>`;
      } catch (err) { alert("No pude guardar: " + ((err && err.message) || err)); }
    });
  }

  function areasHTML(porArea) {
    const max = Math.max(1, ...Object.values(porArea));
    const filas = AREAS.filter((a) => porArea[a]).map((a) => `
      <div class="barra-row">
        <span class="etq">${a}</span>
        <span class="barra-track"><span class="barra-fill" style="width:${Math.max(3, 100 * porArea[a] / max)}%;background:${COLOR_AREA[a]};opacity:${(0.4 + 0.6 * (porArea[a] / max)).toFixed(2)}"></span></span>
        <span class="val">${money(porArea[a])}</span>
      </div>`).join("");
    return filas || `<div class="sub">Sin gasto esta semana.</div>`;
  }

  return off;
}
