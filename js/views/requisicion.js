// Requisición de compras: escribes lo que necesitas, la app pone precio y
// proveedor (de tu historial), lo agrupa por proveedor, le pones estatus y lo
// exportas para mandarlo a quien compra. Guarda historial en Supabase.
import * as store from "../store.js";
import { money, num, fechaBonita } from "../store.js";
import { descargarCSV } from "../csv.js";

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const ESTATUS = [
  { k: "pendiente", t: "Pendiente", c: "var(--amarillo)" },
  { k: "parcial", t: "Parcial", c: "var(--olive)" },
  { k: "pedido", t: "Pedido", c: "var(--verde)" },
];
const estatusInfo = (k) => ESTATUS.find((e) => e.k === k) || ESTATUS[0];
// Estatus general de la requisición, derivado del de cada producto.
function derivar(items) {
  const its = items || [];
  if (!its.length) return "pendiente";
  if (its.every((x) => x.estatus === "pedido")) return "pedido";
  if (its.some((x) => x.estatus === "pedido")) return "parcial";
  return "pendiente";
}

function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function hoyISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function hoyTxt() { const d = new Date(); return `${d.getDate()} ${MES[d.getMonth()]}`; }
function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.round(Math.random() * 1e6)); }
const montoDe = (it) => num(it.cantidad) * num(it.precio);
const totalDe = (its) => (its || []).reduce((a, it) => a + montoDe(it), 0);

