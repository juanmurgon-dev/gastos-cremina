// Editor de gastos fijos (renta, sueldos, servicios…) + análisis:
// peso sobre la venta mensual, comparación con la industria y focos rojos.
import * as store from "../store.js";
import { money, num } from "../store.js";

function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// Rubros con su rango "sano" en restaurantes (% de la venta). El primero que
// coincide con el concepto se lleva el gasto. "ideal" = tope del rango sano.
const RUBROS = [
  { key: "renta",     re: /renta|arrend|local|plaza|ocupa/i,                                     nombre: "Renta / local",             ideal: 10, rango: "6–10%" },
  { key: "nomina",    re: /sueldo|n[óo]mina|salario|personal|emplead|mesero|cociner|chef|staff|prestacion|imss|aguinaldo/i, nombre: "Sueldos / nómina", ideal: 32, rango: "25–32%" },
  { key: "servicios", re: /luz|electric|cfe|agua|gas|internet|tel[eé]fono|cable|servicio/i,      nombre: "Servicios (luz, agua, gas…)", ideal: 6,  rango: "3–6%" },
  { key: "software",  re: /software|sistema|\bpos\b|parrot|suscrip|licencia|nube|plataforma|app/i, nombre: "Software / suscripciones",  ideal: 2,  rango: "0.5–2%" },
  { key: "marketing", re: /marketing|publicidad|redes|ads|anuncio|promo|difusi/i,                nombre: "Marketing / publicidad",   ideal: 4,  rango: "1–4%" },
  { key: "admin",     re: /seguro|contab|contador|administra|legal|honorario|mantenim|limpieza/i, nombre: "Admin / seguros / mantto.", ideal: 4,  rango: "1–4%" },
];
const CONSEJO = {
  renta:     "Negocia el contrato o sube el ticket promedio para diluirla.",
  nomina:    "Ajusta turnos a la demanda real; mide venta por hora-hombre.",
  servicios: "Revisa consumos, cambia a LED, busca fugas y compara tarifas.",
  software:  "Cancela suscripciones que casi no usas.",
  marketing: "Mide el retorno: corta lo que no trae clientes medibles.",
  admin:     "Cotiza de nuevo seguros/contabilidad cada año.",
  otros:     "Revisa qué incluye y qué se puede recortar.",
};

// Venta mensual promedio (run-rate) a partir de los cortes de caja.
function ventaMensualProm() {
  const cortes = (store.state.cortes || []).filter((c) => c.fecha);
  if (!cortes.length) return { mensual: 0, dias: 0 };
  let min = null, max = null, total = 0;
  for (const c of cortes) {
    const f = c.fecha;
    if (!min || f < min) min = f;
    if (!max || f > max) max = f;
    total += num(c.ventas_total);
  }
  const dias = Math.round((Date.parse(max) - Date.parse(min)) / 86400000) + 1;
  return { mensual: dias > 0 ? total / dias * 30.4 : total, dias };
}

function clasificar(gf) {
  const res = RUBROS.map((r) => ({ ...r, sum: 0 }));
  const otros = { key: "otros", nombre: "Otros", ideal: 5, rango: "—", sum: 0 };
  for (const g of gf) {
    const m = num(g.monto_mensual);
    const r = res.find((x) => x.re.test(g.concepto || ""));
    if (r) r.sum += m; else otros.sum += m;
  }
  const out = res.filter((r) => r.sum > 0);
  if (otros.sum > 0) out.push(otros);
  return out.sort((a, b) => b.sum - a.sum);
}

function colorPct(pct, ideal) {
  if (!pct) return "var(--gris)";
  if (pct <= ideal) return "var(--verde)";
  if (pct <= ideal * 1.25) return "var(--amarillo)";
  return "var(--rojo)";
}
function colorTotal(pct) {
  if (!pct) return "var(--gris)";
  if (pct <= 50) return "var(--verde)";
  if (pct <= 65) return "var(--amarillo)";
  return "var(--rojo)";
}

