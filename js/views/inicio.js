// Pantalla de Inicio: resumen de la semana (venta, gasto, costo %), comparación
// con semanas pasadas, proyección de cierre de semana y avance de la meta.
import * as store from "../store.js";
import { money, num } from "../store.js";

function kmoney(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + (Math.trunc(n / 1000) / 1000).toFixed(3).replace(/\.?0+$/, "") + "M";
  if (a >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + Math.round(n);
}
function opac(v, max) { return (0.4 + 0.6 * (v / (max || 1))).toFixed(2); }

// Δ % entre actual y anterior; bueno=verde según el tipo de dato.
function delta(actual, previo, subeEsBueno) {
  if (!previo) return "";
  const p = (actual - previo) / previo * 100;
  if (Math.abs(p) < 0.5) return `<span class="sub">= igual</span>`;
  const sube = p > 0;
  const bueno = sube === subeEsBueno;
  const col = bueno ? "var(--verde)" : "var(--rojo)";
  return `<span style="color:${col};font-size:12px">${sube ? "▲" : "▼"} ${Math.abs(Math.round(p))}% vs. sem. pasada</span>`;
}

export function render(el) {
  let off = 0; // 0 = esta semana
  const rerender = () => pintar();
  const unsub = store.subscribe(pintar);
  pintar();

  function pintar() {
    if (!store.state.listo) { el.innerHTML = `<div class="vacio">Cargando…</div>`; return; }

    const semanas = store.ventasSemanas(14); // i=0 actual, i=1 pasada…
    const wk = semanas[off] || semanas[0];
    const prev = semanas[off + 1] || null;
    const meta = num(store.state.config.presupuestoSemanal) || 0;

    const venta = wk.venta, gasto = wk.gasto;
    const costo = venta > 0 ? (gasto / venta) * 100 : 0;
    const costoPrev = prev && prev.venta > 0 ? (prev.gasto / prev.venta) * 100 : 0;

    // Proyección (solo semana actual y si no terminó)
    let proy = null;
    if (off === 0) {
      const hoy = new Date();
      const dias = Math.min(7, Math.max(1, Math.floor((hoy - wk.lunes) / 86400000) + 1));
      if (dias < 7) {
        proy = { dias, gasto: gasto / dias * 7, venta: venta / dias * 7 };
      }
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

    el.innerHTML = `
      <div class="card" style="padding:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <button class="btn sec chico" id="ant">◀</button>
          <div style="text-align:center;flex:1">
            <div style="font-weight:700">${wk.etiqueta}</div>
            <div class="sub">${off === 0 ? "Esta semana" : off === 1 ? "Semana pasada" : "hace " + off + " semanas"}</div>
          </div>
          <button class="btn sec chico" id="sig">▶</button>
        </div>
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
            <div style="margin-top:3px">${prev ? delta(venta, prev.venta, true) : ""}</div>
          </div>
          <div class="stat">
            <div class="n" style="color:var(--naranja)">${kmoney(gasto)}</div>
            <div class="l">Gasto</div>
            <div style="margin-top:3px">${prev ? delta(gasto, prev.gasto, false) : ""}</div>
          </div>
          <div class="stat">
            <div class="n" style="color:${costo <= 35 ? "var(--verde)" : costo <= 45 ? "var(--amarillo)" : "var(--rojo)"}">${venta > 0 ? Math.round(costo) + "%" : "—"}</div>
            <div class="l">Costo</div>
            <div style="margin-top:3px">${(costoPrev && venta > 0) ? delta(costo, costoPrev, false) : ""}</div>
          </div>
        </div>
        <div class="sub" style="text-align:center;margin-top:8px">Costo = cuánto de tu venta se fue en compras</div>
      </div>

      ${proy ? `
      <div class="card">
        <h2>Proyección al cierre de semana</h2>
        <p class="sub" style="margin-top:0">Vas ${proy.dias} de 7 días. Si sigue este ritmo:</p>
        <div class="row-stats">
          <div class="stat"><div class="n">${kmoney(proy.venta)}</div><div class="l">Venta proyectada</div></div>
          <div class="stat"><div class="n" style="color:${meta && proy.gasto > meta ? "var(--rojo)" : "var(--tinta)"}">${kmoney(proy.gasto)}</div><div class="l">Gasto proyectado</div></div>
        </div>
        ${meta ? `<div class="${proy.gasto > meta ? "aviso-box" : "ok-box"}" style="margin-top:10px">${proy.gasto > meta
          ? `⚠️ A este ritmo cerrarías en ${money(proy.gasto)}, por encima de tu meta de ${money(meta)}.`
          : `✅ A este ritmo cierras dentro de la meta de ${money(meta)}.`}</div>` : ""}
      </div>` : ""}

      <div class="card">
        <h2>Meta de la semana</h2>
        <div class="row-stats" style="margin-bottom:12px">
          <div class="stat"><div class="n">${money(gasto)}</div><div class="l">Gastado</div></div>
          <div class="stat"><div class="n" style="color:${meta - gasto < 0 ? "var(--rojo)" : "var(--verde)"}">${money(meta - gasto)}</div><div class="l">${meta - gasto < 0 ? "Excedido" : "Disponible"}</div></div>
        </div>
        <div class="barra-track" style="height:14px"><span class="barra-fill" style="width:${pct}%;background:${cMeta}"></span></div>
        <div class="sub" style="margin-top:6px">${meta > 0 ? `Meta: ${money(meta)} · ${Math.round(pct)}% usado` : "Sin meta definida"}</div>
      </div>

      <div class="card">
        <h2>Últimas 6 semanas</h2>
        ${ultimas.map((s) => {
          const c = s.venta > 0 ? (s.gasto / s.venta) * 100 : 0;
          return `<div class="barra-row">
            <span class="etq" style="width:88px;font-size:12px">${s.etiqueta}</span>
            <span class="barra-track"><span class="barra-fill" style="width:${Math.max(3, 100 * s.venta / maxV)}%;background:var(--verde-claro);opacity:${opac(s.venta, maxV)}"></span></span>
            <span class="val" style="width:120px">${kmoney(s.venta)} · <span style="color:${c <= 35 ? "var(--verde)" : c <= 45 ? "var(--amarillo)" : "var(--rojo)"}">${s.venta > 0 ? Math.round(c) + "%" : "—"}</span></span>
          </div>`;
        }).join("")}
        <div class="leyenda"><span><i style="background:var(--verde-claro)"></i>Venta</span><span>% = costo (gasto/venta)</span></div>
      </div>

      <div class="card">
        <h2>Configurar meta</h2>
        <label class="campo"><span>Meta de gasto por semana (MXN)</span>
          <input id="meta" type="number" step="any" inputmode="decimal" value="${meta || ""}" placeholder="45000" /></label>
        <button class="btn" id="guardar">Guardar meta</button>
        <div id="ok"></div>
      </div>`;

    el.querySelector("#ant").addEventListener("click", () => { off++; rerender(); });
    el.querySelector("#sig").addEventListener("click", () => { off = Math.max(0, off - 1); rerender(); });
    el.querySelector("#guardar").addEventListener("click", async () => {
      const v = num(el.querySelector("#meta").value);
      try {
        await store.guardarConfig({ presupuestoSemanal: v });
        el.querySelector("#ok").innerHTML = `<div class="ok-box" style="margin-top:10px">Meta guardada.</div>`;
      } catch (err) { alert("No pude guardar: " + ((err && err.message) || err)); }
    });
  }

  return unsub;
}
