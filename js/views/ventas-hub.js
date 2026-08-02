// Hub de Ventas: agrupa Ventas · Margen · Recetas en sub-pestañas, para no tener
// tres pestañas separadas en la barra de abajo.
import * as ventas from "./ventas.js";
import * as margen from "./margen.js";
import * as recetas from "./recetas.js";

export function render(el, ctx) {
  let sub = "ventas";
  el.innerHTML = `
    <div class="segmented" style="font-size:13px"><button data-s="ventas">Ventas</button><button data-s="margen">Margen</button><button data-s="recetas">Recetas</button></div>
    <div id="vhub"></div>`;
  const subEl = el.querySelector("#vhub");
  const btns = [...el.querySelectorAll(".segmented button")];
  let limpiar = null;
  const marcar = () => btns.forEach((b) => b.classList.toggle("act", b.dataset.s === sub));
  btns.forEach((b) => b.addEventListener("click", () => { sub = b.dataset.s; marcar(); renderSub(); }));
  function renderSub() {
    if (typeof limpiar === "function") { try { limpiar(); } catch (e) {} }
    subEl.innerHTML = "";
    limpiar = sub === "ventas" ? ventas.render(subEl, ctx)
      : sub === "margen" ? margen.render(subEl, ctx)
      : recetas.render(subEl, ctx);
  }
  marcar(); renderSub();
  return () => { if (typeof limpiar === "function") limpiar(); };
}
