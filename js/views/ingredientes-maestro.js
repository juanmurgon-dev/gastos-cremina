// Registro Maestro de Ingredientes: precio por gramo por ingrediente.
//   precio/g = precio total ÷ (cantidad de compra × gramos por pieza).
// Es la fuente del costo por gramo que usan las recetas.
import * as store from "../store.js";
import { money, num } from "../store.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const hoyISO = () => new Date().toISOString().slice(0, 10);
const pgFmt = (n) => "$" + (Math.round(num(n) * 10000) / 10000).toFixed(4) + "/g";
const calcPg = (total, pz, gpz) => { const d = num(pz) * num(gpz); return d > 0 ? num(total) / d : 0; };

export function render(el) {
  let q = "", editId = null;
  const unsub = store.subscribe(pintar);
  pintar();

  function lista() {
    const arr = (store.state.ingredientesMaestro || []).slice();
    const f = q.trim().toLowerCase();
    return (f ? arr.filter((x) => (x.nombre || "").toLowerCase().includes(f)) : arr)
      .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
  }

  function pintar() {
    if (!store.state.listo) { el.innerHTML = `<div class="vacio">Cargando…</div>`; return; }
    // No redibujar si se está escribiendo en el formulario (evita perder foco).
    const ae = document.activeElement;
    if (ae && el.contains(ae) && ae.id && ae.id.startsWith("f-")) return;
    const items = lista();

    el.innerHTML = `
      <div class="card">
        <h2 style="margin-top:0">Registro Maestro de Ingredientes</h2>
        <p class="sub" style="margin-top:-4px">El <b>precio por gramo</b> se calcula solo: precio total ÷ (compra × gramos/pza). Es el que usan tus recetas para costear.</p>
        <input id="busca" placeholder="Buscar ingrediente…" value="${esc(q)}" style="margin-bottom:8px" />
        <button class="btn" id="nuevo">＋ Nuevo ingrediente</button>
        <div id="form"></div>
      </div>
      ${items.length ? items.map(fila).join("") : `<div class="card"><div class="sub">${q ? "Sin resultados." : "Aún no hay ingredientes. Agrega el primero arriba."}</div></div>`}`;

    const busca = el.querySelector("#busca");
    busca.addEventListener("input", (e) => {
      q = e.target.value; pintar();
      const b = el.querySelector("#busca"); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); }
    });
    el.querySelector("#nuevo").addEventListener("click", () => { editId = editId === "__new__" ? null : "__new__"; pintarForm(); });
    el.querySelectorAll("[data-ed]").forEach((b) => b.addEventListener("click", () => { editId = b.dataset.ed; pintarForm(); }));
    el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
      const it = (store.state.ingredientesMaestro || []).find((x) => x.id === b.dataset.del);
      if (!it || !confirm(`¿Borrar "${it.nombre}" del registro maestro?`)) return;
      try { await store.borrarIngredienteMaestro(it.id); } catch (e) { alert("No se pudo borrar: " + (e.message || e)); }
    }));
    pintarForm();
  }

  function fila(x) {
    return `<div class="card" style="padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <b style="font-size:15px;flex:1;min-width:0">${esc(x.nombre)}</b>
        <span style="font-weight:800;color:#16514f;white-space:nowrap">${pgFmt(x.precio_g)}</span>
      </div>
      <div class="sub" style="font-size:12px;margin-top:4px">
        ${num(x.compra_pz)} pz · ${num(x.gramos_pz)} g/pz · ${money(x.precio_total)}${x.fecha ? " · " + esc(x.fecha) : ""}
      </div>
      <div class="fila" style="gap:8px;margin-top:8px">
        <button class="btn sec chico" data-ed="${x.id}" style="flex:1">✏️ Editar</button>
        <button class="btn sec chico" data-del="${x.id}" style="flex:0 0 auto;color:var(--rojo)">🗑</button>
      </div>
    </div>`;
  }

  function pintarForm() {
    const host = el.querySelector("#form");
    if (!host) return;
    if (!editId) { host.innerHTML = ""; return; }
    const nuevo = editId === "__new__";
    const it = nuevo ? { nombre: "", compra_pz: 1, gramos_pz: "", precio_total: "", fecha: hoyISO() }
      : (store.state.ingredientesMaestro || []).find((x) => x.id === editId) || {};
    host.innerHTML = `
      <div style="border:1px solid var(--linea);border-radius:12px;padding:12px;margin-top:10px;background:var(--fondo-2,#f6f6f4)">
        <div style="font-weight:700;margin-bottom:8px">${nuevo ? "Nuevo ingrediente" : "Editar: " + esc(it.nombre)}</div>
        <label class="campo"><span>Artículo</span><input id="f-nom" value="${esc(it.nombre || "")}" placeholder="Ej. Jamón Kirkland" /></label>
        <div class="fila" style="gap:8px">
          <label class="campo" style="flex:1;margin:0"><span>Compra (Pz)</span><input id="f-pz" type="number" inputmode="decimal" step="any" min="0" value="${esc(String(it.compra_pz ?? ""))}" /></label>
          <label class="campo" style="flex:1;margin:0"><span>Gramos/Pz</span><input id="f-gpz" type="number" inputmode="decimal" step="any" min="0" value="${esc(String(it.gramos_pz ?? ""))}" /></label>
        </div>
        <div class="fila" style="gap:8px">
          <label class="campo" style="flex:1;margin:0"><span>Precio total</span><input id="f-tot" type="number" inputmode="decimal" step="any" min="0" value="${esc(String(it.precio_total ?? ""))}" /></label>
          <label class="campo" style="flex:1;margin:0"><span>Fecha</span><input id="f-fec" type="date" value="${esc(it.fecha || hoyISO())}" /></label>
        </div>
        <div style="text-align:center;padding:8px;border-radius:10px;background:#fff;margin:2px 0 10px">
          <span class="sub">Precio por gramo</span>
          <div id="f-pg" style="font-size:20px;font-weight:800;color:#16514f">${pgFmt(calcPg(it.precio_total, it.compra_pz, it.gramos_pz))}</div>
        </div>
        <button class="btn" id="f-save">💾 Guardar</button>
        <button class="btn sec chico" id="f-cancel" style="margin-top:6px">Cancelar</button>
      </div>`;
    const g = (s) => host.querySelector(s);
    const recalc = () => { g("#f-pg").textContent = pgFmt(calcPg(g("#f-tot").value, g("#f-pz").value, g("#f-gpz").value)); };
    ["#f-pz", "#f-gpz", "#f-tot"].forEach((s) => g(s).addEventListener("input", recalc));
    g("#f-cancel").addEventListener("click", () => { editId = null; pintarForm(); });
    g("#f-save").addEventListener("click", async () => {
      const nom = g("#f-nom").value.trim();
      if (!nom) { g("#f-nom").focus(); return; }
      const b = g("#f-save"); b.disabled = true; b.textContent = "Guardando…";
      try {
        await store.guardarIngredienteMaestro({
          id: nuevo ? undefined : it.id, nombre: nom,
          compra_pz: g("#f-pz").value, gramos_pz: g("#f-gpz").value,
          precio_total: g("#f-tot").value, fecha: g("#f-fec").value,
        });
        editId = null; pintar();
      } catch (e) { b.disabled = false; b.textContent = "💾 Guardar"; alert("No se pudo guardar: " + (e.message || e) + (String(e && e.message).includes("duplicate") ? " (ya existe un ingrediente con ese nombre)" : "")); }
    });
  }

  return () => { if (typeof unsub === "function") unsub(); };
}
