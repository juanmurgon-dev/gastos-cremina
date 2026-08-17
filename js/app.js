// ─────────────────────────────────────────────────────────────
//  Arranque de la app: login, navegación y montaje de pantallas.
// ─────────────────────────────────────────────────────────────
import { supabase, ENV } from "./supabase-init.js";
import * as store from "./store.js";
import * as marca from "./marca.js";
import * as preferencias from "./preferencias.js";
import * as proveedores from "./proveedores.js";
import * as onboarding from "./onboarding.js";

import * as inicio from "./views/inicio.js";
import * as reportes from "./views/reportes.js";
import * as ventasHub from "./views/ventas-hub.js";   // Ventas · Margen · Recetas
import * as insumos from "./views/insumos.js";        // + Requisición adentro
import * as inventario from "./views/inventario.js";
import * as capacitacion from "./views/capacitacion.js";

// ⬇⬇ Al publicar una versión nueva: sube ESTE número y el CACHE en sw.js.
export const APP_VERSION = "v3.185";
export const APP_FECHA = "17 ago 2026";

const VISTAS = {
  inicio:      { mod: inicio,      ic: "🏠", txt: "Inicio" },
  ventas:      { mod: ventasHub,   ic: "💵", txt: "Ventas" },
  insumos:     { mod: insumos,     ic: "📦", txt: "Insumos" },
  inventario:  { mod: inventario,  ic: "📋", txt: "Inventario" },
  reportes:    { mod: reportes,    ic: "📊", txt: "Gastos" },
  equipo:      { mod: capacitacion, ic: "🎓", txt: "Equipo" }
};

// Pestañas visibles por rol. Los que NO están aquí (owner, admin, gerente) ven
// TODAS. En single-tenant (miRol=null) también ven todas.
// (Recetas vive en Ventas; Requisición vive en Insumos.)
//
// barista y ayudante: SOLO su requisición y su conteo. Sin Inicio, porque el
// tablero de Inicio muestra venta, utilidad y alertas de margen.
// Esto es cosmético: el candado real es la RLS (supabase/roles-candados.sql).
const TABS_ROL = {
  // Giselle e Iván (chef) sí ven Equipo: son quienes evalúan en piso.
  chef:     ["inicio", "ventas", "insumos", "inventario", "equipo"],
  compras:  ["inicio", "insumos", "inventario"],
  staff:    ["inicio", "insumos", "inventario"],
  barista:  ["insumos", "inventario"],
  ayudante: ["insumos", "inventario"],
};
function tabsPermitidas() {
  const permit = TABS_ROL[store.state.miRol];
  return Object.keys(VISTAS).filter((k) => !permit || permit.includes(k));
}
function puedeVer(clave) {
  const permit = TABS_ROL[store.state.miRol];
  return !permit || permit.includes(clave);
}
// Primera pestaña que sí puede ver (para roles que no tienen Inicio).
function vistaInicial() { return tabsPermitidas()[0] || "inicio"; }

// Usuarios sin correo real: en el equipo de piso (barista, ayudante) nadie
// quiere teclear un correo. Escriben "alexis" y aquí se le pega el dominio,
// porque Supabase necesita algo con forma de correo. El buzón no existe ni
// hace falta: las cuentas se crean con "Auto Confirm User" y nunca se manda
// un mail. Quien sí tiene correo real lo escribe completo y pasa igual.
// ⬇ Cambia esta línea si el restaurante usa otro dominio.
const DOMINIO_INTERNO = "creminamx.com";
function aCorreo(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "";
  return s.includes("@") ? s : s + "@" + DOMINIO_INTERNO;
}

const app = document.getElementById("app");
let limpiarVista = null;    // cleanup de la vista actual
let usuarioActual = null;
let shellMontado = false;
let rutaActual = null;      // clave de la vista montada (evita render doble)

