// Editor de un ticket (proveedor, fecha y líneas). Se reutiliza al
// capturar un ticket nuevo y al corregir uno existente.
import { AREAS, TIPOS, UNIDADES, num, money } from "../store.js";

function opciones(lista, sel) {
  return lista.map((o) => `<option value="${o}"${o === sel ? " selected" : ""}>${o}</option>`).join("");
}

function lineaHTML(l = {}) {
  return `
  <div class="linea-edit" data-linea>
    <button type="button" class="quitar" data-quitar title="Quitar línea">×</button>
    <label class="campo"><span>Descripción</span>
      <input data-f="descripcion" value="${escapar(l.descripcion || "")}" placeholder="Ej. Tomate saladet" /></label>
    <div class="fila">
      <label class="campo"><span>Cantidad</span>
        <input data-f="cantidad" type="number" step="any" inputmode="decimal" value="${l.cantidad ?? ""}" /></label>
      <label class="campo"><span>Unidad</span>
        <select data-f="unidad">${opciones(UNIDADES, l.unidad || "")}</select></label>
      <label class="campo"><span>Precio unit.</span>
        <input data-f="precio_unitario" type="number" step="any" inputmode="decimal" value="${l.precio_unitario ?? ""}" /></label>
    </div>
    <div class="fila">
      <label class="campo"><span>Área</span>
        <select data-f="area">${opciones(AREAS, l.area || "otro")}</select></label>
      <label class="campo"><span>Tipo</span>
        <select data-f="tipo">${opciones(TIPOS, l.tipo || "operativo")}</select></label>
      <label class="campo"><span>Monto total</span>
        <input data-f="monto" type="number" step="any" inputmode="decimal" value="${l.monto ?? ""}" data-monto /></label>
    </div>
  </div>`;
}

function escapar(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Crea un editor dentro de `contenedor`. Devuelve { getValue }.
 */
export function crearEditor(contenedor, ticket = {}) {
  const lineas = (ticket.lineas && ticket.lineas.length) ? ticket.lineas : [{}];
  contenedor.innerHTML = `
    <div class="fila">
      <label class="campo"><span>Proveedor</span>
        <input data-prov value="${escapar(ticket.proveedor || "")}" placeholder="Ej. Central de Abastos" /></label>
      <label class="campo"><span>Fecha</span>
        <input data-fecha type="date" value="${ticket.fecha || ""}" /></label>
    </div>
    <div class="titulo-seccion" style="margin-top:6px">Líneas</div>
    <div data-lineas>${lineas.map(lineaHTML).join("")}</div>
    <button type="button" class="btn sec chico" data-add>+ Agregar línea</button>
    <div style="text-align:right;margin-top:12px;font-weight:700" data-total></div>
  `;

  const cont = contenedor.querySelector("[data-lineas]");
  const totalEl = contenedor.querySelector("[data-total]");

  function recalc() {
    let t = 0;
    cont.querySelectorAll("[data-monto]").forEach((i) => (t += num(i.value)));
    totalEl.textContent = "Total: " + money(t);
  }

  contenedor.querySelector("[data-add]").addEventListener("click", () => {
    cont.insertAdjacentHTML("beforeend", lineaHTML({}));
    recalc();
  });

  contenedor.addEventListener("click", (e) => {
    if (e.target.matches("[data-quitar]")) {
      const filas = cont.querySelectorAll("[data-linea]");
      if (filas.length > 1) e.target.closest("[data-linea]").remove();
      recalc();
    }
  });
  contenedor.addEventListener("input", (e) => { if (e.target.matches("[data-monto]")) recalc(); });
  recalc();

  return {
    getValue() {
      const lineas = [...cont.querySelectorAll("[data-linea]")].map((row) => {
        const g = (f) => { const el = row.querySelector(`[data-f="${f}"]`); return el ? el.value : ""; };
        return {
          descripcion: g("descripcion"), cantidad: g("cantidad"), unidad: g("unidad"),
          precio_unitario: g("precio_unitario"), area: g("area"), tipo: g("tipo"), monto: g("monto")
        };
      }).filter((l) => l.descripcion || num(l.monto));
      return {
        proveedor: contenedor.querySelector("[data-prov]").value.trim(),
        fecha: contenedor.querySelector("[data-fecha]").value,
        lineas,
        total: lineas.reduce((a, l) => a + num(l.monto), 0)
      };
    }
  };
}
