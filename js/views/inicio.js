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
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

const ES_CORTESIA = /pan de cortes[íi]a|propina/i;   // cortesía y propina no cuentan como venta
const CAT_BEBIDA = new Set(["Barra de Café", "Bebidas"]);

// Grupo modificador "principal" de un platillo/bebida (Tipo → Sabor; evita leche/temperatura).
const ES_SECUNDARIO = /leche|fr[íi]o|caliente|shot|cold foam|temperatura/i;
function elegirGrupo(grupos) {
  const unidades = (g) => grupos[g].reduce((a, r) => a + store.num(r.unidades), 0);
  // Quita leche/temperatura PRIMERO (para no confundir "Tipo de leche" con el tipo de bebida).
  const pool = Object.keys(grupos).filter((n) => !ES_SECUNDARIO.test(n));
  const base = pool.length ? pool : Object.keys(grupos);
  let cand = base.filter((n) => n.toLowerCase().startsWith("tipo"));
  if (!cand.length) cand = base.filter((n) => n.toLowerCase().startsWith("sabor"));
  if (!cand.length) cand = base;
  return cand.sort((a, b) => unidades(b) - unidades(a))[0];
}
// El tipo/variante más vendido de un producto en un periodo ("qué tipo de chilaquiles/bebida").
function topVariante(producto, periodo) {
  const key = (producto || "").trim().toLowerCase();
  const vars = (store.state.variantes || []).filter((v) =>
    (v.producto || "").trim().toLowerCase() === key && v.periodo === periodo && !ES_CORTESIA.test(v.opcion || ""));
  if (!vars.length) return null;
  const grupos = {};
  for (const v of vars) (grupos[v.grupo] = grupos[v.grupo] || []).push(v);
  const gname = elegirGrupo(grupos);
  const top = (grupos[gname] || []).slice().sort((a, b) => store.num(b.unidades) - store.num(a.unidades))[0];
  return top ? { grupo: gname, opcion: top.opcion, u: store.num(top.unidades) } : null;
}

// Más vendidos (platillo y bebida) del periodo más reciente con datos.
function topProductos() {
  const prod = (store.state.productos || []).filter((p) =>
    !ES_CORTESIA.test(p.producto || "") && !ES_CORTESIA.test(p.categoria || ""));
  if (!prod.length) return null;
  const pmap = new Map();
  for (const p of prod) if (!pmap.has(p.periodo)) pmap.set(p.periodo, p.desde);
  const periodos = [...pmap.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1));
  const periodo = periodos.length ? periodos[0][0] : null;
  const agg = new Map();
  for (const p of prod) {
    if (p.periodo !== periodo) continue;
    const k = p.producto || "—";
    const a = agg.get(k) || { producto: k, cat: p.categoria || "Otros", u: 0, venta: 0 };
    a.u += store.num(p.cantidad); a.venta += store.num(p.venta);
    agg.set(k, a);
  }
  const arr = [...agg.values()];
  if (!arr.length) return null;
  const top = arr.slice().sort((a, b) => b.u - a.u);
  const topPlatillos = arr.filter((x) => !CAT_BEBIDA.has(x.cat)).sort((a, b) => b.u - a.u).slice(0, 3);
  const topBebidas = arr.filter((x) => CAT_BEBIDA.has(x.cat)).sort((a, b) => b.u - a.u).slice(0, 3);
  for (const x of [...topPlatillos, ...topBebidas]) x.tipo = topVariante(x.producto, periodo); // su tipo/sabor
  return { periodo, top, topPlatillos, topBebidas, topFood: topPlatillos[0] || null, topBebida: topBebidas[0] || null };
}

