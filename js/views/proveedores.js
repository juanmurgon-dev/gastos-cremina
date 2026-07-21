// Directorio de proveedores con sus datos de contacto (nombre, teléfono,
// correo, dirección). Se puede agregar a mano o subir un CSV. Vive como
// sub-pestaña de Insumos. Los tickets se clasifican contra este directorio.
import * as store from "../store.js";
import { descargarCSV, parsearCSV } from "../csv.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Encabezados que aceptamos del CSV → campo interno (tolerante a acentos/alias).
const ALIAS = {
  nombre: ["nombre", "proveedor", "razon social", "razón social", "empresa"],
  telefono: ["telefono", "teléfono", "tel", "whatsapp", "wa", "celular", "cel", "movil", "móvil"],
  correo: ["correo", "email", "e-mail", "mail", "correo electronico", "correo electrónico"],
  direccion: ["direccion", "dirección", "domicilio", "ubicacion", "ubicación", "calle"],
};
function mapearFila(o) {
  const pick = (aliases) => { for (const a of aliases) if (o[a]) return o[a]; return ""; };
  return {
    nombre: pick(ALIAS.nombre),
    telefono: pick(ALIAS.telefono),
    correo: pick(ALIAS.correo),
    direccion: pick(ALIAS.direccion),
  };
}

// Enlaces útiles a partir de un teléfono/correo.
const soloDigitos = (t) => String(t || "").replace(/[^\d]/g, "");

