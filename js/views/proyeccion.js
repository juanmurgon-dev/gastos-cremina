// Pantalla: Proyección — ¿voy a cumplir utilidad esta semana?
// Junta venta (cortes) − gasto variable (tickets) − gasto fijo (prorrateado) = utilidad.
// Incluye proyección al cierre, punto de equilibrio y el editor de gastos fijos.
import * as store from "../store.js";
import { money, num, toISO, lunesDe, etiquetaSemana } from "../store.js";

function kmoney(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + (Math.trunc(n / 1000) / 1000).toFixed(3).replace(/\.?0+$/, "") + "M";
  if (a >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + Math.round(n);
}
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

// Gasto variable "sano" como % de la venta (referencia: $45k sobre $170k = 26%).
const RATIO_SANO = 0.26;

export function render(el) {
  let off = 0;
  let ventaEsperEd = null;   // override editable de venta esperada (no persistido)
  const unsub = store.subscribe(pintar);
  pintar();

  function semana() {
    const l = lunesDe(new Date());
    l.setDate(l.getDate() - off * 7);
    const d = new Date(l); d.setDate(l.getDate() + 6);
    return { desde: toISO(l), hasta: toISO(d), lunes: l };
  }

  function pintar() {
    if (!store.state.listo) { el.innerHTML = `<div class="vacio">Cargando…</div>`; return; }

    const { desde, hasta, lunes } = semana();
    const venta = store.cortesEnRango(desde, hasta).reduce((a, c) => a + num(c.ventas_total), 0);
    const gastoVar = store.lineasEnRango(desde, hasta).reduce((a, l) => a + num(l.monto), 0);
    const gfMes = store.gastoFijoMensual();
    const gfSem = gfMes / 30 * 7;
    const utilidad = venta - gastoVar - gfSem;
    const margen = venta > 0 ? utilidad / venta * 100 : 0;
    const colU = utilidad >= 0 ? "var(--verde)" : "var(--rojo)";

    let proy = null;
    if (off === 0) {
      const hoy = new Date();
      const dias = Math.min(7, Math.max(1, Math.floor((hoy - lunes) / 86400000) + 1));
      if (dias < 7) {
        const pv = venta / dias * 7, pg = gastoVar / dias * 7;
        proy = { dias, venta: pv, util: pv - pg - gfSem };
      }
    }

    // Margen de contribución ESTABLE: de todo el historial, no de una sola
    // semana (una compra grande puntual no debe romper el cálculo).
    const contrib = margenContrib();            // 0..1, o null si no hay ventas
    const beSem = (contrib != null && contrib > 0.02) ? gfSem / contrib : 0;
    const beDia = beSem / 7;
    const ventaDia = venta / 7;

    const gf = (store.state.gastosFijos || []).slice().sort((a, b) => num(b.monto_mensual) - num(a.monto_mensual));

    // Presupuesto de compras: 26% sano × venta esperada de la semana actual.
    const prom = promSemReciente();
    const ventaEsper = ventaEsperEd != null ? ventaEsperEd : Math.round(prom.venta);

    el.innerHTML = `
      <div class="card" style="padding:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <button class="btn sec chico" id="ant">◀</button>
          <div style="text-align:center;flex:1"><div style="font-weight:700">${etiquetaSemana(lunes)}</div>
            <div class="sub">${off === 0 ? "Esta semana" : off === 1 ? "Semana pasada" : "hace " + off + " semanas"}</div></div>
          <button class="btn sec chico" id="sig">▶</button>
        </div>
      </div>

      <div class="card">
        <div class="stat" style="padding:2px 0 10px">
          <div class="n" style="font-size:30px;color:${colU}">${money(utilidad)}</div>
          <div class="l">Utilidad de la semana ${venta > 0 ? "· margen " + Math.round(margen) + "%" : ""}</div>
        </div>
        ${filaCalc("Venta", venta, "var(--verde-claro)")}
        ${filaCalc("− Gasto variable (compras)", -gastoVar, "var(--naranja)")}
        ${filaCalc("− Gasto fijo (semana)", -gfSem, "var(--olive)")}
        <div class="barra-row" style="border-top:1px solid var(--linea);margin-top:6px;padding-top:8px;font-weight:700">
          <span class="etq" style="width:auto;flex:1">= Utilidad</span>
          <span class="val" style="color:${colU}">${money(utilidad)}</span>
        </div>
        ${gfMes === 0 ? `<div class="aviso-box" style="margin-top:10px">Aún no registras gastos fijos (renta, sueldos…). Agrégalos abajo para que la utilidad sea real.</div>` : ""}
      </div>

      ${proy ? `
      <div class="card">
        <h2>Proyección al cierre</h2>
        <p class="sub" style="margin-top:-4px">Vas ${proy.dias} de 7 días. Si sigue este ritmo:</p>
        <div class="row-stats">
          <div class="stat"><div class="n">${kmoney(proy.venta)}</div><div class="l">Venta proyectada</div></div>
          <div class="stat"><div class="n" style="color:${proy.util >= 0 ? "var(--verde)" : "var(--rojo)"}">${kmoney(proy.util)}</div><div class="l">Utilidad proyectada</div></div>
        </div>
        <div class="${proy.util >= 0 ? "ok-box" : "aviso-box"}" style="margin-top:10px">${proy.util >= 0
          ? `✅ A este ritmo cierras la semana con ${money(proy.util)} de utilidad.`
          : `⚠️ A este ritmo cierras la semana con pérdida de ${money(Math.abs(proy.util))}.`}</div>
      </div>` : ""}

      <div class="card">
        <h2>Punto de equilibrio</h2>
        ${beCuerpo(gfMes, contrib, beDia, beSem, ventaDia, venta)}
      </div>

      <div class="card">
        <h2>Presupuesto de compras sugerido</h2>
        ${presuCuerpo(ventaEsper, prom.gasto)}
      </div>

      <div class="card">
        <h2>Gastos fijos</h2>
        <div class="sub" style="margin-top:-4px">Total mensual: <b>${money(gfMes)}</b> · semanal ${money(gfSem)}</div>
        <div style="margin:10px 0">
          ${gf.length ? gf.map(filaGF).join("") : `<div class="sub">Aún no hay gastos fijos.</div>`}
        </div>
        <div class="titulo-seccion">Agregar gasto fijo</div>
        <label class="campo"><span>Concepto</span><input id="gfc" placeholder="Ej. Renta, Sueldos, Luz…" /></label>
        <label class="campo"><span>Monto mensual (MXN)</span><input id="gfm" type="number" step="any" inputmode="decimal" placeholder="0" /></label>
        <button class="btn" id="gfadd">Agregar</button>
      </div>`;

    el.querySelector("#ant").addEventListener("click", () => { off++; pintar(); });
    el.querySelector("#sig").addEventListener("click", () => { off = Math.max(0, off - 1); pintar(); });

    const inpVE = el.querySelector("#veEsper");
    if (inpVE) inpVE.addEventListener("change", () => { ventaEsperEd = num(inpVE.value); pintar(); });
    const usar = el.querySelector("#usarPresu");
    if (usar) usar.addEventListener("click", async () => {
      const sug = Math.round(RATIO_SANO * ventaEsper);
      if (sug <= 0) return;
      usar.disabled = true; usar.textContent = "Guardando…";
      try {
        await store.guardarConfig({ presupuestoSemanal: sug });
        usar.textContent = "✅ Guardado como meta";
      } catch (e) {
        alert("No pude guardar: " + ((e && e.message) || e));
        usar.disabled = false; usar.textContent = "Usar como meta semanal";
      }
    });

    el.querySelector("#gfadd").addEventListener("click", async () => {
      const concepto = el.querySelector("#gfc").value.trim();
      const monto = num(el.querySelector("#gfm").value);
      if (!concepto || !monto) return;
      try { await store.guardarGastoFijo({ concepto, monto_mensual: monto }); }
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

// Margen de contribución promedio de TODO el historial (venta − compras)/venta.
// Estable: una semana con compras grandes no lo distorsiona. null si no hay ventas.
function margenContrib() {
  const cortes = store.state.cortes || [];
  if (!cortes.length) return null;
  let min = null, max = null, vTot = 0;
  for (const c of cortes) {
    if (!c.fecha) continue;
    if (!min || c.fecha < min) min = c.fecha;
    if (!max || c.fecha > max) max = c.fecha;
    vTot += num(c.ventas_total);
  }
  if (vTot <= 0) return null;
  const gTot = store.lineasEnRango(min || "0000-01-01", max || "9999-12-31")
    .reduce((a, l) => a + num(l.monto), 0);
  return 1 - gTot / vTot;
}

// Promedio semanal reciente (venta y gasto variable). Usa semanas COMPLETAS
// (salta la semana en curso, que va a medias) y con ventas.
function promSemReciente() {
  const todas = store.ventasSemanas(9) || [];
  let sems = todas.slice(1).filter((s) => s.venta > 0);          // completas recientes
  if (!sems.length) sems = todas.filter((s) => s.venta > 0);      // respaldo: cualquiera
  sems = sems.slice(0, 6);
  if (!sems.length) return { venta: 0, gasto: 0, n: 0 };
  const venta = sems.reduce((a, s) => a + s.venta, 0) / sems.length;
  const gasto = sems.reduce((a, s) => a + s.gasto, 0) / sems.length;
  return { venta, gasto, n: sems.length };
}

// Presupuesto = 26% sano × venta esperada de la semana actual.
function presuCuerpo(ventaEsper, gastoRealSem) {
  const pctRef = Math.round(RATIO_SANO * 100);
  const sugerido = Math.round(RATIO_SANO * ventaEsper);

  const cabeza = `
    <p class="sub" style="margin-top:-4px">Al ${pctRef}% sano de la venta (tu proporción de la buena época). Si vendes menos, compra menos.</p>
    <label class="campo"><span>Venta semanal esperada (MXN)</span><input id="veEsper" type="number" inputmode="decimal" value="${Math.round(ventaEsper)}" /></label>`;

  if (ventaEsper <= 0)
    return cabeza + `<div class="sub" style="margin-top:8px">Escribe tu venta esperada (o carga cortes) para ver el presupuesto.</div>`;

  let compara = "";
  if (gastoRealSem > 0) {
    const diff = gastoRealSem - sugerido;
    const pctReal = Math.round(gastoRealSem / ventaEsper * 100);
    if (diff > sugerido * 0.03)
      compara = `<div class="aviso-box" style="margin-top:10px">⚠️ Hoy gastas ~${money(gastoRealSem)}/sem (${pctReal}% de la venta). Te estás pasando <b>~${money(diff)}/semana</b> (${money(diff / 7)}/día). Baja las compras hacia ${money(sugerido)}.</div>`;
    else if (diff < -sugerido * 0.03)
      compara = `<div class="ok-box" style="margin-top:10px">✅ Hoy gastas ~${money(gastoRealSem)}/sem, por debajo del presupuesto. Bien.</div>`;
    else
      compara = `<div class="ok-box" style="margin-top:10px">✅ Hoy gastas ~${money(gastoRealSem)}/sem, justo en el presupuesto.</div>`;
  }

  return cabeza + `
    <div class="row-stats" style="margin-top:12px">
      <div class="stat"><div class="n" style="color:var(--verde)">${money(sugerido)}</div><div class="l">presupuesto / semana</div></div>
      <div class="stat"><div class="n">${money(sugerido / 7)}</div><div class="l">por día</div></div>
    </div>
    <div class="sub" style="margin-top:6px">= ${pctRef}% × ${money(ventaEsper)} de venta esperada.</div>
    ${compara}
    <button class="btn" id="usarPresu" style="margin-top:12px">Usar como meta semanal</button>`;
}

function beCuerpo(gfMes, contrib, beDia, beSem, ventaDia, venta) {
  if (gfMes === 0)
    return `<div class="sub">Registra tus gastos fijos (abajo) para calcular el punto de equilibrio.</div>`;
  if (contrib == null)
    return `<div class="sub">Necesito ventas cargadas (cortes de caja) para calcularlo.</div>`;
  if (contrib <= 0.02)
    return `<div class="aviso-box">Tu costo de insumos se está comiendo casi toda la venta (margen ${Math.round(contrib * 100)}%). Baja el costo variable antes de que haya punto de equilibrio.</div>`;
  return `
    <p class="sub" style="margin-top:-4px">Con tu margen promedio (<b>${Math.round(contrib * 100)}%</b>), para NO perder necesitas vender:</p>
    <div class="row-stats">
      <div class="stat"><div class="n">${money(beDia)}</div><div class="l">por día</div></div>
      <div class="stat"><div class="n">${money(beSem)}</div><div class="l">por semana</div></div>
    </div>
    ${venta > 0 ? `<div class="${ventaDia >= beDia ? "ok-box" : "aviso-box"}" style="margin-top:10px">${ventaDia >= beDia
      ? `✅ Vas por ${money(ventaDia)}/día, arriba del punto de equilibrio.`
      : `⚠️ Vas por ${money(ventaDia)}/día; te faltan ${money(beDia - ventaDia)}/día para cubrir costos.`}</div>`
      : `<div class="sub" style="margin-top:10px">Aún no hay ventas esta semana para comparar.</div>`}`;
}

function filaCalc(etq, val, color) {
  return `<div class="barra-row">
    <span class="etq" style="width:auto;flex:1">${etq}</span>
    <span class="val" style="color:${color}">${money(val)}</span>
  </div>`;
}

function filaGF(g) {
  return `<div class="barra-row" style="justify-content:space-between">
    <span class="etq" style="width:auto;flex:1">${esc(g.concepto || "—")}</span>
    <span class="val">${money(g.monto_mensual)}/mes</span>
    <button class="linkbtn" data-del="${g.id}" style="color:var(--rojo);padding:0 4px">✕</button>
  </div>`;
}
