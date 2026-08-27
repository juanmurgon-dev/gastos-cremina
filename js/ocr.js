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

// Ruido de ticket: nunca es un artículo comprado.
// Va largo a propósito. Cada palabra de aquí es una línea que antes se
// colaba al inventario como si fuera mercancía.
const IGNORA = new RegExp([
  "sub-?total", "\\btotal\\b", "cambio", "efectivo", "tarjeta", "propina",
  "\\biva\\b", "\\bieps\\b", "impuesto", "descuento", "redondeo", "donativo",
  "cajer", "folio", "\\brfc\\b", "tel[eé]fono", "\\btel\\b", "gracias",
  "caja\\s*\\d", "\\bmesa\\b", "cuenta", "ticket", "factura", "www\\.", "@",
  "sucursal", "direcci[oó]n", "\\bcalle\\b", "\\bcol\\b\\.?", "\\bc\\.?p\\.?\\b",
  "autorizaci", "\\baut\\b", "terminal", "referencia", "vendedor", "atendi",
  "cliente", "\\buuid\\b", "\\bcfdi\\b", "r[eé]gimen", "importe", "descripci",
  "cantidad", "p\\.?\\s?unit", "unitario", "\\bcve\\b", "clave", "saldo",
  "\\bpago\\b", "recibido", "\\bno\\.?\\s*de\\b", "\\bserie\\b", "art[ií]culos",
  "piezas totales", "su compra", "vuelva", "horario", "\\bhora\\b", "\\bfecha\\b",
].join("|"), "i");

// Un importe de dinero AL FINAL de la línea. La regla dura es que traiga
// centavos (12.50) o el signo de pesos ($120). Con eso se caen solos los
// teléfonos, los RFC, los folios, los códigos de barras y las fechas, que
// era exactamente lo que se estaba colando como mercancía.
const MONTO_FIN = /(?:\$\s*)?(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2}|\$\s*\d{1,6})\s*$/;

// Versión suelta, SOLO para el texto que alguien escribe a mano. Ahí acepta
// un entero pelón ("jitomate 65") porque no hay ruido de OCR que filtrar: lo
// escribió una persona, y lo ve en pantalla antes de guardarlo. Exigirle
// centavos a quien teclea sería tratarlo como si fuera una foto borrosa.
const MONTO_FIN_LAXO = /(?:\$\s*)?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*$/;

// Unidades que un ticket mexicano imprime junto a la cantidad.
const UNIDADES_TXT = /^(\d+(?:[.,]\d+)?)\s*(kgs?|kilos?|grs?|gramos?|lts?|litros?|mls?|pzas?|pz|piezas?|cajas?|paq|paquetes?|bolsas?|bultos?|manojos?|latas?|botellas?|docenas?)?\b\s*/i;
const UNIDAD_NORM = { kg:"kg", kgs:"kg", kilo:"kg", kilos:"kg", gr:"gr", grs:"gr", gramo:"gr", gramos:"gr",
  lt:"L", lts:"L", litro:"L", litros:"L", ml:"ml", mls:"ml", pza:"pz", pzas:"pz", pz:"pz",
  pieza:"pz", piezas:"pz", caja:"caja", cajas:"caja", paq:"paq", paquete:"paq", paquetes:"paq",
  bolsa:"paq", bolsas:"paq", bulto:"caja", bultos:"caja", manojo:"manojo", manojos:"manojo",
  lata:"pz", latas:"pz", botella:"pz", botellas:"pz", docena:"paq", docenas:"paq" };

// ¿La descripción parece el nombre de algo que se compra?
// Necesita una palabra de verdad — tres letras seguidas o más. "3 X 1L" no
// es un artículo; "LECHE ENTERA" sí.
function pareceArticulo(desc) {
  if (desc.length < 3 || desc.length > 70) return false;
  if (!/[a-záéíóúñ]{3}/i.test(desc)) return false;
  const letras = (desc.match(/[a-záéíóúñ]/gi) || []).length;
  return letras >= desc.length * 0.4;      // no un código con una letra suelta
}

// Busca una etiqueta con su importe: "TOTAL  1,234.50"
function montoEtiquetado(raw, etiqueta, FIN = MONTO_FIN) {
  for (const l of raw) {
    if (!etiqueta.test(l)) continue;
    const m = l.match(FIN);
    if (m) { const n = normalizarNum(m[1].replace(/\$/g, "")); if (n != null && n > 0) return n; }
  }
  return 0;
}

