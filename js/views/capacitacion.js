// Pantalla: Capacitación. Competencias por área, quiz y observación en piso.
//
// Cómo se usa de verdad: NADIE del equipo entra a la app. Giselle o Andrés
// abren esto en la tablet y lo pasan con la persona enfrente. Por eso el quiz
// pide primero "¿a quién estás evaluando?" y por eso las personas son
// registros, no cuentas.
//
// El nivel de cada quien NO se guarda: se calcula de sus intentos, sus
// observaciones y sus números reales. Una tabla espejo de "progreso" solo
// serviría para desincronizarse y enseñar algo que ya no es cierto.
import * as store from "../store.js";
import { num } from "../store.js";
import { metricasMeseros, rangoMeseros } from "./meseros.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NIVELES = ["bronce", "plata", "oro"];
const MEDALLA = { bronce: "🥉", plata: "🥈", oro: "🥇" };
const APROBAR = 0.7;   // 70% para pasar el quiz

export function render(el) {
  let sub = "tablero";
  let cargando = true;
  let datos = { personas: [], competencias: [], criterios: [], preguntas: [], intentos: [], practicas: [] };
  let quiz = null;      // examen en curso
  let obs = null;       // observación en curso

  cargar();
  pintar();

  async function cargar() {
    cargando = true; pintar();
    try {
      datos = await store.cargarCapacitacion();
      // Solo el mes en curso: es contra lo que se miden los KPIs de plata y
      // oro. Pedir la historia completa aquí sería la misma lentitud que se
      // acaba de quitar en Meseros.
      const r = rangoMeseros("mes");
      if (store.state.ordenesMeseroRango !== r.desde + "|" + r.hasta) {
        await store.cargarOrdenesMesero(r.desde, r.hasta);
      }
    } catch (e) { datos.error = (e && e.message) || String(e); }
    cargando = false; pintar();
  }

  // ── Nivel alcanzado, calculado ────────────────────────────────
  // Un nivel se gana con tres puertas: saber (quiz), hacer (observación) y
  // —si la competencia lo pide— demostrarlo en sus números.
  function nivelDe(persona, competencia) {
    let alcanzado = null;
    for (const nivel of NIVELES) {
      const preguntas = datos.preguntas.filter((p) => p.competencia_id === competencia.id && p.nivel === nivel && p.activa !== false);
      // Sin preguntas cargadas no hay nada que examinar: esa puerta no bloquea.
      // (Hoy plata y oro están así; en cuanto se escriban, empiezan a exigir.)
      const quizOk = !preguntas.length ||
        datos.intentos.some((i) => i.persona_id === persona.id && i.competencia_id === competencia.id && i.nivel === nivel && i.aprobado);
      const practicaOk = datos.practicas.some((p) => p.persona_id === persona.id && p.competencia_id === competencia.id && p.nivel === nivel && p.aprobado);
      const crit = datos.criterios.find((c) => c.competencia_id === competencia.id && c.nivel === nivel);
      const kpiOk = !crit || !crit.kpi || cumpleKpi(persona, crit.kpi);
      if (quizOk && practicaOk && kpiOk) alcanzado = nivel; else break;
    }
    return alcanzado;
  }

  // El KPI se mide contra el MES en curso, con el mismo cálculo del marcador.
  function cumpleKpi(persona, kpi) {
    if (!persona.nombre_parrot) return false;
    const r = rangoMeseros("mes");
    const { lista } = metricasMeseros(r.desde, r.hasta);
    const m = lista.find((x) => x.mesero === persona.nombre_parrot);
    if (!m) return false;
    return num(m[kpi.campo]) >= num(kpi.min);
  }
  function detalleKpi(persona, kpi) {
    if (!persona.nombre_parrot) return "sin nombre de Parrot";
    const r = rangoMeseros("mes");
    const m = metricasMeseros(r.desde, r.hasta).lista.find((x) => x.mesero === persona.nombre_parrot);
    if (!m) return "sin cuentas este mes";
    const v = num(m[kpi.campo]);
    return `${kpi.campo} ${v.toFixed(2)} de ${num(kpi.min).toFixed(2)}`;
  }

  // ── Pintado ───────────────────────────────────────────────────
  function pintar() {
    if (cargando) { el.innerHTML = `<div class="vacio">Cargando capacitación…</div>`; return; }
    if (datos.error) {
      el.innerHTML = `<div class="card"><h2 style="margin-top:0">Falta preparar la base</h2>
        <p class="sub">${esc(datos.error)}</p>
        <p class="sub">Corre <b>supabase/capacitacion.sql</b> y luego <b>capacitacion-preguntas-piso.sql</b>.</p></div>`;
      return;
    }
    if (quiz) return pintarQuiz();
    if (obs) return pintarObs();

    const tab = (k, t) => `<button data-t="${k}" class="btn sec chico" style="flex:1${k === sub ? ";background:var(--verde,#0e3a39);color:#fff;border-color:transparent" : ""}">${t}</button>`;
    el.innerHTML = `
      <div class="card" style="padding:10px"><div class="fila" style="gap:6px">
        ${tab("tablero", "Tablero")}${tab("evaluar", "Evaluar")}${tab("personas", "Personas")}
      </div></div>
      ${sub === "tablero" ? vistaTablero() : sub === "evaluar" ? vistaEvaluar() : vistaPersonas()}`;

    el.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => { sub = b.dataset.t; pintar(); });
    if (sub === "personas") wirePersonas();
    if (sub === "evaluar") wireEvaluar();
  }

  // ── TABLERO ───────────────────────────────────────────────────
  function vistaTablero() {
    if (!datos.personas.length) return avisoSinPersonas();
    const comps = datos.competencias.filter((c) => c.activa !== false);
    const areas = [...new Set(datos.personas.map((p) => p.area))];
    return areas.map((area) => {
      const gente = datos.personas.filter((p) => p.area === area && p.activo !== false);
      const cs = comps.filter((c) => c.area === area);
      if (!gente.length || !cs.length) return "";
      return `<div class="card">
        <h2 style="margin-top:0;text-transform:capitalize">${esc(area)}</h2>
        <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:${120 + cs.length * 90}px">
          <thead><tr>
            <th style="text-align:left;padding:6px 4px">Persona</th>
            ${cs.map((c) => `<th style="padding:6px 4px;font-size:11px;font-weight:600">${esc(c.nombre.split(" ").slice(0, 3).join(" "))}</th>`).join("")}
          </tr></thead>
          <tbody>${gente.map((p) => `<tr style="border-top:1px solid var(--linea)">
            <td style="padding:8px 4px">${esc(p.nombre)}<div class="sub" style="font-size:10.5px">${esc(p.puesto || "")}</div></td>
            ${cs.map((c) => {
              const n = nivelDe(p, c);
              return `<td style="padding:8px 4px;text-align:center;font-size:18px" title="${n ? esc(n) : "sin nivel"}">${n ? MEDALLA[n] : "—"}</td>`;
            }).join("")}
          </tr>`).join("")}</tbody>
        </table></div>
      </div>`;
    }).join("") + `<div class="card"><p class="sub" style="margin:0">
      Un nivel se gana con tres puertas: <b>saber</b> (quiz), <b>hacer</b> (observación en piso) y,
      donde aplica, <b>demostrarlo</b> en sus números de Parrot. El nivel no se captura: se calcula.</p></div>`;
  }

  // ── EVALUAR ───────────────────────────────────────────────────
  function vistaEvaluar() {
    if (!datos.personas.length) return avisoSinPersonas();
    return `<div class="card">
      <h2 style="margin-top:0">Evaluar a alguien</h2>
      <label class="campo"><span>¿A quién estás evaluando?</span>
        <select id="cpPersona">${datos.personas.filter((p) => p.activo !== false)
          .map((p) => `<option value="${p.id}">${esc(p.nombre)} · ${esc(p.area)}</option>`).join("")}</select></label>
      <label class="campo"><span>Competencia</span><select id="cpComp"></select></label>
      <label class="campo"><span>Nivel</span><select id="cpNivel">${NIVELES.map((n) => `<option value="${n}">${MEDALLA[n]} ${n}</option>`).join("")}</select></label>
      <div id="cpEstado" class="sub" style="margin:6px 2px 12px"></div>
      <div class="fila" style="gap:8px">
        <button class="btn" id="cpQuiz" style="flex:1">📝 Pasar quiz</button>
        <button class="btn sec" id="cpObs" style="flex:1">👀 Observación</button>
      </div>
    </div>`;
  }

  function wireEvaluar() {
    const $ = (id) => el.querySelector(id);
    const pintaComps = () => {
      const p = datos.personas.find((x) => x.id === $("#cpPersona").value);
      const cs = datos.competencias.filter((c) => c.area === (p && p.area) && c.activa !== false);
      $("#cpComp").innerHTML = cs.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")
        || `<option value="">— sin competencias para ${esc((p && p.area) || "")} —</option>`;
      estado();
    };
    const estado = () => {
      const p = datos.personas.find((x) => x.id === $("#cpPersona").value);
      const c = datos.competencias.find((x) => x.id === $("#cpComp").value);
      const nivel = $("#cpNivel").value;
      if (!p || !c) { $("#cpEstado").textContent = ""; return; }
      const nq = datos.preguntas.filter((q) => q.competencia_id === c.id && q.nivel === nivel && q.activa !== false).length;
      const crit = datos.criterios.find((x) => x.competencia_id === c.id && x.nivel === nivel);
      const partes = [`${nq} pregunta(s)`, `${((crit && crit.checklist) || []).length} punto(s) de observación`];
      if (crit && crit.kpi) partes.push(`meta: ${detalleKpi(p, crit.kpi)}`);
      $("#cpEstado").innerHTML = partes.join(" · ") + (nq === 0 ? ` <b>· quiz sin preguntas todavía</b>` : "");
    };
    $("#cpPersona").onchange = pintaComps;
    $("#cpComp").onchange = estado;
    $("#cpNivel").onchange = estado;
    pintaComps();

    $("#cpQuiz").onclick = () => {
      const persona = datos.personas.find((x) => x.id === $("#cpPersona").value);
      const comp = datos.competencias.find((x) => x.id === $("#cpComp").value);
      const nivel = $("#cpNivel").value;
      const preguntas = datos.preguntas
        .filter((q) => q.competencia_id === comp?.id && q.nivel === nivel && q.activa !== false)
        .sort((a, b) => a.orden - b.orden);
      if (!preguntas.length) { alert("Esa competencia todavía no tiene preguntas en ese nivel."); return; }
      quiz = { persona, comp, nivel, preguntas, i: 0, respuestas: {}, aciertos: 0, elegida: null };
      pintar();
    };
    $("#cpObs").onclick = () => {
      const persona = datos.personas.find((x) => x.id === $("#cpPersona").value);
      const comp = datos.competencias.find((x) => x.id === $("#cpComp").value);
      const nivel = $("#cpNivel").value;
      const crit = datos.criterios.find((x) => x.competencia_id === comp?.id && x.nivel === nivel);
      const items = (crit && crit.checklist) || [];
      if (!items.length) { alert("Ese nivel todavía no tiene puntos de observación definidos."); return; }
      obs = { persona, comp, nivel, items, marcados: {}, notas: "" };
      pintar();
    };
  }

  // ── QUIZ ──────────────────────────────────────────────────────
  function pintarQuiz() {
    const q = quiz.preguntas[quiz.i];
    // Terminó
    if (!q) {
      const total = quiz.preguntas.length;
      const pct = total ? quiz.aciertos / total : 0;
      const paso = pct >= APROBAR;
      el.innerHTML = `<div class="card" style="text-align:center">
        <div style="font-size:46px">${paso ? "🎉" : "💪"}</div>
        <h2 style="margin:6px 0">${quiz.aciertos} de ${total}</h2>
        <div style="font-size:26px;font-weight:800;color:${paso ? "var(--verde,#0e7a4a)" : "var(--rojo,#b3261e)"}">${Math.round(pct * 100)}%</div>
        <p class="sub">${paso ? "Aprobado" : `No aprobado — se necesita ${Math.round(APROBAR * 100)}%`}</p>
        <p class="sub" style="margin-top:10px">${esc(quiz.persona.nombre)} · ${esc(quiz.comp.nombre)} · ${esc(quiz.nivel)}</p>
        <div class="fila" style="gap:8px;margin-top:14px">
          <button class="btn" id="qGuardar" style="flex:1">Guardar resultado</button>
          <button class="btn sec" id="qSalir" style="flex:1">Salir sin guardar</button>
        </div>
      </div>`;
      el.querySelector("#qSalir").onclick = () => { quiz = null; pintar(); };
      el.querySelector("#qGuardar").onclick = async (e) => {
        e.target.disabled = true; e.target.textContent = "Guardando…";
        try {
          await store.guardarIntentoQuiz({
            persona_id: quiz.persona.id, competencia_id: quiz.comp.id, nivel: quiz.nivel,
            respuestas: quiz.respuestas, aciertos: quiz.aciertos, total, aprobado: paso,
          });
          quiz = null; await cargar(); sub = "tablero"; pintar();
        } catch (err) { e.target.disabled = false; e.target.textContent = "Guardar resultado"; alert("No pude guardar: " + ((err && err.message) || err)); }
      };
      return;
    }

    const ops = Array.isArray(q.opciones) ? q.opciones : [];
    const eleg = quiz.elegida;
    el.innerHTML = `<div class="card">
      <div class="sub" style="font-size:11.5px">${esc(quiz.persona.nombre)} · ${esc(quiz.comp.nombre)} · ${MEDALLA[quiz.nivel]} ${esc(quiz.nivel)}</div>
      <div class="barra-track" style="height:6px;margin:8px 0 14px"><span class="barra-fill" style="width:${Math.round(quiz.i / quiz.preguntas.length * 100)}%;background:var(--naranja)"></span></div>
      <div class="sub" style="font-size:11.5px">Pregunta ${quiz.i + 1} de ${quiz.preguntas.length}</div>
      <h2 style="margin:6px 0 14px;font-size:17px;line-height:1.35">${esc(q.pregunta)}</h2>
      <div style="display:grid;gap:8px">
        ${ops.map((o) => {
          let estilo = "border:1px solid var(--linea);background:var(--blanco,#fff)";
          if (eleg) {
            if (o.k === q.correcta) estilo = "border:2px solid var(--verde,#0e7a4a);background:#eafaf0";
            else if (o.k === eleg) estilo = "border:2px solid var(--rojo,#b3261e);background:#fdecea";
            else estilo = "border:1px solid var(--linea);opacity:.55";
          }
          return `<button data-op="${esc(o.k)}"${eleg ? " disabled" : ""} style="${estilo};border-radius:12px;padding:13px 14px;text-align:left;font-size:15px;line-height:1.35;cursor:${eleg ? "default" : "pointer"};min-height:48px">
            ${esc(o.t)}${eleg && o.k === q.correcta ? " ✓" : ""}${eleg && o.k === eleg && o.k !== q.correcta ? " ✗" : ""}
          </button>`;
        }).join("")}
      </div>
      ${eleg ? `<div style="margin-top:14px;padding:12px;border-radius:12px;background:var(--fondo-2,#f6f6f4)">
        <div class="sub" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">Por qué</div>
        <div style="font-size:14px;line-height:1.45">${esc(q.explicacion || "—")}</div>
      </div>
      <button class="btn" id="qSig" style="margin-top:14px">${quiz.i + 1 < quiz.preguntas.length ? "Siguiente" : "Ver resultado"}</button>` : ""}
    </div>`;

    el.querySelectorAll("[data-op]").forEach((b) => b.onclick = () => {
      if (quiz.elegida) return;
      quiz.elegida = b.dataset.op;
      quiz.respuestas[q.id] = quiz.elegida;
      if (quiz.elegida === q.correcta) quiz.aciertos++;
      pintar();   // repinta mostrando la explicación: ahí es donde se enseña
    });
    const sig = el.querySelector("#qSig");
    if (sig) sig.onclick = () => { quiz.i++; quiz.elegida = null; pintar(); };
  }

  // ── OBSERVACIÓN ───────────────────────────────────────────────
  function pintarObs() {
    const marcados = Object.values(obs.marcados).filter(Boolean).length;
    el.innerHTML = `<div class="card">
      <div class="sub" style="font-size:11.5px">${esc(obs.persona.nombre)} · ${esc(obs.comp.nombre)} · ${MEDALLA[obs.nivel]} ${esc(obs.nivel)}</div>
      <h2 style="margin:6px 0 4px">Observación en piso</h2>
      <p class="sub" style="margin-top:0">Palomea lo que le viste hacer. No lo que sabe: lo que hace.</p>
      ${obs.items.map((t, i) => `<label style="display:flex;gap:11px;align-items:flex-start;padding:11px 0;border-bottom:1px solid var(--linea)">
        <input type="checkbox" data-i="${i}"${obs.marcados[i] ? " checked" : ""} style="width:22px;height:22px;flex:none;margin-top:1px;accent-color:var(--verde)" />
        <span style="font-size:14.5px;line-height:1.35">${esc(t)}</span>
      </label>`).join("")}
      <label class="campo" style="margin-top:14px"><span>Notas para la persona</span>
        <textarea id="obsNotas" rows="3" placeholder="Qué hizo bien y qué le toca trabajar">${esc(obs.notas)}</textarea></label>
      <div class="sub" style="margin-bottom:10px">${marcados} de ${obs.items.length} · se aprueba con todos</div>
      <div class="fila" style="gap:8px">
        <button class="btn" id="obsGuardar" style="flex:1">Guardar</button>
        <button class="btn sec" id="obsSalir" style="flex:1">Cancelar</button>
      </div>
    </div>`;
    el.querySelectorAll("[data-i]").forEach((c) => c.onchange = () => {
      obs.notas = el.querySelector("#obsNotas").value;
      obs.marcados[c.dataset.i] = c.checked; pintarObs();
    });
    el.querySelector("#obsSalir").onclick = () => { obs = null; pintar(); };
    el.querySelector("#obsGuardar").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Guardando…";
      const aprobado = obs.items.every((_, i) => obs.marcados[i]);
      try {
        await store.guardarPracticaCap({
          persona_id: obs.persona.id, competencia_id: obs.comp.id, nivel: obs.nivel,
          checklist: obs.marcados, observaciones: el.querySelector("#obsNotas").value, aprobado,
        });
        obs = null; await cargar(); sub = "tablero"; pintar();
      } catch (err) { e.target.disabled = false; e.target.textContent = "Guardar"; alert("No pude guardar: " + ((err && err.message) || err)); }
    };
  }

  // ── PERSONAS ──────────────────────────────────────────────────
  function vistaPersonas() {
    const nombresParrot = [...new Set((store.state.ordenesMesero || []).map((o) => o.mesero).filter(Boolean))].sort();
    return `<div class="card">
      <h2 style="margin-top:0">Personas</h2>
      <p class="sub" style="margin-top:-4px">Quién se capacita. No son cuentas de la app: nadie de aquí entra a Platify.</p>
      ${datos.personas.map((p) => `<div style="display:flex;gap:8px;align-items:center;padding:9px 0;border-bottom:1px solid var(--linea)">
        <div style="flex:1;min-width:0">
          <b>${esc(p.nombre)}</b>
          <div class="sub" style="font-size:11.5px">${esc(p.area)}${p.puesto ? " · " + esc(p.puesto) : ""}${p.nombre_parrot ? " · Parrot: " + esc(p.nombre_parrot) : ""}</div>
        </div>
        <button class="linkbtn" data-del="${p.id}" style="color:var(--rojo);padding:0 6px;font-size:16px">✕</button>
      </div>`).join("") || `<div class="sub">Todavía no hay nadie.</div>`}

      <h3 style="margin:16px 0 6px;font-size:14px">Agregar</h3>
      <label class="campo"><span>Nombre</span><input id="npNombre" placeholder="Ej. Alexa" /></label>
      <div class="fila" style="gap:8px">
        <label class="campo" style="flex:1"><span>Área</span><select id="npArea">
          <option value="piso">piso</option><option value="cocina">cocina</option>
          <option value="barra">barra</option><option value="loza">loza</option></select></label>
        <label class="campo" style="flex:1"><span>Puesto</span><input id="npPuesto" placeholder="mesera" /></label>
      </div>
      <label class="campo"><span>Cómo aparece en Parrot (opcional)</span>
        <select id="npParrot"><option value="">— no aplica —</option>
        ${nombresParrot.map((n) => `<option>${esc(n)}</option>`).join("")}</select></label>
      <p class="sub" style="margin:-6px 2px 10px;font-size:11.5px">Sin esto, los niveles que dependen de sus números (plata, oro) no se pueden verificar solos.</p>
      <button class="btn" id="npAdd">Agregar persona</button>
    </div>`;
  }

  function wirePersonas() {
    el.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      const p = datos.personas.find((x) => x.id === b.dataset.del);
      if (!confirm(`¿Quitar a ${p.nombre}? Se borra también su historial de quizzes y observaciones.`)) return;
      try { await store.borrarPersonaCap(b.dataset.del); await cargar(); }
      catch (e) { alert("No pude borrar: " + ((e && e.message) || e)); }
    });
    el.querySelector("#npAdd").onclick = async (e) => {
      const nombre = el.querySelector("#npNombre").value.trim();
      if (!nombre) { el.querySelector("#npNombre").focus(); return; }
      e.target.disabled = true;
      try {
        await store.guardarPersonaCap({
          nombre, area: el.querySelector("#npArea").value,
          puesto: el.querySelector("#npPuesto").value.trim(),
          nombre_parrot: el.querySelector("#npParrot").value,
        });
        await cargar();
      } catch (err) { e.target.disabled = false; alert("No pude agregar: " + ((err && err.message) || err)); }
    };
  }

  function avisoSinPersonas() {
    return `<div class="card">
      <h2 style="margin-top:0">Primero, ¿quiénes se capacitan?</h2>
      <p class="sub">Ve a <b>Personas</b> y da de alta a tu equipo. Con el nombre de Parrot, los niveles
      que dependen de sus números se verifican solos.</p></div>`;
  }

  return () => {};
}
