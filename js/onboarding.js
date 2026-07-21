// Onboarding para clientes nuevos (multi-tenant): da la bienvenida, crea su
// espacio y calibra su "pulso" (meta de costo, venta y fijos) para que Pulsify
// muestre metas y punto de equilibrio desde el primer día.
import * as store from "./store.js";

const TIPOS = ["Restaurante", "Cafetería", "Bar", "Food truck", "Otro"];
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function abrir() {
  const d = { nombre: "", tipo: "", persona: "", costoMeta: 30, ventaSem: "", fijos: "" };
  let paso = 1;
  const total = 3;
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  document.body.appendChild(bg);
  render();

  function sync() {
    const g = (id) => { const e = bg.querySelector("#" + id); return e ? e.value : undefined; };
    let v;
    if ((v = g("f_nombre")) !== undefined) d.nombre = v;
    if ((v = g("f_persona")) !== undefined) d.persona = v;
    if ((v = g("f_costo")) !== undefined) d.costoMeta = v;
    if ((v = g("f_venta")) !== undefined) d.ventaSem = v;
    if ((v = g("f_fijos")) !== undefined) d.fijos = v;
  }

  function render() {
    bg.innerHTML = `<div class="modal">
      <div class="sub" style="font-size:11px;letter-spacing:.12em;text-transform:uppercase">Paso ${paso} de ${total}</div>
      <div style="height:5px;background:var(--gris-claro);border-radius:999px;margin:8px 0 16px;overflow:hidden">
        <div style="height:100%;width:${Math.round(paso / total * 100)}%;background:var(--naranja);border-radius:999px;transition:width .2s"></div>
      </div>
      ${paso === 1 ? pasoNegocio() : paso === 2 ? pasoPersona() : pasoPulso()}
      <div class="fila" style="margin-top:18px;gap:8px">
        ${paso > 1 ? `<button class="btn sec" id="atras" style="flex:1">Atrás</button>` : ""}
        <button class="btn" id="next" style="flex:2">${paso < total ? "Siguiente" : "💓 Empezar a medir mi pulso"}</button>
      </div>
      <div id="oerr"></div>
    </div>`;

    bg.querySelectorAll("[data-tipo]").forEach((b) => b.addEventListener("click", () => { sync(); d.tipo = b.dataset.tipo; render(); }));
    const at = bg.querySelector("#atras");
    if (at) at.addEventListener("click", () => { sync(); paso--; render(); });
    bg.querySelector("#next").addEventListener("click", siguiente);
    const first = bg.querySelector("input"); if (first) first.focus();
  }

  function pasoNegocio() {
    return `
      <h2 style="margin-bottom:4px">💓 Bienvenido a Pulsify</h2>
      <p class="sub" style="margin-top:0">Cuéntanos de tu negocio para medir su pulso. Solo tú y tu equipo verán sus datos.</p>
      <label class="campo" style="margin-top:8px"><span>¿Cómo se llama tu negocio?</span>
        <input id="f_nombre" value="${esc(d.nombre)}" placeholder="Ej. Cremina Café" /></label>
      <label class="campo" style="margin-bottom:6px"><span>¿Qué tipo de negocio es?</span></label>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${TIPOS.map((t) => `<button type="button" data-tipo="${esc(t)}" class="btn sec chico" style="width:auto${t === d.tipo ? ";background:var(--naranja);color:#3a2500;border-color:transparent" : ""}">${esc(t)}</button>`).join("")}
      </div>`;
  }

  function pasoPersona() {
    return `
      <h2 style="margin-bottom:4px">¿Quién eres?</h2>
      <p class="sub" style="margin-top:0">Tu nombre aparece en los movimientos que registres. Serás el dueño de este espacio.</p>
      <label class="campo" style="margin-top:8px"><span>Tu nombre</span>
        <input id="f_persona" value="${esc(d.persona)}" placeholder="Ej. Juan Murillo" /></label>`;
  }

  function pasoPulso() {
    return `
      <h2 style="margin-bottom:4px">Calibra tu pulso</h2>
      <p class="sub" style="margin-top:0">Con esto Pulsify te da tu meta y punto de equilibrio desde el día 1. Son aproximados; puedes ajustarlos después.</p>
      <label class="campo" style="margin-top:8px"><span>Meta de costo de insumos (% de la venta)</span>
        <input id="f_costo" type="number" inputmode="decimal" value="${esc(d.costoMeta)}" /></label>
      <label class="campo"><span>Venta promedio por semana (aprox, MXN)</span>
        <input id="f_venta" type="number" inputmode="decimal" value="${esc(d.ventaSem)}" placeholder="Ej. 60000" /></label>
      <label class="campo"><span>Gastos fijos al mes (aprox, MXN)</span>
        <input id="f_fijos" type="number" inputmode="decimal" value="${esc(d.fijos)}" placeholder="Ej. 80000" /></label>`;
  }

  function siguiente() {
    sync();
    const err = bg.querySelector("#oerr");
    if (paso === 1) {
      if (!d.nombre.trim()) { err.innerHTML = `<div class="aviso-box" style="margin-top:10px">Escribe el nombre de tu negocio.</div>`; return; }
      paso = 2; render(); return;
    }
    if (paso === 2) {
      if (!d.persona.trim()) { err.innerHTML = `<div class="aviso-box" style="margin-top:10px">Escribe tu nombre.</div>`; return; }
      paso = 3; render(); return;
    }
    finalizar();
  }

  async function finalizar() {
    const btn = bg.querySelector("#next");
    btn.disabled = true; btn.textContent = "Creando tu espacio…";
    try {
      await store.crearOrg(d.nombre.trim());
      const costo = store.num(d.costoMeta);
      const vs = store.num(d.ventaSem);
      const fj = store.num(d.fijos);
      const cfg = { negocio: { tipo: d.tipo || "", ventaSemanalAprox: vs || 0, gastosFijosAprox: fj || 0 } };
      if (costo > 0) cfg.costoVarPct = costo;
      if (vs > 0 && costo > 0) { cfg.presupuestoSemanal = Math.round(vs * costo / 100); cfg.metaBase = Math.round(vs * costo / 100); }
      try { await store.guardarConfig(cfg); } catch (e) {}
      if (fj > 0) { try { await store.guardarGastoFijo({ concepto: "Gastos fijos (estimado — edítalo)", monto_mensual: fj }); } catch (e) {} }
      try { await store.guardarPerfil(d.persona.trim()); } catch (e) {}
      location.reload();   // recarga limpia ya con el espacio nuevo
    } catch (e) {
      bg.querySelector("#oerr").innerHTML = `<div class="error-box" style="margin-top:10px">No pude crear tu espacio: ${esc((e && e.message) || e)}</div>`;
      btn.disabled = false; btn.textContent = "💓 Empezar a medir mi pulso";
    }
  }
}
