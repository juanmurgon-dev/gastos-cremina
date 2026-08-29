// Pantalla: lista de tickets, con corregir y borrar.
import * as store from "../store.js";
import { COLOR_AREA, money, totalTicket, fechaBonita } from "../store.js";
import { crearEditor } from "./ticket-editor.js";
import { descargarCSV } from "../csv.js";
import { ic } from "../iconos.js";

export function render(el) {
  let orden = "gasto";   // "gasto" = lista por fecha del ticket · "subida" = agrupado por día de subida
  el.innerHTML = `
    <div class="segmented" style="font-size:12.5px;margin-bottom:10px"><button data-o="gasto">Fecha del gasto</button><button data-o="subida">Día de subida</button></div>
    <input id="buscar" placeholder="Buscar proveedor o artículo…" style="margin-bottom:10px" />
    <button class="btn sec chico" id="exp" style="margin-bottom:14px">${ic("descargar",15)} Exportar CSV</button>
    <div id="lista"></div>`;

  const lista = el.querySelector("#lista");
  const buscar = el.querySelector("#buscar");
  buscar.addEventListener("input", pintar);
  el.querySelector("#exp").addEventListener("click", exportar);
  const obtns = [...el.querySelectorAll(".segmented button[data-o]")];
  const marcarO = () => obtns.forEach((b) => b.classList.toggle("act", b.dataset.o === orden));
  obtns.forEach((b) => b.addEventListener("click", () => { orden = b.dataset.o; marcarO(); pintar(); }));
  marcarO();

  function exportar() {
    const filas = [];
    for (const t of store.state.tickets) {
      for (const l of t.lineas || []) {
        filas.push([t.fecha, (t.creadoEn || "").slice(0, 10), t.proveedor, l.area, l.descripcion, l.cantidad, l.unidad,
          l.precio_unitario, l.monto, l.tipo, l.notas, t.creadoPor || "", t.editadoPor || ""]);
      }
    }
    descargarCSV("tickets-cremina", ["Fecha gasto", "Fecha subida", "Proveedor", "Área", "Descripción", "Cantidad",
      "Unidad", "Precio Unitario", "Monto Total", "Tipo de Gasto", "Notas", "Registrado por", "Editado por"], filas);
  }

  const off = store.subscribe(pintar);
  pintar();

  // Si llegamos desde otra pantalla con "#/tickets?t=<id>" (p.ej. corregir el
  // precio de un insumo), abre ese ticket y limpia el parámetro para que al
  // recargar no se vuelva a abrir solo.
  (function abrirPedido() {
    const q = location.hash.split("?")[1];
    const id = q && new URLSearchParams(q).get("t");
    if (!id) return;
    history.replaceState(null, "", "#/tickets");
    const existe = (store.state.tickets || []).some((x) => x.id === id);
    if (existe) { abrirModal(id); return; }
    // Los tickets pueden no haber cargado aún: espera al primer aviso del store.
    const off = store.subscribe(() => {
      if ((store.state.tickets || []).some((x) => x.id === id)) { if (off) off(); abrirModal(id); }
    });
  })();

  function pintar() {
    if (!store.state.listo) { lista.innerHTML = `<div class="vacio">Cargando tickets…</div>`; return; }
    const q = buscar.value.trim().toLowerCase();
    let ts = store.state.tickets;
    if (q) {
      ts = ts.filter((t) =>
        store.coincide(t.proveedor, q) ||
        (t.lineas || []).some((l) => store.coincide(l.descripcion, q)));
    }
    if (!ts.length) {
      lista.innerHTML = `<div class="vacio">${q ? "Sin resultados." : "Aún no hay tickets. Captura el primero desde Insumos → Capturar."}</div>`;
      return;
    }
    if (orden === "subida") {
      // Agrupa por DÍA DE SUBIDA (t.creadoEn), del más reciente al más viejo.
      const grupos = new Map();
      for (const t of [...ts].sort((a, b) => (b.creadoEn || "").localeCompare(a.creadoEn || ""))) {
        const dia = (t.creadoEn || "").slice(0, 10);
        if (!grupos.has(dia)) grupos.set(dia, []);
        grupos.get(dia).push(t);
      }
      lista.innerHTML = [...grupos.entries()].map(([dia, arr]) => {
        const tot = arr.reduce((a, t) => a + totalTicket(t), 0);
        const cab = dia ? "Subidos el " + fechaBonita(dia) : "Sin fecha de subida";
        return `<div class="sub" style="font-weight:700;margin:14px 2px 8px;display:flex;justify-content:space-between">
            <span>${cab}</span><span>${arr.length} ticket(s) · ${money(tot)}</span></div>
          ${arr.map(filaHTML).join("")}`;
      }).join("");
    } else {
      lista.innerHTML = ts.map(filaHTML).join("");
    }
    lista.querySelectorAll("[data-id]").forEach((row) =>
      row.addEventListener("click", () => abrirModal(row.dataset.id)));
  }

  function filaHTML(t) {
    const areas = [...new Set((t.lineas || []).map((l) => l.area))];
    const chips = areas.map((a) =>
      `<span class="chip" style="background:${COLOR_AREA[a] || "var(--default-500)"}">${a}</span>`).join(" ");
    const subido = t.creadoEn ? " · subido " + fechaBonita((t.creadoEn || "").slice(0, 10)) : "";
    return `
      <div class="ticket" data-id="${t.id}">
        <div class="cab">
          <span class="prov">${escapar(t.proveedor || "Sin proveedor")}</span>
          <span class="monto">${money(totalTicket(t))}</span>
        </div>
        <div class="meta">${fechaBonita(t.fecha)} · ${(t.lineas || []).length} líneas${subido}</div>
        <div style="margin-top:7px;display:flex;gap:5px;flex-wrap:wrap">${chips}</div>
        ${t.aviso ? `<div class="aviso">${ic("alerta",13)} ${escapar(t.aviso)}</div>` : ""}
      </div>`;
  }

  function abrirModal(id) {
    const t = store.state.tickets.find((x) => x.id === id);
    if (!t) return;

    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `
      <div class="modal">
        <h2>Corregir ticket</h2>
        ${t.fotoUrl ? `<a href="${t.fotoUrl}" target="_blank" class="pill" style="margin-bottom:12px">${ic("camara",14)} Ver foto</a>` : ""}
        <div id="editor"></div>
        <div class="sub" style="margin:10px 2px 4px">
          ${t.creadoEn ? "Subido el <b>" + fechaHora(t.creadoEn) + "</b>" : ""}
          ${t.creadoPor ? "<br>Registrado por <b>" + escapar(t.creadoPor) + "</b>" : ""}
          ${t.editadoPor ? "<br>Última edición por <b>" + escapar(t.editadoPor) + "</b>" + (t.editadoEn ? " · " + fechaHora(t.editadoEn) : "") : ""}
        </div>
        <div class="fila" style="margin-top:6px">
          <button class="btn sec" data-cerrar>Cerrar</button>
          <button class="btn" data-guardar>Guardar</button>
        </div>
        <button class="btn peligro" data-borrar style="margin-top:10px">${ic("basura",15)} Borrar ticket</button>
      </div>`;
    document.body.appendChild(bg);

    const ed = crearEditor(bg.querySelector("#editor"), t);
    const cerrar = () => bg.remove();
    bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
    bg.querySelector("[data-cerrar]").addEventListener("click", cerrar);

    bg.querySelector("[data-guardar]").addEventListener("click", async (e) => {
      const b = e.target; b.disabled = true; b.textContent = "Guardando…";
      try {
        const v = ed.getValue();
        await store.actualizarTicket(id, { proveedor: v.proveedor, fecha: v.fecha, lineas: v.lineas, total: v.total });
        cerrar();
      } catch (err) {
        alert("No pude guardar: " + ((err && err.message) || err));
        b.disabled = false; b.textContent = "Guardar";
      }
    });

    bg.querySelector("[data-borrar]").addEventListener("click", async () => {
      if (!confirm("¿Borrar este ticket? No se puede deshacer.")) return;
      try { await store.borrarTicket(id); cerrar(); }
      catch (err) { alert("No pude borrar: " + ((err && err.message) || err)); }
    });
  }

  return off; // cleanup: cancela la suscripción al salir
}

function escapar(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MESES_TH = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaHora(iso) {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
    return `${store.fechaDMA(d)}, ${hh}:${mm}`;
  } catch (e) { return ""; }
}