export function render(el) {
  let vista = "lista";        // "lista" | "editor"
  let editing = null;         // requisición en edición (copia local)
  const insumos = store.preciosPorInsumo();
  const byName = new Map(insumos.map((i) => [i.nombre.toLowerCase(), i]));

  // Solo redibuja desde el store cuando estamos en la LISTA (no pisa el editor).
  const unsub = store.subscribe(() => { if (vista === "lista") pintar(); });
  pintar();

  function pintar() { vista === "editor" ? pintarEditor() : pintarLista(); }

  // ───────────── LISTA / HISTORIAL ─────────────
  function pintarLista() {
    const reqs = (store.state.requisiciones || []).slice();
    el.innerHTML = `
      <div class="card">
        <h2>Requisiciones de compra</h2>
        <p class="sub" style="margin-top:-4px">Arma tu lista, ponle estatus y expórtala. Aquí queda el historial.</p>
        <button class="btn" id="nueva">＋ Nueva requisición</button>
      </div>
      ${reqs.length ? `<div class="card"><h2>Historial</h2>${reqs.map(tarjetaHist).join("")}</div>`
        : `<div class="card"><div class="sub">Aún no hay requisiciones. Crea la primera arriba.</div></div>`}`;

    el.querySelector("#nueva").addEventListener("click", () => {
      editing = { id: uuid(), fecha: hoyISO(), titulo: "", estatus: "pendiente", items: [], total: 0, _nuevo: true };
      vista = "editor"; pintar();
    });
    el.querySelectorAll("[data-open]").forEach((c) => c.addEventListener("click", () => {
      const r = reqs.find((x) => x.id === c.dataset.open);
      if (!r) return;
      editing = { ...r, items: (r.items || []).map((x) => ({ ...x })) };
      vista = "editor"; pintar();
    }));
  }

  function tarjetaHist(r) {
    const e = estatusInfo(r.estatus);
    const n = (r.items || []).length;
    return `<div class="ticket" data-open="${r.id}" style="cursor:pointer">
      <div class="cab">
        <span class="prov">Requisición · ${fechaBonita(r.fecha)}</span>
        <span class="monto">${money(r.total)}</span></div>
      <div class="meta" style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
        <span><span class="chip" style="background:${e.c}">${e.t}</span> · ${n} insumos</span>
        <span class="sub">abrir ›</span></div>
    </div>`;
  }

  // ───────────── EDITOR ─────────────
  function pintarEditor() {
    const e = estatusInfo(derivar(editing.items));
    el.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <button class="btn sec chico" id="volver">‹ Volver</button>
          <span class="chip" id="rqChip" style="background:${e.c}">${e.t}</span>
        </div>
        <p class="sub" style="margin:8px 0 0">Toca el estatus de cada producto para cambiarlo entre <b>Pendiente</b> y <b>Pedido</b>.</p>
        <button class="btn" id="rqGuardar" style="margin-top:10px">💾 Guardar requisición</button>
        <div id="rqSaveMsg"></div>
      </div>

      <div class="card">
        <h2>Agregar insumo</h2>
        <label class="campo"><span>Insumo</span>
          <input id="rqNom" list="rqDL" placeholder="Ej. Tomate saladet" autocomplete="off" /></label>
        <datalist id="rqDL">${insumos.map((i) => `<option value="${esc(i.nombre)}"></option>`).join("")}</datalist>
        <div style="display:flex;gap:8px">
          <label class="campo" style="flex:1"><span>Cantidad</span>
            <input id="rqCant" type="number" step="any" inputmode="decimal" placeholder="0" /></label>
          <label class="campo" style="width:96px"><span>Unidad</span>
            <input id="rqUni" placeholder="kg" /></label>
        </div>
        <button class="btn" id="rqAdd">Agregar a la lista</button>
      </div>

      <div id="rqLista"></div>`;

    const $ = (s) => el.querySelector(s);
    $("#volver").addEventListener("click", async () => {
      if (editing.items.length) await guardar();   // guarda el último avance al salir
      vista = "lista"; editing = null; pintar();
    });
    $("#rqGuardar").addEventListener("click", () => guardar(true));

    $("#rqNom").addEventListener("change", () => {
      const hit = byName.get($("#rqNom").value.trim().toLowerCase());
      if (hit && !$("#rqUni").value) $("#rqUni").value = hit.unidad || "";
    });
    $("#rqAdd").addEventListener("click", () => {
      const nombre = $("#rqNom").value.trim();
      const cantidad = num($("#rqCant").value);
      if (!nombre || !cantidad) return;
      const hit = byName.get(nombre.toLowerCase());
      const precio = hit ? num(hit.precioActual) : 0;
      const proveedor = hit && hit.registros[0] ? (hit.registros[0].proveedor || "") : "";
      const unidad = $("#rqUni").value.trim() || (hit && hit.unidad) || "pz";
      editing.items.push({ nombre, cantidad, unidad, precio, proveedor, estatus: "pendiente" });
      $("#rqNom").value = ""; $("#rqCant").value = ""; $("#rqUni").value = "";
      $("#rqNom").focus();
      pintarItems(); guardar();
    });

    pintarItems();
  }

  function grupos() {
    const g = new Map();
    for (const it of editing.items) {
      const p = (it.proveedor || "").trim() || "Sin proveedor";
      if (!g.has(p)) g.set(p, []);
      g.get(p).push(it);
    }
    return g;
  }

  function pintarItems() {
    const cont = el.querySelector("#rqLista");
    if (!editing.items.length) {
      cont.innerHTML = `<div class="card"><div class="sub">Lista vacía. Agrega insumos arriba.</div></div>`;
      return;
    }
    let html = "";
    for (const [prov, list] of grupos()) {
      html += `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <h2 style="margin:0">🏪 ${esc(prov)}</h2><span class="val">${money(totalDe(list))}</span></div>
        <div style="margin-top:8px">${list.map(filaItem).join("")}</div>
      </div>`;
    }
    html += `<div class="card">
      <div class="row-stats">
        <div class="stat"><div class="n">${money(totalDe(editing.items))}</div><div class="l">Total</div></div>
        <div class="stat"><div class="n">${editing.items.length}</div><div class="l">Insumos</div></div>
      </div>
      <div class="fila" style="margin-top:12px;gap:8px;flex-wrap:wrap">
        <button class="btn" id="rqWa">📋 Copiar para WhatsApp</button>
        <button class="btn sec" id="rqCsv">⬇ Exportar CSV</button>
      </div>
      <button class="btn sec" id="rqDel" style="margin-top:10px;color:var(--rojo)">Borrar esta requisición</button>
    </div>`;
    cont.innerHTML = html;

    cont.querySelectorAll("[data-i]").forEach((row) => {
      const it = editing.items[Number(row.dataset.i)];
      row.querySelector("[data-f='estat']").addEventListener("click", () => {
        it.estatus = it.estatus === "pedido" ? "pendiente" : "pedido";
        actualizarChip(); pintarItems(); guardar();
      });
      row.querySelector("[data-f='cant']").addEventListener("change", (ev) => { it.cantidad = num(ev.target.value); pintarItems(); guardar(); });
      row.querySelector("[data-f='precio']").addEventListener("change", (ev) => { it.precio = num(ev.target.value); pintarItems(); guardar(); });
      row.querySelector("[data-f='prov']").addEventListener("change", (ev) => {
        const v = ev.target.value;
        if (v === "__otro__") {
          const nom = (prompt("Nombre del proveedor:", it.proveedor || "") || "").trim();
          if (nom) it.proveedor = nom;
          pintarItems(); guardar(); return;
        }
        it.proveedor = v.trim();
        const pr = provsDe(it.nombre).find((p) => p.proveedor === it.proveedor);
        if (pr) it.precio = pr.precio;   // toma el precio de ESE proveedor
        pintarItems(); guardar();
      });
      row.querySelector("[data-del]").addEventListener("click", () => { editing.items.splice(Number(row.dataset.i), 1); pintarItems(); guardar(); });
    });
    cont.querySelector("#rqWa").addEventListener("click", copiarWa);
    cont.querySelector("#rqCsv").addEventListener("click", exportarCsv);
    cont.querySelector("#rqDel").addEventListener("click", borrar);
  }

  // Proveedores a los que ya le compramos ESTE insumo (con su último precio).
  function provsDe(nombre) {
    const hit = byName.get((nombre || "").toLowerCase());
    if (!hit) return [];
    const seen = new Map(); // registros vienen recientes primero → 1er precio = el último
    for (const r of hit.registros) {
      const p = (r.proveedor || "").trim();
      if (p && !seen.has(p)) seen.set(p, num(r.precio));
    }
    return [...seen.entries()].map(([proveedor, precio]) => ({ proveedor, precio }));
  }

  function filaItem(it) {
    const idx = editing.items.indexOf(it);
    const provs = provsDe(it.nombre);
    const provCampo = provs.length
      ? `<select data-f="prov" style="flex:1 1 100px;min-width:0">
          ${provs.map((p) => `<option value="${esc(p.proveedor)}"${p.proveedor === it.proveedor ? " selected" : ""}>${esc(p.proveedor)} · ${money(p.precio)}</option>`).join("")}
          ${it.proveedor && !provs.some((p) => p.proveedor === it.proveedor) ? `<option value="${esc(it.proveedor)}" selected>${esc(it.proveedor)}</option>` : ""}
          <option value="__otro__">✏️ Otro proveedor…</option>
        </select>`
      : `<input data-f="prov" value="${esc(it.proveedor)}" placeholder="Proveedor" style="flex:1 1 100px;min-width:0" />`;
    const ie = estatusInfo(it.estatus);
    return `<div class="barra-row" data-i="${idx}" style="gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--linea);padding:8px 0">
      <span class="etq" style="width:100%;font-weight:600;display:flex;align-items:center;gap:8px">
        <button data-f="estat" class="chip" title="Cambiar estatus" style="background:${ie.c};border:none;cursor:pointer;flex:none">${ie.t}</button>
        <span style="flex:1;min-width:0">${esc(it.nombre)}</span>
        <span class="val" style="margin-left:auto">${money(montoDe(it))}</span></span>
      <input data-f="cant" type="number" step="any" inputmode="decimal" value="${it.cantidad}" style="width:64px" />
      <span class="sub" style="align-self:center">${esc(it.unidad)} ×</span>
      <input data-f="precio" type="number" step="any" inputmode="decimal" value="${it.precio}" style="width:80px" />
      ${provCampo}
      <button class="linkbtn" data-del style="color:var(--rojo);padding:0 6px;font-size:16px">✕</button>
    </div>`;
  }

  function actualizarChip() {
    const c = el.querySelector("#rqChip");
    if (!c) return;
    const e = estatusInfo(derivar(editing.items));
    c.textContent = e.t; c.style.background = e.c;
  }

  // ───────────── exportar / guardar ─────────────
  function textoWa() {
    const e = estatusInfo(derivar(editing.items));
    let t = `📋 *Requisición ${hoyTxt()}*  (${e.t})\n`;
    for (const [prov, list] of grupos()) {
      t += `\n🏪 *${prov}*\n`;
      for (const it of list) {
        t += `${it.estatus === "pedido" ? "✅" : "•"} ${it.nombre} — ${num(it.cantidad)} ${it.unidad}${num(it.precio) ? ` — ${money(montoDe(it))}` : ""}\n`;
      }
      t += `   Subtotal: ${money(totalDe(list))}\n`;
    }
    t += `\n*TOTAL: ${money(totalDe(editing.items))}*`;
    return t;
  }
  async function copiarWa() {
    const txt = textoWa();
    try {
      await navigator.clipboard.writeText(txt);
      const b = el.querySelector("#rqWa"); b.textContent = "✅ Copiado";
      setTimeout(() => { b.textContent = "📋 Copiar para WhatsApp"; }, 1600);
    } catch (e) { alert("Copia esto y pégalo:\n\n" + txt); }
  }
  function exportarCsv() {
    const filas = [];
    for (const [prov, list] of grupos())
      for (const it of list)
        filas.push([prov, it.nombre, num(it.cantidad), it.unidad, num(it.precio), montoDe(it)]);
    descargarCSV("requisicion-" + hoyTxt().replace(" ", "-"),
      ["Proveedor", "Insumo", "Cantidad", "Unidad", "Precio unit.", "Monto"], filas);
  }

  async function borrar() {
    if (!confirm("¿Borrar esta requisición del historial?")) return;
    try {
      if (!editing._nuevo) await store.borrarRequisicion(editing.id);
      vista = "lista"; editing = null; pintar();
    } catch (e) { alert("No pude borrar: " + ((e && e.message) || e)); }
  }

  async function guardar(explicito) {
    editing.total = totalDe(editing.items);
    editing.estatus = derivar(editing.items);   // el general sale del de cada producto
    editing._nuevo = false;
    const msg = el.querySelector("#rqSaveMsg");
    if (explicito && msg) msg.innerHTML = `<div class="sub" style="margin-top:6px">Guardando…</div>`;
    try {
      await store.guardarRequisicion(editing);
      if (explicito && msg) msg.innerHTML = `<div class="ok-box" style="margin-top:6px">✅ Guardado. Puedes volver y editarla cuando quieras.</div>`;
    } catch (e) {
      if (explicito && msg) msg.innerHTML = `<div class="error-box" style="margin-top:6px">No pude guardar. ¿Corriste <b>requisiciones.sql</b> en Supabase? (${esc((e && e.message) || e)})</div>`;
      // sin `explicito` queda local y se reintenta al siguiente cambio
    }
  }

  return unsub;
}
