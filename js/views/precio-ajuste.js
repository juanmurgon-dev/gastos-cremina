// Pantalla: Ajuste de precio (Rebanada A del spec "fijos vs variables → precio").
// Separa gasto variable (insumos en receta + comisiones) de gasto fijo, calcula la
// utilidad actual y cuánto subir los precios (% y monto) para llegar a la utilidad
// objetivo (banda 15–20% sobre ventas). Estima labor desde los gastos fijos de nómina
// para dar un semáforo de prime cost. Todo con datos que ya existen; captura fina y
// SPLH vienen en rebanadas posteriores.
import * as store from "../store.js";
import { money, num, toISO } from "../store.js";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
// Mismo criterio que el editor de gastos fijos para detectar nómina/labor.
const RE_NOMINA = /sueldo|n[óo]mina|salario|personal|emplead|mesero|cociner|chef|staff|prestacion|imss|aguinaldo/i;

const bonito = (n) => Math.max(0, Math.round(n / 5) * 5);   // precio "bonito" al múltiplo de 5

function rangoMes(off) {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth() - off, 1);
  const desde = new Date(base.getFullYear(), base.getMonth(), 1);
  const fin = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return { desde, fin, y: base.getFullYear(), m: base.getMonth() };
}

// Ventas del periodo: primero de cortes; si no hay, cae a la venta por producto/variante.
function ventasEnRango(desdeISO, hastaISO) {
  const c = store.cortesEnRango(desdeISO, hastaISO).reduce((a, x) => a + num(x.ventas_total), 0);
  if (c > 0) return { S: c, fuente: "cortes" };
  const dentro = (row) => row.fecha
    ? (row.fecha >= desdeISO && row.fecha <= hastaISO)
    : (row.desde >= desdeISO && row.desde <= hastaISO);
  let v = 0;
  for (const r of store.state.variantes || []) if (dentro(r)) v += num(r.venta);
  if (v === 0) for (const r of store.state.productos || []) if (dentro(r)) v += num(r.venta);
  return { S: v, fuente: "ventas por producto" };
}

// Top platillos del periodo más reciente (para mostrar el Δ en precios reales).
function platillosRecientes() {
  const rows = (store.state.variantes || []).length ? store.state.variantes : (store.state.productos || []);
  if (!rows.length) return [];
  let maxDesde = "";
  for (const r of rows) if (r.desde > maxDesde) maxDesde = r.desde;
  const agg = new Map();
  for (const r of rows) {
    if (r.desde !== maxDesde) continue;
    const nom = (r.producto || "") + (r.opcion && r.grupo !== "Sin variante" ? " · " + r.opcion : "");
    const uds = num(r.unidades != null ? r.unidades : r.cantidad);
    const venta = num(r.venta);
    if (venta <= 0 || uds <= 0) continue;
    const a = agg.get(nom) || { uds: 0, venta: 0 };
    a.uds += uds; a.venta += venta; agg.set(nom, a);
  }
  return [...agg.entries()]
    .map(([nom, a]) => ({ nom, precio: a.venta / a.uds, venta: a.venta }))
    .sort((x, y) => y.venta - x.venta).slice(0, 6);
}

