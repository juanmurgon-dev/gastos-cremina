// Pantalla: reportes y gráficas, con selector de periodo (semana navegable,
// mes, rango de fechas personalizado o todo el histórico).
import * as store from "../store.js";
import { COLOR_AREA, money, toISO, lunesDe, etiquetaSemana } from "../store.js";
import { descargarCSV } from "../csv.js";
import * as gastosFijos from "./gastos-fijos.js";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function render(el) {
  let sub = "variables";
  el.innerHTML = `
    <div class="segmented"><button data-s="variables">Variables</button><button data-s="fijos">Fijos</button></div>
    <div id="rsub"></div>`;
  const subEl = el.querySelector("#rsub");
  const btns = [...el.querySelectorAll(".segmented button")];
  let limpiar = null;
  btns.forEach((b) => b.addEventListener("click", () => { sub = b.dataset.s; marcar(); renderSub(); }));
  function marcar() { btns.forEach((b) => b.classList.toggle("act", b.dataset.s === sub)); }
  function renderSub() {
    if (typeof limpiar === "function") { try { limpiar(); } catch (e) {} }
    subEl.innerHTML = "";
    limpiar = sub === "variables" ? renderVariables(subEl) : gastosFijos.montar(subEl);
  }
  marcar(); renderSub();
  return () => { if (typeof limpiar === "function") limpiar(); };
}

