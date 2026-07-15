// OCR gratis en el navegador con Tesseract.js + un parser local que arma el
// ticket a partir del texto. Así la mayoría de los tickets no cuestan API.
// Si Tesseract no puede leer, quien llama escala a Claude (Haiku).

let _tessPromise = null;
async function cargarTesseract() {
  if (!_tessPromise) _tessPromise = import("https://esm.sh/tesseract.js@5.1.1");
  const mod = await _tessPromise;
  return mod && mod.createWorker ? mod : (mod.default || mod);
}

// Lee una imagen (dataURL, URL o Blob) y regresa { text, confidence 0-100 }.
export async function leerConTesseract(imagen, onProgress) {
  const T = await cargarTesseract();
  const worker = await T.createWorker("spa", 1, {
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) onProgress(m.progress || 0);
    },
  });
  try {
    const { data } = await worker.recognize(imagen);
    return { text: (data.text || "").trim(), confidence: data.confidence || 0 };
  } finally {
    await worker.terminate();
  }
}

// ── Parser local: de texto crudo a un ticket estructurado (aproximado) ──
const MESES = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8,
  sep: 9, oct: 10, nov: 11, dic: 12,
};

function pad(n) { return String(n).padStart(2, "0"); }
function iso(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

function normalizarNum(s) {
  s = String(s).replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) {
    // la última marca es el decimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (s.includes(",")) {
    const after = s.split(",").pop();
    s = after.length === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function ultimoNumero(l) {
  const m = l.match(/\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g);
  if (!m) return null;
  return normalizarNum(m[m.length - 1]);
}

function extraerFecha(texto) {
  const s = texto.replace(/\n/g, " ");
  let m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let d = +m[1], mo = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return iso(y, mo, d);
  }
  m = s.match(/(\d{1,2})\s*(?:de\s*)?([a-záéíóúñ]{3,})\.?\s*(?:de\s*)?(\d{4})?/i);
  if (m) {
    const d = +m[1];
    const mo = MESES[m[2].toLowerCase().slice(0, 3)];
    if (mo && d >= 1 && d <= 31) {
      const y = m[3] ? +m[3] : new Date().getFullYear();
      return iso(y, mo, d);
    }
  }
  return "";
}

const IGNORA = /sub-?total|cambio|efectivo|tarjeta|propina|iva|cajero|folio|rfc|tel[eé]fono|\btel\b|gracias|caja|mesa|cuenta|ticket|factura|www\.|@/i;

// texto -> { proveedor, fecha, lineas:[...], total, aviso }
export function parsearTicketLocal(texto) {
  const raw = String(texto).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let proveedor = "";
  for (const l of raw) {
    const cifras = l.replace(/[^0-9]/g, "").length;
    if (/[a-záéíóúñ]/i.test(l) && !IGNORA.test(l) && cifras < l.length / 2) {
      proveedor = l.slice(0, 60);
      break;
    }
  }

  const fecha = extraerFecha(raw.join(" "));
  const lineas = [];
  let total = 0;

  for (const l of raw) {
    const precio = ultimoNumero(l);
    if (/\btotal\b/i.test(l) && precio != null) { total = precio; continue; }
    if (IGNORA.test(l)) continue;
    if (precio == null || precio <= 0) continue;

    let desc = l.replace(/\$?\s*\d[\d.,]*\s*$/, "").trim();
    let cantidad = 1;
    const q = desc.match(/^(\d+)\s*[xX]?\s+(.*)$/);
    if (q && /[a-záéíóúñ]/i.test(q[2])) { cantidad = parseInt(q[1], 10) || 1; desc = q[2].trim(); }
    if (!desc || !/[a-záéíóúñ]/i.test(desc)) continue;

    const monto = precio;
    lineas.push({
      area: "cocina",
      descripcion: desc.slice(0, 60),
      cantidad,
      unidad: "pz",
      precio_unitario: cantidad > 1 ? Math.round((monto / cantidad) * 100) / 100 : monto,
      monto,
      tipo: "costo de venta",
      notas: "",
    });
  }

  if (!total && lineas.length) {
    total = Math.round(lineas.reduce((s, x) => s + x.monto, 0) * 100) / 100;
  }

  return {
    proveedor,
    fecha,
    lineas,
    total,
    aviso: "Leído con Tesseract (gratis) — revisa bien montos y área.",
  };
}
