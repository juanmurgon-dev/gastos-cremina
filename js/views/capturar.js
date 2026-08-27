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
        <p class="sub" style="margin:0 0 16px">Toma la foto del recibo o elígela de tu galería, y yo saco los artículos.</p>
        <label class="btn" style="margin-bottom:10px">
          📸 Tomar / elegir foto
          <input id="file" type="file" accept="image/*" hidden />
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
  el.querySelector("#txt-analizar").addEventListener("click", () => {
    const texto = el.querySelector("#txt").value.trim();
    if (!texto) return;
    fotoBlob = null; fotoBase64 = null; fotoDataUrl = null;
    // Manual = 100% local (parser propio). NO llama a Claude, así funciona
    // aunque la API esté sin cupo o sin internet. La IA queda solo para fotos.
    // Modo laxo: lo escribió una persona, no una cámara. Acepta "jitomate 65"
    // sin exigir centavos, y de todos modos se le enseña para que lo revise.
    const local = parsearTicketLocal(texto, { laxo: true });
    local.aviso = "";
    mostrarRevision([local.lineas.length ? local : { ...local, lineas: [{}] }], "manual");
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

    const texto = ocr && ocr.text ? ocr.text.trim() : "";

    // Cascada de MENOR a MAYOR costo. La confianza de Tesseract es poco fiable,
    // así que NO decidimos por ella: decidimos por si hay texto y si el parser
    // local logra estructurarlo.
    if (texto.length >= 25) {
      // 1) GRATIS: Tesseract + parser local, cero API.
      //
      // La puerta es `local.confiable`, NO "sacó al menos una línea". Ese
      // era el bug: el parser convertía casi cualquier renglón en artículo,
      // así que siempre sacaba líneas, siempre pasaba, y la IA no se
      // llamaba nunca. Entraban al inventario el RFC, el teléfono y la
      // dirección del proveedor como si fueran mercancía.
      //
      // Ahora solo se acepta la lectura gratis cuando las líneas SUMAN lo
      // que el propio ticket dice que suman. Si no cuadra, cuesta unos
      // centavos de IA — mucho más barato que un inventario sucio.
      const local = parsearTicketLocal(texto);
      if (local.confiable) {
        return mostrarRevision([local], "tesseract");
      }
      // 2) BARATO: hay texto pero no cuadró → Claude con TEXTO (sin imagen).
      setCarg("Revisando con IA…");
      const r = await analizar({ texto, ocr: true });
      return r;
    }

    // 3) ÚLTIMO RECURSO (más caro): Tesseract no sacó casi nada → Claude lee la IMAGEN.
    setCarg("No se leyó claro; usando IA (imagen)…");
    return analizar({ imagenBase64: fotoBase64, mediaType: "image/jpeg" });
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
    } else if (fuente === "manual") {
      msg.innerHTML = `<div class="ok-box">Escrito a mano (sin internet ni IA). Revisa proveedor, fecha y montos, y guarda.</div>`;
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
        // Carpeta por restaurante. Storage no tiene org_id, así que el
        // aislamiento entre clientes se hace con la RUTA: la policy compara
        // esta primera carpeta contra la org de quien sube. Sin el prefijo,
        // un jefe de otro restaurante podría abrir fotos ajenas — y una foto
        // de ticket trae los precios de sus proveedores.
        const carpeta = store.state.orgId ? store.state.orgId + "/" : "";
        const nombre = `${carpeta}${new Date().toISOString().slice(0, 10)}-${id}.jpg`;
        const { error: eUp } = await supabase.storage.from("tickets")
          .upload(nombre, fotoBlob, { contentType: "image/jpeg" });
        if (eUp) throw eUp;
        fotoUrl = supabase.storage.from("tickets").getPublicUrl(nombre).data.publicUrl;
      }
      const guardados = [];
      const lineasGasto = [];
      let fechaGasto = "";
      for (const ed of editores) {
        const t = ed.getValue();
        if (!t.lineas.length) continue;
        const typed = (t.proveedor || "").trim();
        const final = await store.guardarTicket({ ...t, fotoUrl, creadoPor: store.miNombre() });
        guardados.push({ typed, final: (final || "").trim() });
        lineasGasto.push(...t.lineas);
        if (!fechaGasto && t.fecha) fechaGasto = t.fecha;
      }
      const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
      const provs = [...new Set(guardados.map((g) => g.final).filter(Boolean))];
      const unif = guardados.filter((g) => g.typed && g.final && g.typed !== g.final);
      let extra = "";
      if (provs.length) extra += ` Proveedor: <b>${provs.map(esc).join(", ")}</b>.`;
      if (unif.length) extra += `<br><span style="color:var(--sea-txt)">🔗 Unifiqué "${esc(unif[0].typed)}" → "${esc(unif[0].final)}".</span>`;
      el.querySelector("#msg").innerHTML = `<div class="ok-box">✅ Guardado.${extra}</div>`;
      // ¿El gasto coincide con pendientes de alguna requisición? → sugerir marcarlos comprados.
      const candidatos = store.cruzarGastoRequis(lineasGasto);
      if (candidatos.length) confirmarComprados(candidatos, fechaGasto);
      else setTimeout(reset, 900);
    } catch (err) {
      alert("No pude guardar: " + ((err && err.message) || err));
      btn.disabled = false; btn.textContent = "✅ Guardar";
    }
  });

  // Modal: el gasto coincide con pendientes de una requisición → confirma cuáles marcar comprados.
  function confirmarComprados(cands, fecha) {
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `
      <div class="modal">
        <h2>Cruzar con tu requisición 🛒</h2>
        <p class="sub" style="margin:-8px 0 12px">Este gasto coincide con estos <b>pendientes</b>. Marca los que ya compraste y pasan a <b>Comprado</b>.</p>
        <div id="ccList">
          ${cands.map((c, i) => `
            <label class="cc-row" style="display:flex;align-items:flex-start;gap:10px;padding:10px 4px;border-bottom:1px solid var(--linea);cursor:pointer">
              <input type="checkbox" data-i="${i}" checked style="margin-top:3px;width:18px;height:18px;accent-color:var(--verde);flex:none" />
              <span style="flex:1;min-width:0">
                <b>${esc(c.nombre)}</b>
                <span class="sub" style="display:block;font-size:12px">${esc(c.reqTitulo)} · coincide con “${esc(c.linea)}”</span>
              </span>
            </label>`).join("")}
        </div>
        <button class="btn" id="ccOk" style="margin-top:14px">✅ Marcar comprado</button>
        <button class="btn sec" id="ccNo" style="margin-top:8px">Ahora no</button>
      </div>`;
    document.body.appendChild(bg);
    const cerrar = () => { bg.remove(); reset(); };
    bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
    bg.querySelector("#ccNo").addEventListener("click", cerrar);
    bg.querySelector("#ccOk").addEventListener("click", async () => {
      const sel = [...bg.querySelectorAll("input[data-i]:checked")].map((inp) => cands[Number(inp.dataset.i)]);
      const ok = bg.querySelector("#ccOk"); ok.disabled = true; ok.textContent = "Guardando…";
      try {
        if (sel.length) await store.marcarComprados(sel.map((c) => ({ reqId: c.reqId, itemIdx: c.itemIdx })), { fecha });
      } catch (e) { /* no bloquear la captura por esto */ }
      cerrar();
    });
  }

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