// ── Sesión ──────────────────────────────────────────────────
supabase.auth.getSession().then(({ data }) => aplicarSesion(data.session));
supabase.auth.onAuthStateChange((_event, session) => aplicarSesion(session));

// Id de la persona que estaba en esta pestaña, para detectar un cambio de cuenta.
let usuarioPrevio = null;

function aplicarSesion(session) {
  const user = session?.user || null;

  // Cambió la persona (o se cerró sesión) sin recargar la página. El estado en
  // memoria sigue siendo del anterior — su rol, sus tickets, todo — porque
  // store.init() no vuelve a correr una vez arrancado. Sin esto, cierras sesión
  // como el barista, entras como dueño, y la app te deja con el rol del barista.
  // Recargar es la forma segura de arrancar limpio.
  if (usuarioPrevio && user?.id !== usuarioPrevio) { location.reload(); return; }
  if (user) usuarioPrevio = user.id;

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
        <img src="assets/platify-wordmark.png" alt="Platify" style="height:46px;width:auto;display:block;margin:2px auto 0" />
        <p class="sub" style="margin-top:2px">Del plato a la boca se cae el margen</p>
        <div id="err"></div>
        <form id="f" style="margin-top:16px;text-align:left">
          <label class="campo"><span>Usuario</span>
            <input id="correo" type="text" autocomplete="username" required
                   autocapitalize="none" autocorrect="off" spellcheck="false"
                   placeholder="tu nombre de usuario" /></label>
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
      email: aCorreo(document.getElementById("correo").value),
      password: document.getElementById("pass").value
    });
    if (error) {
      err.innerHTML = `<div class="error-box">Usuario o contraseña incorrectos.</div>`;
      btn.disabled = false; btn.textContent = "Entrar";
    }
  });
}

function montarShell(user) {
  shellMontado = true;
  app.innerHTML = `
    <div class="shell">
      <header class="top">
        <span id="marca" style="cursor:pointer" title="Personalizar tu marca"><img src="assets/platify-wordmark.png" alt="Platify" style="height:20px;width:auto;display:block" /></span>
        <button class="hamb" id="menu" aria-label="Ajustes" title="Ajustes">☰</button>
      </header>
      <main class="vista" id="vista"></main>
      <nav class="tabs" id="tabs"></nav>
    </div>`;

  const menuBtn = document.getElementById("menu");
  if (menuBtn) menuBtn.addEventListener("click", abrirMenu);
  const marcaEl = document.getElementById("marca");
  if (marcaEl) marcaEl.addEventListener("click", () => {
    if (!store.state.multiTenant || store.state.miRol === "owner") marca.abrirPersonalizar();
  });

  const tabs = document.getElementById("tabs");
  pintarTabs();

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

  // Onboarding: si la BD es multi-tenant y el usuario aún no tiene restaurante,
  // pídelo antes que nada. Luego, el nombre de la persona.
  let orgPedida = false, nombrePedido = false, rolPintado = "__none__", aperturaLog = false;
  let cargadoPintado = false;
  store.subscribe(() => {
    if (store.state.listo && !aperturaLog) { aperturaLog = true; store.logActividad && store.logActividad("apertura"); }
    // Cuando ya se conoce el rol, ajusta las pestañas visibles.
    if (store.state.miRol !== rolPintado || store.state.rolCargado !== cargadoPintado) {
      rolPintado = store.state.miRol;
      cargadoPintado = store.state.rolCargado;
      pintarTabs();
      if (!puedeVer(location.hash.replace("#/", "").split("?")[0] || "inicio")) {
        location.hash = "#/" + vistaInicial();
      } else {
        // El rol llega DESPUÉS del primer render (la consulta es asíncrona), así
        // que la vista de abajo se dibujó sin saber quién eres. Hay que rehacerla:
        // si no, un barista que cayó en Insumos se queda con la versión completa,
        // con precios y todo, hasta que cambie de pestaña.
        rutaActual = null;
        ruta();
      }
    }
    // White-label: logo + nombre del restaurante en el header y en el ícono.
    marca.aplicarMarcaActual();
    actualizarBadgeRequis();
    // Usuario autenticado pero SIN rol asignado. Antes aquí se abría el
    // asistente de "crea tu restaurante", y estaba mal: hoy nadie se registra
    // solo — las cuentas las crea dirección desde Supabase. Así que quien cae
    // aquí no es un cliente nuevo, es alguien a quien le falta su rol (o cuya
    // cuenta ya se dio de baja y le quedaba la sesión viva). Mandarlo al
    // onboarding le creaba un restaurante nuevo y vacío, y partía los datos.
    // Cuando existan registros públicos, aquí vuelve onboarding.abrir().
    if (store.state.listo && store.state.multiTenant && !store.state.orgId && !orgPedida) {
      orgPedida = true;
      pantallaSinAcceso();
      return;
    }
    if (store.state.perfil.cargado && !store.state.perfil.nombre && !nombrePedido) {
      nombrePedido = true;
      pedirNombre();
    }
  });
}

