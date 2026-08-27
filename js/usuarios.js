// Equipo y accesos: dar de alta gente, cambiarle el puesto y quitarle
// el acceso, sin entrar a Supabase.
//
// Todo el trabajo real pasa en la Edge Function `gestionar-usuarios`,
// porque crear una cuenta necesita la llave de administrador y esa
// llave no puede vivir en el navegador. Aquí solo se pide y se pinta.
//
// Esta pantalla es COMODIDAD, no seguridad. Aunque alguien la abriera
// a la fuerza, la función del servidor vuelve a preguntar quién es y
// si le toca. El candado de los datos sigue siendo la RLS.
import { supabase } from "./supabase-init.js";

// Puesto → qué ve y qué puede hacer. El texto es lo que lee el dueño
// cuando decide, así que dice consecuencias, no nombres técnicos.
const PUESTOS = [
  { id: "owner",    txt: "Dueño",          desc: "Todo, incluido repartir accesos" },
  { id: "admin",    txt: "Administrador",  desc: "Todo, incluido repartir accesos" },
  { id: "gerente",  txt: "Gerente",        desc: "Todo menos repartir accesos" },
  { id: "chef",     txt: "Chef",           desc: "Ventas, insumos e inventario" },
  { id: "compras",  txt: "Compras",        desc: "Insumos e inventario. Sin ventas" },
  { id: "barista",  txt: "Barista",        desc: "Solo requisición y conteo de barra", area: "barra" },
  { id: "ayudante", txt: "Ayudante cocina",desc: "Solo requisición y conteo de cocina", area: "cocina" },
  { id: "staff",    txt: "Staff",          desc: "Insumos e inventario. Sin números" },
];
const puestoDe = (id) => PUESTOS.find((p) => p.id === id) || { txt: id, desc: "" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let estado = { miembros: [], dominio: "", miRol: "", cargando: true, error: "" };

async function llamar(cuerpo) {
  const { data, error } = await supabase.functions.invoke("gestionar-usuarios", { body: cuerpo });
  if (error) {
    // La función manda el motivo en el cuerpo del error, no en el mensaje.
    let detalle = error.message || "error";
    if (error.context && typeof error.context.text === "function") {
      try { const b = JSON.parse(await error.context.text()); detalle = b.error || detalle; } catch (e) {}
    }
    throw new Error(detalle);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

export function abrirUsuarios() {
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  estado = { miembros: [], dominio: "", miRol: "", cargando: true, error: "" };
  bg.innerHTML = `<div class="modal" id="uModal">${pintar()}</div>`;
  document.body.appendChild(bg);
  const cerrar = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });

  const repintar = () => {
    bg.querySelector("#uModal").innerHTML = pintar();
    wire(bg, cerrar, repintar);
  };

  llamar({ accion: "listar" })
    .then((r) => { estado = { ...estado, ...r, cargando: false }; repintar(); })
    .catch((e) => {
      estado.cargando = false;
      estado.error = String(e.message || e);
      repintar();
    });

  wire(bg, cerrar, repintar);
}

function pintar() {
  if (estado.cargando) {
    return `<h2>Equipo y accesos</h2><div class="vacio">Cargando…</div>`;
  }
  if (estado.error) {
    // El error más probable en el primer uso es que la función no esté
    // instalada. Decirlo con su nombre ahorra media hora de adivinar.
    const falta = /not found|404|Failed to send|non-2xx/i.test(estado.error);
    return `<h2>Equipo y accesos</h2>
      <div class="error-box">${esc(estado.error)}</div>
      ${falta ? `<p class="sub">Parece que falta instalar la función del servidor.
        En Supabase → <b>Edge Functions</b> → <b>Create a function</b>, nómbrala exactamente
        <b>gestionar-usuarios</b>, pega el contenido de <b>supabase/gestionar-usuarios.ts</b> y dale Deploy.</p>` : ""}
      <button class="btn sec" data-cerrar style="margin-top:14px">Cerrar</button>`;
  }

  const dom = estado.dominio;
  return `
    <h2>Equipo y accesos</h2>
    <p class="sub" style="margin-top:0">Quién entra a la app y qué ve cada quien.
    ${dom ? `Tu equipo entra escribiendo solo su nombre — la app le pega <b>@${esc(dom)}</b>.` : ""}</p>

    ${estado.miRol === "owner" ? `
      <div class="titulo-seccion" style="margin-top:16px">Cómo entra tu equipo</div>
      <label class="campo"><span>Dominio de tu restaurante</span>
        <div class="fila" style="gap:8px">
          <input id="uDom" value="${esc(dom)}" placeholder="mirestaurante.com" autocapitalize="none" style="flex:1" />
          <button class="btn sec" id="uDomOk" style="width:auto;padding:0 14px">Guardar</button>
        </div>
        <span class="sub" style="font-size:11px">Con esto tu equipo entra escribiendo solo su nombre.
        El buzón no tiene que existir — nunca se manda un correo.
        ${dom ? "Cambiarlo <b>no</b> mueve las cuentas ya creadas." : ""}</span></label>` : ""}

    <div class="titulo-seccion" style="margin-top:16px">Tu equipo (${estado.miembros.length})</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
      ${estado.miembros.map(filaMiembro).join("") || `<div class="vacio">Todavía no hay nadie.</div>`}
    </div>

    <div class="titulo-seccion" style="margin-top:20px">Agregar a alguien</div>
    <label class="campo"><span>${dom ? "Usuario" : "Correo completo"}</span>
      <input id="nUsuario" placeholder="${dom ? "alexis" : "alguien@surestaurante.com"}" autocapitalize="none" />
      ${dom ? `<span class="sub" style="font-size:11px">Va a entrar como <b id="nPreview">…</b></span>` : ""}
    </label>
    <label class="campo"><span>Contraseña</span>
      <input id="nPass" placeholder="mínimo 6 caracteres" autocapitalize="none" />
      <span class="sub" style="font-size:11px">Se la das tú en persona. No se manda ningún correo.</span></label>
    <label class="campo"><span>Puesto</span><select id="nRol">
      ${PUESTOS.filter((p) => p.id !== "owner" || estado.miRol === "owner")
        .map((p) => `<option value="${p.id}"${p.id === "staff" ? " selected" : ""}>${esc(p.txt)} — ${esc(p.desc)}</option>`).join("")}
    </select></label>
    <button class="btn" id="nAdd">Agregar</button>
    <div id="uMsg"></div>

    <button class="btn sec" data-cerrar style="margin-top:16px">Cerrar</button>`;
}

function filaMiembro(m) {
  const p = puestoDe(m.rol);
  return `<div style="border:1px solid var(--linea);border-radius:10px;padding:10px 12px">
    <div style="display:flex;align-items:center;gap:8px">
      <b style="flex:1;min-width:0;word-break:break-all;font-size:13.5px">${esc(m.correo)}</b>
      ${m.soyYo ? `<span class="sub" style="font-size:11px;white-space:nowrap">tú</span>` : ""}
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap">
      <select data-rolde="${esc(m.usuario)}" style="flex:1;min-width:150px;font-size:12px">
        ${PUESTOS
          // El puesto que la persona YA tiene siempre aparece, aunque quien
          // mira no pueda otorgarlo. Si no, un administrador vería al dueño
          // marcado como otra cosa y lo degradaría sin darse cuenta.
          .filter((x) => x.id === m.rol || x.id !== "owner" || estado.miRol === "owner")
          .map((x) => `<option value="${x.id}"${x.id === m.rol ? " selected" : ""}>${esc(x.txt)}</option>`).join("")}
      </select>
      <button class="linkbtn" data-clave="${esc(m.usuario)}" style="font-size:11.5px">🔑 Clave</button>
      ${m.soyYo ? "" : `<button class="linkbtn" data-quitar="${esc(m.usuario)}" style="color:var(--rojo);font-size:11.5px">Quitar</button>`}
    </div>
    <div class="sub" style="font-size:11px;margin-top:4px">${esc(p.desc)}${m.area ? " · " + esc(m.area) : ""}</div>
  </div>`;
}

function wire(bg, cerrar, repintar) {
  const q = (s) => bg.querySelector(s);
  bg.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", cerrar));

  const msg = (t, malo) => {
    const n = q("#uMsg");
    if (n) n.innerHTML = t ? `<div class="${malo ? "error-box" : "aviso-box"}" style="margin-top:10px">${esc(t)}</div>` : "";
  };

  // Enseñar el correo que va a quedar, mientras escribe.
  const usu = q("#nUsuario"), prev = q("#nPreview");
  if (usu && prev) {
    const ver = () => {
      const v = (usu.value || "").trim().toLowerCase();
      prev.textContent = !v ? "…" : v.includes("@") ? v : v + "@" + estado.dominio;
    };
    usu.addEventListener("input", ver); ver();
  }

  const conBoton = async (btn, fn) => {
    const txt = btn.textContent;
    btn.disabled = true; btn.textContent = "…";
    try { await fn(); }
    catch (e) { msg(String(e.message || e), true); }
    finally { btn.disabled = false; btn.textContent = txt; }
  };

  const domOk = q("#uDomOk");
  if (domOk) domOk.addEventListener("click", () => conBoton(domOk, async () => {
    const r = await llamar({ accion: "dominio", dominio: q("#uDom").value });
    estado.dominio = r.dominio;
    estado.miembros = r.miembros;
    try { localStorage.setItem("platify.dominio", r.dominio); } catch (e) {}
    repintar();
  }));

  const add = q("#nAdd");
  if (add) add.addEventListener("click", () => conBoton(add, async () => {
    msg("");
    const rol = q("#nRol").value;
    const r = await llamar({
      accion: "crear",
      usuario: q("#nUsuario").value,
      password: q("#nPass").value,
      rol,
      area: puestoDe(rol).area || null,
    });
    estado.miembros = r.miembros;
    repintar();
    // El repintado borra el mensaje, así que va después.
    const n = bg.querySelector("#uMsg");
    if (n) n.innerHTML = `<div class="aviso-box" style="margin-top:10px">${r.reusada
      ? `Esa cuenta ya existía y le di acceso a este restaurante.`
      : `Listo. <b>${esc(r.correo)}</b> ya puede entrar con la contraseña que pusiste.`}</div>`;
  }));

  bg.querySelectorAll("[data-rolde]").forEach((s) => s.addEventListener("change", async () => {
    const rol = s.value;
    try {
      const r = await llamar({ accion: "cambiar", usuario_id: s.dataset.rolde, rol, area: puestoDe(rol).area || null });
      estado.miembros = r.miembros;
      repintar();
    } catch (e) { msg(String(e.message || e), true); repintar(); }
  }));

  bg.querySelectorAll("[data-quitar]").forEach((b) => b.addEventListener("click", () => conBoton(b, async () => {
    const m = estado.miembros.find((x) => x.usuario === b.dataset.quitar);
    if (!confirm(`¿Quitarle el acceso a ${m ? m.correo : "esta persona"}?\n\n`
      + `Deja de ver todo de inmediato. Lo que ya capturó — tickets, conteos, requisiciones — se queda.`)) return;
    const r = await llamar({ accion: "quitar", usuario_id: b.dataset.quitar });
    estado.miembros = r.miembros;
    repintar();
  })));

  bg.querySelectorAll("[data-clave]").forEach((b) => b.addEventListener("click", () => conBoton(b, async () => {
    const m = estado.miembros.find((x) => x.usuario === b.dataset.clave);
    const pass = prompt(`Nueva contraseña para ${m ? m.correo : "esta persona"} (mínimo 6):`);
    if (!pass) return;
    await llamar({ accion: "clave", usuario_id: b.dataset.clave, password: pass });
    alert("Contraseña cambiada. Dísela en persona.");
  })));
}
