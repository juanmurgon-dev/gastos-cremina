// Chat de datos: un botón flotante 💬 que abre una conversación. La pregunta y
// un RESUMEN de las cifras del restaurante se mandan a la Edge Function
// "preguntar" (que llama a Claude con la llave del servidor). Tope de preguntas
// por día en el servidor; aquí solo mostramos cuántas van.
import { supabase } from "./supabase-init.js";
import * as store from "./store.js";
import { money } from "./store.js";

let montado = false;
let fab = null;
const historial = [];   // [{role:"user"|"assistant", content}]
let bg = null;

const SUGERENCIAS = [
  "¿Cómo va la venta esta semana?",
  "¿Qué insumo subió de precio?",
  "¿Cuál es mi platillo estrella?",
];

function esc(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Estilos (una sola vez) ──────────────────────────────────────────────────
function inyectarEstilos() {
  if (document.getElementById("chat-css")) return;
  const st = document.createElement("style");
  st.id = "chat-css";
  st.textContent = `
    #chat-fab{position:fixed;right:16px;bottom:84px;z-index:9000;width:56px;height:56px;border-radius:50%;
      border:none;background:var(--verde,#0e3a39);color:#fff;font-size:24px;cursor:pointer;
      box-shadow:0 6px 20px rgba(0,0,0,.28);display:grid;place-items:center}
    #chat-fab:active{transform:scale(.94)}
    .chat-bg{position:fixed;inset:0;z-index:9001;background:rgba(0,0,0,.4);display:flex;
      align-items:flex-end;justify-content:center}
    .chat-panel{background:var(--blanco,#fff);width:100%;max-width:620px;height:82vh;max-height:82vh;
      border-radius:20px 20px 0 0;display:flex;flex-direction:column;overflow:hidden;
      box-shadow:0 -8px 30px rgba(0,0,0,.25)}
    .chat-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--linea,#e0ece8)}
    .chat-head b{font-size:15px}
    .chat-head .sub{font-size:11px;color:var(--gris,#7ea8a2)}
    .chat-x{margin-left:auto;background:none;border:none;font-size:22px;line-height:1;cursor:pointer;color:var(--gris,#7ea8a2)}
    .chat-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}
    .chat-b{max-width:82%;padding:10px 13px;border-radius:15px;font-size:14px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
    .chat-b.me{align-self:flex-end;background:var(--verde,#0e3a39);color:#fff;border-bottom-right-radius:5px}
    .chat-b.ai{align-self:flex-start;background:var(--gris-claro,#eef5f3);color:var(--tinta,#12312f);border-bottom-left-radius:5px}
    .chat-b.err{align-self:center;background:#fdecec;color:#b23b3b;font-size:13px;text-align:center}
    .chat-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px}
    .chat-chip{font-size:12.5px;background:var(--gris-claro,#eef5f3);border:1px solid var(--linea,#e0ece8);
      color:var(--tinta,#12312f);border-radius:999px;padding:6px 12px;cursor:pointer}
    .chat-foot{border-top:1px solid var(--linea,#e0ece8);padding:8px 12px}
    .chat-quota{font-size:11px;color:var(--gris,#7ea8a2);text-align:center;margin:0 0 6px}
    .chat-form{display:flex;gap:8px;align-items:center}
    .chat-form input{flex:1;border:1px solid var(--linea,#e0ece8);border-radius:999px;padding:11px 15px;font-size:14px;outline:none}
    .chat-form button{flex:none;width:42px;height:42px;border-radius:50%;border:none;background:var(--verde,#0e3a39);
      color:#fff;font-size:17px;cursor:pointer;display:grid;place-items:center}
    .chat-form button:disabled{opacity:.5}
  `;
  document.head.appendChild(st);
}

// ── Botón flotante ──────────────────────────────────────────────────────────
export function montar() {
  if (montado) { mostrar(); return; }
  montado = true;
  inyectarEstilos();
  fab = document.createElement("button");
  fab.id = "chat-fab";
  fab.type = "button";
  fab.title = "Pregúntale a Platify";
  fab.setAttribute("aria-label", "Pregúntale a Platify");
  fab.textContent = "💬";
  fab.addEventListener("click", abrir);
  document.body.appendChild(fab);
}

// Mostrar/ocultar el botón (p. ej. ocultarlo en la pantalla de login).
export function mostrar() { if (fab) fab.style.display = "grid"; }
export function ocultar() { if (fab) fab.style.display = "none"; cerrar(); }

// ── Panel ───────────────────────────────────────────────────────────────────
function abrir() {
  if (bg) return;
  const nombre = (store.state.config.marcaNombre || store.state.orgNombre || "Platify");
  bg = document.createElement("div");
  bg.className = "chat-bg";
  bg.innerHTML = `
    <div class="chat-panel">
      <div class="chat-head">
        <span style="font-size:20px">💬</span>
        <span><b>Pregúntale a ${esc(nombre)}</b><br><span class="sub">Sobre tus ventas, gastos y márgenes</span></span>
        <button class="chat-x" aria-label="Cerrar">✕</button>
      </div>
      <div class="chat-msgs" id="chat-msgs"></div>
      <div class="chat-foot">
        <div class="chat-quota" id="chat-quota"></div>
        <form class="chat-form" id="chat-form">
          <input id="chat-q" placeholder="Escribe tu pregunta…" autocomplete="off" />
          <button type="submit" aria-label="Enviar">➤</button>
        </form>
      </div>
    </div>`;
  document.body.appendChild(bg);

  bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
  bg.querySelector(".chat-x").addEventListener("click", cerrar);
  bg.querySelector("#chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = bg.querySelector("#chat-q");
    const q = inp.value.trim();
    if (q) { inp.value = ""; enviar(q); }
  });

  pintar();          // vuelve a dibujar el historial (persiste mientras la app esté abierta)
  bg.querySelector("#chat-q").focus();
}

