// ─────────────────────────────────────────────────────────────
//  Arranque de la app: login, navegación y montaje de pantallas.
// ─────────────────────────────────────────────────────────────
import { supabase } from "./supabase-init.js";
import * as store from "./store.js";

import * as inicio from "./views/inicio.js";
import * as capturar from "./views/capturar.js";
import * as tickets from "./views/tickets.js";
import * as reportes from "./views/reportes.js";
import * as ventas from "./views/ventas.js";
import * as insumos from "./views/insumos.js";
import * as proyeccion from "./views/proyeccion.js";
import * as requisicion from "./views/requisicion.js";

// ⬇⬇ Al publicar una versión nueva: sube ESTE número y el CACHE en sw.js.
export const APP_VERSION = "v3.2";
export const APP_FECHA = "15 jul 2026";

const VISTAS = {
  inicio:      { mod: inicio,      ic: "🏠", txt: "Inicio" },
  proyeccion:  { mod: proyeccion,  ic: "📈", txt: "Proyec." },
  capturar:    { mod: capturar,    ic: "📸", txt: "Capturar" },
  tickets:     { mod: tickets,     ic: "🧾", txt: "Tickets" },
  reportes:    { mod: reportes,    ic: "📊", txt: "Gastos" },
  ventas:      { mod: ventas,      ic: "💵", txt: "Ventas" },
  insumos:     { mod: insumos,     ic: "📦", txt: "Insumos" },
  requisicion: { mod: requisicion, ic: "🛒", txt: "Requis." }
};

const app = document.getElementById("app");
let limpiarVista = null;    // cleanup de la vista actual
let usuarioActual = null;
let shellMontado = false;
let rutaActual = null;      // clave de la vista montada (evita render doble)

// ── Sesión ──────────────────────────────────────────────────
supabase.auth.getSession().then(({ data }) => aplicarSesion(data.session));
supabase.auth.onAuthStateChange((_event, session) => aplicarSesion(session));

function aplicarSesion(session) {
  const user = session?.user || null;
  usuarioActual = user;
  if (user) {
    store.init();
    if (!shellMontado) montarShell(user);
  } else {
    shellMontado = false;
    montarLogin();
  }
}

function montarLogin() {
  app.innerHTML = `
    <div class="login">
      <div class="card">
        <div class="logo-banner"><img src="assets/cremina-wordmark.png" alt="Cremina Bistro & Café" /></div>
        <p class="sub" style="margin-top:2px">Control de gastos</p>
        <div id="err"></div>
        <form id="f" style="margin-top:16px;text-align:left">
          <label class="campo"><span>Correo</span>
            <input id="correo" type="email" autocomplete="username" required inputmode="email" /></label>
          <label class="campo"><span>Contraseña</span>
            <input id="pass" type="password" autocomplete="current-password" required /></label>
          <button class="btn" id="entrar" type="submit">Entrar</button>
        </form>
      </div>
    </div>`;

  const f = document.getElementById("f");
  const err = document.getElementById("err");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("entrar");
    btn.disabled = true; btn.textContent = "Entrando…"; err.innerHTML = "";
    const { error } = await supabase.auth.signInWithPassword({
      email: document.getElementById("correo").value.trim(),
      password: document.getElementById("pass").value
    });
    if (error) {
      err.innerHTML = `<div class="error-box">Correo o contraseña incorrectos.</div>`;
      btn.disabled = false; btn.textContent = "Entrar";
    }
  });
}

function montarShell(user) {
  shellMontado = true;
  app.innerHTML = `
    <div class="shell">
      <header class="top">
        <img class="logo-img" src="assets/cremina-wordmark.png" alt="Cremina" />
        <div style="text-align:right">
          <div class="quien">${user.email}</div>
          <button class="linkbtn" id="salir">Salir</button>
          <button class="linkbtn" id="ver" title="Tocar para buscar actualización"
            style="display:block;font-size:10px;color:var(--gris);margin-top:2px">${APP_VERSION} · ${APP_FECHA}</button>
        </div>
      </header>
      <main class="vista" id="vista"></main>
      <nav class="tabs" id="tabs"></nav>
    </div>`;

  document.getElementById("salir").addEventListener("click", () => supabase.auth.signOut());
  const verBtn = document.getElementById("ver");
  if (verBtn) verBtn.addEventListener("click", buscarActualizacion);

  const tabs = document.getElementById("tabs");
  tabs.innerHTML = Object.entries(VISTAS).map(([k, v]) =>
    `<a href="#/${k}" data-k="${k}"><span class="ic">${v.ic}</span>${v.txt}</a>`).join("");

  // Navegar al tocar la pestaña, sin depender solo de hashchange (que a veces
  // no dispara en la PWA instalada de iOS).
  tabs.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-k]");
    if (!a) return;
    e.preventDefault();
    if (location.hash !== "#/" + a.dataset.k) location.hash = "#/" + a.dataset.k;
    ruta();
  });

  window.addEventListener("hashchange", ruta);
  ruta();

  // Pedir el nombre la primera vez (para saber quién hace cada cosa).
  let nombrePedido = false;
  store.subscribe(() => {
    if (store.state.perfil.cargado && !store.state.perfil.nombre && !nombrePedido) {
      nombrePedido = true;
      pedirNombre();
    }
  });
}