// texto -> { proveedor, fecha, lineas:[...], total, confiable, motivo, aviso }
export function parsearTicketLocal(texto, { laxo = false } = {}) {
  const FIN = laxo ? MONTO_FIN_LAXO : MONTO_FIN;
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
  const total    = montoEtiquetado(raw, /\btotal\b/i, FIN);
  const subtotal = montoEtiquetado(raw, /sub-?total/i, FIN);

  const lineas = [];
  let candidatas = 0;          // líneas que TRAÍAN un importe al final

  for (const l of raw) {
    const m = l.match(FIN);
    if (!m) continue;
    candidatas++;

    const monto = normalizarNum(m[1].replace(/\$/g, ""));
    // Un artículo de restaurante no cuesta 3 centavos ni un millón. Fuera
    // de ese rango casi siempre es un código que se disfrazó de precio.
    if (monto == null || monto < 0.5 || monto > 200000) continue;

    let resto = l.slice(0, l.length - m[0].length).trim();

    // Muchos tickets imprimen  CANT  DESC  P.UNIT  IMPORTE. Si después de
    // quitar el importe queda OTRO importe al final, ese es el unitario.
    let unitario = null;
    const m2 = resto.match(FIN);
    if (m2) {
      const u = normalizarNum(m2[1].replace(/\$/g, ""));
      if (u != null && u > 0 && u <= monto * 1.05) {
        unitario = u;
        resto = resto.slice(0, resto.length - m2[0].length).trim();
      }
    }

    // Cantidad y unidad al principio: "2 PZ LECHE", "1.5 KG JITOMATE".
    let cantidad = 1, unidad = "pz";
    const q = resto.match(UNIDADES_TXT);
    if (q && q[0].trim() && /[a-záéíóúñ]{3}/i.test(resto.slice(q[0].length))) {
      const n = normalizarNum(q[1]);
      if (n != null && n > 0 && n < 10000) {
        cantidad = n;
        if (q[2]) unidad = UNIDAD_NORM[q[2].toLowerCase()] || "pz";
        resto = resto.slice(q[0].length).trim();
      }
    }

    const desc = resto.replace(/^[-–·*\s]+/, "").replace(/\s{2,}/g, " ").trim();
    // El filtro de ruido va contra la DESCRIPCIÓN, no contra la línea entera.
    // Contra la línea entera, "1 CAJA HUEVO BLANCO 89.00" se perdía porque
    // la palabra "caja" también aparece en "Caja 3 · Cajero María". Aquí ya
    // no queda más que el nombre del artículo, así que "TOTAL" o "EFECTIVO"
    // se caen igual y una caja de huevo se queda.
    if (IGNORA.test(desc)) continue;
    if (!pareceArticulo(desc)) continue;

    lineas.push({
      area: "cocina",
      descripcion: desc.slice(0, 60),
      cantidad,
      unidad,
      precio_unitario: unitario != null ? unitario
        : cantidad > 1 ? Math.round((monto / cantidad) * 100) / 100 : monto,
      monto,
      tipo: "costo de venta",
      notas: "",
    });
  }

  const suma = Math.round(lineas.reduce((s, x) => s + x.monto, 0) * 100) / 100;

  // ── ¿Se le puede creer a esta lectura? ──────────────────────────
  //
  // Esta es la parte que faltaba. Antes bastaba con sacar UNA línea para
  // dar por bueno el ticket, y como el parser convertía casi cualquier
  // renglón en artículo, siempre "salía bien" y nunca se llamaba a la IA.
  // El resultado: el RFC, el teléfono y la dirección entraban al
  // inventario como mercancía.
  //
  // La única prueba honesta que se puede hacer sin ojos es la aritmética:
  // si lo que leí suma lo que el propio ticket dice que suma, lo leí bien.
  // Si no cuadra, no se adivina — se manda a la IA, que sí ve la foto.
  const cerca = (a, b) => a > 0 && b > 0 && Math.abs(a - b) <= Math.max(1.5, b * 0.02);
  let confiable = false, motivo = "";
  if (lineas.length < 2) {
    motivo = "saqué menos de dos artículos";
  } else if (!total && !subtotal) {
    motivo = "el ticket no muestra un total contra el cual comprobar";
  } else if (cerca(suma, total) || cerca(suma, subtotal) || cerca(suma * 1.16, total) || cerca(suma * 1.08, total)) {
    confiable = true;
  } else {
    motivo = `mis líneas suman ${suma.toFixed(2)} y el ticket dice ${(total || subtotal).toFixed(2)}`;
  }

  return {
    proveedor,
    fecha,
    lineas,
    total: total || subtotal || suma,
    confiable,
    motivo,
    leidas: candidatas,
    aviso: confiable
      ? "Leído sin IA — la suma cuadra con el total del ticket. Aun así revisa el área de cada línea."
      : "",
  };
}