function renderVariables(el) {
  const st = { modo: "semana", semanaOff: 0, mesOff: 0, desde: "", hasta: "" };

  // Rango por defecto para el modo personalizado: esta semana
  const lun0 = lunesDe(new Date());
  const dom0 = new Date(lun0); dom0.setDate(lun0.getDate() + 6);
  st.desde = toISO(lun0); st.hasta = toISO(dom0);

  el.innerHTML = `
    <div class="card" style="padding:12px">
      <select id="modo" style="margin-bottom:10px">
        <option value="semana">Por semana</option>
        <option value="mes">Por mes</option>
        <option value="rango">Rango de fechas</option>
        <option value="todo">Todo el histórico</option>
      </select>
      <div id="ctrl"></div>
      <button class="btn sec chico" id="exp" style="margin-top:10px">⬇ Exportar CSV (periodo)</button>
    </div>
    <div id="cuerpo"></div>`;

  const modoSel = el.querySelector("#modo");
  modoSel.addEventListener("change", () => { st.modo = modoSel.value; pintarCtrl(); pintar(); });
  el.querySelector("#exp").addEventListener("click", () => {
    const { desde, hasta, etq } = rango();
    const filas = store.lineasEnRango(desde, hasta).map((l) => [
      l.fecha, l.proveedor, l.area, l.descripcion, l.cantidad, l.unidad, l.precio_unitario, l.monto, l.tipo, l.notas]);
    descargarCSV("gastos-" + (etq || "todo"), ["Fecha", "Proveedor", "Área", "Descripción",
      "Cantidad", "Unidad", "Precio Unitario", "Monto Total", "Tipo de Gasto", "Notas"], filas);
  });

  const off = store.subscribe(pintar);
  pintarCtrl();
  pintar();

  // ── Controles según el modo ──
  function pintarCtrl() {
    const c = el.querySelector("#ctrl");
    if (st.modo === "semana" || st.modo === "mes") {
      c.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <button class="btn sec chico" id="ant">◀</button>
          <div id="etq" style="font-weight:700;text-align:center;flex:1">—</div>
          <button class="btn sec chico" id="sig">▶</button>
        </div>`;
      c.querySelector("#ant").addEventListener("click", () => { paso(+1); });
      c.querySelector("#sig").addEventListener("click", () => { paso(-1); });
    } else if (st.modo === "rango") {
      c.innerHTML = `
        <div class="fila">
          <label class="campo" style="margin:0"><span>Desde</span>
            <input id="d" type="date" value="${st.desde}" /></label>
          <label class="campo" style="margin:0"><span>Hasta</span>
            <input id="h" type="date" value="${st.hasta}" /></label>
        </div>`;
      c.querySelector("#d").addEventListener("change", (e) => { st.desde = e.target.value; pintar(); });
      c.querySelector("#h").addEventListener("change", (e) => { st.hasta = e.target.value; pintar(); });
    } else {
      c.innerHTML = `<div class="sub">Sumando todos los tickets registrados.</div>`;
    }
  }

  function paso(dir) {
    if (st.modo === "semana") st.semanaOff = Math.max(0, st.semanaOff + dir);
    else st.mesOff = Math.max(0, st.mesOff + dir);
    pintar();
  }

  // ── Rango [desde, hasta] y etiqueta según el modo ──
  function rango() {
    const hoy = new Date();
    if (st.modo === "semana") {
      const l = lunesDe(hoy); l.setDate(l.getDate() - st.semanaOff * 7);
      const d = new Date(l); d.setDate(l.getDate() + 6);
      return { desde: toISO(l), hasta: toISO(d), etq: etiquetaSemana(l) };
    }
    if (st.modo === "mes") {
      const base = new Date(hoy.getFullYear(), hoy.getMonth() - st.mesOff, 1);
      const fin = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      return { desde: toISO(base), hasta: toISO(fin), etq: `${MESES[base.getMonth()]} ${base.getFullYear()}` };
    }
    if (st.modo === "rango") return { desde: st.desde, hasta: st.hasta, etq: "" };
    return { desde: null, hasta: null, etq: "" };
  }

  function pintar() {
    const cuerpo = el.querySelector("#cuerpo");
    if (!store.state.listo) { cuerpo.innerHTML = `<div class="vacio">Cargando…</div>`; return; }

    const { desde, hasta, etq } = rango();
    const etqEl = el.querySelector("#etq");
    if (etqEl && etq) etqEl.textContent = etq;

    const lineas = store.lineasEnRango(desde, hasta);
    const ts = store.ticketsEnRango(desde, hasta);
    const total = lineas.reduce((a, l) => a + store.num(l.monto), 0);

    const porArea = store.sumaPor(lineas, "area");
    const porTipo = store.sumaPor(lineas, "tipo");
    const porProv = store.sumaPor(lineas, "proveedor");
    const semanas = store.ultimasSemanas(12).reverse();

    cuerpo.innerHTML = `
      <div class="card">
        <div class="row-stats">
          <div class="stat"><div class="n">${money(total)}</div><div class="l">Gastado</div></div>
          <div class="stat"><div class="n">${ts.length}</div><div class="l">Tickets</div></div>
          <div class="stat"><div class="n">${lineas.length}</div><div class="l">Artículos</div></div>
        </div>
      </div>
      <div class="card"><h2>Gasto por área</h2>${barras(porArea, total, (k) => COLOR_AREA[k] || "#9c9482")}</div>
      <div class="card"><h2>Costo de venta vs. operativo</h2>${barras(porTipo, total, (k) => k === "costo de venta" ? "#0e3a39" : "#d9a441")}</div>
      <div class="card"><h2>Top proveedores</h2>${barras(porProv, total, () => "#16514f", 8)}</div>
      <div class="card"><h2>Gasto por semana (comparativo)</h2>${columnas(semanas)}</div>`;
  }

  return off;
}

// Gráfica de columnas verticales: compara el gasto de las últimas 12 semanas
// de un vistazo. La semana de mayor gasto se resalta en dorado.
function columnas(semanas) {
  const max = Math.max(1, ...semanas.map((s) => s.total));
  const maxVal = Math.max(...semanas.map((s) => s.total));
  const cols = semanas.map((s) => {
    const h = Math.max(2, Math.round(100 * s.total / max));
    const esMax = s.total === maxVal && s.total > 0;
    const [d1, d2] = s.etiqueta.split(" ");
    return `
      <div class="colwrap${esMax ? " max" : ""}">
        <div class="colbar-track">
          <div class="colbar" style="height:${h}%;background:var(--naranja);opacity:${opac(s.total, max)}">
            ${s.total > 0 ? `<span class="cval">${kmoney(s.total)}</span>` : ""}
          </div>
        </div>
        <div class="collbl">${d1 || ""}<br>${d2 || ""}</div>
      </div>`;
  }).join("");
  return `<div class="colchart">${cols}</div>
    <div class="leyenda"><span><i style="background:var(--dorado)"></i>Semana de mayor gasto</span></div>`;
}

// Dinero compacto: $1.302M / $38.7k / $950
function kmoney(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + (Math.trunc(n / 1000) / 1000).toFixed(3).replace(/\.?0+$/, "") + "M";
  if (a >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + Math.round(n);
}

function barras(obj, total, colorFn, limite = 99) {
  const entradas = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, limite);
  if (!entradas.length || total <= 0) return `<div class="sub">Sin datos en el periodo.</div>`;
  const max = Math.max(...entradas.map((e) => e[1]));
  return entradas.map(([k, v]) => `
    <div class="barra-row">
      <span class="etq">${escapar(k)}</span>
      <span class="barra-track"><span class="barra-fill" style="width:${Math.max(3, 100 * v / max)}%;background:${colorFn(k)};opacity:${opac(v, max)}"></span></span>
      <span class="val">${money(v)}</span>
    </div>`).join("");
}

// Intensidad de color según el valor (más alto = más fuerte).
function opac(v, max) { return (0.4 + 0.6 * (v / max)).toFixed(2); }

function escapar(s) {
  return String(s || "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
