// White-label: el restaurante pone su logo y nombre. Aparece en el header
// (sin quitar "Cifra") y en el ícono cuando guardan la app en su pantalla de
// inicio (iOS: apple-touch-icon + título; Chrome/Android: manifest dinámico).
import * as store from "./store.js";

const escapar = (s) =>
  String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- Aplicar la marca actual (lee del store) -------------------------------
let ultimaFirma = null;
export function aplicarMarcaActual() {
  const nombre = (store.state.config.marcaNombre || store.state.orgNombre || "").trim();
  const logo = store.state.config.logoData || "";
  const firma = nombre + "|" + logo.length + "|" + logo.slice(0, 48);
  if (firma === ultimaFirma) return;
  ultimaFirma = firma;
  pintarHeader(nombre, logo);
  aplicarPWA(nombre, logo);
}

function pintarHeader(nombre, logo) {
  const m = document.getElementById("marca");
  if (!m) return;
  if (!nombre && !logo) {
    m.innerHTML = `<span class="wordmark-cifra">Platify</span>`;
    return;
  }
  m.innerHTML = `
    <span style="display:inline-flex;align-items:center;gap:9px">
      ${logo ? `<img src="${logo}" alt="" style="width:30px;height:30px;border-radius:9px;object-fit:cover;border:1px solid rgba(255,255,255,.14);flex:none"/>` : ""}
      <span style="display:flex;flex-direction:column;line-height:1.05">
        <span style="font-family:'Poppins',sans-serif;color:var(--tinta);font-size:16px;font-weight:600">${escapar(nombre || "Platify")}</span>
        <span style="font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--gris);margin-top:2px">por Platify</span>
      </span>
    </span>`;
}

// ---- Ícono / nombre en la pantalla de inicio -------------------------------
let manifestURL = null;
function aplicarPWA(nombre, logo) {
  const nom = (nombre || "").trim();
  if (nom) {
    document.title = nom + " · Platify";
    setMeta("apple-mobile-web-app-title", nom);
  }
  if (logo) setLink("apple-touch-icon", logo);

  try {
    const homeAbs = new URL(".", location.href).href;
    const iconos = logo
      ? [{ src: logo, sizes: "192x192", type: "image/png", purpose: "any" },
         { src: logo, sizes: "512x512", type: "image/png", purpose: "maskable" }]
      : [{ src: new URL("icons/icon-192.png", location.href).href, sizes: "192x192", type: "image/png" },
         { src: new URL("icons/icon-512.png", location.href).href, sizes: "512x512", type: "image/png" }];
    const man = {
      name: nom || "Platify",
      short_name: (nom || "Platify").slice(0, 12),
      description: "Control financiero para tu restaurante — por Platify",
      start_url: homeAbs, scope: homeAbs,
      display: "standalone", orientation: "portrait",
      background_color: "#f1fbfa", theme_color: "#f1fbfa", lang: "es-MX",
      icons: iconos,
    };
    const blob = new Blob([JSON.stringify(man)], { type: "application/manifest+json" });
    if (manifestURL) URL.revokeObjectURL(manifestURL);
    manifestURL = URL.createObjectURL(blob);
    setLink("manifest", manifestURL);
  } catch (e) {}
}

function setMeta(name, content) {
  let m = document.querySelector(`meta[name="${name}"]`);
  if (!m) { m = document.createElement("meta"); m.setAttribute("name", name); document.head.appendChild(m); }
  m.setAttribute("content", content);
}
function setLink(rel, href) {
  let l = document.querySelector(`link[rel="${rel}"]`);
  if (!l) { l = document.createElement("link"); l.setAttribute("rel", rel); document.head.appendChild(l); }
  l.setAttribute("href", href);
}