export function montar(el) {
  const unsub = store.subscribe(pintar);
  pintar();

  function pintar() {
    if (!store.state.listo) { el.innerHTML = `<div class="vacio">Cargando…</div>`; return; }
    const gf = (store.state.gastosFijos || []).slice().sort((a, b) => num(b.monto_mensual) - num(a.monto_mensual));
    const mes = store.gastoFijoMensual();
    const { mensual: ventaMes, dias } = ventaMensualProm();
    const pctFijo = ventaMes > 0 ? mes / ventaMes * 100 : 0;
    const rubros = clasificar(gf);

    el.innerHTML = `
      <div class="card">
        <h2>Gastos fijos</h2>
        <p class="sub" style="margin-top:-4px">Lo que pagas cada mes pase lo que pase: renta, sueldos, luz, internet…</p>
        <div class="row-stats" style="margin:10px 0 12px">
          <div class="stat"><div class="n">${money(mes)}</div><div class="l">Mensual</div></div>
          <div class="stat"><div class="n">${money(mes / 30 * 7)}</div><div class="l">Semanal</div></div>
          <div class="stat"><div class="n">${money(mes / 30)}</div><div class="l">Diario</div></div>
        </div>
        <div>${gf.length ? gf.map((g) => fila(g, ventaMes)).join("") : `<div class="sub">Aún no hay gastos fijos. Agrégalos abajo.</div>`}</div>
      </div>

      ${gf.length ? `
      <div class="card">
        <h2>Peso sobre tu venta</h2>
        <p class="sub" style="margin-top:-4px">
          ${ventaMes > 0
            ? `Venta mensual estimada <b>${money(ventaMes)}</b> (promedio de ${dias} días de cortes).`
            : `Sube cortes de caja para calcular los porcentajes.`}
        </p>
        ${ventaMes > 0 ? `
          <div style="text-align:center;margin:6px 0 4px">
            <div style="font-size:34px;font-weight:800;color:${colorTotal(pctFijo)};line-height:1">${pctFijo.toFixed(0)}%</div>
            <div class="sub" style="margin-top:2px">de tu venta se va en gastos fijos</div>
          </div>
          <div class="barra-row" style="margin-top:8px">
            <span class="barra-track"><span class="barra-fill" style="width:${Math.min(100, Math.max(3, pctFijo))}%;background:${colorTotal(pctFijo)}"></span></span>
          </div>
          <div class="sub" style="margin-top:6px">Referencia: un negocio sano mantiene sus gastos fijos <b>≤ ~50%</b> de la venta (deja espacio para el costo de insumos ~30% y la utilidad).</div>
        ` : ""}
      </div>

      ${ventaMes > 0 ? `
      <div class="card">
        <h2>Cada rubro vs. la industria</h2>
        <p class="sub" style="margin-top:-4px">% de tu venta mensual por rubro, comparado con lo normal en restaurantes.</p>
        ${rubros.map((r) => rowRubro(r, ventaMes)).join("")}
        <div class="leyenda" style="margin-top:8px">
          <span><i style="background:var(--verde)"></i>en rango</span>
          <span><i style="background:var(--amarillo)"></i>al límite</span>
          <span><i style="background:var(--rojo)"></i>alto</span>
        </div>
      </div>

      <div class="card">
        <h2>Focos rojos</h2>
        ${focosRojos(rubros, ventaMes, pctFijo).map((f) => `
          <div style="font-size:13px;padding:7px 0;border-bottom:1px solid var(--linea)">
            ${f.t === "rojo" ? "🔴" : f.t === "amarillo" ? "🟡" : "✅"} ${f.txt}
          </div>`).join("")}
      </div>
      ` : ""}
      ` : ""}

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

function fila(g, ventaMes) {
  const pct = ventaMes > 0 ? num(g.monto_mensual) / ventaMes * 100 : 0;
  return `<div class="barra-row" style="justify-content:space-between">
    <span class="etq" style="width:auto;flex:1">${esc(g.concepto || "—")}</span>
    <span class="val">${money(g.monto_mensual)}/mes${ventaMes > 0 ? ` · <b>${pct.toFixed(1)}%</b>` : ""}</span>
    <button class="linkbtn" data-del="${g.id}" style="color:var(--rojo);padding:0 6px;font-size:16px">✕</button>
  </div>`;
}

function rowRubro(r, ventaMes) {
  const pct = r.sum / ventaMes * 100;
  const col = colorPct(pct, r.ideal);
  return `<div class="barra-row">
    <span class="etq" style="width:150px">${esc(r.nombre)}</span>
    <span class="barra-track"><span class="barra-fill" style="width:${Math.min(100, Math.max(3, pct * 2))}%;background:${col}"></span></span>
    <span class="val" style="width:118px;text-align:right;color:${col};font-weight:700">${pct.toFixed(1)}%<span style="color:var(--gris);font-weight:400"> · ${r.rango}</span></span>
  </div>`;
}

function focosRojos(rubros, ventaMes, pctFijo) {
  const out = [];
  for (const r of rubros) {
    const pct = r.sum / ventaMes * 100;
    if (r.key !== "otros" && pct > r.ideal) {
      out.push({ t: pct > r.ideal * 1.25 ? "rojo" : "amarillo",
        txt: `<b>${r.nombre}</b> va en ${pct.toFixed(1)}% (industria ${r.rango}). ${CONSEJO[r.key] || ""}` });
    }
  }
  if (pctFijo > 65) out.push({ t: "rojo", txt: `Tus gastos fijos son <b>${pctFijo.toFixed(0)}%</b> de la venta. Con el costo de insumos casi no queda utilidad; hay que subir venta o recortar.` });
  else if (pctFijo > 55) out.push({ t: "amarillo", txt: `Gastos fijos en <b>${pctFijo.toFixed(0)}%</b> de la venta; vigílalo (ideal ≤ ~50%).` });

  if (!rubros.find((r) => r.key === "nomina")) out.push({ t: "amarillo", txt: "No veo <b>sueldos/nómina</b> en tus gastos fijos. Si pagas nómina, agrégala para ver el panorama real (suele ser el gasto más grande)." });
  if (!rubros.find((r) => r.key === "renta")) out.push({ t: "amarillo", txt: "No veo <b>renta</b>. Si rentas el local, agrégala." });

  if (!out.length) out.push({ t: "verde", txt: "Tus gastos fijos se ven en rango sano. ¡Bien hecho!" });
  return out.slice(0, 7);
}
