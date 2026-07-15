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