export function montar(el) {
  let off = 0;
  const unsub = store.subscribe(pintar);
  pintar();

  function cfg(k, def) { const v = num(store.state.config[k]); return v > 0 ? v : def; }

  function pintar() {
    if (!store.state.listo) { el.innerHTML = `<div class="vacio">Cargando…</div>`; return; }

    const { desde, fin, m, y } = rangoMes(off);
    const hoy = new Date();
    const finReal = (fin > hoy && off === 0) ? hoy : fin;
    const desdeISO = toISO(desde), hastaISO = toISO(finReal);
    const dias = Math.max(1, Math.round((finReal - desde) / 86400000) + 1);
    const diasMes = fin.getDate();

    // ── Parámetros editables (persistidos en config) ──
    const comisionPct = cfg("comisionPct", 4);
    const uMin = cfg("utilidadMinPct", 15);
    const uMax = cfg("utilidadMaxPct", 20);
    const precioEj = cfg("precioEjemplo", 120);

    // ── Ventas y gastos del periodo ──
    const { S, fuente } = ventasEnRango(desdeISO, hastaISO);
    const insumos = store.lineasEnRango(desdeISO, hastaISO)
      .filter((l) => l.tipo === "costo de venta").reduce((a, l) => a + num(l.monto), 0);
    const comision = S * comisionPct / 100;
    const gfMes = store.gastoFijoMensual();
    const gfPer = gfMes / diasMes * dias;                       // fijos prorrateados al periodo
    const laborMes = (store.state.gastosFijos || [])
      .filter((g) => g.activo !== false && RE_NOMINA.test(g.concepto || ""))
      .reduce((a, g) => a + num(g.monto_mensual), 0);
    const laborPer = laborMes / diasMes * dias;

    // ── La cuenta (Sección 5 del spec) ──
    const C = S - insumos - comision;            // contribución tras variables
    const utilAct = C - gfPer;                   // utilidad actual del periodo
    const margenAct = S > 0 ? utilAct / S * 100 : 0;
    const foodPct = S > 0 ? insumos / S * 100 : 0;
    const laborPct = S > 0 ? laborPer / S * 100 : 0;
    const prime = foodPct + laborPct;

    // Aumento necesario para cada extremo de la banda de utilidad objetivo.
    const xPct = (uObj) => {
      const Cobjetivo = gfPer + uObj / 100 * S;  // C* = F + U
      return S > 0 ? (Cobjetivo - C) / S * 100 : 0;
    };
    const xLo = xPct(uMin), xHi = xPct(uMax);
    const necesita = xHi > 0;                     // ¿hace falta subir para la meta alta?

    const sinDatos = S === 0;
    const primeCol = prime <= 60 ? "var(--verde)" : prime <= 65 ? "var(--amarillo)" : "var(--rojo)";
    const foodCol = foodPct <= 30 ? "var(--verde)" : foodPct <= 35 ? "var(--amarillo)" : "var(--rojo)";
    const utilCol = margenAct >= uMin ? "var(--verde)" : margenAct > 0 ? "var(--amarillo)" : "var(--rojo)";

    const nuevoRango = (p) => {
      const lo = p * (1 + Math.max(0, xLo) / 100), hi = p * (1 + Math.max(0, xHi) / 100);
      return { lo, hi, loB: bonito(lo), hiB: bonito(hi) };
    };
    const rEj = nuevoRango(precioEj);
    const xMid = (Math.max(0, xLo) + Math.max(0, xHi)) / 2;

    el.innerHTML = `
      <div class="card" style="padding:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <button class="btn sec chico" id="ant">◀</button>
          <div style="text-align:center;flex:1">
            <div style="font-weight:700;text-transform:capitalize">${MESES[m]} ${y}</div>
            <div class="sub">${off === 0 ? "Mes en curso · " + dias + " días" : "mes completo"} · S de ${fuente}</div>
          </div>
          <button class="btn sec chico" id="sig"${off === 0 ? " disabled" : ""}>▶</button>
        </div>
      </div>

      ${sinDatos ? `<div class="card"><div class="aviso-box">No hay ventas en este mes. Sube tus reportes o cortes para calcular el ajuste.</div></div>` : `
      <div class="card">
        <h2 style="margin-bottom:8px">La cuenta del mes</h2>
        <div class="row-stats" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
          <div class="stat"><div class="n">${money(S)}</div><div class="l">Ventas</div></div>
          <div class="stat"><div class="n" style="color:${foodCol}">${Math.round(foodPct)}%</div><div class="l">Insumos (food)</div></div>
          <div class="stat"><div class="n">${comisionPct}%</div><div class="l">Comisiones</div></div>
          <div class="stat"><div class="n">${Math.round(gfPer / (S || 1) * 100)}%</div><div class="l">Fijos</div></div>
          <div class="stat"><div class="n" style="color:${laborPct ? primeCol : "var(--gris)"}">${laborPct ? Math.round(laborPct) + "%" : "—"}</div><div class="l">Labor (de fijos)</div></div>
          <div class="stat"><div class="n" style="color:${utilCol}">${Math.round(margenAct)}%</div><div class="l">Utilidad hoy</div></div>
        </div>
        <div style="margin-top:12px;padding:10px;border-radius:10px;background:var(--fondo-2, var(--content2));display:flex;justify-content:space-between;align-items:center">
          <div><b>Prime cost</b> (food + labor)<div class="sub" style="font-size:11.5px">Meta ≤ 60–65%. ${laborPct ? "" : "Agrega tu nómina a gastos fijos para verlo."}</div></div>
          <div style="font-size:clamp(16px,6vw,22px);font-weight:800;color:${laborPct ? primeCol : "var(--gris)"};white-space:nowrap">${laborPct ? Math.round(prime) + "%" : "—"}</div>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-bottom:4px">Cuánto subir los precios</h2>
        <div class="sub" style="margin-bottom:10px">Para cubrir todo y quedarte con ${uMin}–${uMax}% de utilidad.</div>
        ${necesita ? `
          <div style="text-align:center;padding:14px;border-radius:12px;background:var(--fondo-2, var(--content2))">
            <div style="font-size:clamp(20px,7.5vw,32px);font-weight:800;color:var(--naranja);overflow-wrap:anywhere">+${xLo.toFixed(1)}% a +${xHi.toFixed(1)}%</div>
            <div class="sub">aumento uniforme sobre todos los precios</div>
          </div>
          <div style="margin-top:12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span>Un platillo de</span>
            <input id="pej" type="number" value="${precioEj}" style="width:80px" />
            <span>→ <b>${money(rEj.lo)}–${money(rEj.hi)}</b></span>
            <span class="sub">(bonito: ${money(rEj.loB)}–${money(rEj.hiB)})</span>
          </div>
        ` : `
          <div style="text-align:center;padding:14px;border-radius:12px;background:var(--success-100)">
            <div style="font-size:20px;font-weight:800;color:var(--verde)">Ya cubres tu utilidad objetivo</div>
            <div class="sub">Tu margen (${Math.round(margenAct)}%) ya está en la banda ${uMin}–${uMax}%. No necesitas subir.</div>
          </div>`}
      </div>

      ${necesita ? `
      <div class="card">
        <h2 style="margin-bottom:8px">Tus platillos (aumento ${xMid.toFixed(1)}%)</h2>
        ${platillosRecientes().map((p) => {
          const np = p.precio * (1 + xMid / 100);
          return `<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--linea);font-size:13.5px">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapar(p.nom)}</span>
            <span style="white-space:nowrap">${money(p.precio)} → <b>${money(bonito(np))}</b></span></div>`;
        }).join("") || `<div class="sub">Aún no hay ventas por platillo del periodo.</div>`}
      </div>` : ""}

      <div class="card">
        <h2 style="margin-bottom:8px">Ajustes</h2>
        <label class="campo"><span>Comisiones apps/TPV (% de ventas)</span><input id="cm" type="number" value="${comisionPct}" /></label>
        <label class="campo"><span>Utilidad objetivo mínima (%)</span><input id="umin" type="number" value="${uMin}" /></label>
        <label class="campo"><span>Utilidad objetivo máxima (%)</span><input id="umax" type="number" value="${uMax}" /></label>
        <div class="sub" style="margin-top:6px">El aumento es el <b>piso matemático</b> a tu volumen actual; supone que la venta no cae al subir. Recalcula solo con datos reales cada vez que subes reportes.</div>
      </div>`}
    `;

    el.querySelector("#ant").onclick = () => { off++; pintar(); };
    const sig = el.querySelector("#sig"); if (sig) sig.onclick = () => { if (off > 0) { off--; pintar(); } };
    const guardar = (k, v) => store.guardarConfig({ [k]: num(v) }).catch(() => {});
    const bind = (id, k) => { const n = el.querySelector(id); if (n) n.onchange = () => guardar(k, n.value); };
    bind("#pej", "precioEjemplo"); bind("#cm", "comisionPct"); bind("#umin", "utilidadMinPct"); bind("#umax", "utilidadMaxPct");
  }

  return () => { if (typeof unsub === "function") unsub(); };
}

function escapar(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
