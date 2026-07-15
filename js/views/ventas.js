// Pantalla: Ventas — dos sub-vistas: Resumen (cortes de caja, gasto vs venta)
// y Productos (venta por producto, categoría y modificadores).
import * as store from "../store.js";
import { money, fechaBonita } from "../store.js";
import * as importar from "./importar.js";
import { descargarCSV } from "../csv.js";

function kmoney(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return "$" + (Math.trunc(n / 1000) / 1000).toFixed(3).replace(/\.?0+$/, "") + "M";
  if (a >= 1000) return "$" + (n / 1000).toFixed(1) + "k";
  return "$" + Math.round(n);
}
function escapar(s) {
  return String(s || "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const PALETA = ["#0e3a39", "#dd6031", "#767522", "#491208", "#16514f", "#2e1e1f", "#9c9482"];
const ES_CORTESIA = /pan de cortes[íi]a/i;   // cortesía, no cuenta como venta
const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
let vistaVenta = "semana";   // "semana" | "mes" — se recuerda entre redibujos

// Suma los cortes por mes (AAAA-MM) para la gráfica de venta mensual.
function ventaMensual(cortes) {
  const map = new Map();
  for (const c of cortes) {
    if (!c.fecha) continue;
    const ym = String(c.fecha).slice(0, 7);
    map.set(ym, (map.get(ym) || 0) + store.num(c.ventas_total));
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([ym, v]) => {
    const [y, m] = ym.split("-");
    return { etiqueta: `${MES_CORTO[(+m || 1) - 1]} ${y.slice(2)}`, venta: v };
  });
}

export function render(el) {
  let sub = "resumen";
  el.innerHTML = `
    <div class="segmented" style="font-size:13px">
      <button data-s="resumen">Resumen</button>
      <button data-s="productos">Productos</button>
      <button data-s="rentab">Rentab.</button>
      <button data-s="importar">Importar</button>
    </div>
    <div id="sub"></div>`;
  const subEl = el.querySelector("#sub");
  const btns = [...el.querySelectorAll(".segmented button")];
  btns.forEach((b) => b.addEventListener("click", () => { sub = b.dataset.s; marcar(); renderSub(); }));

  function marcar() { btns.forEach((b) => b.classList.toggle("act", b.dataset.s === sub)); }

  function renderSub() {
    if (!store.state.listo) { subEl.innerHTML = `<div class="vacio">Cargando…</div>`; return; }
    if (sub === "resumen") resumen(subEl);
    else if (sub === "productos") productos(subEl);
    else if (sub === "rentab") rentabilidad(subEl);
    else importar.montar(subEl);
  }

  // El importador no se redibuja con los cambios de datos (para no borrar su resultado).
  const off = store.subscribe(() => { if (sub !== "importar") renderSub(); });
  marcar();
  renderSub();
  return off;
}

// ─────────── RESUMEN (cortes de caja) ───────────
function resumen(cont) {
  const cortes = store.state.cortes || [];
  if (!cortes.length) {
    cont.innerHTML = `<div class="card"><div class="aviso-box">Aún no hay ventas cargadas. Corre <b>importar-ventas.sql</b> en Supabase.</div></div>`;
    return;
  }
  const ventaTotal = cortes.reduce((a, c) => a + store.num(c.ventas_total), 0);
  const efectivoT = cortes.reduce((a, c) => a + store.num(c.efectivo), 0);
  const tarjetaT = cortes.reduce((a, c) => a + store.num(c.tarjeta), 0);
  const transfT = cortes.reduce((a, c) => a + store.num(c.transferencia), 0);
  const mezclaTot = efectivoT + tarjetaT + transfT || 1;
  const semanas = store.ventasSemanas(12).reverse();
  const meses = ventaMensual(cortes).slice(-12);
  const conVenta = semanas.filter((s) => s.venta > 0 || s.gasto > 0);
  const chartVenta = () => vistaVenta === "mes"
    ? columnas(meses, "venta", "var(--verde-claro)", "Mes")
    : columnas(semanas, "venta", "var(--verde-claro)", "Semana");

  cont.innerHTML = `
    <button class="btn sec chico" id="expC" style="margin-bottom:12px">⬇ Exportar cortes CSV</button>
    <div class="card">
      <div class="row-stats">
        <div class="stat"><div class="n">${kmoney(ventaTotal)}</div><div class="l">Venta histórica</div></div>
        <div class="stat"><div class="n">${cortes.length}</div><div class="l">Cortes</div></div>
        <div class="stat"><div class="n">${kmoney(ventaTotal / cortes.length)}</div><div class="l">Prom./corte</div></div>
      </div>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:10px">
        <h2 id="vTitulo" style="margin:0">Venta por ${vistaVenta === "mes" ? "mes" : "semana"}</h2>
        <div class="segmented chico" id="vtog" style="font-size:12px;width:auto;flex:none">
          <button data-v="semana"${vistaVenta === "semana" ? ' class="act"' : ""}>Semana</button>
          <button data-v="mes"${vistaVenta === "mes" ? ' class="act"' : ""}>Mes</button>
        </div>
      </div>
      <div id="vchart">${chartVenta()}</div>
    </div>
    <div class="card">
      <h2>Gasto vs Venta (costo %)</h2>
      <p class="sub" style="margin-top:0">Cuánto de tu venta se fue en compras. Menos % = mejor margen.</p>
      ${tablaCosto(conVenta)}
    </div>
    <div class="card">
      <h2>Cómo te pagan</h2>
      ${mezcla("Efectivo", efectivoT, mezclaTot, "#0e3a39")}
      ${mezcla("Tarjeta", tarjetaT, mezclaTot, "#dd6031")}
      ${mezcla("Transferencia", transfT, mezclaTot, "#3f8a5c")}
    </div>
    <div class="card"><h2>Cortes de caja</h2>${cortes.slice(0, 40).map(filaCorte).join("")}</div>`;
  cont.querySelectorAll("#vtog button").forEach((b) => b.addEventListener("click", () => {
    vistaVenta = b.dataset.v;
    cont.querySelectorAll("#vtog button").forEach((x) => x.classList.toggle("act", x.dataset.v === vistaVenta));
    cont.querySelector("#vTitulo").textContent = vistaVenta === "mes" ? "Venta por mes" : "Venta por semana";
    cont.querySelector("#vchart").innerHTML = chartVenta();
  }));

  cont.querySelector("#expC").addEventListener("click", () => {
    const filas = cortes.map((c) => [c.fecha, store.num(c.ventas_total), store.num(c.efectivo),
      store.num(c.tarjeta), store.num(c.transferencia), store.num(c.diferencia), c.persona || ""]);
    descargarCSV("cortes-cremina", ["Fecha", "Venta total", "Efectivo", "Tarjeta", "Transferencia", "Diferencia", "Persona"], filas);
  });
}

// ─────────── PRODUCTOS ───────────
function productos(cont) {
  const prodAll = store.state.productos || [];
  const varAll = store.state.variantes || [];
  if (!prodAll.length && !varAll.length) {
    cont.innerHTML = `<div class="card"><div class="aviso-box">Aún no hay ventas por producto. Corre <b>importar-productos.sql</b> e <b>importar-variantes.sql</b> en Supabase.</div></div>`;
    return;
  }
  const pmap = new Map();
  for (const p of prodAll) if (!pmap.has(p.periodo)) pmap.set(p.periodo, p.desde);
  for (const v of varAll) if (!pmap.has(v.periodo)) pmap.set(v.periodo, v.desde);
  const periodos = [...pmap.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map((e) => e[0]);
  let periodo = periodos[0];

  cont.innerHTML = `
    <div class="card" style="padding:10px">
      <select id="per">${periodos.map((p) => `<option value="${escapar(p)}">${escapar(p)}</option>`).join("")}</select>
    </div>
    <div id="pc"></div>`;

  const sel = cont.querySelector("#per");
  sel.addEventListener("change", () => { periodo = sel.value; pintarPeriodo(); });
  pintarPeriodo();

  function pintarPeriodo() {
    const pc = cont.querySelector("#pc");
    // Pan de Cortesía es cortesía, no venta → se excluye de los análisis.
    const prods = prodAll.filter((p) => p.periodo === periodo && !ES_CORTESIA.test(p.producto || "") && !ES_CORTESIA.test(p.categoria || ""));
    const vars = varAll.filter((v) => v.periodo === periodo && !ES_CORTESIA.test(v.producto || "") && !ES_CORTESIA.test(v.opcion || ""));

    const porCat = {};
    for (const p of prods) porCat[p.categoria || "Otros"] = (porCat[p.categoria || "Otros"] || 0) + store.num(p.venta);

    const ventaProd = {};
    const prodCat = new Map(); // producto → set de categorías
    for (const p of prods) {
      ventaProd[p.producto] = (ventaProd[p.producto] || 0) + store.num(p.venta);
      if (!prodCat.has(p.producto)) prodCat.set(p.producto, new Set());
      prodCat.get(p.producto).add(p.categoria || "Otros");
    }
    const categorias = [...new Set(prods.map((p) => p.categoria || "Otros"))].sort((a, b) => a.localeCompare(b, "es"));

    // agrupar variantes por platillo → grupo
    const porProd = new Map();
    for (const v of vars) {
      if (!porProd.has(v.producto)) porProd.set(v.producto, {});
      const g = porProd.get(v.producto);
      (g[v.grupo] = g[v.grupo] || []).push(v);
    }
    let platillos = [...porProd.entries()].map(([prod, grupos]) => {
      const gname = elegirGrupo(grupos);
      const rows = (grupos[gname] || []).slice().sort((a, b) => store.num(b.unidades) - store.num(a.unidades));
      return { prod, grupo: gname, rows, ventaProd: ventaProd[prod] || rows.reduce((a, r) => a + store.num(r.venta), 0) };
    });
    platillos.sort((a, b) => b.ventaProd - a.ventaProd);

    // Leche como su propia categoría (avena / deslactosada / entera), sumada de todas las bebidas
    const leche = {};
    for (const v of vars) if (/^leche$/i.test(v.grupo || "")) leche[v.opcion] = (leche[v.opcion] || 0) + store.num(v.unidades);
    const lecheEnt = Object.entries(leche).sort((a, b) => b[1] - a[1]);

    let q = "", cat = "todas";
    pc.innerHTML = `
      <button class="btn sec chico" id="expP" style="margin-bottom:12px">⬇ Exportar CSV (${escapar(periodo)})</button>
      ${Object.keys(porCat).length ? `<div class="card"><h2>Venta por categoría</h2>${barrasCat(porCat)}</div>` : ""}
      ${lecheEnt.length ? `<div class="card"><h2>Leche más pedida</h2>
        <p class="sub" style="margin-top:-4px">Total de bebidas por tipo de leche</p>${barrasLeche(lecheEnt)}</div>` : ""}
      <div class="card">
        <h2>Venta por platillo y variante</h2>
        ${vars.length
          ? `<input id="bq" placeholder="Buscar platillo…" style="margin-bottom:10px" />
             <select id="fcat" style="margin-bottom:12px">
               <option value="todas">Todos los grupos de comida</option>
               ${categorias.map((c) => `<option value="${escapar(c)}">${escapar(c)}</option>`).join("")}
             </select>
             <div id="plist"></div>`
          : `<div class="aviso-box">Sube el <b>reporte de grupos de modificadores</b> de esta semana en <b>Importar</b> para ver el desglose por variante.</div>`}
      </div>`;

    pc.querySelector("#expP").addEventListener("click", () => {
      if (vars.length) {
        const filas = vars.map((v) => [v.producto, v.grupo, v.opcion, store.num(v.unidades), store.num(v.venta)]);
        descargarCSV("productos-variantes-" + periodo, ["Producto", "Grupo", "Variante", "Unidades", "Venta"], filas);
      } else {
        const filas = prods.map((p) => [p.producto, p.categoria, store.num(p.cantidad), store.num(p.venta)]);
        descargarCSV("productos-" + periodo, ["Producto", "Categoría", "Cantidad", "Venta"], filas);
      }
    });

    if (vars.length) {
      const bq = pc.querySelector("#bq"), fc = pc.querySelector("#fcat");
      bq.addEventListener("input", () => { q = bq.value.trim().toLowerCase(); pintarList(); });
      fc.addEventListener("change", () => { cat = fc.value; pintarList(); });
      pintarList();
    }

    function pintarList() {
      let lista = platillos;
      if (cat !== "todas") lista = lista.filter((x) => prodCat.get(x.prod) && prodCat.get(x.prod).has(cat));
      if (q) lista = lista.filter((x) => x.prod.toLowerCase().includes(q));
      pc.querySelector("#plist").innerHTML = lista.map(cardPlatillo).join("") || `<div class="sub">Sin resultados.</div>`;
    }
  }
}

// ─────────── RENTABILIDAD ───────────
function rentabilidad(cont) {
  const prodAll = (store.state.productos || []).filter((p) => !ES_CORTESIA.test(p.producto || "") && !ES_CORTESIA.test(p.categoria || ""));
  if (!prodAll.length) {
    cont.innerHTML = `<div class="card"><div class="aviso-box">Corre <b>importar-productos.sql</b> para analizar rentabilidad por periodo.</div></div>`;
    return;
  }
  const pmap = new Map();
  for (const p of prodAll) if (!pmap.has(p.periodo)) pmap.set(p.periodo, { desde: p.desde, hasta: p.hasta });
  const periodos = [...pmap.entries()].sort((a, b) => (a[1].desde < b[1].desde ? 1 : -1)).map((e) => e[0]);
  let periodo = periodos[0];

  cont.innerHTML = `<div class="card" style="padding:10px">
    <select id="per">${periodos.map((p) => `<option value="${escapar(p)}">${escapar(p)}</option>`).join("")}</select>
  </div><div id="rc"></div>`;
  const sel = cont.querySelector("#per");
  sel.addEventListener("change", () => { periodo = sel.value; pinta(); });
  pinta();

  function pinta() {
    const { desde, hasta } = pmap.get(periodo);
    const prods = prodAll.filter((p) => p.periodo === periodo);
    const BAR = new Set(["Barra de Café", "Bebidas"]);
    let foodVenta = 0, barVenta = 0; const porCat = {};
    for (const p of prods) {
      const v = store.num(p.venta);
      porCat[p.categoria || "Otros"] = (porCat[p.categoria || "Otros"] || 0) + v;
      if (BAR.has(p.categoria)) barVenta += v; else foodVenta += v;
    }
    const ventaMenu = foodVenta + barVenta;

    const lineas = store.lineasEnRango(desde, hasta);
    const gArea = {}; for (const l of lineas) gArea[l.area] = (gArea[l.area] || 0) + store.num(l.monto);
    const cocina = gArea.cocina || 0, barra = gArea.barra || 0;
    const gastoVar = lineas.reduce((a, l) => a + store.num(l.monto), 0);
    const otros = Math.max(0, gastoVar - cocina - barra);
    const foodCost = foodVenta > 0 ? cocina / foodVenta * 100 : 0;
    const barCost = barVenta > 0 ? barra / barVenta * 100 : 0;
    const costoTotal = ventaMenu > 0 ? gastoVar / ventaMenu * 100 : 0;

    const dias = Math.max(1, Math.round((Date.parse(hasta) - Date.parse(desde)) / 86400000) + 1);
    const gfPer = store.gastoFijoMensual() / 30 * dias;
    const utilBruta = ventaMenu - gastoVar;
    const utilNeta = utilBruta - gfPer;

    const cCost = (p, ideal) => p === 0 ? "var(--gris)" : p <= ideal ? "var(--verde)" : p <= ideal + 8 ? "var(--amarillo)" : "var(--rojo)";

    const recs = [];
    if (foodVenta > 0 && foodCost > 35) recs.push(`🍳 El costo de <b>comida</b> es ${Math.round(foodCost)}% (ideal ≤35%). Revisa porciones, mermas o precios.`);
    if (barVenta > 0 && barCost > 25) recs.push(`☕ El costo de <b>barra</b> es ${Math.round(barCost)}% (ideal ≤25%). Revisa recetas/mermas o precios.`);
    if (ventaMenu > 0 && costoTotal > 40) recs.push(`⚠️ Tu costo de venta total va en ${Math.round(costoTotal)}%; apunta a ≤35–40%.`);
    if (store.gastoFijoMensual() === 0) recs.push(`📌 Registra tus <b>gastos fijos</b> (pestaña Proyec.) para ver la utilidad neta real.`);
    else if (utilNeta < 0) recs.push(`🔴 En este periodo cierras con pérdida de ${money(-utilNeta)}. Sube venta o baja costos.`);
    if (!recs.length) recs.push(`✅ Tus costos se ven sanos en este periodo. ¡Bien!`);

    cont.querySelector("#rc").innerHTML = `
      <div class="card">
        <h2>Costo de venta</h2>
        <p class="sub" style="margin-top:-4px">Cuánto te cuesta lo que vendes (menos % = mejor margen).</p>
        ${barCostRow("Comida (cocina)", foodVenta, foodCost, cCost(foodCost, 35))}
        ${barCostRow("Barra (café/bebidas)", barVenta, barCost, cCost(barCost, 25))}
        <div class="barra-row" style="border-top:1px solid var(--linea);margin-top:6px;padding-top:8px;font-weight:700">
          <span class="etq" style="width:auto;flex:1">Costo total de venta</span>
          <span class="val" style="color:${cCost(costoTotal, 38)}">${ventaMenu > 0 ? Math.round(costoTotal) + "%" : "—"}</span>
        </div>
        ${otros > 0 ? `<div class="sub" style="margin-top:6px">+ ${money(otros)} de gasto operativo (piso, limpieza, otros).</div>` : ""}
      </div>
      <div class="card">
        <h2>Utilidad del periodo</h2>
        <div class="row-stats">
          <div class="stat"><div class="n">${kmoney(ventaMenu)}</div><div class="l">Venta</div></div>
          <div class="stat"><div class="n" style="color:${utilBruta >= 0 ? "var(--verde)" : "var(--rojo)"}">${kmoney(utilBruta)}</div><div class="l">Util. bruta</div></div>
          <div class="stat"><div class="n" style="color:${utilNeta >= 0 ? "var(--verde)" : "var(--rojo)"}">${kmoney(utilNeta)}</div><div class="l">Util. neta</div></div>
        </div>
        <div class="sub" style="text-align:center;margin-top:6px">Bruta = venta − compras · Neta = − gastos fijos (${money(gfPer)} del periodo)</div>
      </div>
      <div class="card"><h2>De dónde viene la venta</h2>${barrasCat(porCat)}</div>
      <div class="card">
        <h2>Recomendaciones</h2>
        ${recs.map((r) => `<div style="font-size:13px;padding:6px 0;border-bottom:1px solid var(--linea)">${r}</div>`).join("")}
      </div>`;
  }
}

function barCostRow(nombre, venta, pct, color) {
  return `<div class="barra-row">
    <span class="etq" style="width:130px">${nombre}</span>
    <span class="barra-track"><span class="barra-fill" style="width:${Math.min(100, Math.max(3, pct))}%;background:${color}"></span></span>
    <span class="val" style="color:${color};font-weight:700">${venta > 0 ? Math.round(pct) + "%" : "—"}</span></div>`;
}

// Grupo "principal" de un platillo: Tipo… → Sabor → (evita Leche/temperatura).
// La leche se analiza aparte, así que no debe ser el grupo mostrado del café.
const ES_SECUNDARIO = /leche|fr[íi]o|caliente|shot|cold foam/i;
function elegirGrupo(grupos) {
  const nombres = Object.keys(grupos);
  const unidades = (g) => grupos[g].reduce((a, r) => a + store.num(r.unidades), 0);
  let cand = nombres.filter((n) => n.toLowerCase().startsWith("tipo"));
  if (!cand.length) cand = nombres.filter((n) => n.toLowerCase().startsWith("sabor"));
  if (!cand.length) cand = nombres.filter((n) => !ES_SECUNDARIO.test(n));
  if (!cand.length) cand = nombres;
  return cand.sort((a, b) => unidades(b) - unidades(a))[0];
}

function cardPlatillo(x) {
  const max = Math.max(1, ...x.rows.map((r) => store.num(r.unidades)));
  const totVenta = x.rows.reduce((a, r) => a + store.num(r.venta), 0) || 1;
  const filas = x.rows.map((r) => {
    const u = store.num(r.unidades), pct = Math.round(100 * store.num(r.venta) / totVenta);
    return `<div class="barra-row">
      <span class="etq" style="width:120px">${escapar(r.opcion)}</span>
      <span class="barra-track"><span class="barra-fill" style="width:${Math.max(3, 100 * u / max)}%;background:var(--naranja);opacity:${opac(u, max)}"></span></span>
      <span class="val" style="width:130px">${Math.round(u)} · ${money(r.venta)} · ${pct}%</span></div>`;
  }).join("");
  return `<div style="margin-bottom:18px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;font-weight:700"><span>${escapar(x.prod)}</span><span>${money(x.ventaProd)}</span></div>
    <div class="sub" style="margin:2px 0 7px">${escapar(x.grupo)}</div>
    ${filas}
  </div>`;
}

function barrasCombos(combos) {
  if (!combos.length) return `<div class="sub">Sin datos.</div>`;
  const max = Math.max(1, ...combos.map((c) => store.num(c.cantidad)));
  return combos.map((c) => {
    const v = store.num(c.cantidad);
    return `<div class="barra-row">
      <span class="etq" style="width:160px">${escapar(c.producto)} · <b>${escapar(c.modificador)}</b></span>
      <span class="barra-track"><span class="barra-fill" style="width:${Math.max(3, 100 * v / max)}%;background:var(--naranja);opacity:${opac(v, max)}"></span></span>
      <span class="val">${Math.round(v)}</span></div>`;
  }).join("");
}

// Intensidad de color según el valor: más alto = más fuerte (ayuda a comparar).
function opac(v, max) { return (0.4 + 0.6 * (v / max)).toFixed(2); }

// ─────────── helpers de gráficas ───────────
function columnas(semanas, campo, color, unidad = "Semana") {
  const max = Math.max(1, ...semanas.map((s) => s[campo]));
  const maxVal = Math.max(...semanas.map((s) => s[campo]));
  const cols = semanas.map((s) => {
    const h = Math.max(2, Math.round(100 * s[campo] / max));
    const esMax = s[campo] === maxVal && s[campo] > 0;
    const [d1, d2] = s.etiqueta.split(" ");
    return `<div class="colwrap${esMax ? " max" : ""}">
      <div class="colbar-track"><div class="colbar" style="height:${h}%;background:${color};opacity:${opac(s[campo], max)}">
        ${s[campo] > 0 ? `<span class="cval">${kmoney(s[campo])}</span>` : ""}</div></div>
      <div class="collbl">${d1 || ""}<br>${d2 || ""}</div></div>`;
  }).join("");
  return `<div class="colchart">${cols}</div>
    <div class="leyenda"><span><i style="background:var(--dorado)"></i>${unidad} de mayor venta</span></div>`;
}

function tablaCosto(semanas) {
  if (!semanas.length) return `<div class="sub">Sin datos.</div>`;
  return `<div class="barra-row" style="font-weight:600;color:var(--gris);font-size:12px">
      <span class="etq" style="width:96px">Semana</span>
      <span style="flex:1;text-align:right">Venta</span>
      <span style="flex:1;text-align:right">Gasto</span>
      <span style="width:56px;text-align:right">Costo</span></div>
    ${semanas.map((s) => {
      const pct = s.venta > 0 ? (s.gasto / s.venta) * 100 : 0;
      const col = pct === 0 ? "var(--gris)" : pct <= 35 ? "var(--verde)" : pct <= 45 ? "var(--amarillo)" : "var(--rojo)";
      return `<div class="barra-row">
        <span class="etq" style="width:96px;font-size:12px">${s.etiqueta}</span>
        <span style="flex:1;text-align:right;font-variant-numeric:tabular-nums">${kmoney(s.venta)}</span>
        <span style="flex:1;text-align:right;font-variant-numeric:tabular-nums">${kmoney(s.gasto)}</span>
        <span style="width:56px;text-align:right;font-weight:700;color:${col}">${s.venta > 0 ? Math.round(pct) + "%" : "—"}</span></div>`;
    }).join("")}`;
}

function mezcla(nombre, val, total, color) {
  const pct = 100 * val / total;
  return `<div class="barra-row">
    <span class="etq">${nombre}</span>
    <span class="barra-track"><span class="barra-fill" style="width:${Math.max(2, pct)}%;background:${color}"></span></span>
    <span class="val">${money(val)}</span></div>`;
}

function barrasCat(obj) {
  const ent = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...ent.map((e) => e[1]));
  return ent.map(([k, v], i) => `<div class="barra-row">
    <span class="etq" style="width:110px">${escapar(k)}</span>
    <span class="barra-track"><span class="barra-fill" style="width:${Math.max(3, 100 * v / max)}%;background:${PALETA[i % PALETA.length]};opacity:${opac(v, max)}"></span></span>
    <span class="val">${money(v)}</span></div>`).join("");
}

function barrasLeche(ent) {
  const max = Math.max(1, ...ent.map((e) => e[1]));
  return ent.map(([k, v], i) => `<div class="barra-row">
    <span class="etq" style="width:120px">${escapar(k)}</span>
    <span class="barra-track"><span class="barra-fill" style="width:${Math.max(3, 100 * v / max)}%;background:${PALETA[i % PALETA.length]};opacity:${opac(v, max)}"></span></span>
    <span class="val">${Math.round(v)}</span></div>`).join("");
}

function barrasProd(prods, campo, total) {
  if (!prods.length) return `<div class="sub">Sin datos.</div>`;
  const max = Math.max(1, ...prods.map((p) => store.num(p[campo])));
  return prods.map((p) => {
    const v = store.num(p[campo]);
    const etq = campo === "venta" ? money(v) : Math.round(v) + " pz";
    return `<div class="barra-row">
      <span class="etq" style="width:120px">${escapar(p.producto)}</span>
      <span class="barra-track"><span class="barra-fill" style="width:${Math.max(3, 100 * v / max)}%;background:var(--naranja)"></span></span>
      <span class="val">${etq}</span></div>`;
  }).join("");
}

function barrasMods(mods) {
  if (!mods.length) return `<div class="sub">Sin modificadores registrados.</div>`;
  const max = Math.max(1, ...mods.map((m) => store.num(m.cantidad)));
  return mods.map((m) => `<div class="barra-row">
    <span class="etq" style="width:150px">${escapar(m.modificador)}</span>
    <span class="barra-track"><span class="barra-fill" style="width:${Math.max(3, 100 * store.num(m.cantidad) / max)}%;background:var(--dorado)"></span></span>
    <span class="val">${Math.round(store.num(m.cantidad))}</span></div>`).join("");
}

function filaCorte(c) {
  const dif = store.num(c.diferencia);
  const difTxt = Math.abs(dif) < 0.5 ? "" :
    `<span style="color:${dif < 0 ? "var(--rojo)" : "var(--verde)"};font-size:12px">${dif < 0 ? "" : "+"}${money(dif)}</span>`;
  return `<div class="ticket" style="cursor:default">
    <div class="cab">
      <span class="prov" style="font-size:14px">${fechaBonita(c.fecha)}</span>
      <span class="monto" style="font-size:14px">${money(c.ventas_total)}</span></div>
    <div class="meta" style="display:flex;justify-content:space-between;align-items:center">
      <span>💵 ${kmoney(store.num(c.efectivo))} · 💳 ${kmoney(store.num(c.tarjeta))}${store.num(c.transferencia) ? " · 🔁 " + kmoney(store.num(c.transferencia)) : ""}</span>
      ${difTxt}</div></div>`;
}