// ---- Modal para personalizar ----------------------------------------------
export function abrirPersonalizar() {
  const logoActual = store.state.config.logoData || "";
  const nombreActual = (store.state.config.marcaNombre || store.state.orgNombre || "").trim();
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `
    <div class="modal">
      <h2>Personaliza tu marca</h2>
      <p class="sub" style="margin-top:0">Pon el logo y nombre de tu restaurante. Aparecen aquí y en el ícono cuando guardas la app en tu pantalla de inicio. <b>Platify</b> sigue siendo tu plataforma.</p>
      <div style="display:flex;align-items:center;gap:14px;margin:14px 0">
        <div id="prev" style="width:74px;height:74px;border-radius:18px;background:var(--blanco);border:1px solid rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none">
          ${logoActual ? `<img src="${logoActual}" style="width:100%;height:100%;object-fit:cover"/>` : `<span class="sub" style="font-size:11px">Sin logo</span>`}
        </div>
        <div style="flex:1">
          <label class="btn sec chico" style="display:inline-block;cursor:pointer;margin:0">Subir logo<input id="file" type="file" accept="image/*" style="display:none"/></label>
          <button class="linkbtn" id="quitar" style="display:${logoActual ? "block" : "none"};margin-top:8px;color:var(--rojo)">Quitar logo</button>
        </div>
      </div>
      <label class="sub" style="display:block;margin:0 2px 4px">Nombre para el ícono</label>
      <input id="nom" value="${escapar(nombreActual)}" placeholder="Ej. Cremina" maxlength="24" />
      <p class="sub" style="font-size:11px;margin:10px 2px 0;line-height:1.5">📱 <b>iPhone:</b> toca Compartir → <b>Agregar a inicio</b> y verás este nombre y logo. Si ya la tenías guardada, bórrala y agrégala de nuevo para que tome tu logo.</p>
      <button class="btn" id="guardar" style="margin-top:16px">Guardar</button>
      <button class="btn sec" id="cerrar" style="margin-top:8px">Cerrar</button>
      <div id="msg"></div>
    </div>`;
  document.body.appendChild(bg);

  let logoNuevo = logoActual;
  const prev = bg.querySelector("#prev");
  const btnQuitar = bg.querySelector("#quitar");
  const msg = bg.querySelector("#msg");

  bg.querySelector("#file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    msg.innerHTML = "";
    try {
      logoNuevo = await comprimir(f, 256);
      prev.innerHTML = `<img src="${logoNuevo}" style="width:100%;height:100%;object-fit:cover"/>`;
      btnQuitar.style.display = "block";
    } catch (err) {
      msg.innerHTML = `<p class="sub" style="color:var(--rojo)">No pude leer esa imagen. Intenta con otra.</p>`;
    }
  });
  btnQuitar.addEventListener("click", () => {
    logoNuevo = "";
    prev.innerHTML = `<span class="sub" style="font-size:11px">Sin logo</span>`;
    btnQuitar.style.display = "none";
  });
  const cerrar = () => bg.remove();
  bg.querySelector("#cerrar").addEventListener("click", cerrar);
  bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });

  bg.querySelector("#guardar").addEventListener("click", async () => {
    const nom = bg.querySelector("#nom").value.trim();
    const btn = bg.querySelector("#guardar");
    btn.disabled = true; btn.textContent = "Guardando…";
    try {
      await store.guardarConfig({ logoData: logoNuevo || null, marcaNombre: nom || null });
      ultimaFirma = null; // forzar re-aplicar
      aplicarMarcaActual();
      cerrar();
    } catch (err) {
      msg.innerHTML = `<p class="sub" style="color:var(--rojo)">No se pudo guardar. Revisa tu conexión.</p>`;
      btn.disabled = false; btn.textContent = "Guardar";
    }
  });
}

// Recorta la imagen a un cuadrado centrado y la reduce a PNG (máx px).
function comprimir(file, max) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = rej;
    fr.onload = () => {
      const img = new Image();
      img.onerror = rej;
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = max; c.height = max;
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, max, max);
          const s = Math.min(img.width, img.height);
          const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
          ctx.drawImage(img, sx, sy, s, s, 0, 0, max, max);
          res(c.toDataURL("image/png"));
        } catch (e) { rej(e); }
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
