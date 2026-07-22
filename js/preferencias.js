// Preferencias del restaurante: cómo ve/usa los datos. Se guarda en `config`
// (por restaurante, vía guardarConfig) y las pantallas la respetan al instante,
// porque están suscritas al store. Pensado para crecer: hoy trae el nivel de
// detalle de ventas; mañana pueden sumarse % objetivo, moneda, etc.
import * as store from "./store.js";

// ── Definición de opciones (fácil de extender) ──────────────────────────────
const DETALLE_OPTS = [
  { v: "auto", t: "Automático",
    d: "Si subes grupos modificadores, desgloso por variante; si no, me quedo en artículo. Sin que configures nada." },
  { v: "variante", t: "Por artículo y variante",
    d: "Desgloso cada platillo por su grupo modificador (tipo, sabor, leche…). Necesitas subir el reporte de grupos modificadores de Parrot." },
  { v: "articulo", t: "Solo por artículo",
    d: "Me quedo al nivel de platillo. No te pido el reporte de grupos modificadores." },
];

export function abrirPreferencias() {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = render();
  document.body.appendChild(bg);
  const cerrar = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
  wire(bg, cerrar);
}

function render() {
  const actual = (store.state.config && store.state.config.detalleVentas) || "auto";
  const autoEs = store.detalleVentas();
  const filas = DETALLE_OPTS.map((o) => filaOpcion(o, actual, autoEs)).join("");
  return `
    <div class="modal">
      <h2>Preferencias</h2>
      <p class="sub" style="margin-top:0">Ajusta cómo ves los datos. Aplica solo a este restaurante y se guarda para todo tu equipo.</p>

      <div class="titulo-seccion" style="margin-top:16px">Nivel de detalle de ventas</div>
      <p class="sub" style="margin:2px 2px 10px">Cómo se desglosan tus platillos en <b>Ventas</b> y <b>Margen</b>.</p>
      <div id="opts" style="display:flex;flex-direction:column;gap:8px">${filas}</div>

      <button class="btn" id="guardar" style="margin-top:18px">Guardar</button>
      <button class="btn sec" id="cerrar" style="margin-top:8px">Cerrar</button>
      <div id="msg"></div>
    </div>`;
}

function filaOpcion(o, actual, autoEs) {
  const sel = o.v === actual;
  const hint = o.v === "auto"
    ? ` <span style="color:var(--verde);font-weight:600">· ahora: ${autoEs === "variante" ? "por variante" : "por artículo"}</span>`
    : "";
  return `
    <div class="pref-opt" data-val="${o.v}" role="radio" aria-checked="${sel}" tabindex="0"
      style="display:flex;gap:11px;align-items:flex-start;cursor:pointer;border:1px solid ${sel ? "var(--verde)" : "var(--linea)"};background:${sel ? "rgba(46,196,182,.08)" : "transparent"};border-radius:12px;padding:12px 13px">
      <span class="pref-dot" style="flex:none;width:18px;height:18px;border-radius:50%;border:2px solid ${sel ? "var(--verde)" : "var(--gris)"};margin-top:2px;display:grid;place-items:center">
        <span style="width:8px;height:8px;border-radius:50%;background:var(--verde);display:${sel ? "block" : "none"}"></span>
      </span>
      <span style="flex:1">
        <span style="font-weight:700;font-size:14px">${o.t}${hint}</span>
        <span class="sub" style="display:block;font-size:12.5px;margin-top:2px">${o.d}</span>
      </span>
    </div>`;
}

function wire(bg, cerrar) {
  let elegido = (store.state.config && store.state.config.detalleVentas) || "auto";
  const opts = bg.querySelector("#opts");

  function marcar() {
    opts.querySelectorAll(".pref-opt").forEach((el) => {
      const sel = el.dataset.val === elegido;
      el.style.borderColor = sel ? "var(--verde)" : "var(--linea)";
      el.style.background = sel ? "rgba(46,196,182,.08)" : "transparent";
      el.setAttribute("aria-checked", sel);
      const dot = el.querySelector(".pref-dot");
      dot.style.borderColor = sel ? "var(--verde)" : "var(--gris)";
      dot.firstElementChild.style.display = sel ? "block" : "none";
    });
  }
  const elegir = (el) => { if (!el) return; elegido = el.dataset.val; marcar(); };
  opts.addEventListener("click", (e) => elegir(e.target.closest(".pref-opt")));
  opts.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); elegir(e.target.closest(".pref-opt")); }
  });

  bg.querySelector("#cerrar").addEventListener("click", cerrar);
  bg.querySelector("#guardar").addEventListener("click", async () => {
    const btn = bg.querySelector("#guardar");
    btn.disabled = true; btn.textContent = "Guardando…";
    try {
      await store.guardarConfig({ detalleVentas: elegido });
      cerrar();   // el store notifica → Ventas, Margen e Inicio se redibujan solos
    } catch (err) {
      bg.querySelector("#msg").innerHTML =
        `<p class="sub" style="color:var(--rojo);margin-top:10px">No se pudo guardar. Revisa tu conexión.</p>`;
      btn.disabled = false; btn.textContent = "Guardar";
    }
  });
}
