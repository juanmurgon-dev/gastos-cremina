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

const VISTAS = {
  inicio:      { mod: inicio,      ic: "🏠", txt: "Inicio" },
  proyeccion:  { mod: proyeccion,  ic: "📈", txt: "Proyec." },
  capturar:    { mod: capturar,    ic: "📸", txt: "Capturar" },
  tickets:     { mod: tickets,     ic: "🧾", txt: "Tickets" },
  reportes:    { mod: reportes,    ic: "📊", txt: "Gastos" },
  ventas:      { mod: ventas,      ic: "💵", txt: "Ventas" },
  insumos:     { mod: insumos,     ic: "📦", txt: "Insumos" }
};

const app = document.getElementById("app");
let limpiarVista = null;    // cleanup de la vista actual
let usuarioActual = null;
let shellMontado = false;

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
        </div>
      </header>
      <main class="vista" id="vista"></main>
      <nav class="tabs" id="tabs"></nav>
    </div>`;

  document.getElementById("salir").addEventListener("click", () => supabase.auth.signOut());

  const tabs = document.getElementById("tabs");
  tabs.innerHTML = Object.entries(VISTAS).map(([k, v]) =>
    `<a href="#/${k}" data-k="${k}"><span class="ic">${v.ic}</span>${v.txt}</a>`).join("");

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

  document.querySelectorAll("#tabs a").forEach((a) =>
    a.classList.toggle("activo", a.dataset.k === clave));

  if (typeof limpiarVista === "function") { try { limpiarVista(); } catch (e) {} }
  vistaEl.innerHTML = "";
  window.scrollTo(0, 0);
  limpiarVista = VISTAS[clave].mod.render(vistaEl, { user: usuarioActual }) || null;
}

// Registrar el service worker (hace la app instalable y de arranque rápido)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