function cerrar() { if (bg) { bg.remove(); bg = null; } }

function pintar() {
  const cont = bg && bg.querySelector("#chat-msgs");
  if (!cont) return;
  if (!historial.length) {
    cont.innerHTML = `
      <div class="chat-b ai">¡Hola! Pregúntame lo que quieras sobre tus números: cómo va la semana, qué subió de precio, cuál platillo deja más… Respondo con tus datos de la app.</div>
      <div class="chat-chips">${SUGERENCIAS.map((s) => `<button class="chat-chip" type="button">${esc(s)}</button>`).join("")}</div>`;
    cont.querySelectorAll(".chat-chip").forEach((c) =>
      c.addEventListener("click", () => enviar(c.textContent)));
  } else {
    cont.innerHTML = historial.map((m) =>
      `<div class="chat-b ${m.role === "user" ? "me" : "ai"}">${esc(m.content)}</div>`).join("");
  }
  cont.scrollTop = cont.scrollHeight;
}

function nota(texto, clase) {
  const cont = bg && bg.querySelector("#chat-msgs");
  if (!cont) return;
  const div = document.createElement("div");
  div.className = "chat-b " + (clase || "ai");
  div.textContent = texto;
  cont.appendChild(div);
  cont.scrollTop = cont.scrollHeight;
  return div;
}

async function enviar(pregunta) {
  if (!bg) return;
  historial.push({ role: "user", content: pregunta });
  pintar();
  const btn = bg.querySelector("#chat-form button");
  if (btn) btn.disabled = true;
  const pensando = nota("Pensando…", "ai");

  try {
    const { data, error } = await supabase.functions.invoke("preguntar", {
      body: {
        pregunta,
        resumen: construirResumen(),
        historial: historial.slice(0, -1),   // los turnos previos (sin la pregunta nueva)
        orgId: store.state.orgId || null,
      },
    });
    if (pensando) pensando.remove();

    if (error) throw new Error(await mensajeError(error));
    if (data && data.error) throw new Error(data.error);

    if (data && data.limite_alcanzado) {
      historial.pop();   // no contó como turno con respuesta
      pintar();          // re-dibuja el historial ANTES de la nota (si no, la borra)
      nota(`Llegaste al tope de ${data.limite} preguntas por hoy. Vuelve mañana 🙂`, "err");
      return;
    }

    const resp = (data && data.respuesta) || "No pude generar una respuesta.";
    historial.push({ role: "assistant", content: resp });
    pintar();
    const q = bg.querySelector("#chat-quota");
    if (q && data && data.limite) q.textContent = `Llevas ${data.usadas} de ${data.limite} preguntas de hoy`;
  } catch (e) {
    if (pensando) pensando.remove();
    historial.pop();   // quita la pregunta que no obtuvo respuesta
    pintar();          // re-dibuja ANTES de la nota de error (si no, la borra)
    nota("No pude responder: " + ((e && e.message) || e), "err");
  } finally {
    if (bg) { const b = bg.querySelector("#chat-form button"); if (b) b.disabled = false; }
  }
}

