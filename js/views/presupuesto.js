// Pantalla: presupuesto (meta) semanal por FOOD COST, con selector de semana.
//
// Modelo (regla de Cremina):
//  1) Venta proyectada = venta REAL de la semana pasada × (1 + crecimiento%).
//     crecimiento% ajustable (default 5%), pensado para la meta de crecimiento.
//  2) Meta de gasto = foodCost% × venta proyectada (default 26%). Es food cost:
//     se compara SOLO contra lo etiquetado "costo de venta" (insumos).
//  3) La meta se calcula sola, pero se puede fijar/editar a mano por semana.
//  4) Si la venta REAL supera la proyección, puedes subir la meta a foodCost%
//     de la venta real (respetando siempre el 26%).
import * as store from "../store.js";
import { COLOR_AREA, money, num, toISO, lunesDe, etiquetaSemana, AREAS } from "../store.js";

const CREC_DEFAULT = 5;    // % de crecimiento sobre la semana pasada
const FOOD_DEFAULT = 26;   // % food cost (costo de venta / venta)

// Dinero sin centavos, para los stat tiles (así caben 3 en móvil).
const money0 = (n) => num(n).toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

// Venta de una semana: cortes de caja (fuente diaria); respaldo = productos_venta.
function ventaSemana(desde, hasta) {
  const porCortes = store.cortesEnRango(desde, hasta).reduce((a, c) => a + num(c.ventas_total), 0);
  if (porCortes > 0) return porCortes;
  const ps = (store.state.productos || []).filter((p) => p.desde === desde);
  return ps.reduce((a, p) => a + num(p.venta), 0);
}

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

    const cfg = store.state.config || {};
    const crec = num(cfg.crecimientoPct ?? CREC_DEFAULT);
    const food = num(cfg.foodCostPct ?? FOOD_DEFAULT);

    // ── Proyección y meta sugerida ──
    const prevL = new Date(lunes); prevL.setDate(lunes.getDate() - 7);
    const prevD = new Date(prevL); prevD.setDate(prevL.getDate() + 6);
    const ventaPrev = ventaSemana(toISO(prevL), toISO(prevD));
    const ventaReal = ventaSemana(desde, hasta);
    const proyeccion = ventaPrev * (1 + crec / 100);
    const metaSug = proyeccion * food / 100;

    // Meta efectiva: override manual de ESTA semana (si existe) o la sugerida.
    const manual = (cfg.metaHist || []).find((e) => e && e.desde === desde);
    const meta = manual ? num(manual.meta) : metaSug;

    // ── Gasto en insumos (solo "costo de venta") ──
    const lineas = store.lineasEnRango(desde, hasta);
    const insumos = lineas.filter((l) => l.tipo === "costo de venta").reduce((a, l) => a + num(l.monto), 0);
    const totalGasto = lineas.reduce((a, l) => a + num(l.monto), 0);
    const rest = meta - insumos;
    const pct = meta > 0 ? Math.min(100, 100 * insumos / meta) : 0;
    const color = pct >= 100 ? "var(--rojo)" : pct >= 85 ? "var(--amarillo)" : "var(--verde)";
    const foodReal = ventaReal > 0 ? (100 * insumos / ventaReal) : null;

    let alerta = "";
    if (meta > 0 && insumos > meta) {
      alerta = `<div class="error-box">🔴 Insumos por encima de la meta: <b>${money(insumos - meta)}</b> de más.</div>`;
    } else if (meta > 0 && pct >= 85) {
      alerta = `<div class="aviso-box">🟡 Vas al ${Math.round(pct)}% de la meta de insumos. Quedan ${money(rest)}.</div>`;
    }

    // Si vendiste MÁS que la proyección, puedes subir la meta al 26% de la venta real.
    let superaste = "";
    if (ventaReal > proyeccion && proyeccion > 0) {
      const metaReal = ventaReal * food / 100;
      superaste = `<div class="ok-box" style="margin-top:10px">
        📈 Vendiste ${money(ventaReal)} (más que la proyección de ${money(proyeccion)}).
        Puedes subir la meta al ${food}% de la venta real = <b>${money(metaReal)}</b>.
        <button class="btn sec chico" id="usar-real" style="margin-top:8px">Subir meta a ${money(metaReal)}</button>
      </div>`;
    }

    el.querySelector("#cuerpo").innerHTML = `
      ${alerta}
      <div class="card">
        <div class="sub" style="margin-top:0">
          Semana pasada <b>${money(ventaPrev)}</b> · proyección +${crec}% <b>${money(proyeccion)}</b> · meta = ${food}% de la proyección ${manual ? "(fijada a mano)" : "(sugerida)"}
        </div>
        <div class="row-stats" style="margin:14px 0">
          <div class="stat"><div class="n" style="font-size:19px">${money0(meta)}</div><div class="l">Meta</div></div>
          <div class="stat"><div class="n" style="font-size:19px">${money0(insumos)}</div><div class="l">Insumos</div></div>
          <div class="stat"><div class="n" style="font-size:19px;color:${rest < 0 ? "var(--rojo)" : "var(--verde)"}">${money0(rest)}</div><div class="l">${rest < 0 ? "Excedido" : "Disponible"}</div></div>
        </div>
        <div class="barra-track" style="height:14px"><span class="barra-fill" style="width:${pct}%;background:${color}"></span></div>
        <div class="sub" style="margin-top:6px">
          ${meta > 0 ? `Meta: ${money(meta)} · ${Math.round(pct)}% usado` : "Sin venta previa; define la meta a mano"}
          ${foodReal != null ? ` · Food cost real: <b>${foodReal.toFixed(1)}%</b>` : ""}
        </div>
        ${superaste}
      </div>

      <div class="card">
        <h2>Ajustes de la meta</h2>
        <div class="fila" style="gap:10px">
          <label class="campo" style="flex:1"><span>Crecimiento %</span>
            <input id="crec" type="number" step="any" inputmode="decimal" value="${crec}" /></label>
          <label class="campo" style="flex:1"><span>Food cost %</span>
            <input id="food" type="number" step="any" inputmode="decimal" value="${food}" /></label>
        </div>
        <button class="btn sec" id="guardar-pct">Guardar % (aplica a todas las semanas)</button>
        <hr style="border:none;border-top:1px solid var(--linea);margin:14px 0" />
        <label class="campo"><span>Meta de ESTA semana a mano (MXN)</span>
          <input id="meta" type="number" step="any" inputmode="decimal" value="${manual ? num(manual.meta) : ""}" placeholder="${Math.round(metaSug) || "27300"}" /></label>
        <div class="fila" style="gap:10px">
          <button class="btn" id="guardar-meta">Fijar meta de la semana</button>
          ${manual ? `<button class="btn sec" id="volver-sug">Volver a la sugerida</button>` : ""}
        </div>
        <div id="ok"></div>
      </div>

      <div class="card">
        <h2>Gasto por área (esta semana)</h2>
        <div class="sub" style="margin-top:-6px">Total capturado: ${money(totalGasto)} (insumos + operativo)</div>
        ${areasHTML(store.sumaPor(lineas, "area"))}
      </div>`;

    // ── Handlers ──
    el.querySelector("#guardar-pct").addEventListener("click", async () => {
      try {
        await store.guardarConfig({
          crecimientoPct: num(el.querySelector("#crec").value),
          foodCostPct: num(el.querySelector("#food").value),
        });
        el.querySelector("#ok").innerHTML = `<div class="ok-box" style="margin-top:10px">Porcentajes guardados.</div>`;
      } catch (err) { alert("No pude guardar: " + ((err && err.message) || err)); }
    });

    el.querySelector("#guardar-meta").addEventListener("click", async () => {
      const v = num(el.querySelector("#meta").value) || Math.round(metaSug);
      try {
        await store.guardarMetaSemana(desde, v);
        el.querySelector("#ok").innerHTML = `<div class="ok-box" style="margin-top:10px">Meta de la semana fijada en ${money(v)}.</div>`;
      } catch (err) { alert("No pude guardar: " + ((err && err.message) || err)); }
    });

    const usarReal = el.querySelector("#usar-real");
    if (usarReal) usarReal.addEventListener("click", async () => {
      try { await store.guardarMetaSemana(desde, Math.round(ventaReal * food / 100)); }
      catch (err) { alert("No pude guardar: " + ((err && err.message) || err)); }
    });

    const volver = el.querySelector("#volver-sug");
    if (volver) volver.addEventListener("click", async () => {
      try {
        const hist = (cfg.metaHist || []).filter((e) => e && e.desde !== desde);
        await store.guardarConfig({ metaHist: hist });
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
