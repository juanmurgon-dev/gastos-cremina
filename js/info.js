// Botón "ⓘ" reutilizable: junto a un dato, abre una explicación de qué es,
// cómo se calcula y de dónde sale. El contenido vive aquí (una sola fuente de
// verdad) para que Inicio, Ventas y Margen expliquen los números igual.
//
// Uso en una vista:  import * as info from "../info.js";
//                    ...<div class="l">Costo insumos${info.icono("costoInsumos")}</div>
// No hace falta enganchar nada más: un listener global abre el modal al tocar.

const EXPL = {
  utilidad: {
    t: "Utilidad de la semana",
    q: "Lo que de verdad te queda después de pagar todo.",
    c: "Venta − compras del periodo − la parte de esta semana de tus gastos fijos.",
    d: "La venta sale de los cortes de caja; las compras, de tus tickets; los fijos, de Gastos → Fijos. Si la semana va a medias, se proyecta al cierre con el ritmo de la semana pasada.",
  },
  costoInsumos: {
    t: "Costo de insumos (%)",
    q: "De cada $100 que vendes, cuánto se te fue en comprar insumos. Es el número que más cuida tu margen.",
    c: "Gasto en compras ÷ venta × 100. Sano ≤ 35%, ojo 36–45%, alto arriba de 45%.",
    d: "El gasto son tus tickets del periodo; la venta, los cortes de caja del mismo periodo.",
  },
  venderDia: {
    t: "Vender/día para ganar",
    q: "El mínimo que necesitas vender cada día para no perder (punto de equilibrio).",
    c: "Gastos fijos de la semana ÷ (1 − % de costo variable), dividido entre 7 días.",
    d: "Los gastos fijos salen de Gastos → Fijos. El % de costo variable se ajusta en tu configuración (por defecto 26%).",
  },
  ventaSemana: {
    t: "Venta de la semana",
    q: "Todo lo que vendió el restaurante en la semana.",
    c: "Suma de la venta total de los cortes de caja de la semana.",
    d: "Sale de los cortes que subes en Ventas → Importar. “Parcial” = solo los días que llevas de la semana.",
  },
  metaCompras: {
    t: "Meta de compras",
    q: "Tu presupuesto de gasto en insumos para la semana.",
    c: "La barra muestra cuánto llevas gastado contra la meta. Verde vas holgado, amarillo al llegar a 85%, rojo si te pasaste (100%).",
    d: "El gasto son tus tickets de la semana. La meta la fijas aquí abajo o en Gastos → Meta.",
  },
  tendencia: {
    t: "Tendencia · últimas 6 semanas",
    q: "Cómo se ha movido tu venta y tu costo semana con semana.",
    c: "Cada barra es la venta de esa semana; el % de al lado es su costo de insumos (gasto ÷ venta).",
    d: "La venta viene de los cortes de caja y el gasto de tus tickets.",
  },
  ventaHistorica: {
    t: "Venta histórica",
    q: "Todo lo que has vendido desde que registras cortes.",
    c: "Suma de la venta total de todos los cortes de caja cargados.",
    d: "Cada corte que subes en Ventas → Importar se acumula aquí.",
  },
  mezclaPago: {
    t: "Cómo te pagan",
    q: "Con qué te pagan tus clientes: efectivo, tarjeta o transferencia.",
    c: "Suma cada forma de pago de todos los cortes y saca su porcentaje del total.",
    d: "Viene del desglose de pagos de tus cortes de caja.",
  },
  margen: {
    t: "Margen por platillo",
    q: "De lo que cobras por un platillo, qué porcentaje es ganancia después de su costo.",
    c: "(Precio − costo) ÷ precio. El precio sale de venta ÷ unidades; el costo lo capturas tú. Menos de 15% muy bajo, 15–30% flojo, 30–45% bien, arriba de 45% excelente.",
    d: "El precio y las unidades vienen de tus reportes de Parrot; el costo por porción lo pones en esta pantalla.",
  },
  minaOro: {
    t: "Mina de oro",
    q: "El platillo que más utilidad total te deja — no el más caro, sino el que más gana sumando todo lo que se vende.",
    c: "Utilidad por platillo = (precio − costo) × unidades vendidas. Se muestra el más alto.",
    d: "Necesita tener costo capturado. Los que aún no lo tienen salen en “Falta capturar costo”.",
  },
};

// HTML del botón "ⓘ" para incrustar junto a una etiqueta o título.
export function icono(clave) {
  if (!EXPL[clave]) return "";
  return `<button type="button" data-info="${clave}" aria-label="Qué significa este dato" title="Qué significa"
    style="cursor:pointer;background:none;padding:0;margin-left:5px;flex:none;display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;border:1.3px solid var(--gris);color:var(--gris);font-size:10px;font-weight:800;font-style:italic;line-height:1;vertical-align:middle;font-family:Georgia,serif">i</button>`;
}

function abrir(clave) {
  const x = EXPL[clave];
  if (!x) return;
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `
    <div class="modal">
      <h2 style="margin-bottom:2px">${x.t}</h2>
      <p style="margin:6px 0 0;font-size:14px;line-height:1.5">${x.q}</p>
      ${x.c ? `<div class="titulo-seccion" style="margin-top:14px">Cómo se calcula</div>
        <p class="sub" style="margin:4px 0 0;font-size:13px;line-height:1.5">${x.c}</p>` : ""}
      ${x.d ? `<div class="titulo-seccion" style="margin-top:12px">De dónde sale</div>
        <p class="sub" style="margin:4px 0 0;font-size:13px;line-height:1.5">${x.d}</p>` : ""}
      <button class="btn sec" data-cerrar style="margin-top:18px">Entendido</button>
    </div>`;
  document.body.appendChild(bg);
  const cerrar = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
  bg.querySelector("[data-cerrar]").addEventListener("click", cerrar);
}

// Un solo listener global: al tocar cualquier "ⓘ" (ahora o tras re-render), abre.
let montado = false;
(function montar() {
  if (montado || typeof document === "undefined") return;
  montado = true;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-info]");
    if (b) abrir(b.getAttribute("data-info"));
  });
})();