// Saca el detalle de un error de supabase.functions.invoke (a veces trae cuerpo).
async function mensajeError(error) {
  let msg = (error && error.message) || "error desconocido";
  if (error && error.context && typeof error.context.json === "function") {
    try { const b = await error.context.json(); if (b && b.error) msg = b.error; } catch { /* usa msg */ }
  }
  return msg;
}

// ── Resumen de datos que se le manda a Claude (compacto pero útil) ───────────
function construirResumen() {
  const L = [];
  const nombre = (store.state.config.marcaNombre || store.state.orgNombre || "el restaurante");
  L.push(`Restaurante: ${nombre}. Moneda: pesos MXN. Hoy es ${store.hoyISO()}.`);

  // Ventas y costo de las últimas semanas
  const sems = store.ventasSemanas(6);
  const conDatos = sems.filter((s) => s.venta > 0 || s.gasto > 0);
  if (conDatos.length) {
    L.push("\nVENTAS POR SEMANA (la primera es la semana en curso):");
    for (const s of conDatos) {
      const costo = s.venta > 0 ? Math.round(s.gasto / s.venta * 100) : null;
      L.push(`- ${s.etiqueta}: venta ${money(s.venta)}, gasto en insumos ${money(s.gasto)}` +
        (costo != null ? `, costo de insumos ${costo}%` : ""));
    }
    const wk = sems[0];
    const meta = store.metaDeSemana(wk.desde);
    if (meta > 0) L.push(`Meta de compras de esta semana: ${money(meta)} (llevas gastado ${money(wk.gasto)}).`);
  } else {
    L.push("\nAún no hay cortes de caja cargados, así que no hay cifras de venta.");
  }

  // Gastos fijos
  const gf = store.gastoFijoMensual();
  if (gf > 0) L.push(`\nGastos fijos: ${money(gf)} al mes (aprox ${money(gf / 30 * 7)} por semana).`);

  // Más vendidos del periodo más reciente
  const prod = store.state.productos || [];
  if (prod.length) {
    const pmap = new Map();
    for (const p of prod) if (!pmap.has(p.periodo)) pmap.set(p.periodo, p.desde);
    const per = [...pmap.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1))[0];
    const periodo = per && per[0];
    const agg = new Map();
    for (const p of prod) {
      if (p.periodo !== periodo) continue;
      const a = agg.get(p.producto) || { u: 0, v: 0 };
      a.u += store.num(p.cantidad); a.v += store.num(p.venta);
      agg.set(p.producto, a);
    }
    const top = [...agg.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 6);
    if (top.length) {
      L.push(`\nMÁS VENDIDOS (${periodo}):`);
      for (const [n, a] of top) L.push(`- ${n}: ${Math.round(a.u)} vendidos, ${money(a.v)}`);
    }
  }

  // Insumos: dónde más gastas y qué subió
  const ins = store.preciosPorInsumo();
  if (ins.length) {
    const masGasto = ins
      .map((i) => ({ n: i.nombre, g: (i.registros || []).reduce((s, r) => s + store.num(r.monto), 0) }))
      .sort((a, b) => b.g - a.g).slice(0, 5);
    if (masGasto.length) {
      L.push("\nINSUMOS DONDE MÁS GASTAS:");
      for (const i of masGasto) L.push(`- ${i.n}: ${money(i.g)}`);
    }
    const subio = ins.filter((i) => i.veces >= 2 && i.cambio >= 1)
      .sort((a, b) => b.cambio - a.cambio).slice(0, 4);
    if (subio.length) {
      L.push("\nINSUMOS QUE SUBIERON DE PRECIO:");
      for (const i of subio) L.push(`- ${i.n}: +${money(i.cambio)} (ahora ${money(i.precioActual)}${i.unidad ? "/" + i.unidad : ""})`);
    }
  }

  return L.join("\n");
}
