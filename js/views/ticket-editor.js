// Editor de un ticket (proveedor, fecha y líneas). Se reutiliza al
// capturar un ticket nuevo y al corregir uno existente.
import { AREAS, TIPOS, UNIDADES, num, money, proveedoresConocidos, sugerirProveedor, proveedoresDir, emparejarProveedorDir, normProv } from "../store.js";

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

// Nombres para el autocompletado: directorio + historial de tickets, sin repetir.
function nombresProveedor() {
  const vistos = new Set(), out = [];
  for (const p of proveedoresDir()) {
    const k = normProv(p.nombre);
    if (p.nombre && !vistos.has(k)) { vistos.add(k); out.push(p.nombre); }
  }
  for (const p of proveedoresConocidos()) {
    const k = normProv(p.nombre);
    if (!vistos.has(k)) { vistos.add(k); out.push(p.nombre); }
  }
  return out;
}

/**
 * Crea un editor dentro de `contenedor`. Devuelve { getValue }.
 */
export function crearEditor(contenedor, ticket = {}) {
  const lineas = (ticket.lineas && ticket.lineas.length) ? ticket.lineas : [{}];
  contenedor.innerHTML = `
    <div class="fila">
      <label class="campo"><span>Proveedor</span>
        <input data-prov list="provDL" autocomplete="off" value="${escapar(ticket.proveedor || "")}" placeholder="Ej. Central de Abastos" />
        <datalist id="provDL">${nombresProveedor().map((n) => `<option value="${escapar(n)}"></option>`).join("")}</datalist>
        <div data-prov-sug></div></label>
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

  // Sugerir un proveedor existente si el escrito se parece (errores de dedo).
  // Prioriza el directorio de proveedores; si no, el historial de tickets.
  const provInput = contenedor.querySelector("[data-prov]");
  const provSug = contenedor.querySelector("[data-prov-sug]");
  function pill(nombre, prefijo) {
    provSug.innerHTML = `<button type="button" class="pill" data-usar style="margin-top:6px;cursor:pointer;border:none">${prefijo} <b style="margin:0 4px">${escapar(nombre)}</b>? Usar</button>`;
    provSug.querySelector("[data-usar]").addEventListener("click", () => { provInput.value = nombre; provSug.innerHTML = ""; });
  }
  function revisarProv() {
    const val = provInput.value.trim();
    if (!val) { provSug.innerHTML = ""; return; }
    // 1) ¿coincide con una ficha del directorio, aunque escrita distinto?
    const m = emparejarProveedorDir(val);
    if (m) {
      if (normProv(m.proveedor.nombre) === normProv(val)) { provSug.innerHTML = ""; return; }
      pill(m.proveedor.nombre, "Se clasificará como");
      return;
    }
    // 2) parecido en el historial de tickets
    const s = sugerirProveedor(val);
    if (!s) { provSug.innerHTML = ""; return; }
    pill(s.nombre, "¿Quisiste decir");
  }
  provInput.addEventListener("change", revisarProv);
  provInput.addEventListener("blur", revisarProv);

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