// Movimientos de venta entre el periodo reciente y el anterior:
//  · Caídas: productos de buena venta (>15/sem) que bajaron ≥15%.
//  · Subidas ("ojo del bueno"): productos que subieron ≥15%.
const MIN_VENTA = 15;   // arriba de 15 vendidos por semana = producto que sí importa
function movimientosProductos() {
  const prod = (store.state.productos || []).filter((p) =>
    !ES_CORTESIA.test(p.producto || "") && !ES_CORTESIA.test(p.categoria || ""));
  if (!prod.length) return null;
  const pmap = new Map();
  for (const p of prod) if (!pmap.has(p.periodo)) pmap.set(p.periodo, p.desde);
  const periodos = [...pmap.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map((e) => e[0]);
  if (periodos.length < 2) return null;             // se necesitan 2 periodos para comparar
  const cur = periodos[0], prev = periodos[1];
  const agg = (per) => {
    const m = new Map();
    for (const p of prod) if (p.periodo === per) {
      const k = p.producto || "—";
      const a = m.get(k) || { u: 0, cat: p.categoria || "Otros" };
      a.u += store.num(p.cantidad); m.set(k, a);
    }
    return m;
  };
  const A = agg(prev), B = agg(cur);
  const caidas = [], subidas = [];
  for (const nombre of new Set([...A.keys(), ...B.keys()])) {
    const av = A.get(nombre) ? A.get(nombre).u : 0;
    const bv = B.get(nombre) ? B.get(nombre).u : 0;
    const cat = (B.get(nombre) || A.get(nombre)).cat;
    if (av <= 0) continue;                           // sin base previa no hay %
    if (Math.max(av, bv) < MIN_VENTA) continue;      // debe ser de buena venta
    const chg = (bv - av) / av;
    if (chg <= -0.15) caidas.push({ nombre, cat, prev: av, cur: bv, drop: chg });
    else if (chg >= 0.15) subidas.push({ nombre, cat, prev: av, cur: bv, rise: chg });
  }
  caidas.sort((a, b) => a.drop - b.drop);            // mayor caída primero
  subidas.sort((a, b) => b.rise - a.rise);           // mayor subida primero
  return { cur, prev, caidas, subidas };
}

// Insumo en el que más gastas y el que más subió de precio.
function insumosDestacados() {
  const ins = store.preciosPorInsumo();
  if (!ins.length) return null;
  const conGasto = ins.map((i) => ({ ...i, gasto: (i.registros || []).reduce((a, r) => a + store.num(r.monto), 0) }));
  const masGasto = conGasto.slice().sort((a, b) => b.gasto - a.gasto)[0] || null;
  // El que más subió, pero solo si el alza es de al menos $1 (no centavos).
  const masSubio = ins.filter((i) => i.veces >= 2 && i.cambio >= 1)
    .sort((a, b) => b.cambio - a.cambio)[0] || null;
  return { masGasto, masSubio };
}

// Mini-tarjeta para los vistazos operativos.
function tile(icon, label, big, sub, color) {
  return `<div style="background:rgba(46,196,182,.07);border:1px solid var(--linea);border-radius:14px;padding:13px 14px;min-width:0">
    <div class="sub" style="font-size:11.5px;font-weight:600">${icon} ${label}</div>
    <div style="font-size:16px;font-weight:700;letter-spacing:-.01em;margin-top:3px;line-height:1.2;color:${color || "var(--tinta)"};overflow-wrap:anywhere">${big}</div>
    <div class="sub" style="font-size:12px;margin-top:3px">${sub}</div>
  </div>`;
}
function grid2(tiles) {
  const cols = tiles.length > 1 ? "1fr 1fr" : "1fr";
  return `<div style="display:grid;grid-template-columns:${cols};gap:10px">${tiles.join("")}</div>`;
}

// "De un vistazo": lo que sube/baja de venta y tu insumo clave.
function cardVistazo(tp, ins, cd) {
  const tiles = [];
  if (cd && cd.subidas.length) {
    const s = cd.subidas[0];
    tiles.push(tile("🚀", "Subiendo (ojo del bueno)", esc(s.nombre),
      `▲ ${Math.round(s.rise * 100)}% · ${Math.round(s.prev)}→${Math.round(s.cur)} vendidos`, "var(--verde)"));
  }
  if (cd && cd.caidas.length) {
    const c = cd.caidas[0];
    tiles.push(tile("📉", "Está cayendo", esc(c.nombre),
      `▼ ${Math.round(Math.abs(c.drop) * 100)}% · ${Math.round(c.prev)}→${Math.round(c.cur)} vendidos`, "var(--rojo)"));
  }
  if (ins && ins.masSubio) tiles.push(tile("📈", "Insumo que más subió", esc(ins.masSubio.nombre),
    `▲ ${money(ins.masSubio.cambio)} · ${money(ins.masSubio.precioActual)}${ins.masSubio.unidad ? "/" + esc(ins.masSubio.unidad) : ""}`, "var(--rojo)"));
  if (ins && ins.masGasto) tiles.push(tile("💸", "En lo que más gastas", esc(ins.masGasto.nombre),
    `${kmoney(ins.masGasto.gasto)} · ${ins.masGasto.veces} compra(s)`, "var(--naranja)"));
  if (!tiles.length) return "";   // sin movimientos ni insumos → no muestres tarjeta vacía
  return `<div class="card"><h2 style="margin-bottom:11px">De un vistazo</h2>${grid2(tiles)}</div>`;
}

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

    // ── Vitales para la radiografía ──
    const gfSem = store.gastoFijoMensual() / 30 * 7;
    const usaProy = (off === 0 && parcial && proy);
    const hVenta = usaProy ? proy.venta : venta;
    const hGasto = usaProy ? proy.gasto : gasto;
    const util = hVenta - hGasto - gfSem;
    const sinDatos = venta === 0;
    const colU = sinDatos ? "var(--gris)" : util > 0 ? "var(--verde)" : util < 0 ? "var(--rojo)" : "var(--tinta)";
    const verdicto = sinDatos ? "Aún sin ventas esta semana" : util > 0 ? "Vas ganando" : util < 0 ? "Vas perdiendo" : "Vas a mano";
    const heroTit = usaProy ? "Utilidad proyectada al cierre" : (off === 0 ? "Utilidad de la semana" : "Utilidad de esa semana");
    const costoCol = costo <= 35 ? "var(--verde)" : costo <= 45 ? "var(--amarillo)" : "var(--rojo)";

    // Punto de equilibrio: cuánto vender para no perder.
    const gfMes = store.gastoFijoMensual();
    const costoVarPct = num(store.state.config.costoVarPct) || 26;
    const contrib = 1 - costoVarPct / 100;
    const beSem = contrib > 0.02 ? gfSem / contrib : 0;
    const beDia = beSem / 7;
    const ventaDiaAct = venta > 0 ? venta / (off === 0 ? diasT : 7) : 0;

    const tp = topProductos();
    const ins = insumosDestacados();
    const cd = movimientosProductos();

    // ── Para actuar: máximo 3 cosas, lo crítico primero ──
    const acc = [];
    if (meta > 0 && gasto > meta) acc.push(`🔴 Te pasaste de tu meta de compras por <b>${money(gasto - meta)}</b>. Frena pedidos que no sean urgentes.`);
    if (venta > 0 && costo > 45) acc.push(`🔴 Tu costo de insumos va en <b>${Math.round(costo)}%</b> (sano ≤35%). Sube precio, ajusta porciones o baja mermas.`);
    if (prev && prev.venta > 0 && ((venta - prev.venta) / prev.venta * 100) <= -12)
      acc.push(`🔻 La venta bajó <b>${Math.round(Math.abs((venta - prev.venta) / prev.venta * 100))}%</b> vs. la semana pasada. Activa una promo o busca a tus clientes frecuentes.`);
    if (cd && cd.caidas.length) {
      const c = cd.caidas[0];
      acc.push(`🔻 <b>${esc(c.nombre)}</b> se vendía bien y cayó <b>${Math.round(Math.abs(c.drop) * 100)}%</b> (${Math.round(c.prev)}→${Math.round(c.cur)}). ¿Se agotó, subió de precio o hay que promocionarlo?`);
    }
    if (cd && cd.subidas.length) {
      const s = cd.subidas[0];
      acc.push(`🚀 <b>${esc(s.nombre)}</b> subió <b>${Math.round(s.rise * 100)}%</b> en ventas (${Math.round(s.prev)}→${Math.round(s.cur)}). ¡Ojo del bueno! Dale más salida mientras está caliente.`);
    }
    if (ins && ins.masSubio) acc.push(`📈 <b>${esc(ins.masSubio.nombre)}</b> subió <b>${money(ins.masSubio.cambio)}</b> por ${esc(ins.masSubio.unidad || "unidad")}. Renegocia con tu proveedor o ajústalo en el menú.`);
    if (tp && (tp.topFood || tp.topBebida)) {
      const names = [tp.topFood && tp.topFood.producto, tp.topBebida && tp.topBebida.producto].filter(Boolean).map(esc).join(" y ");
      acc.push(`🏆 Empuja <b>${names}</b>: es lo que más vendes. Recomiéndalo u ofrécelo en combo.`);
    }
    if (!sinDatos && beDia > 0 && ventaDiaAct > 0 && ventaDiaAct < beDia)
      acc.push(`🎯 Necesitas vender <b>${money(beDia)}/día</b> para no perder; vas en <b>${money(ventaDiaAct)}/día</b>. Enfócate en subir el ticket promedio.`);
    if (!acc.length) acc.push(`✅ Vas en rango sano. Mantén el ritmo y registra tus cortes cada día.`);
    const accTop = acc.slice(0, 3);

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
        <div class="row-stats" style="margin-top:14px">
          <div class="stat" style="min-width:0"><div class="n" style="font-size:clamp(15px,5vw,21px);color:var(--verde-claro)">${kmoney(venta)}</div><div class="l">Venta${parcial ? " (parcial)" : ""}</div></div>
          <div class="stat" style="min-width:0"><div class="n" style="font-size:clamp(15px,5vw,21px);color:${costoCol}">${venta > 0 ? Math.round(costo) + "%" : "—"}</div><div class="l">Costo insumos</div></div>
          <div class="stat" style="min-width:0"><div class="n" style="font-size:clamp(15px,5vw,21px)">${beDia > 0 ? kmoney(beDia) : "—"}</div><div class="l">Vender/día p/ ganar</div></div>
        </div>
        ${sinDatos ? `<div class="sub" style="margin-top:10px">Espera el corte del día para ver cómo vas.</div>`
          : (gfSem === 0 ? `<div class="sub" style="margin-top:8px;font-size:12px">💡 Registra tus gastos fijos (Gastos → Fijos) para la utilidad real.</div>` : "")}
      </div>

      <div class="card" style="border-left:4px solid var(--flame)">
        <h2 style="margin-bottom:10px">Para actuar</h2>
        ${accTop.map((a) => `<div style="font-size:13.5px;padding:8px 0;border-bottom:1px solid var(--linea);line-height:1.45">${a}</div>`).join("")}
      </div>

      ${cardVistazo(tp, ins, cd)}

      <div class="card">
        <h2 style="margin-bottom:8px">Meta de compras (semana)</h2>
        <div class="barra-track" style="height:12px"><span class="barra-fill" style="width:${pct}%;background:${cMeta}"></span></div>
        <div class="sub" style="margin-top:6px">${meta > 0 ? `Llevas ${money(gasto)} de ${money(meta)} · ${Math.round(pct)}% usado` : "Aún sin meta. Defínela abajo o en Gastos → Meta."}</div>
        <div class="fila" style="margin-top:10px;gap:8px">
          <input id="meta" type="number" step="any" inputmode="decimal" value="${meta || ""}" placeholder="Meta semanal (MXN)" style="flex:1" />
          <button class="btn sec" id="guardar" style="flex:none;width:auto">Guardar</button>
        </div>
        <div id="ok"></div>
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
