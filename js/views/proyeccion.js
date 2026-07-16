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

export function render(el) {
  let off = 0;
  let ventaEsperEd = null;   // override editable de la venta proyectada
  let pctSel = 0.26;         // meta de gasto elegida (máx 26%)
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
        // Proyectar con el ritmo REAL de la semana pasada (mismos días), no lineal.
        const pl = new Date(lunes); pl.setDate(pl.getDate() - 7);
        const plFin = new Date(pl); plFin.setDate(pl.getDate() + 6);
        const plPart = new Date(pl); plPart.setDate(pl.getDate() + dias - 1);
        const vFull = store.cortesEnRango(toISO(pl), toISO(plFin)).reduce((a, c) => a + num(c.ventas_total), 0);
        const vPart = store.cortesEnRango(toISO(pl), toISO(plPart)).reduce((a, c) => a + num(c.ventas_total), 0);
        const gFull = store.lineasEnRango(toISO(pl), toISO(plFin)).reduce((a, l) => a + num(l.monto), 0);
        const gPart = store.lineasEnRango(toISO(pl), toISO(plPart)).reduce((a, l) => a + num(l.monto), 0);
        const fV = vPart > 0 ? vFull / vPart : 7 / dias;
        const fG = gPart > 0 ? gFull / gPart : 7 / dias;
        const pv = venta * fV, pg = gastoVar * fG;
        proy = { dias, venta: pv, util: pv - pg - gfSem };
      }
    }

    // Punto de equilibrio: gastos fijos ÷ margen. El % de costo variable es
    // editable (los tickets capturados suelen estar incompletos, así que NO
    // sirven para estimar el margen real). Default 26% (tu ritmo sano).
    const costoVarPct = num(store.state.config.costoVarPct) || 26;
    const ventaRefDia = ventaSemanaAnterior() / 7;

    const gf = (store.state.gastosFijos || []).slice().sort((a, b) => num(b.monto_mensual) - num(a.monto_mensual));

    // Presupuesto de compras: % elegido × venta proyectada (semana pasada +5%).
    const proj = ventaEsperEd != null ? ventaEsperEd : Math.round(ventaSemanaAnterior() * 1.05);

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
        <p class="sub" style="margin-top:-4px">Vas ${proy.dias} de 7 días. Proyectado con el ritmo de la semana pasada:</p>
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
        ${beCuerpo(gfMes, gfSem, costoVarPct, ventaRefDia)}
      </div>

      <div class="card">
        <h2>Presupuesto de compras sugerido</h2>
        ${presuCuerpo(proj, pctSel)}
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

    const cvEl = el.querySelector("#cvpct");
    if (cvEl) cvEl.addEventListener("change", () => store.guardarConfig({ costoVarPct: num(cvEl.value) }).catch(() => {}));
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

// Venta de la semana anterior (la última semana COMPLETA con ventas).
function ventaSemanaAnterior() {
  const sems = store.ventasSemanas(8) || [];
  for (let i = 1; i < sems.length; i++) if (sems[i].venta > 0) return sems[i].venta;
  return sems[0] && sems[0].venta > 0 ? sems[0].venta : 0;  // respaldo: semana en curso
}

// Presupuesto = % elegido (máx 26%) × venta proyectada (semana pasada +5%).
function presuCuerpo(proj, pct) {
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
      <div class="stat"><div class="n" style="color:var(--verde)">${money(sugerido)}</div><div class="l">presupuesto / semana</div></div>
      <div class="stat"><div class="n">${money(sugerido / 7)}</div><div class="l">por día</div></div>
    </div>
    <div class="sub" style="margin-top:6px">= ${pctInt}% × ${money(proj)} (semana pasada +5%).</div>
    <button class="btn" id="usarPresu" style="margin-top:12px">Usar como meta semanal</button>`;
}

function beCuerpo(gfMes, gfSem, costoVarPct, ventaRefDia) {
  if (gfMes === 0)
    return `<div class="sub">Registra tus gastos fijos (abajo) para calcular el punto de equilibrio.</div>`;

  const input = `<label class="campo"><span>Costo variable (% de la venta)</span>
    <input id="cvpct" type="number" inputmode="decimal" value="${costoVarPct}" /></label>`;
  const contrib = 1 - costoVarPct / 100;
  if (contrib <= 0.02)
    return input + `<div class="aviso-box" style="margin-top:8px">Con un costo variable de ${costoVarPct}% casi no queda margen; no hay punto de equilibrio hasta bajarlo.</div>`;

  const beSem = gfSem / contrib;
  const beDia = beSem / 7;
  const margenPct = Math.round(contrib * 100);
  return input + `
    <p class="sub" style="margin-top:2px">Con margen de <b>${margenPct}%</b>, para NO perder necesitas vender:</p>
    <div class="row-stats">
      <div class="stat"><div class="n">${money(beDia)}</div><div class="l">por día</div></div>
      <div class="stat"><div class="n">${money(beSem)}</div><div class="l">por semana</div></div>
    </div>
    ${ventaRefDia > 0 ? `<div class="${ventaRefDia >= beDia ? "ok-box" : "aviso-box"}" style="margin-top:10px">${ventaRefDia >= beDia
      ? `✅ La semana pasada vendiste ${money(ventaRefDia)}/día, arriba del equilibrio.`
      : `⚠️ La semana pasada vendiste ${money(ventaRefDia)}/día; te faltan ${money(beDia - ventaRefDia)}/día para cubrir costos.`}</div>` : ""}
    <div class="sub" style="margin-top:8px">= gastos fijos ${money(gfSem)}/sem ÷ margen ${margenPct}%.</div>`;
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
