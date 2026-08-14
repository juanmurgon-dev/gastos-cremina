// Pantalla: desempeño por mesero. Sale de `ordenes_mesero` (una fila por
// cuenta), que se llena al importar el reporte de órdenes de Parrot.
//
// Dos cosas distintas conviven aquí, a propósito:
//   · SCORECARD  — todos los indicadores contra su meta. Para la junta.
//   · MARCADOR   — la competencia. Solo extras y postres, que son las que
//                  el mesero SÍ mueve. El café va como indicador de equipo:
//                  en julio los tres de piso quedaron en 1.47–1.63, o sea
//                  un techo del sistema, no de la persona. Rankear ahí
//                  premia el ruido y no enseña nada.
import * as store from "../store.js";
import { money, num } from "../store.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Debajo de esto la muestra es demasiado chica para comparar a nadie: un mal
// martes te cambia al líder. Se siguen mostrando sus números, pero fuera del
// podio y marcados. (Julio: Denisse 33 cuentas, Andrés 7.)
const MIN_CUENTAS = 40;

const METAS_DEF = { cafeCuenta: 2.0, attachPostre: 0.10, extrasCuenta: 0.72 };

function cfg() {
  const c = (store.state.config && store.state.config.meseros) || {};
  return { metas: { ...METAS_DEF, ...(c.metas || {}) }, compiten: c.compiten || {} };
}
// Sin marcar, todos compiten: es menos sorpresivo que esconder a alguien solo.
const compite = (nombre) => cfg().compiten[nombre] !== false;

// ── Periodos ────────────────────────────────────────────────────
const hoy = () => new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function rangoDe(clave) {
  const d = hoy();
  if (clave === "mes") return { desde: iso(new Date(d.getFullYear(), d.getMonth(), 1)), hasta: iso(d), txt: "Este mes" };
  if (clave === "mespasado") {
    const ini = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return { desde: iso(ini), hasta: iso(new Date(d.getFullYear(), d.getMonth(), 0)), txt: "Mes pasado" };
  }
  if (clave === "semana") {
    const ini = new Date(d); ini.setDate(d.getDate() - 6);
    return { desde: iso(ini), hasta: iso(d), txt: "Últimos 7 días", corto: true };
  }
  return { desde: "0000-01-01", hasta: "9999-12-31", txt: "Todo lo cargado" };
}

// ── El cálculo ──────────────────────────────────────────────────
// Solo COMEDOR y cuentas cerradas con venta: para-llevar no tiene mesero que
// atienda mesa, y una cuenta en $0 es una prueba o un error.
//
// Se exporta porque Capacitación lo reusa: los niveles plata y oro se ganan
// con desempeño real (café/cuenta, attach de postre), y ese número tiene que
// salir del MISMO cálculo que ve el marcador. Dos fórmulas para lo mismo es
// pedir que un día no cuadren.
export { calcular as metricasMeseros, rangoDe as rangoMeseros };

function calcular(desde, hasta) {
  const filas = (store.state.ordenesMesero || []).filter((o) =>
    o.fecha >= desde && o.fecha <= hasta &&
    o.tipo_orden === "Comedor" && o.estatus === "Cerrada" && num(o.total) > 0);

  const por = new Map();
  for (const o of filas) {
    const m = o.mesero || "(sin usuario)";
    if (!por.has(m)) por.set(m, { mesero: m, cuentas: 0, comensales: 0, venta: 0, cafes: 0,
      ctasPostre: 0, postres: 0, extras: 0, extrasMonto: 0, aguacate: 0 });
    const p = por.get(m);
    p.cuentas++;
    p.comensales += num(o.comensales);
    p.venta += num(o.total);
    p.cafes += num(o.cafes);
    p.postres += num(o.postres);
    if (num(o.postres) > 0) p.ctasPostre++;      // el attach es por CUENTA, no por postre
    p.extras += num(o.extras_uds);
    p.extrasMonto += num(o.extras_monto);
    const ex = (o.detalle && o.detalle.extras) || {};
    for (const k of Object.keys(ex)) if (/aguacate/i.test(k)) p.aguacate += num(ex[k]);
  }

  const lista = [...por.values()].map((p) => ({
    ...p,
    tktPersona: p.comensales ? p.venta / p.comensales : 0,
    cafeCuenta: p.cuentas ? p.cafes / p.cuentas : 0,
    attach: p.cuentas ? p.ctasPostre / p.cuentas : 0,
    extrasCuenta: p.cuentas ? p.extras / p.cuentas : 0,
    aguaCuenta: p.cuentas ? p.aguacate / p.cuentas : 0,
    chica: p.cuentas < MIN_CUENTAS,
  }));
  const eq = lista.reduce((a, p) => ({
    cuentas: a.cuentas + p.cuentas, comensales: a.comensales + p.comensales, venta: a.venta + p.venta,
    cafes: a.cafes + p.cafes, ctasPostre: a.ctasPostre + p.ctasPostre,
    extras: a.extras + p.extras, extrasMonto: a.extrasMonto + p.extrasMonto,
  }), { cuentas: 0, comensales: 0, venta: 0, cafes: 0, ctasPostre: 0, extras: 0, extrasMonto: 0 });
  return { lista: lista.sort((a, b) => b.cuentas - a.cuentas), eq, n: filas.length };
}

