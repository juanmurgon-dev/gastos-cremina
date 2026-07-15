// Pantalla: capturar un ticket (con foto o escrito a mano).
import { supabase } from "../supabase-init.js";
import * as store from "../store.js";
import { crearEditor } from "./ticket-editor.js";
import { leerConTesseract, parsearTicketLocal } from "../ocr.js";

export function render(el, ctx) {
  const user = ctx.user;
  let fotoBlob = null;   // la foto comprimida lista para subir
  let fotoBase64 = null; // la misma en base64 para Claude
  let fotoDataUrl = null; // dataURL para Tesseract
  let editores = [];     // editores creados tras la extracción

  el.innerHTML = `
    <div id="paso-inicio">
      <div class="card" style="text-align:center">
        <h2 style="margin-bottom:6px">Registrar un ticket</h2>
        <p class="sub" style="margin:0 0 16px">Toma la foto del recibo y yo saco los artículos.</p>
        <label class="btn" style="margin-bottom:10px">
          📸 Tomar / elegir foto
          <input id="file" type="file" accept="image/*" capture="environment" hidden />
        </label>
        <button class="btn sec" id="btn-texto">✍️ Escribir a mano</button>
      </div>
    </div>

    <div id="paso-texto" hidden>
      <div class="card">
        <h2>Escribir el gasto</h2>
        <p class="sub" style="margin-top:0">Pon proveedor, fecha y artículos con su precio.</p>
        <textarea id="txt" rows="7" placeholder="Mercado — 20 jul
Tomate 3kg 90
Cebolla 2kg 40
Cilantro 15"></textarea>
        <div class="fila" style="margin-top:12px">
          <button class="btn sec" id="txt-cancelar">Cancelar</button>
          <button class="btn" id="txt-analizar">Analizar</button>
        </div>
      </div>
    </div>

    <div id="paso-foto" hidden>
      <div class="card" style="text-align:center">
        <img id="preview" style="max-width:100%;border-radius:12px;margin-bottom:12px" />
        <div class="fila">
          <button class="btn sec" id="otra">Otra foto</button>
          <button class="btn" id="analizar">🔍 Analizar ticket</button>
        </div>
      </div>
    </div>

    <div id="paso-cargando" hidden>
      <div class="card" style="text-align:center;padding:40px">
        <div class="spinner" style="margin:0 auto 14px;border-color:#f0d3c7;border-top-color:var(--naranja)"></div>
        <p class="sub" id="carg-txt" style="margin:0">Leyendo el ticket…</p>
      </div>
    </div>

    <div id="paso-revisar" hidden>
      <div id="msg"></div>
      <div id="editores"></div>
      <button class="btn sec" id="mejorar-ia" hidden style="margin-top:6px">🤖 Mejorar con IA</button>
      <button class="btn" id="guardar" style="margin-top:10px">✅ Guardar</button>
      <button class="btn sec" id="descartar" style="margin-top:10px">Descartar</button>
    </div>
  `;

  const paso = (id) => {
    ["inicio", "texto", "foto", "cargando", "revisar"].forEach((p) =>
      el.querySelector(`#paso-${p}`).hidden = (p !== id));
  };

  // ── Elegir foto ──
  el.querySelector("#file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const r = await comprimir(f);
      fotoBlob = r.blob; fotoBase64 = r.base64; fotoDataUrl = r.dataUrl;
      el.querySelector("#preview").src = r.dataUrl;
      paso("foto");
    } catch (err) {
      alert("No pude leer la imagen. Intenta de nuevo.");
    }
  });
  el.querySelector("#otra").addEventListener("click", () => el.querySelector("#file").click());

  // ── Modo texto ──
  el.querySelector("#btn-texto").addEventListener("click", () => paso("texto"));
  el.querySelector("#txt-cancelar").addEventListener("click", () => paso("inicio"));
  el.querySelector("#txt-analizar").addEventListener("click", async () => {
    const texto = el.querySelector("#txt").value.trim();
    if (!texto) return;
    fotoBlob = null; fotoBase64 = null;
    await analizar({ texto });
  });

  // ── Analizar foto: Tesseract primero (gratis); Claude solo si hace falta ──
  el.querySelector("#analizar").addEventListener("click", analizarFoto);
  el.querySelector("#mejorar-ia").addEventListener("click", () =>
    analizar({ imagenBase64: fotoBase64, mediaType: "image/jpeg" }));

  const setCarg = (t) => { const n = el.querySelector("#carg-txt"); if (n) n.textContent = t; };

  async function analizarFoto() {
    paso("cargando");
    setCarg("Leyendo el ticket… 0%");
    let ocr = null;
    try {
      ocr = await leerConTesseract(fotoDataUrl, (p) => setCarg(`Leyendo el ticket… ${Math.round(p * 100)}%`));
    } catch (e) {
      ocr = null; // Tesseract no cargó (p. ej. sin internet) → vamos con IA
    }

    // ¿Tesseract leyó bien? Si no, que Claude lea la imagen.
    if (!ocr || ocr.confidence < 55 || ocr.text.length < 25) {
      setCarg("No se leyó claro; usando IA…");
      return analizar({ imagenBase64: fotoBase64, mediaType: "image/jpeg" });
    }

    const local = parsearTicketLocal(ocr.text);
    if (local.lineas.length >= 1) {
      return mostrarRevision([local], "tesseract");
    }

    // Leyó texto pero no pude estructurarlo → Claude con el TEXTO (más barato).
    setCarg("Estructurando con IA…");
    return analizar({ texto: ocr.text, ocr: true });
  }

  async function analizar(payload) {
    paso("cargando");
    const { data, error } = await supabase.functions.invoke("extraer-ticket", { body: payload });
    // El OCR y la visión vienen de una foto: si algo falla, volvemos a "foto".
    const step = (payload.imagenBase64 || payload.ocr) ? "foto" : "texto";
    if (error || (data && data.error)) {
      let detalle = (data && data.error) || (error && error.message) || "error desconocido";
      // Si la función devolvió un error con cuerpo, sácalo para verlo en pantalla.
      if (error && error.context && typeof error.context.text === "function") {
        try {
          const txt = await error.context.text();
          try { const b = JSON.parse(txt); detalle = b.error || txt; } catch (e) { detalle = txt || detalle; }
        } catch (e) {}
      }
      paso(step);
      const cont = el.querySelector(`#paso-${step} .card`);
      const prev = cont.querySelector(".error-box"); if (prev) prev.remove();
      cont.insertAdjacentHTML("afterbegin",
        `<div class="error-box">No pude leer el ticket: ${detalle}. Intenta con otra foto o escríbelo a mano.</div>`);
      return;
    }
    mostrarRevision((data && data.tickets) || [], "ia");
  }

  function mostrarRevision(tickets, fuente) {
    const cont = el.querySelector("#editores");
    const msg = el.querySelector("#msg");
    cont.innerHTML = "";
    editores = [];

    // El botón "Mejorar con IA" solo tiene sentido si hay foto que reprocesar.
    el.querySelector("#mejorar-ia").hidden = !fotoBase64;

    if (!tickets.length) {
      msg.innerHTML = `<div class="aviso-box">No detecté ningún gasto. Corrígelo a mano o toca "Mejorar con IA".</div>`;
    } else if (fuente === "tesseract") {
      msg.innerHTML = `<div class="ok-box">Leí ${tickets.length} ticket(s) <b>gratis</b> con Tesseract. Revisa montos y área; si algo salió mal, toca "Mejorar con IA".</div>`;
    } else {
      msg.innerHTML = `<div class="ok-box">Encontré ${tickets.length} ticket(s). Revisa y corrige si hace falta.</div>`;
    }

    (tickets.length ? tickets : [{ lineas: [{}] }]).forEach((t) => {
      const card = document.createElement("div");
      card.className = "card";
      if (t.aviso) card.innerHTML = `<div class="aviso-box">⚠️ ${t.aviso}</div>`;
      const holder = document.createElement("div");
      card.appendChild(holder);
      cont.appendChild(card);
      editores.push(crearEditor(holder, t));
    });
    paso("revisar");
  }

  el.querySelector("#descartar").addEventListener("click", reset);

  // ── Guardar ──
  el.querySelector("#guardar").addEventListener("click", async () => {
    const btn = el.querySelector("#guardar");
    btn.disabled = true; btn.textContent = "Guardando…";
    try {
      let fotoUrl = "";
      if (fotoBlob) {
        const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
        const nombre = `${new Date().toISOString().slice(0, 10)}-${id}.jpg`;
        const { error: eUp } = await supabase.storage.from("tickets")
          .upload(nombre, fotoBlob, { contentType: "image/jpeg" });
        if (eUp) throw eUp;
        fotoUrl = supabase.storage.from("tickets").getPublicUrl(nombre).data.publicUrl;
      }
      for (const ed of editores) {
        const t = ed.getValue();
        if (!t.lineas.length) continue;
        await store.guardarTicket({ ...t, fotoUrl, creadoPor: store.miNombre() });
      }
      el.querySelector("#msg").innerHTML = `<div class="ok-box">✅ Guardado. ¡Listo!</div>`;
      setTimeout(reset, 900);
    } catch (err) {
      alert("No pude guardar: " + ((err && err.message) || err));
      btn.disabled = false; btn.textContent = "✅ Guardar";
    }
  });

  function reset() {
    fotoBlob = null; fotoBase64 = null; fotoDataUrl = null; editores = [];
    el.querySelector("#file").value = "";
    el.querySelector("#txt").value = "";
    el.querySelector("#mejorar-ia").hidden = true;
    const g = el.querySelector("#guardar"); g.disabled = false; g.textContent = "✅ Guardar";
    paso("inicio");
  }
}

// ── Comprime la foto a JPEG ~1600px para que suba rápido y quepa en la API ──
function comprimir(file, max = 1600, calidad = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > h && w > max) { h = Math.round(h * max / w); w = max; }
      else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = c.toDataURL("image/jpeg", calidad);
      const base64 = dataUrl.split(",")[1];
      c.toBlob((blob) => resolve({ blob, base64, dataUrl }), "image/jpeg", calidad);
    };
    img.onerror = reject;
    img.src = url;
  });
}
