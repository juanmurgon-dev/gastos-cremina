// Pantalla para unificar proveedores duplicados (mismo negocio escrito distinto).
// No toca los tickets: guarda un mapa de alias en config y canoniza al leer.
import * as store from "./store.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function abrirProveedores() {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal">
    <h2>Unificar proveedores</h2>
    <div id="pvBody"></div>
    <button class="btn sec" id="pvCerrar" style="margin-top:14px">Cerrar</button>
  </div>`;
  document.body.appendChild(bg);
  const cerrar = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
  bg.querySelector("#pvCerrar").addEventListener("click", cerrar);
  const body = bg.querySelector("#pvBody");
  render();

  function render() {
    const grupos = store.agruparProveedores();
    const todos = store.proveedoresConocidos();
    const alias = (store.state.config && store.state.config.proveedorAlias) || {};
    const nAlias = Object.keys(alias).length;

    body.innerHTML = `
      <p class="sub" style="margin:-8px 0 12px">Junta los proveedores que son el mismo pero se escribieron distinto. No borra nada: solo unifica cómo se muestran y se agrupan.</p>
      ${grupos.length
        ? `<div class="titulo-seccion">Sugerencias (${grupos.length})</div>
           <div id="pvSug">${grupos.map(grupoHTML).join("")}</div>`
        : `<div class="ok-box">No detecté proveedores duplicados. 👌</div>`}
      <div class="titulo-seccion" style="margin-top:16px">Todos los proveedores (${todos.length})</div>
      <div id="pvTodos">${todos.length ? todos.map(filaTodos).join("") : `<div class="sub">Aún no hay proveedores en los tickets.</div>`}</div>
      ${todos.length ? `<div class="card" style="margin-top:10px;padding:12px">
        <label class="sub" style="display:block;margin-bottom:6px">Marca 2 o más arriba y escribe el nombre final:</label>
        <input id="pvManualNom" placeholder="Nombre final del proveedor" />
        <button class="btn" id="pvManualBtn" style="margin-top:8px">Unificar seleccionados</button>
        <div id="pvMsg"></div>
      </div>` : ""}
      ${nAlias ? `<button class="btn sec" id="pvReset" style="margin-top:10px;color:var(--rojo)">Deshacer todas las unificaciones (${nAlias})</button>` : ""}`;

    body.querySelectorAll("[data-sug]").forEach((blk) => {
      const idx = Number(blk.dataset.sug);
      blk.querySelector("[data-unif]").addEventListener("click", async (e) => {
        const canon = blk.querySelector("[data-canon]").value.trim();
        if (!canon) return;
        const b = e.target; b.disabled = true; b.textContent = "Unificando…";
        try {
          await store.unificarProveedores(grupos[idx].map((g) => store.normProv(g.nombre)), canon);
          render();
        } catch (err) { b.disabled = false; b.textContent = "Unificar en este nombre"; }
      });
    });

    const manualBtn = body.querySelector("#pvManualBtn");
    if (manualBtn) manualBtn.addEventListener("click", async () => {
      const nom = body.querySelector("#pvManualNom").value.trim();
      const sel = [...body.querySelectorAll("#pvTodos input:checked")].map((c) => c.value);
      const msg = body.querySelector("#pvMsg");
      if (!nom || sel.length < 1) { msg.innerHTML = `<div class="aviso-box" style="margin-top:8px">Marca al menos un proveedor y escribe el nombre final.</div>`; return; }
      manualBtn.disabled = true; manualBtn.textContent = "Unificando…";
      try {
        await store.unificarProveedores(sel.map((n) => store.normProv(n)), nom);
        render();
      } catch (err) { manualBtn.disabled = false; manualBtn.textContent = "Unificar seleccionados"; }
    });

    const reset = body.querySelector("#pvReset");
    if (reset) reset.addEventListener("click", async () => {
      if (!confirm("¿Deshacer todas las unificaciones de proveedores?")) return;
      await store.deshacerAliasProveedor(Object.keys(alias));
      render();
    });
  }

  function grupoHTML(grupo, idx) {
    const variantes = grupo.map((g) => `${esc(g.nombre)} <span class="sub">(${g.veces})</span>`).join(" · ");
    return `<div class="linea-edit" data-sug="${idx}" style="padding:12px">
      <div style="margin-bottom:8px;font-size:13px">${variantes}</div>
      <input data-canon value="${esc(grupo[0].nombre)}" />
      <button class="btn chico" data-unif style="margin-top:8px">Unificar en este nombre</button>
    </div>`;
  }

  function filaTodos(p) {
    return `<label class="barra-row" style="gap:10px;cursor:pointer;border-bottom:1px solid var(--linea);padding:8px 2px;margin:0">
      <input type="checkbox" value="${esc(p.nombre)}" style="width:auto;flex:none" />
      <span style="flex:1;min-width:0">${esc(p.nombre)}</span>
      <span class="sub">${p.veces} ticket(s)</span>
    </label>`;
  }
}
