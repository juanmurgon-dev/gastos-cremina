// Ritmo de compras: cada cuánto le compras a cada proveedor y pides cada insumo,
// con semáforo de "ya toca pedir" y una predicción contra tu meta de la semana.
import * as store from "../store.js";
import { money } from "../store.js";

function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function dias(n) { n = Math.max(0, Math.round(n)); return n === 1 ? "1 día" : n + " días"; }
function frec(m) {
  if (m.veces < 2 || m.intervalo == null) return "1 sola compra";
  const cada = `cada ${dias(m.intervalo)}`;
  return m.porSemana >= 1 ? `${m.porSemana.toFixed(1)}/sem · ${cada}` : cada;
}
const COL = { toca: "var(--rojo)", pronto: "var(--amarillo)", ok: "var(--gris)" };
const TXT = { toca: "Ya toca", pronto: "Pronto" };
function chip(estado) {
  return estado === "ok" ? "" : `<span class="chip" style="background:${COL[estado]}">${TXT[estado]}</span>`;
}

export function render(el) {
  el.innerHTML = `<div id="rroot"></div>`;
  const root = el.querySelector("#rroot");
  const off = store.subscribe(pintar);
  pintar();

  function pintar() {
    if (!store.state.listo) { root.innerHTML = `<div class="vacio">Cargando…</div>`; return; }
    const { insumos, proveedores } = store.ritmoCompras();
    if (!insumos.length && !proveedores.length) {
      root.innerHTML = `<div class="card"><div class="aviso-box">Aún no hay compras registradas. Captura tickets en <b>Capturar</b> y aquí verás tu ritmo de compras.</div></div>`;
      return;
    }
    root.innerHTML = cardPrediccion(store.prediccionCompras()) + cardProv(proveedores) + cardIns(insumos);
  }
  return off;
}

function cardPrediccion(p) {
  const cab = p.meta > 0 ? `Llevas <b>${money(p.gastoSemana)}</b> de tu meta <b>${money(p.meta)}</b>.` : "";
  if (!p.pendientes.length) {
    return `<div class="card"><h2>Predicción de la semana</h2>
      <p class="sub" style="margin:6px 0 0">${cab} Según tu ritmo, ahorita no traes pedidos vencidos. 👍</p></div>`;
  }
  const aviso = p.seValePasar
    ? `⚠️ ${cab} Con lo que aún te falta pedir (~<b>${money(p.costoPendiente)}</b>) llegarías a <b>${money(p.proyectado)}</b> — por encima de tu meta.`
    : (p.meta > 0
        ? `${cab} Según tu ritmo aún te falta pedir ~<b>${money(p.costoPendiente)}</b> (quedarías en ${money(p.proyectado)}).`
        : `Según tu ritmo, aún te falta pedir ~<b>${money(p.costoPendiente)}</b>.`);
  const lista = p.pendientes.slice(0, 8).map((x) => `
    <div class="barra-row" style="justify-content:space-between;gap:8px">
      <span class="etq" style="width:auto;flex:1"><b>${esc(x.nombre)}</b></span>
      <span class="sub" style="font-size:12px">cada ${dias(x.intervalo)} · llevas ${dias(x.diasDesde)}</span>
      <span class="val" style="width:78px">~${money(x.montoProm)}</span>
    </div>`).join("");
  return `<div class="card" style="border-left:4px solid var(--flame)">
    <h2 style="margin-bottom:8px">Predicción de la semana</h2>
    <p style="margin:0 0 12px;font-size:13.5px;line-height:1.45">${aviso}</p>
    <div class="titulo-seccion">Ya toca pedir</div>${lista}</div>`;
}

function cardProv(provs) {
  if (!provs.length) return "";
  const rows = provs.map((p) => `
    <div class="barra-row" style="justify-content:space-between;gap:8px">
      <span class="etq" style="width:auto;flex:1"><b>${esc(p.nombre)}</b> ${chip(p.estado)}</span>
      <span class="sub" style="font-size:12px">${frec(p)}${p.veces >= 2 ? ` · hace ${dias(p.diasDesde)}` : ""}</span>
      <span class="val" style="width:78px">${money(p.gastoProm)}</span>
    </div>`).join("");
  return `<div class="card"><h2>Cada cuánto le compras a…</h2>
    <p class="sub" style="margin-top:-4px">Frecuencia y gasto promedio por visita.</p>${rows}</div>`;
}

function cardIns(insumos) {
  if (!insumos.length) return "";
  const rows = insumos.slice(0, 40).map((i) => `
    <div class="barra-row" style="justify-content:space-between;gap:8px">
      <span class="etq" style="width:auto;flex:1"><b>${esc(i.nombre)}</b> ${chip(i.estado)}</span>
      <span class="sub" style="font-size:12px">${frec(i)}${i.veces >= 2 ? ` · hace ${dias(i.diasDesde)}` : ""}</span>
      <span class="val" style="width:78px">~${money(i.montoProm)}</span>
    </div>`).join("");
  const extra = insumos.length > 40 ? `<div class="sub" style="margin-top:8px">…y ${insumos.length - 40} más.</div>` : "";
  return `<div class="card"><h2>Cada cuánto pides cada insumo</h2>
    <p class="sub" style="margin-top:-4px">Ordenados por urgencia. “Ya toca” = pasó más tiempo del normal desde tu última compra.</p>${rows}${extra}</div>`;
}