function pedirNombre() {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `
    <div class="modal">
      <h2>¿Cómo te llamas?</h2>
      <p class="sub" style="margin-top:0">Tu nombre aparecerá en los tickets que registres o corrijas.</p>
      <input id="nom" placeholder="Ej. Andrés Murillo" />
      <button class="btn" id="ok" style="margin-top:12px">Guardar</button>
    </div>`;
  document.body.appendChild(bg);
  const input = bg.querySelector("#nom");
  input.focus();
  bg.querySelector("#ok").addEventListener("click", async () => {
    const nombre = input.value.trim();
    if (!nombre) return;
    try { await store.guardarPerfil(nombre); bg.remove(); }
    catch (e) { alert("No pude guardar el nombre: " + ((e && e.message) || e)); }
  });
}

function ruta() {
  const vistaEl = document.getElementById("vista");
  if (!vistaEl) return;
  let clave = (location.hash.replace("#/", "") || "inicio");
  if (!VISTAS[clave]) clave = "inicio";

  // Ya estamos en esa vista: no re-render (evita el doble click+hashchange).
  if (clave === rutaActual && vistaEl.childElementCount > 0) return;
  rutaActual = clave;

  document.querySelectorAll("#tabs a").forEach((a) =>
    a.classList.toggle("activo", a.dataset.k === clave));

  if (typeof limpiarVista === "function") { try { limpiarVista(); } catch (e) {} }
  vistaEl.innerHTML = "";
  window.scrollTo(0, 0);
  limpiarVista = VISTAS[clave].mod.render(vistaEl, { user: usuarioActual }) || null;
}

// ── Service worker + actualización sin reinstalar ──────────────
let swReg = null;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      swReg = await navigator.serviceWorker.register("sw.js");

      // ¿Ya hay una versión nueva esperando de una visita anterior?
      if (swReg.waiting && navigator.serviceWorker.controller) bannerActualizar();

      // Se detectó una versión nueva mientras la app está abierta.
      swReg.addEventListener("updatefound", () => {
        const nuevo = swReg.installing;
        if (!nuevo) return;
        nuevo.addEventListener("statechange", () => {
          if (nuevo.state === "installed" && navigator.serviceWorker.controller) bannerActualizar();
        });
      });
    } catch (e) { /* sin SW no pasa nada, la app igual funciona */ }
  });

  // Al volver a primer plano (reabrir la app instalada), revisa si hay update.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && swReg) swReg.update().catch(() => {});
  });

  // Cuando el SW nuevo toma control, recarga una sola vez para ver lo nuevo.
  let recargando = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (recargando) return;
    recargando = true;
    location.reload();
  });
}

// Botón/etiqueta de versión: buscar actualización a mano.
async function buscarActualizacion() {
  const v = document.getElementById("ver");
  if (!swReg) { if (v) v.textContent = "sin conexión"; return; }
  const original = v ? v.textContent : "";
  if (v) v.textContent = "buscando…";
  try { await swReg.update(); } catch (e) {}
  // updatefound (si hay algo nuevo) ya mostró el banner; si no, avisa "al día".
  setTimeout(() => {
    if (!v) return;
    if (swReg.waiting || swReg.installing) v.textContent = original;
    else { v.textContent = "✓ al día"; setTimeout(() => { v.textContent = original; }, 1600); }
  }, 1200);
}

// Barra fija abajo: "Hay una versión nueva → Actualizar".
function bannerActualizar() {
  if (document.getElementById("update-bar")) return;
  const bar = document.createElement("div");
  bar.id = "update-bar";
  bar.style.cssText =
    "position:fixed;left:12px;right:12px;bottom:76px;z-index:9999;background:var(--verde,#0e3a39);" +
    "color:#fff;border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:12px;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.25);font-size:14px";
  bar.innerHTML =
    `<span style="flex:1">✨ Hay una versión nueva de la app</span>
     <button id="upd-btn" style="background:#fff;color:var(--verde,#0e3a39);border:none;border-radius:8px;
       padding:8px 14px;font-weight:700;cursor:pointer">Actualizar</button>`;
  document.body.appendChild(bar);
  document.getElementById("upd-btn").addEventListener("click", () => {
    const w = swReg && swReg.waiting;
    if (w) w.postMessage("SKIP_WAITING");   // el SW hace skipWaiting → controllerchange → reload
    else location.reload();
  });
}
