// Hub de Ventas: agrupa Ventas · Margen · Recetas en sub-pestañas, para no tener
// tres pestañas separadas en la barra de abajo.
import * as ventas from "./ventas.js";
import * as margen from "./margen.js";
import * as recetas from "./recetas.js";
import * as meseros from "./meseros.js";
import * as plan from "../plan.js";

export function render(el, ctx) {
  let sub = "ventas";
  el.innerHTML = `
    <div class="segmented" style="font-size:12.5px"><button data-s="ventas">Ventas</button><button data-s="margen">Margen</button><button data-s="recetas">Recetas</button><button data-s="meseros">Meseros</button></div>
    <div id="vhub"></div>`;
  // El plan decide cuáles de las cuatro existen para este restaurante.
  sub = plan.podarSegmented(el, {
    ventas: "v.ventas", margen: "v.margen", recetas: "v.recetas", meseros: "v.meseros",
  }, sub);
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
      : sub === "meseros" ? meseros.render(subEl, ctx)
      : recetas.render(subEl, ctx);
  }
  marcar(); renderSub();
  return () => { if (typeof limpiar === "function") limpiar(); };
}