const sem = (v, meta) => v >= meta ? "var(--verde,#0e7a4a)" : v >= meta * 0.75 ? "var(--amarillo,#b8860b)" : "var(--rojo,#b3261e)";

export function render(el) {
  let periodo = "mes", verAjustes = false;
  let cargando = !(store.state.ordenesMesero || []).length;

  const unsub = store.subscribe(pintar);
  if (cargando) store.cargarOrdenesMesero().finally(() => { cargando = false; pintar(); });
  pintar();

  function pintar() {
    const r = rangoDe(periodo);
    const { lista, eq } = calcular(r.desde, r.hasta);
    const metas = cfg().metas;

    if (store.state.errorMeseros) {
      el.innerHTML = `<div class="card"><h2 style="margin-top:0">Falta preparar la base</h2>
        <p class="sub">No pude leer <b>ordenes_mesero</b>: ${esc(store.state.errorMeseros)}</p>
        <p class="sub">Corre <b>supabase/meseros.sql</b> en el SQL Editor y vuelve a entrar.</p></div>`;
      return;
    }
    if (cargando) { el.innerHTML = `<div class="vacio">Cargando órdenes…</div>`; return; }
    if (!lista.length) { el.innerHTML = selector(r) + vacio(); wireSel(); return; }

    // El podio: solo quien compite y tiene muestra suficiente.
    const podio = (campo) => lista.filter((p) => compite(p.mesero) && !p.chica)
      .sort((a, b) => b[campo] - a[campo]);
    const pExtras = podio("extrasCuenta"), pPostre = podio("attach");
    const MED = ["🥇", "🥈", "🥉"];

    el.innerHTML = `
      ${selector(r)}

      <div class="card">
        <h2 style="margin-top:0">🏁 Marcador · ${esc(r.txt)}</h2>
        <p class="sub" style="margin-top:-6px">Se ordena por <b>tasa por cuenta</b>, que es lo justo entre quien
        atendió ${eq.cuentas ? Math.max(...lista.map((p) => p.cuentas)) : 0} mesas y quien atendió menos. El volumen va al lado.</p>
        <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
          ${tarjetaPodio("Extras por cuenta", pExtras, "extrasCuenta", "extras", MED, metas.extrasCuenta, (v) => v.toFixed(2))}
          ${tarjetaPodio("Postre en la mesa", pPostre, "attach", "ctasPostre", MED, metas.attachPostre, (v) => (v * 100).toFixed(0) + "%")}
        </div>
        ${lista.some((p) => p.chica && compite(p.mesero)) ? `<p class="sub" style="margin:12px 2px 0;font-size:11.5px">
          Fuera del podio por muestra chica (menos de ${MIN_CUENTAS} cuentas):
          ${esc(lista.filter((p) => p.chica && compite(p.mesero)).map((p) => `${p.mesero} (${p.cuentas})`).join(", "))}.
          Sus números sí aparecen abajo.</p>` : ""}
        ${r.corto ? `<p class="sub" style="margin:8px 2px 0;font-size:11.5px">⚠️ Siete días es poca muestra: tómalo como preliminar. El marcador que cuenta es el del mes.</p>` : ""}
      </div>

      <div class="card">
        <h2 style="margin-top:0">📋 Scorecard · ${esc(r.txt)}</h2>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:640px">
            <thead><tr style="text-align:right">
              <th style="text-align:left;padding:6px 4px">Mesero</th>
              <th style="padding:6px 4px">Cuentas</th><th style="padding:6px 4px">Comensales</th>
              <th style="padding:6px 4px">Ticket/pers</th>
              <th style="padding:6px 4px">Café/cta<br><span class="sub" style="font-weight:400">meta ${metas.cafeCuenta.toFixed(1)}</span></th>
              <th style="padding:6px 4px">Postre<br><span class="sub" style="font-weight:400">meta ${(metas.attachPostre * 100).toFixed(0)}%</span></th>
              <th style="padding:6px 4px">Extras/cta<br><span class="sub" style="font-weight:400">meta ${metas.extrasCuenta.toFixed(2)}</span></th>
              <th style="padding:6px 4px">Extras $</th><th style="padding:6px 4px">Aguacate/cta</th>
            </tr></thead>
            <tbody>${lista.map((p) => filaScore(p, metas)).join("")}</tbody>
            <tfoot><tr style="text-align:right;border-top:2px solid var(--linea);font-weight:800">
              <td style="text-align:left;padding:8px 4px">EQUIPO</td>
              <td style="padding:8px 4px">${eq.cuentas}</td><td style="padding:8px 4px">${eq.comensales}</td>
              <td style="padding:8px 4px">${money(eq.comensales ? eq.venta / eq.comensales : 0)}</td>
              <td style="padding:8px 4px">${(eq.cuentas ? eq.cafes / eq.cuentas : 0).toFixed(2)}</td>
              <td style="padding:8px 4px">${((eq.cuentas ? eq.ctasPostre / eq.cuentas : 0) * 100).toFixed(0)}%</td>
              <td style="padding:8px 4px">${(eq.cuentas ? eq.extras / eq.cuentas : 0).toFixed(2)}</td>
              <td style="padding:8px 4px">${money(eq.extrasMonto)}</td><td style="padding:8px 4px">—</td>
            </tr></tfoot>
          </table>
        </div>
        <p class="sub" style="margin:10px 2px 0;font-size:11.5px">
          Solo comedor, cuentas cerradas con venta. <b>Postre</b> = porcentaje de mesas que se llevaron postre,
          no postres vendidos. <b>Extras</b> = modificadores pagados de Extras Proteína y Premium.</p>
      </div>

      <div class="card">
        <button class="btn sec" id="mAjustes">⚙️ Quién compite y las metas</button>
        <div id="mPanel">${verAjustes ? panelAjustes(lista, metas) : ""}</div>
      </div>`;

    wireSel();
    el.querySelector("#mAjustes").onclick = () => { verAjustes = !verAjustes; pintar(); };
    if (verAjustes) wireAjustes(lista);
  }

  function selector(r) {
    const op = (k, t) => `<button data-p="${k}" class="btn sec chico" style="flex:1${k === periodo ? ";background:var(--verde,#0e3a39);color:#fff;border-color:transparent" : ""}">${t}</button>`;
    return `<div class="card" style="padding:10px">
      <div class="fila" style="gap:6px">${op("mes", "Este mes")}${op("mespasado", "Mes pasado")}${op("semana", "7 días")}${op("todo", "Todo")}</div>
      <div class="sub" style="margin-top:8px;font-size:11.5px">${esc(r.desde)} → ${esc(r.hasta)}</div>
    </div>`;
  }
  function wireSel() {
    el.querySelectorAll("[data-p]").forEach((b) =>
      b.addEventListener("click", () => { periodo = b.dataset.p; pintar(); }));
  }
  function wireAjustes(lista) {
    el.querySelectorAll("[data-compite]").forEach((c) => c.addEventListener("change", async () => {
      const m = { ...cfg().compiten, [c.dataset.compite]: c.checked };
      await guardar({ compiten: m });
    }));
    el.querySelectorAll("[data-meta]").forEach((i) => i.addEventListener("change", async () => {
      const k = i.dataset.meta;
      const v = k === "attachPostre" ? num(i.value) / 100 : num(i.value);
      await guardar({ metas: { ...cfg().metas, [k]: v } });
    }));
  }
  async function guardar(patch) {
    const actual = (store.state.config && store.state.config.meseros) || {};
    try { await store.guardarConfig({ meseros: { ...actual, ...patch } }); pintar(); }
    catch (e) { alert("No pude guardar: " + ((e && e.message) || e)); }
  }

  return () => { if (typeof unsub === "function") unsub(); };
}

