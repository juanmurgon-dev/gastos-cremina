// Qué ve cada restaurante.
//
// La app sabe hacer 26 cosas y ninguna persona necesita 26 cosas. Este archivo
// es el único lugar donde se decide cuáles se prenden. NO borra código: apaga
// destinos. Lo que está fuera del plan sigue en el repo, funcionando, esperando
// a un cliente que lo pida — se prende con una línea de SQL, sin tocar la app.
//
// Tres capas, en este orden:
//   1. el plan del restaurante (orgs.plan)     — lo que trae de fábrica
//   2. orgs.extras                              — lo que ESTE cliente pidió de más
//   3. orgs.ocultos                             — lo que ESTE cliente no quiere ver
//
// Nada de esto es un candado de seguridad: el candado real es la RLS
// (supabase/roles-candados.sql). Esto es qué tanto cabe en la pantalla.

// ── Catálogo: todo lo que la app sabe hacer ──────────────────────
// La clave es la que usan las vistas. "v." = dentro de Ventas, "i." = Insumos,
// "n." = Inventario, "g." = Gastos, "c." = tarjeta de Inicio, "e." = Equipo.
export const DESTINOS = {
  inicio: "Portada",  ventas: "Ventas",  insumos: "Insumos",
  inventario: "Inventario",  reportes: "Gastos",  equipo: "Equipo",

  "v.ventas": "Venta por producto",  "v.margen": "Margen",
  "v.recetas": "Recetas",            "v.meseros": "Meseros",

  "i.capturar": "Capturar ticket",   "i.tickets": "Tickets",
  "i.requisicion": "Requisición",    "i.precios": "Precios",
  "i.proveedores": "Proveedores",

  "n.conteo": "Conteo",  "n.catalogo": "Catálogo",  "n.cierre": "Cierre de mes",

  "g.variables": "Gasto variable",  "g.fijos": "Gastos fijos",
  "g.precio": "Ajuste de precio",   "g.meta": "Meta semanal",

  "c.utilidad": "Utilidad",      "c.comensales": "Comensales",
  "c.rentabilidad": "Rentabilidad por área",  "c.tendencia": "Tendencia",
  "c.actuar": "Para actuar",     "c.vistazo": "De un vistazo",  "c.meta": "Meta",

  "e.tablero": "Tablero de equipo",  "e.evaluar": "Evaluar",  "e.personas": "Personas",
};

// ── Lite: ¿estoy ganando dinero esta semana? ─────────────────────
// Cero dependencia de Parrot. Un dato manual por semana y fotos de tickets.
const LITE = [
  "inicio", "c.utilidad", "c.meta",
  "insumos", "i.capturar", "i.tickets", "i.precios", "i.proveedores",
  "reportes", "g.variables", "g.fijos", "g.meta",
];

// ── Pro: haz que tu equipo venda más ─────────────────────────────
// Lite + cinco destinos que salen del reporte que el cliente YA descarga.
const PRO = [
  ...LITE,
  "ventas", "v.ventas", "v.meseros",
  "i.requisicion",
  "c.comensales", "c.rentabilidad", "c.tendencia",
];

const PLANES = { lite: LITE, pro: PRO, trial: PRO, starter: LITE };

// Fuera del lanzamiento, no del repo: v.margen, v.recetas, inventario y sus
// tres pantallas, g.precio, equipo y las suyas, c.actuar, c.vistazo.
// Cada una exige captura previa (recetas, catálogo) o contenido que todavía
// no existe (capacitación). Se prenden por org con `extras`.

let plan = null, extras = [], ocultos = [];

// La app llama esto cuando ya sabe de qué restaurante es la sesión.
export function definir(p, ex, oc) {
  plan = p || null;
  extras = Array.isArray(ex) ? ex : [];
  ocultos = Array.isArray(oc) ? oc : [];
}

// ¿Este restaurante ve este destino?
//
// Sin plan conocido se ve TODO. Es a propósito y no es un hueco de seguridad:
// una base vieja o de un solo restaurante no tiene columna `plan`, y esconderle
// la mitad de la app a quien ya la usaba sería romperle el día. Lo que protege
// los datos es la RLS, no esta función.
export function ve(clave) {
  if (ocultos.includes(clave)) return false;
  if (extras.includes(clave)) return true;
  const set = PLANES[plan];
  return !set || set.includes(clave);
}

// Filtra una lista de claves dejando solo las que se ven. Para las barras de
// sub-pestañas, que son listas de destinos y nada más.
export function soloVisibles(claves) { return claves.filter(ve); }

// Poda una barra de sub-pestañas ya dibujada.
//
// Cada hub dibuja su `.segmented` con todos los botones y luego llama aquí:
// se van los que este restaurante no ve. Es lo menos invasivo — el hub no
// tiene que saber nada de planes, y si el plan cambia no hay que tocarlo.
//
// `mapa` traduce el data-s del botón a la clave del catálogo:
//   podarSegmented(el, { ventas:"v.ventas", margen:"v.margen", ... })
//
// Devuelve dónde debe arrancar el hub: `actual` si sigue viva, y si no, la
// primera que quede. Respetar `actual` importa — el barista abre Insumos
// directo en Requisición, y mandarlo siempre a la primera lo regresaría a
// Capturar cada vez.
// Si al final queda una sola, la barra entera se esconde: un selector de una
// opción no es un selector, es ruido.
export function podarSegmented(el, mapa, actual) {
  const barra = el.querySelector(".segmented");
  if (!barra) return actual || null;
  const btns = [...barra.querySelectorAll("button")];
  for (const b of btns) {
    const clave = mapa[b.dataset.s];
    if (clave && !ve(clave)) b.remove();
  }
  const quedan = [...barra.querySelectorAll("button")];
  if (quedan.length <= 1) barra.hidden = true;
  if (quedan.some((b) => b.dataset.s === actual)) return actual;
  return quedan.length ? quedan[0].dataset.s : null;
}