function escaparHtml(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// Con qué rol estás conectado, junto al correo en el menú ☰. Suena a detalle,
// pero el navegador guarda UNA sola sesión: si entras con otra cuenta sin
// cerrar la anterior, sigues siendo el de antes. Verlo aquí evita horas de
// "juraría que entré como el barista y ve todo".
function etiquetaRol() {
  if (!store.state.multiTenant) return "";
  const rol = store.state.miRol;
  if (!rol) return ` · <b style="color:var(--rojo,#b3261e)">sin rol asignado</b>`;
  const area = store.state.miArea ? " · " + store.state.miArea : "";
  return ` · <b>${escaparHtml(rol + area)}</b>`;
}

// Menú ☰ → Ajustes: personalizar marca, actualizar, cerrar sesión.
function abrirMenu() {
  const puedePersonalizar = !store.state.multiTenant || store.state.miRol === "owner";
  const badge = ENV === "staging" ? "🧪 STAGING · " : "";
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `
    <div class="modal">
      <h2>Ajustes</h2>
      <div class="sub" style="margin:-8px 2px 14px;word-break:break-all">
        ${escaparHtml(usuarioActual?.email || "")}${etiquetaRol()}
      </div>
      <div class="menu-lista">
        ${puedePersonalizar ? `<button class="menu-item" data-a="marca"><span class="mi-ic">🎨</span><span class="mi-tx"><b>Personalizar marca</b><span class="sub">Cambiar logo y nombre del restaurante</span></span></button>` : ""}
        ${puedePersonalizar ? `<button class="menu-item" data-a="prefs"><span class="mi-ic">⚙️</span><span class="mi-tx"><b>Preferencias</b><span class="sub">Cómo ves los datos de tu restaurante</span></span></button>` : ""}
        <button class="menu-item" data-a="prov"><span class="mi-ic">🏪</span><span class="mi-tx"><b>Unificar proveedores</b><span class="sub">Juntar los que son el mismo</span></span></button>
        <button class="menu-item" data-a="update"><span class="mi-ic">🔄</span><span class="mi-tx"><b>Buscar actualización</b><span class="sub">${badge}${APP_VERSION} · ${APP_FECHA}</span></span></button>
        <button class="menu-item" data-a="salir"><span class="mi-ic">🚪</span><span class="mi-tx"><b>Cerrar sesión</b></span></button>
      </div>
      <button class="btn sec" data-cerrar style="margin-top:14px">Cerrar</button>
    </div>`;
  document.body.appendChild(bg);
  const cerrar = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
  bg.querySelector("[data-cerrar]").addEventListener("click", cerrar);
  bg.querySelectorAll(".menu-item").forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.a;
    cerrar();
    if (a === "marca") marca.abrirPersonalizar();
    else if (a === "prefs") preferencias.abrirPreferencias();
    else if (a === "prov") proveedores.abrirProveedores();
    else if (a === "update") buscarActualizacion();
    else if (a === "salir") supabase.auth.signOut();
  }));
}