function tarjetaPodio(titulo, arr, campo, campoVol, MED, meta, fmt) {
  if (!arr.length) return `<div><h3 style="margin:0 0 8px;font-size:14px">${esc(titulo)}</h3><div class="sub">Sin datos suficientes.</div></div>`;
  return `<div>
    <h3 style="margin:0 0 8px;font-size:14px">${esc(titulo)}</h3>
    ${arr.map((p, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--linea)">
        <span style="width:22px;font-size:15px">${MED[i] || ""}</span>
        <span style="flex:1;min-width:0;font-weight:${i === 0 ? 700 : 500};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.mesero)}</span>
        <span class="sub" style="font-size:11.5px;white-space:nowrap">${p[campoVol]} uds</span>
        <b style="min-width:52px;text-align:right;color:${sem(p[campo], meta)}">${fmt(p[campo])}</b>
      </div>`).join("")}
  </div>`;
}

function filaScore(p, metas) {
  const td = (v, col) => `<td style="padding:7px 4px${col ? ";color:" + col + ";font-weight:700" : ""}">${v}</td>`;
  return `<tr style="text-align:right;border-bottom:1px solid var(--linea)${p.chica ? ";opacity:.6" : ""}">
    <td style="text-align:left;padding:7px 4px">
      ${esc(p.mesero)}${compite(p.mesero) ? "" : ` <span class="sub" style="font-size:10.5px">· no compite</span>`}
      ${p.chica ? ` <span class="sub" style="font-size:10.5px">· muestra chica</span>` : ""}
    </td>
    ${td(p.cuentas)}${td(p.comensales)}${td(money(p.tktPersona))}
    ${td(p.cafeCuenta.toFixed(2), sem(p.cafeCuenta, metas.cafeCuenta))}
    ${td((p.attach * 100).toFixed(0) + "%", sem(p.attach, metas.attachPostre))}
    ${td(p.extrasCuenta.toFixed(2), sem(p.extrasCuenta, metas.extrasCuenta))}
    ${td(money(p.extrasMonto))}${td(p.aguaCuenta.toFixed(2))}
  </tr>`;
}

function panelAjustes(lista, metas) {
  return `<div style="margin-top:12px">
    <h3 style="margin:0 0 6px;font-size:14px">Quién entra al marcador</h3>
    <p class="sub" style="margin-top:0;font-size:11.5px">Desmarca a quien no sea de piso — socios de respaldo, cajeros que mesean a ratos.
    Sus números siguen apareciendo en el scorecard, pero fuera de la competencia.</p>
    ${lista.map((p) => `<label style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--linea)">
      <input type="checkbox" data-compite="${esc(p.mesero)}"${compite(p.mesero) ? " checked" : ""} style="width:18px;height:18px;flex:none;accent-color:var(--verde)" />
      <span style="flex:1">${esc(p.mesero)}</span>
      <span class="sub" style="font-size:11.5px">${p.cuentas} cuentas</span>
    </label>`).join("")}

    <h3 style="margin:16px 0 6px;font-size:14px">Metas</h3>
    <label class="campo"><span>Cafés por cuenta</span>
      <input data-meta="cafeCuenta" type="number" step="0.1" inputmode="decimal" value="${metas.cafeCuenta}" /></label>
    <label class="campo"><span>Mesas con postre (%)</span>
      <input data-meta="attachPostre" type="number" step="1" inputmode="decimal" value="${(metas.attachPostre * 100).toFixed(0)}" /></label>
    <label class="campo"><span>Extras por cuenta</span>
      <input data-meta="extrasCuenta" type="number" step="0.01" inputmode="decimal" value="${metas.extrasCuenta}" /></label>
  </div>`;
}

function vacio() {
  return `<div class="card">
    <h2 style="margin-top:0">Todavía no hay órdenes de ese periodo</h2>
    <p class="sub">Para llenar esto, ve a <b>Insumos → Importar</b> y sube el <b>reporte de órdenes de Parrot</b>
    (el Excel con las hojas "Reporte de órdenes" y "Reporte de detalle de órdenes").</p>
    <p class="sub">La app cruza las dos hojas: de la primera saca quién atendió cada cuenta, de la segunda qué se vendió en ella.</p>
  </div>`;
}
