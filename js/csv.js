// Lee un CSV a un arreglo de objetos usando la 1ª fila como encabezados.
// Soporta comillas, comas dentro de comillas y saltos CRLF/LF. Quita el BOM.
export function parsearCSV(texto) {
  const t = String(texto || "").replace(/^﻿/, "");
  const filas = [];
  let campo = "", fila = [], enComillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; }   // comilla escapada ""
        else enComillas = false;
      } else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n") { fila.push(campo); filas.push(fila); campo = ""; fila = []; }
    else if (c !== "\r") campo += c;
  }
  if (campo !== "" || fila.length) { fila.push(campo); filas.push(fila); }
  if (!filas.length) return [];
  const enc = filas[0].map((h) => h.trim().toLowerCase());
  return filas.slice(1)
    .filter((r) => r.some((v) => (v || "").trim() !== ""))
    .map((r) => {
      const o = {};
      enc.forEach((h, i) => { o[h] = (r[i] || "").trim(); });
      return o;
    });
}

// Utilidad para exportar datos a CSV y descargarlo.
export function descargarCSV(nombre, encabezados, filas) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lineas = [encabezados, ...filas].map((r) => r.map(esc).join(","));
  const csv = "﻿" + lineas.join("\r\n"); // BOM para que Excel respete los acentos
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre.replace(/[^\w\-]+/g, "_") + ".csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
