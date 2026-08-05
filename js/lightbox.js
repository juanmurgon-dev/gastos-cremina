// Visor de fotos a pantalla completa.
//
// Por qué existe: las fotos se guardan como data URL (base64) y los
// navegadores BLOQUEAN abrir un data: en pestaña nueva, así que
// window.open(img.src) no hacía nada. Aquí se muestra dentro de la app.
//
// Se cierra tocando el fondo, con la ✕ o con Escape.

let abierto = null;

export function verFoto(src, titulo) {
  if (!src) return;
  cerrar();

  const capa = document.createElement("div");
  capa.className = "visor-foto";
  capa.setAttribute("role", "dialog");
  capa.setAttribute("aria-modal", "true");
  capa.setAttribute("aria-label", titulo ? `Foto de ${titulo}` : "Foto");
  capa.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(12,22,21,.93);
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;
    -webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)`;

  capa.innerHTML = `
    <div style="width:100%;max-width:900px;display:flex;align-items:center;gap:10px;color:#fff">
      <span style="flex:1;min-width:0;font-weight:700;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${
        String(titulo || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
      }</span>
      <a data-baja download="foto.jpg" title="Descargar" style="flex:0 0 auto;color:#fff;text-decoration:none;font-size:20px;padding:4px 8px">⬇</a>
      <button data-cerrar aria-label="Cerrar" style="flex:0 0 auto;background:none;border:none;color:#fff;font-size:26px;line-height:1;cursor:pointer;padding:2px 8px">✕</button>
    </div>
    <img data-img alt="${titulo ? "Foto de " + String(titulo).replace(/"/g, "") : "Foto"}"
      style="max-width:100%;max-height:calc(100vh - 110px);object-fit:contain;border-radius:12px;background:#fff" />
    <p style="color:#cfe0de;font-size:12px;margin:0">Toca fuera de la foto para cerrar</p>`;

  const img = capa.querySelector("[data-img]");
  img.src = src;
  const baja = capa.querySelector("[data-baja]");
  baja.href = src;
  baja.download = ((titulo || "foto").replace(/[^\w\s.-]/g, "").trim() || "foto") + ".jpg";

  // Cerrar: fondo, ✕ o Escape. Un clic sobre la imagen NO cierra.
  capa.addEventListener("click", (e) => { if (e.target === capa) cerrar(); });
  capa.querySelector("[data-cerrar]").addEventListener("click", cerrar);
  const conEsc = (e) => { if (e.key === "Escape") cerrar(); };
  document.addEventListener("keydown", conEsc);

  document.body.appendChild(capa);
  document.body.style.overflow = "hidden";
  capa.querySelector("[data-cerrar]").focus();
  abierto = { capa, conEsc };
}

export function cerrar() {
  if (!abierto) return;
  document.removeEventListener("keydown", abierto.conEsc);
  abierto.capa.remove();
  document.body.style.overflow = "";
  abierto = null;
}
