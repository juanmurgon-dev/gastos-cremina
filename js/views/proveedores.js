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
    if (q) dir = dir.filter((p) => store.coincide(p.nombre + " " + p.telefono + " " + p.correo + " " + p.direccion, q));
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

  // Resumen de tickets del proveedor: cuántos, cuánto y la lista.
  function bloqueTickets(p) {
    const ts = store.ticketsDeProveedor(p.nombre);
    const total = ts.reduce((a, t) => a + store.gastoTicket(t), 0);
    if (!ts.length) return `<div class="sub" style="margin:8px 2px 2px">🧾 Sin tickets todavía de este proveedor.</div>`;
    const filas = ts.slice(0, 80).map((t) => {
      const nl = (t.lineas || []).length;
      return `<div class="barra-row" style="gap:8px;border-bottom:1px solid var(--linea);padding:7px 10px;margin:0">
        <span style="flex:1;min-width:0">🧾 ${esc(t.fecha || "sin fecha")}${nl ? ` · <span class="sub">${nl} línea(s)</span>` : ""}</span>
        <span style="font-variant-numeric:tabular-nums;font-weight:600">${esc(store.money(store.gastoTicket(t)))}</span></div>`;
    }).join("");
    return `<div class="sub" style="margin:10px 2px 6px">🧾 <b>${ts.length}</b> ticket(s) · <b>${esc(store.money(total))}</b> en compras</div>
      <div style="max-height:34vh;overflow:auto;border:1px solid var(--linea);border-radius:12px">${filas}${ts.length > 80 ? `<div class="sub" style="padding:7px 10px">…y ${ts.length - 80} más</div>` : ""}</div>`;
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
        ${editando ? bloqueTickets(p) : ""}
        <div id="fMsg"></div>
        <button class="btn" id="fGuardar" style="margin-top:12px">${editando ? "Guardar cambios" : "Agregar"}</button>
        ${editando ? `<button class="btn sec" id="fUnir" style="margin-top:8px">🔀 Unir con otro proveedor</button>` : ""}
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

    const unir = bg.querySelector("#fUnir");
    if (unir) unir.addEventListener("click", () => abrirUnir(p));

    const del = bg.querySelector("#fBorrar");
    if (del) del.addEventListener("click", async () => {
      if (!confirm(`¿Borrar a "${p.nombre}" del directorio? (No toca tus tickets.)`)) return;
      try { await store.borrarProveedorDir(p.id); cerrar(); }
      catch (e) { alert("No pude borrar: " + ((e && e.message) || e)); }
    });
  }

  // ── Unir el proveedor `origen` con otro del directorio ──
  // Se elige el otro proveedor y con qué nombre quedarse; al final queda uno.
  function abrirUnir(origen) {
    const otros = store.proveedoresDir()
      .filter((p) => p.id !== origen.id)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `
      <div class="modal">
        <h2>Unir «${esc(origen.nombre)}» con…</h2>
        <p class="sub" style="margin:-6px 0 10px">Elige el proveedor que en realidad es el mismo. Sus tickets se juntan y queda <b>uno solo</b>.</p>
        ${otros.length
          ? `<input id="uBuscar" placeholder="Buscar proveedor…" style="margin-bottom:8px" />
             <div id="uLista" style="max-height:44vh;overflow:auto;border:1px solid var(--linea);border-radius:12px"></div>`
          : `<div class="vacio">No hay otro proveedor con el cuál unir. Agrega o sube más primero.</div>`}
        <div id="uMsg"></div>
        <button class="btn sec" id="uCancel" style="margin-top:12px">Cancelar</button>
      </div>`;
    document.body.appendChild(bg);
    const cerrar = () => bg.remove();
    bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
    bg.querySelector("#uCancel").addEventListener("click", cerrar);

    if (!otros.length) return;

    const lista = bg.querySelector("#uLista");
    const buscar = bg.querySelector("#uBuscar");
    function pintarLista() {
      const q = (buscar.value || "").trim().toLowerCase();
      const vis = q ? otros.filter((p) => store.coincide(p.nombre, q)) : otros;
      lista.innerHTML = vis.length
        ? vis.map((p) => `<button type="button" class="barra-row" data-uid="${esc(p.id)}"
            style="width:100%;gap:8px;border:none;border-bottom:1px solid var(--linea);padding:10px;margin:0;background:none;text-align:left;cursor:pointer">
            <span style="flex:1;min-width:0">🏪 <b>${esc(p.nombre)}</b>${p.telefono ? ` · <span class="sub">${esc(p.telefono)}</span>` : ""}</span>
            <span class="sub">unir ›</span></button>`).join("")
        : `<div class="sub" style="padding:10px">Sin resultados.</div>`;
      lista.querySelectorAll("[data-uid]").forEach((b) =>
        b.addEventListener("click", () => elegirNombre(otros.find((p) => p.id === b.dataset.uid))));
    }
    buscar.addEventListener("input", pintarLista);
    pintarLista();

    // Paso 2: ¿con cuál nombre nos quedamos?
    function elegirNombre(otro) {
      bg.querySelector("h2").textContent = "¿Con cuál nombre te quedas?";
      const cuerpo = bg.querySelector(".modal");
      cuerpo.innerHTML = `
        <h2>¿Con cuál nombre te quedas?</h2>
        <p class="sub" style="margin:-6px 0 12px">Vas a unir estos dos en un solo proveedor. El otro nombre desaparece y sus tickets quedan con el que elijas.</p>
        <button class="btn" id="uKeepOrigen" style="margin-bottom:8px">Quedarme con «${esc(origen.nombre)}»</button>
        <button class="btn" id="uKeepOtro" style="margin-bottom:8px">Quedarme con «${esc(otro.nombre)}»</button>
        <div id="uMsg2"></div>
        <button class="btn sec" id="uCancel2" style="margin-top:8px">Cancelar</button>`;
      cuerpo.querySelector("#uCancel2").addEventListener("click", cerrar);

      async function fusionar(destino, origenF, btn) {
        const msg = cuerpo.querySelector("#uMsg2");
        cuerpo.querySelectorAll("button").forEach((b) => (b.disabled = true));
        btn.textContent = "Uniendo…";
        try {
          await store.fusionarProveedores(origenF, destino);
          msg.innerHTML = `<div class="ok-box" style="margin-top:10px">✅ Listo. Quedó <b>${esc(destino.nombre)}</b>.</div>`;
          setTimeout(() => { cerrar(); document.querySelectorAll(".modal-bg").forEach((m) => m.remove()); }, 900);
        } catch (e) {
          cuerpo.querySelectorAll("button").forEach((b) => (b.disabled = false));
          msg.innerHTML = `<div class="error-box" style="margin-top:10px">No pude unir: ${esc((e && e.message) || e)}</div>`;
        }
      }
      cuerpo.querySelector("#uKeepOrigen").addEventListener("click", (e) => fusionar(origen, otro, e.currentTarget));
      cuerpo.querySelector("#uKeepOtro").addEventListener("click", (e) => fusionar(otro, origen, e.currentTarget));
    }
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