export function render(el, ctx) {
  const st = { q: "" };

  el.innerHTML = `
    <p class="sub" style="margin:2px 2px 12px">Tu lista de proveedores con sus datos. Al capturar un ticket, la app lo clasifica con el proveedor de aquí (o el más parecido) y crea la ficha si es nuevo.</p>
    <div class="fila" style="gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn" id="pAgregar" style="flex:1 1 140px">＋ Agregar proveedor</button>
      <button class="btn sec" id="pSubir" style="flex:1 1 140px">⬆ Subir CSV</button>
    </div>
    <button class="btn sec chico" id="pPlantilla" style="margin-bottom:12px">⬇ Descargar plantilla CSV</button>
    <input id="pBuscar" placeholder="Buscar proveedor…" style="margin-bottom:10px" />
    <div id="pConteo" class="sub" style="margin:0 2px 8px"></div>
    <div id="pLista"></div>
    <input id="pFile" type="file" accept=".csv,text/csv" hidden />`;

  const $ = (s) => el.querySelector(s);
  const off = store.subscribe(pintar);
  pintar();

  $("#pBuscar").addEventListener("input", (e) => { st.q = e.target.value; pintar(); });
  $("#pAgregar").addEventListener("click", () => abrirFicha(null));
  $("#pSubir").addEventListener("click", () => $("#pFile").click());
  $("#pFile").addEventListener("change", onArchivo);
  $("#pPlantilla").addEventListener("click", () => {
    descargarCSV("plantilla-proveedores",
      ["nombre", "telefono", "correo", "direccion"],
      [["Central de Abastos", "6641234567", "ventas@central.com", "Av. Principal 123, Tijuana"]]);
  });

  function pintar() {
    const cont = $("#pLista"), conteo = $("#pConteo");
    if (!cont) return;
    if (!store.state.listo) { cont.innerHTML = `<div class="vacio">Cargando…</div>`; return; }
    const q = st.q.trim().toLowerCase();
    let dir = store.proveedoresDir().slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    if (q) dir = dir.filter((p) => (p.nombre + " " + p.telefono + " " + p.correo + " " + p.direccion).toLowerCase().includes(q));
    conteo.textContent = `${dir.length} proveedor(es)`;
    if (!dir.length) {
      cont.innerHTML = `<div class="vacio">${q ? "Sin resultados." : "Aún no hay proveedores. Agrega el primero o sube un CSV."}</div>`;
      return;
    }
    cont.innerHTML = dir.map(tarjeta).join("");
    cont.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => abrirFicha(dir.find((p) => p.id === b.dataset.edit))));
  }

  function tarjeta(p) {
    const tel = soloDigitos(p.telefono);
    const filas = [];
    if (p.telefono) filas.push(`<a href="https://wa.me/${tel}" target="_blank" rel="noopener" class="sub" style="text-decoration:none">💬 ${esc(p.telefono)}</a>`);
    if (p.correo) filas.push(`<a href="mailto:${esc(p.correo)}" class="sub" style="text-decoration:none">✉️ ${esc(p.correo)}</a>`);
    if (p.direccion) filas.push(`<span class="sub">📍 ${esc(p.direccion)}</span>`);
    return `<div class="ticket" style="cursor:pointer" data-edit="${esc(p.id)}">
      <div class="cab">
        <span class="prov" style="font-size:14px">🏪 ${esc(p.nombre)}</span>
        <span class="sub">editar ›</span>
      </div>
      ${filas.length ? `<div class="meta" style="display:flex;flex-direction:column;gap:2px;margin-top:4px">${filas.join("")}</div>`
        : `<div class="meta sub" style="margin-top:4px">Sin datos de contacto — toca para agregar.</div>`}
    </div>`;
  }

  // ── Alta / edición de una ficha ──
  function abrirFicha(p) {
    const editando = !!(p && p.id);
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `
      <div class="modal">
        <h2>${editando ? "Editar proveedor" : "Nuevo proveedor"}</h2>
        <label class="campo"><span>Nombre *</span>
          <input id="fNombre" value="${esc(p?.nombre || "")}" placeholder="Ej. Central de Abastos" /></label>
        <label class="campo"><span>Teléfono / WhatsApp</span>
          <input id="fTel" type="tel" inputmode="tel" value="${esc(p?.telefono || "")}" placeholder="6641234567" /></label>
        <label class="campo"><span>Correo</span>
          <input id="fCorreo" type="email" inputmode="email" value="${esc(p?.correo || "")}" placeholder="ventas@proveedor.com" /></label>
        <label class="campo"><span>Dirección</span>
          <input id="fDir" value="${esc(p?.direccion || "")}" placeholder="Calle, número, ciudad" /></label>
        <div id="fMsg"></div>
        <button class="btn" id="fGuardar" style="margin-top:12px">${editando ? "Guardar cambios" : "Agregar"}</button>
        ${editando ? `<button class="btn sec" id="fBorrar" style="margin-top:8px;color:var(--rojo)">Borrar proveedor</button>` : ""}
        <button class="btn sec" id="fCerrar" style="margin-top:8px">Cancelar</button>
      </div>`;
    document.body.appendChild(bg);
    const cerrar = () => bg.remove();
    bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
    bg.querySelector("#fCerrar").addEventListener("click", cerrar);
    bg.querySelector("#fNombre").focus();

    bg.querySelector("#fGuardar").addEventListener("click", async () => {
      const datos = {
        id: p?.id,
        nombre: bg.querySelector("#fNombre").value.trim(),
        telefono: bg.querySelector("#fTel").value.trim(),
        correo: bg.querySelector("#fCorreo").value.trim(),
        direccion: bg.querySelector("#fDir").value.trim(),
      };
      const msg = bg.querySelector("#fMsg");
      if (!datos.nombre) { msg.innerHTML = `<div class="aviso-box" style="margin-top:8px">Escribe al menos el nombre.</div>`; return; }
      const btn = bg.querySelector("#fGuardar"); btn.disabled = true; btn.textContent = "Guardando…";
      try { await store.guardarProveedorDir(datos); cerrar(); }
      catch (e) { btn.disabled = false; btn.textContent = editando ? "Guardar cambios" : "Agregar"; msg.innerHTML = `<div class="error-box" style="margin-top:8px">No pude guardar: ${esc((e && e.message) || e)}</div>`; }
    });

    const del = bg.querySelector("#fBorrar");
    if (del) del.addEventListener("click", async () => {
      if (!confirm(`¿Borrar a "${p.nombre}" del directorio? (No toca tus tickets.)`)) return;
      try { await store.borrarProveedorDir(p.id); cerrar(); }
      catch (e) { alert("No pude borrar: " + ((e && e.message) || e)); }
    });
  }

  // ── Subir CSV ──
  async function onArchivo(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";   // permite re-subir el mismo archivo
    if (!f) return;
    let texto;
    try { texto = await f.text(); }
    catch (err) { alert("No pude leer el archivo."); return; }
    const filas = parsearCSV(texto).map(mapearFila).filter((p) => p.nombre);
    if (!filas.length) {
      alert("No encontré proveedores en el archivo. Revisa que tenga una columna 'nombre' y usa la plantilla si tienes dudas.");
      return;
    }
    revisarImport(filas);
  }

  function revisarImport(filas) {
    const dir = store.proveedoresDir();
    const yaHay = new Set(dir.map((p) => store.normProv(p.nombre)));
    const nuevos = filas.filter((p) => !yaHay.has(store.normProv(p.nombre))).length;
    const actualiza = filas.length - nuevos;
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `
      <div class="modal">
        <h2>Revisa la importación</h2>
        <p class="sub" style="margin:-8px 0 10px">Leí <b>${filas.length}</b> proveedor(es): <b>${nuevos}</b> nuevo(s) y <b>${actualiza}</b> que ya tienes (se actualizan sin borrar sus datos).</p>
        <div style="max-height:46vh;overflow:auto;border:1px solid var(--linea);border-radius:12px">
          ${filas.slice(0, 200).map((p) => `
            <div class="barra-row" style="gap:8px;border-bottom:1px solid var(--linea);padding:8px 10px;margin:0">
              <span style="flex:1;min-width:0"><b>${esc(p.nombre)}</b>${p.telefono ? ` · <span class="sub">${esc(p.telefono)}</span>` : ""}</span>
              <span class="chip" style="background:${yaHay.has(store.normProv(p.nombre)) ? "var(--olive)" : "var(--verde)"}">${yaHay.has(store.normProv(p.nombre)) ? "actualiza" : "nuevo"}</span>
            </div>`).join("")}
          ${filas.length > 200 ? `<div class="sub" style="padding:8px 10px">…y ${filas.length - 200} más</div>` : ""}
        </div>
        <div id="impMsg"></div>
        <button class="btn" id="impOk" style="margin-top:12px">Importar ${filas.length}</button>
        <button class="btn sec" id="impCancel" style="margin-top:8px">Cancelar</button>
      </div>`;
    document.body.appendChild(bg);
    const cerrar = () => bg.remove();
    bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
    bg.querySelector("#impCancel").addEventListener("click", cerrar);
    bg.querySelector("#impOk").addEventListener("click", async () => {
      const btn = bg.querySelector("#impOk"); btn.disabled = true; btn.textContent = "Importando…";
      try {
        const r = await store.importarProveedoresDir(filas);
        bg.querySelector("#impMsg").innerHTML = `<div class="ok-box" style="margin-top:10px">✅ Listo: ${r.nuevos} nuevo(s), ${r.actualizados} actualizado(s).</div>`;
        setTimeout(cerrar, 1100);
      } catch (e) {
        btn.disabled = false; btn.textContent = `Importar ${filas.length}`;
        bg.querySelector("#impMsg").innerHTML = `<div class="error-box" style="margin-top:10px">No pude importar: ${esc((e && e.message) || e)}</div>`;
      }
    });
  }

  return off;
}
