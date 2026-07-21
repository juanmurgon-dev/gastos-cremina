// Pantalla de Inicio: resumen de la semana (venta, gasto, costo %), comparación
// con semanas pasadas, proyección de cierre de semana y avance de la meta.
import * as store from "../store.js";
import { money, num } from "../store.js";
import * as dashCompras from "./dash-compras.js";

// Inicio se adapta al ROL: compras ve su tablero; los demás (owner/gerente/
// staff/single-tenant) ven el resumen financiero de siempre.
export function render(el) {
  let sub = null, rolActual = "__none__";
  const unsub = store.subscribe(evaluar);
  evaluar();
  function evaluar() {
    const rol = store.state.miRol;
    if (rol === rolActual) return;         // el rol no cambió → no re-montar
    rolActual = rol;
    if (typeof sub === "function") { try { sub(); } catch (e) {} }
    el.innerHTML = "";
    sub = (rol === "compras") ? dashCompras.render(el) : renderOwner(el);
  }
  return () => { if (typeof sub === "function") { try { sub(); } catch (e) {} } unsub(); };
}

function kmoney(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + (Math.trunc(n / 1000) / 1000).toFixed(3).replace(/\.?0+$/, "") + "M";
  if (a >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + Math.round(n);
}
function opac(v, max) { return (0.4 + 0.6 * (v / (max || 1))).toFixed(2); }

// Δ % entre actual y anterior; bueno=verde según el tipo de dato.
function delta(actual, previo, subeEsBueno, etiqueta) {
  if (!previo) return "";
  const p = (actual - previo) / previo * 100;
  if (Math.abs(p) < 0.5) return `<span class="sub">= igual</span>`;
  const sube = p > 0;
  const bueno = sube === subeEsBueno;
  const col = bueno ? "var(--verde)" : "var(--rojo)";
  return `<span style="color:${col};font-size:12px">${sube ? "▲" : "▼"} ${Math.abs(Math.round(p))}% ${etiqueta || "vs. sem. pasada"}</span>`;
}

function renderOwner(el) {
  let off = 0; // 0 = esta semana
  const rerender = () => pintar();
  const unsub = store.subscribe(pintar);
  pintar();

  function pintar() {
    if (!store.state.listo) { el.innerHTML = `<div class="vacio">Cargando…</div>`; return; }

    const semanas = store.ventasSemanas(14); // i=0 actual, i=1 pasada…
    const wk = semanas[off] || semanas[0];
    const prevFull = semanas[off + 1] || null;
    const meta = store.metaDeSemana(wk.desde);

    const venta = wk.venta, gasto = wk.gasto;
    const costo = venta > 0 ? (gasto / venta) * 100 : 0;

    // ¿Semana en curso y a medias? Cuántos días llevamos.
    let diasT = 7, parcial = false;
    if (off === 0) {
      diasT = Math.min(7, Math.max(1, Math.floor((new Date() - wk.lunes) / 86400000) + 1));
      parcial = diasT < 7;
    }
    const cmpLbl = parcial ? `vs. mismos ${diasT} días` : "vs. sem. pasada";

    // Comparar contra el MISMO punto de la semana pasada (no la semana completa).
    let prev = prevFull;
    if (parcial && prevFull) {
      const pl = new Date(wk.lunes); pl.setDate(pl.getDate() - 7);
      prev = store.semanaParcial(pl, diasT);
    }
    const costoPrev = prev && prev.venta > 0 ? (prev.gasto / prev.venta) * 100 : 0;

    // Proyección al cierre: con el ritmo REAL de la semana pasada (no lineal).
    let proy = null;
    if (parcial) {
      const fV = (prev && prev.venta > 0 && prevFull) ? prevFull.venta / prev.venta : 7 / diasT;
      const fG = (prev && prev.gasto > 0 && prevFull) ? prevFull.gasto / prev.gasto : 7 / diasT;
      proy = { dias: diasT, venta: venta * fV, gasto: gasto * fG };
    }

    // Meta
    const pct = meta > 0 ? Math.min(100, 100 * gasto / meta) : 0;
    const cMeta = pct >= 100 ? "var(--rojo)" : pct >= 85 ? "var(--amarillo)" : "var(--verde)";

    const ultimas = semanas.slice(0, 6).slice().reverse(); // 6 semanas, viejo→nuevo
    const maxV = Math.max(1, ...ultimas.map((s) => s.venta));

    // Alertas automáticas
    const alertas = [];
    if (prev && prev.gasto > 0) {
      const d = (gasto - prev.gasto) / prev.gasto * 100;
      if (d >= 8) alertas.push(`🔺 Los gastos subieron <b>${Math.round(d)}%</b> vs. la semana pasada.`);
    }
    if (venta > 0 && costo > 45) alertas.push(`🔺 Costo alto: <b>${Math.round(costo)}%</b> de tu venta se fue en compras.`);
    if (meta > 0 && gasto > meta) alertas.push(`🔴 Te pasaste de la meta por <b>${money(gasto - meta)}</b>.`);
    if (prev && prev.venta > 0) {
      const dv = (venta - prev.venta) / prev.venta * 100;
      if (dv <= -12) alertas.push(`🔻 La venta bajó <b>${Math.round(Math.abs(dv))}%</b> vs. la semana pasada.`);
    }

    // ── Hero: la respuesta clara de "¿cómo voy?" ──
    const gfSem = store.gastoFijoMensual() / 30 * 7;
    const usaProy = (off === 0 && parcial && proy);
    const hVenta = usaProy ? proy.venta : venta;
    const hGasto = usaProy ? proy.gasto : gasto;
    const util = hVenta - hGasto - gfSem;
    const sinDatos = venta === 0;
    const colU = sinDatos ? "var(--gris)" : util > 0 ? "var(--verde)" : util < 0 ? "var(--rojo)" : "var(--tinta)";
    const verdicto = sinDatos ? "Aún sin ventas esta semana" : util > 0 ? "Vas ganando" : util < 0 ? "Vas perdiendo" : "Vas a mano";
    const heroTit = usaProy ? "Proyección al cierre" : (off === 0 ? "Utilidad de la semana" : "Utilidad de esa semana");
    const costoCol = costo <= 35 ? "var(--verde)" : costo <= 45 ? "var(--amarillo)" : "var(--rojo)";

    // Punto de equilibrio (antes en Proyec.): gastos fijos ÷ margen.
    const gfMes = store.gastoFijoMensual();
    const costoVarPct = num(store.state.config.costoVarPct) || 26;
    const contrib = 1 - costoVarPct / 100;
    const beSem = contrib > 0.02 ? gfSem / contrib : 0;
    const beDia = beSem / 7;
    const ventaRefDia = prevFull ? prevFull.venta / 7 : 0;

    el.innerHTML = `
      <div class="card" style="text-align:center;padding:18px 16px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <button class="btn sec chico" id="ant">◀</button>
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px">${wk.etiqueta}</div>
            <div class="sub" style="font-size:11px">${off === 0 ? "Esta semana" : off === 1 ? "Semana pasada" : "hace " + off + " semanas"}</div>
          </div>
          <button class="btn sec chico" id="sig">▶</button>
        </div>
        <div class="sub" style="text-transform:uppercase;letter-spacing:.09em;font-size:10.5px;margin-top:12px">${heroTit}</div>
        <div style="font-size:40px;font-weight:800;letter-spacing:-.02em;line-height:1.05;color:${colU}">${sinDatos ? "—" : money(util)}</div>
        <div style="font-weight:700;color:${colU}">${verdicto}${usaProy && !sinDatos ? " (a este ritmo)" : ""}</div>
        ${!sinDatos
          ? `<div class="sub" style="margin-top:8px;font-size:12.5px">Venta ${kmoney(hVenta)} − compras ${kmoney(hGasto)}${gfSem ? ` − fijos ${kmoney(gfSem)}` : ""}</div>`
          : `<div class="sub" style="margin-top:8px">Espera el corte del día para ver cómo vas.</div>`}
        ${(!sinDatos && gfSem === 0) ? `<div class="sub" style="margin-top:4px;font-size:12px">💡 Registra gastos fijos (Gastos → Fijos) para la utilidad real.</div>` : ""}
      </div>
      ${alertas.length ? `<div class="card" style="border-left:4px solid var(--flame)">
        <h2 style="margin-bottom:8px">Alertas</h2>
        ${alertas.map((a) => `<div style="font-size:13px;padding:4px 0">${a}</div>`).join("")}
      </div>` : ""}

      <div class="card">
        <div class="row-stats">
          <div class="stat">
            <div class="n" style="color:var(--verde-claro)">${kmoney(venta)}</div>
            <div class="l">Venta</div>
            <div style="margin-top:3px">${prev ? delta(venta, prev.venta, true, cmpLbl) : ""}</div>
          </div>
          <div class="stat">
            <div class="n" style="color:var(--naranja)">${kmoney(gasto)}</div>
            <div class="l">Gasto</div>
            <div style="margin-top:3px">${prev ? delta(gasto, prev.gasto, false, cmpLbl) : ""}</div>
          </div>
          <div class="stat">
            <div class="n" style="color:${costo <= 35 ? "var(--verde)" : costo <= 45 ? "var(--amarillo)" : "var(--rojo)"}">${venta > 0 ? Math.round(costo) + "%" : "—"}</div>
            <div class="l">Costo</div>
            <div style="margin-top:3px">${(costoPrev && venta > 0) ? delta(costo, costoPrev, false, cmpLbl) : ""}</div>
          </div>
        </div>
        ${parcial ? `<div class="sub" style="text-align:center;margin-top:8px;font-size:11.5px">Comparado con los mismos ${diasT} días de la semana pasada</div>` : ""}
      </div>

      <div class="card">
        <h2 style="margin-bottom:8px">Meta de compras (semana)</h2>
        <div class="barra-track" style="height:14px"><span class="barra-fill" style="width:${pct}%;background:${cMeta}"></span></div>
        <div class="sub" style="margin-top:6px">${meta > 0 ? `Llevas ${money(gasto)} de ${money(meta)} · ${Math.round(pct)}% usado` : "Define tu meta de compras semanal abajo."}</div>
        <div class="fila" style="margin-top:10px;gap:8px">
          <input id="meta" type="number" step="any" inputmode="decimal" value="${meta || ""}" placeholder="Meta semanal (MXN)" style="flex:1" />
          <button class="btn sec" id="guardar" style="flex:none;width:auto">Guardar</button>
        </div>
        <div class="sub" style="margin-top:6px;font-size:11.5px">Aplica de esta semana en adelante; las anteriores quedan fijas.</div>
        <div id="ok"></div>
      </div>

      <div class="card">
        <h2 style="margin-bottom:6px">Punto de equilibrio</h2>
        ${gfMes === 0
          ? `<div class="sub">Registra tus gastos fijos (Gastos → Fijos) para calcularlo.</div>`
          : contrib <= 0.02
          ? `<div class="aviso-box">Con costo variable ${costoVarPct}% casi no queda margen; bájalo primero.</div>`
          : `<div class="row-stats">
               <div class="stat"><div class="n">${money(beDia)}</div><div class="l">por día</div></div>
               <div class="stat"><div class="n">${money(beSem)}</div><div class="l">por semana</div></div>
             </div>
             <div class="sub" style="margin-top:6px">Para NO perder, con margen <b>${Math.round(contrib * 100)}%</b>.${ventaRefDia > 0 ? (ventaRefDia >= beDia ? ` La semana pasada vendiste ${money(ventaRefDia)}/día ✅` : ` La semana pasada vendiste ${money(ventaRefDia)}/día ⚠️`) : ""}</div>
             <label class="campo" style="margin-top:8px"><span>Costo variable (% de la venta)</span>
               <input id="cvpct" type="number" step="any" inputmode="decimal" value="${costoVarPct}" /></label>`}
      </div>

      <div class="card">
        <h2>Tendencia · últimas 6 semanas</h2>
        ${ultimas.map((s) => {
          const c = s.venta > 0 ? (s.gasto / s.venta) * 100 : 0;
          return `<div class="barra-row">
            <span class="etq" style="width:88px;font-size:12px">${s.etiqueta}</span>
            <span class="barra-track"><span class="barra-fill" style="width:${Math.max(3, 100 * s.venta / maxV)}%;background:var(--verde-claro);opacity:${opac(s.venta, maxV)}"></span></span>
            <span class="val" style="width:120px">${kmoney(s.venta)} · <span style="color:${c <= 35 ? "var(--verde)" : c <= 45 ? "var(--amarillo)" : "var(--rojo)"}">${s.venta > 0 ? Math.round(c) + "%" : "—"}</span></span>
          </div>`;
        }).join("")}
        <div class="leyenda"><span><i style="background:var(--verde-claro)"></i>Venta</span><span>% = costo</span></div>
      </div>`;

    el.querySelector("#ant").addEventListener("click", () => { off++; rerender(); });
    el.querySelector("#sig").addEventListener("click", () => { off = Math.max(0, off - 1); rerender(); });
    const cvEl = el.querySelector("#cvpct");
    if (cvEl) cvEl.addEventListener("change", () => store.guardarConfig({ costoVarPct: num(cvEl.value) }).catch(() => {}));
    const gBtn = el.querySelector("#guardar");
    if (gBtn) gBtn.addEventListener("click", async () => {
      const v = num(el.querySelector("#meta").value);
      try {
        await store.guardarMetaSemana(wk.desde, v);   // solo esta semana en adelante
        el.querySelector("#ok").innerHTML = `<div class="ok-box" style="margin-top:10px">Meta guardada (solo esta semana en adelante).</div>`;
      } catch (err) { alert("No pude guardar: " + ((err && err.message) || err)); }
    });
  }

  return unsub;
}