function pintarTabs() {
  const tabs = document.getElementById("tabs");
  if (!tabs) return;
  // Sin rol conocido no se pintan pestañas: pintarlas mostraría las cinco a
  // todo el mundo por un instante, incluido quien solo debe ver dos.
  if (!store.state.rolCargado) { tabs.innerHTML = ""; return; }
  tabs.innerHTML = tabsPermitidas().map((k) => {
    const v = VISTAS[k];
    const badge = k === "insumos" ? `<span class="tab-badge" data-badge="requisicion" hidden></span>` : "";
    return `<a href="#/${k}" data-k="${k}"><span class="ic">${v.ic}</span>${v.txt}${badge}</a>`;
  }).join("");
  const clave = (location.hash.replace("#/", "") || "inicio");
  tabs.querySelectorAll("a").forEach((a) => a.classList.toggle("activo", a.dataset.k === clave));
  actualizarBadgeRequis();
}

// Badge rojo con el número de items pendientes (no comprados) de las requisiciones abiertas.
function actualizarBadgeRequis() {
  const b = document.querySelector('.tab-badge[data-badge="requisicion"]');
  if (!b) return;
  const n = store.itemsPendientesRequis ? store.itemsPendientesRequis() : 0;
  if (n > 0) { b.textContent = n > 99 ? "99+" : String(n); b.hidden = false; }
  else { b.textContent = ""; b.hidden = true; }
}

// Cuenta sin rol: en vez de dejarlo en una app vacía (o peor, en el asistente
// de restaurante nuevo), se le dice qué pasa y con quién ir. El botón de salir
// es lo importante: así puede entrar con la cuenta correcta.
function pantallaSinAcceso() {
  app.innerHTML = `
    <div class="login">
      <div class="card">
        <img src="assets/platify-wordmark.png" alt="Platify" style="height:46px;width:auto;display:block;margin:2px auto 12px" />
        <h2 style="margin:0 0 6px">Tu cuenta todavía no tiene acceso</h2>
        <p class="sub" style="margin-top:0">
          Entraste como <b>${escaparHtml(usuarioActual?.email || "")}</b>, pero esa cuenta
          no tiene un rol asignado en el restaurante.
        </p>
        <p class="sub">
          Si es tu primer día, pídele a dirección que te dé de alta. Si te equivocaste
          de cuenta, sal y entra con la tuya.
        </p>
        <button class="btn" id="salir-sin-acceso" style="margin-top:14px">Cerrar sesión</button>
      </div>
    </div>`;
  const b = document.getElementById("salir-sin-acceso");
  if (b) b.addEventListener("click", async () => {
    b.disabled = true; b.textContent = "Saliendo…";
    await supabase.auth.signOut();
    location.reload();
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

  // Todavía no sabemos el rol (la consulta a `miembros` es asíncrona). No se
  // dibuja NADA: montar una vista aquí significaría elegir qué enseñar sin
  // saber a quién. En cuanto llega el rol, el subscribe de abajo llama a ruta()
  // otra vez y se pinta lo que corresponde.
  if (!store.state.rolCargado) {
    vistaEl.innerHTML = `<div class="vacio">Cargando…</div>`;
    rutaActual = null;
    return;
  }
  // "#/tickets?t=<id>" sigue siendo la vista "tickets": lo de después del ?
  // es para que la vista abra algo en concreto (ej. un ticket a corregir).
  let clave = (location.hash.replace("#/", "").split("?")[0] || vistaInicial());
  if (!VISTAS[clave]) clave = vistaInicial();
  if (!puedeVer(clave)) clave = vistaInicial();   // rol sin acceso → su 1ª pestaña

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
