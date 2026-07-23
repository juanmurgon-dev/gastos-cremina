// Requisición de compras: escribes lo que necesitas, la app pone precio y
// proveedor (de tu historial), lo agrupa por proveedor, le pones estatus y lo
// exportas para mandarlo a quien compra. Guarda historial en Supabase.
import * as store from "../store.js";
import { money, num, fechaBonita } from "../store.js";
import { descargarCSV } from "../csv.js";

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const ESTATUS = [
  { k: "pendiente", t: "Pendiente", c: "var(--amarillo)" },
  { k: "parcial", t: "Parcial", c: "var(--olive)" },
  { k: "pedido", t: "Pedido", c: "var(--verde)" },
];
const estatusInfo = (k) => ESTATUS.find((e) => e.k === k) || ESTATUS[0];
// Estatus general de la requisición, derivado del de cada producto.
function derivar(items) {
  const its = items || [];
  if (!its.length) return "pendiente";
  if (its.every((x) => x.estatus === "pedido")) return "pedido";
  if (its.some((x) => x.estatus === "pedido")) return "parcial";
  return "pendiente";
}

function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function hoyISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function hoyTxt() { const d = new Date(); return `${d.getDate()} ${MES[d.getMonth()]}`; }
function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.round(Math.random() * 1e6)); }
const montoDe = (it) => num(it.cantidad) * num(it.precio);
const totalDe = (its) => (its || []).reduce((a, it) => a + montoDe(it), 0);

// ───────────── Desglose de un pedido pegado ─────────────
// Convierte un mensaje libre ("5 kg tomate, 2 cajas leche…") en una lista de
// insumos {nombre, cantidad, unidad}. Todo local: sin costo y sin internet.
const UNIDADES_MATCH = [
  [/\b(kilos?|kilogramos?|kgs?|kg)\b/i, "kg"],
  [/\b(gramos?|grs?|gr)\b/i, "gr"],
  [/\b(litros?|lts?|lt)\b/i, "lt"],
  [/\b(mililitros?|ml)\b/i, "ml"],
  [/\b(piezas?|pzas?|pza|pz)\b/i, "pz"],
  [/\b(cajas?|caja)\b/i, "caja"],
  [/\b(paquetes?|paqs?|paq)\b/i, "paq"],
  [/\b(bolsas?|bolsa)\b/i, "bolsa"],
  [/\b(manojos?|manojo)\b/i, "manojo"],
  [/\b(docenas?|docena)\b/i, "docena"],
  [/\b(costales?|costal)\b/i, "costal"],
  [/\b(atados?|atado)\b/i, "atado"],
  [/\b(charolas?|charola)\b/i, "charola"],
  [/\b(latas?|lata)\b/i, "lata"],
  [/\b(botes?|bote)\b/i, "bote"],
  [/\b(rollos?|rollo)\b/i, "rollo"],
  [/\b(conos?|cono)\b/i, "cono"],
];
const NUM_PAL = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, docena: 12, media: 0.5, medio: 0.5 };
const FILLER = /\b(de|del|la|el|los|las|unos|unas|por\s*favor|porfa(?:vor)?|favor|necesito|ocupo|quiero|comprar|traer|tr[aá]eme|mandar|manda|pedir|pide|hay\s*que)\b/gi;
const IGNORAR = /^(hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|gracias|ok|listo|pedido|orden|lista|para (hoy|ma[ñn]ana|el)|del d[ií]a|hola,?)/i;

function parsearPedido(texto, byName) {
  const partes = String(texto || "").replace(/\r/g, "").split(/[\n,;]+|\s[•·]\s/);
  const out = [];
  for (const linea of partes) {
    let s = linea.trim().replace(/^[\s\-*•·►▪✅☑▫◦]+/, "").trim();
    if (!s || s.length < 2 || IGNORAR.test(s) || /[:：]\s*$/.test(s)) continue;

    let cantidad = null, unidad = "";
    // 1) número en dígitos (también si viene pegado a la unidad: "4kg")
    const mNum = s.match(/(\d+(?:[.,]\d+)?|\d+\/\d+)/);
    if (mNum) {
      const raw = mNum[1];
      cantidad = raw.includes("/")
        ? parseFloat(raw.split("/")[0]) / parseFloat(raw.split("/")[1])
        : parseFloat(raw.replace(",", "."));
      if (!isFinite(cantidad)) cantidad = null;
      s = s.replace(mNum[1], " ");
    }
    // 2) unidad (ya sin el dígito, "kg" en "4kg" queda suelto)
    for (const [re, canon] of UNIDADES_MATCH) {
      if (re.test(s)) { unidad = canon; s = s.replace(re, " "); break; }
    }
    // 3) si no hubo dígito, busca el número escrito con palabra
    if (cantidad == null) {
      for (const t of s.toLowerCase().split(/\s+/)) {
        if (NUM_PAL[t] != null) { cantidad = NUM_PAL[t]; s = s.replace(new RegExp("\\b" + t + "\\b", "i"), " "); break; }
      }
    }
    let nombre = s.replace(FILLER, " ").replace(/\s+/g, " ").trim();
    if (!nombre || nombre.length < 2) continue;

    const hit = byName.get(nombre.toLowerCase());
    if (hit) { nombre = hit.nombre; if (!unidad) unidad = hit.unidad || ""; }
    else if (!unidad) {
      const alt = [...byName.values()].find((i) =>
        i.nombre.toLowerCase().includes(nombre.toLowerCase()) || nombre.toLowerCase().includes(i.nombre.toLowerCase()));
      if (alt) unidad = alt.unidad || "";
    }
    nombre = nombre.charAt(0).toUpperCase() + nombre.slice(1);
    out.push({ nombre, cantidad: cantidad == null ? 1 : cantidad, unidad, enInventario: !!hit });
  }
  return out;
}

export function render(el) {
  let vista = "lista";        // "lista" | "editor"
  let editing = null;         // requisición en edición (copia local)
  const insumos = store.preciosPorInsumo();
  const byName = new Map(insumos.map((i) => [i.nombre.toLowerCase(), i]));

  // Solo redibuja desde el store cuando estamos en la LISTA (no pisa el editor).
  const unsub = store.subscribe(() => { if (vista === "lista") pintar(); });
  pintar();

  function pintar() { vista === "editor" ? pintarEditor() : pintarLista(); }

  // ───────────── LISTA / HISTORIAL ─────────────
  function pintarLista() {
    const reqs = (store.state.requisiciones || []).slice();
    el.innerHTML = `
      <div class="card">
        <h2>Requisiciones de compra</h2>
        <p class="sub" style="margin-top:-4px">Arma tu lista, ponle estatus y expórtala. Aquí queda el historial.</p>
        <button class="btn" id="nueva">＋ Nueva requisición</button>
      </div>
      ${reqs.length ? `<div class="card"><h2>Historial</h2>${reqs.map(tarjetaHist).join("")}</div>`
        : `<div class="card"><div class="sub">Aún no hay requisiciones. Crea la primera arriba.</div></div>`}`;

    el.querySelector("#nueva").addEventListener("click", () => {
      editing = { id: uuid(), fecha: hoyISO(), titulo: "", estatus: "pendiente", items: [], total: 0, _nuevo: true };
      vista = "editor"; pintar();
    });
    el.querySelectorAll("[data-open]").forEach((c) => c.addEventListener("click", () => {
      const r = reqs.find((x) => x.id === c.dataset.open);
      if (!r) return;
      editing = { ...r, items: (r.items || []).map((x) => ({ ...x })) };
      vista = "editor"; pintar();
    }));
  }

  function tarjetaHist(r) {
    const e = estatusInfo(r.estatus);
    const n = (r.items || []).length;
    return `<div class="ticket" data-open="${r.id}" style="cursor:pointer">
      <div class="cab">
        <span class="prov">Requisición · ${fechaBonita(r.fecha)}</span>
        <span class="monto">${money(r.total)}</span></div>
      <div class="meta" style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
        <span><span class="chip" style="background:${e.c}">${e.t}</span> · ${n} insumos</span>
        <span class="sub">abrir ›</span></div>
    </div>`;
  }

  // ───────────── EDITOR ─────────────
  function pintarEditor() {
    const e = estatusInfo(derivar(editing.items));
    el.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <button class="btn sec chico" id="volver">‹ Volver</button>
          <span class="chip" id="rqChip" style="background:${e.c}">${e.t}</span>
        </div>
        <p class="sub" style="margin:8px 0 0">Toca el estatus de cada producto para cambiarlo entre <b>Pendiente</b> y <b>Pedido</b>.</p>
        <button class="btn" id="rqGuardar" style="margin-top:10px">💾 Guardar requisición</button>
        <div id="rqSaveMsg"></div>
      </div>

      <div class="card">
        <h2>📋 Pegar pedido completo</h2>
        <p class="sub" style="margin-top:-4px">Pega el mensaje de lo que necesitas (una línea por insumo o separado por comas) y la app lo desglosa solo.</p>
        <textarea id="rqPegar" rows="4" placeholder="Ej.&#10;5 kg tomate&#10;2 cajas de leche&#10;1 manojo cilantro&#10;3 aguacate"></textarea>
        <button class="btn" id="rqDesglosar" style="margin-top:10px">✨ Desglosar pedido</button>
      </div>

      <div class="card">
        <h2>Agregar insumo</h2>
        <label class="campo" style="position:relative"><span>Insumo</span>
          <input id="rqNom" placeholder="Escribe y elige, ej. carne…" autocomplete="off" />
          <div id="rqSug" style="display:none;position:absolute;left:0;right:0;top:100%;z-index:30;background:var(--blanco);border:1px solid var(--linea);border-radius:12px;box-shadow:var(--sombra);max-height:250px;overflow-y:auto;margin-top:4px"></div>
        </label>
        <div style="display:flex;gap:8px">
          <label class="campo" style="flex:1"><span>Cantidad</span>
            <input id="rqCant" type="number" step="any" inputmode="decimal" placeholder="0" /></label>
          <label class="campo" style="width:96px"><span>Unidad</span>
            <input id="rqUni" placeholder="kg" /></label>
        </div>
        <button class="btn" id="rqAdd">Agregar a la lista</button>
      </div>

      <div id="rqLista"></div>`;

    const $ = (s) => el.querySelector(s);
    $("#volver").addEventListener("click", async () => {
      if (editing.items.length) await guardar();   // guarda el último avance al salir
      vista = "lista"; editing = null; pintar();
    });
    $("#rqGuardar").addEventListener("click", () => guardar(true));

    $("#rqDesglosar").addEventListener("click", () => {
      const t = $("#rqPegar").value.trim();
      if (!t) return;
      const items = parsearPedido(t, byName);
      if (!items.length) { alert("No reconocí insumos en ese texto. Prueba una línea por insumo, ej: “5 kg tomate”."); return; }
      revisarPedido(items);
    });

    $("#rqNom").addEventListener("change", () => {
      const hit = byName.get($("#rqNom").value.trim().toLowerCase());
      if (hit && !$("#rqUni").value) $("#rqUni").value = hit.unidad || "";
    });

    // Autocompletar: al escribir, despliega los insumos que coinciden (ej. "carne").
    const nomEl = $("#rqNom"), sugEl = $("#rqSug");
    const cerrarSug = () => { sugEl.style.display = "none"; sugEl.innerHTML = ""; };
    function abrirSug() {
      const q = nomEl.value.trim().toLowerCase();
      let items = insumos;
      if (q) items = insumos.filter((i) => i.nombre.toLowerCase().includes(q));
      items = items.slice(0, 8);
      if (!items.length) { cerrarSug(); return; }
      sugEl.innerHTML = items.map((i) => `
        <div class="ac-item" data-n="${esc(i.nombre)}" style="padding:11px 13px;cursor:pointer;border-bottom:1px solid var(--linea);font-size:14px;display:flex;justify-content:space-between;gap:8px;align-items:center">
          <span>${esc(i.nombre)}</span>
          <span class="sub" style="font-size:11.5px;white-space:nowrap">${esc(i.unidad || "")}${i.precioActual ? " · " + money(i.precioActual) : ""}</span>
        </div>`).join("");
      sugEl.style.display = "block";
      sugEl.querySelectorAll(".ac-item").forEach((it) => it.addEventListener("mousedown", (ev) => {
        ev.preventDefault();   // selecciona antes del blur
        nomEl.value = it.dataset.n;
        const hit = byName.get(it.dataset.n.toLowerCase());
        if (hit) $("#rqUni").value = hit.unidad || $("#rqUni").value;
        cerrarSug();
        $("#rqCant").focus();
      }));
    }
    nomEl.addEventListener("input", abrirSug);
    nomEl.addEventListener("focus", abrirSug);
    nomEl.addEventListener("blur", () => setTimeout(cerrarSug, 150));
    $("#rqAdd").addEventListener("click", () => {
      const nombre = $("#rqNom").value.trim();
      const cantidad = num($("#rqCant").value);
      if (!nombre || !cantidad) return;
      const hit = byName.get(nombre.toLowerCase());
      const precio = hit ? num(hit.precioActual) : 0;
      const proveedor = hit && hit.registros[0] ? (hit.registros[0].proveedor || "") : "";
      const unidad = $("#rqUni").value.trim() || (hit && hit.unidad) || "pz";
      editing.items.push({ nombre, cantidad, unidad, precio, proveedor, estatus: "pendiente" });
      $("#rqNom").value = ""; $("#rqCant").value = ""; $("#rqUni").value = "";
      $("#rqNom").focus();
      pintarItems(); guardar();
    });

    pintarItems();
  }

  // Crea un item de requisición completando precio/proveedor del historial.
  function itemDesde(nombre, cantidad, unidad) {
    const hit = byName.get((nombre || "").toLowerCase());
    const precio = hit ? num(hit.precioActual) : 0;
    const proveedor = hit && hit.registros[0] ? (hit.registros[0].proveedor || "") : "";
    const uni = unidad || (hit && hit.unidad) || "pz";
    return { nombre, cantidad: num(cantidad) || 1, unidad: uni, precio, proveedor, estatus: "pendiente" };
  }

  // Modal de revisión: el usuario ajusta/quita antes de agregar a la lista.
  function revisarPedido(items) {
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = `
      <div class="modal">
        <h2>Revisa el pedido</h2>
        <p class="sub" style="margin:-8px 0 12px">Desglosé <b>${items.length}</b> insumo(s). Ajusta lo que haga falta y quita lo que no quieras.</p>
        <div id="rvLista">${items.map(filaRev).join("")}</div>
        <button class="btn" id="rvAdd" style="margin-top:12px">Agregar a la lista</button>
        <button class="btn sec" id="rvCancel" style="margin-top:8px">Cancelar</button>
      </div>`;
    document.body.appendChild(bg);
    const cerrar = () => bg.remove();
    bg.addEventListener("click", (e) => { if (e.target === bg) cerrar(); });
    bg.querySelector("#rvCancel").addEventListener("click", cerrar);
    bg.querySelectorAll("[data-del-rev]").forEach((b) =>
      b.addEventListener("click", () => { const r = b.closest("[data-row]"); if (r) r.remove(); }));
    bg.querySelector("#rvAdd").addEventListener("click", () => {
      let n = 0;
      for (const row of bg.querySelectorAll("[data-row]")) {
        const nombre = row.querySelector("[data-f='nom']").value.trim();
        if (!nombre) continue;
        const cantidad = num(row.querySelector("[data-f='cant']").value);
        const unidad = row.querySelector("[data-f='uni']").value.trim();
        editing.items.push(itemDesde(nombre, cantidad, unidad));
        n++;
      }
      cerrar();
      const ta = el.querySelector("#rqPegar"); if (ta) ta.value = "";
      pintarItems(); guardar();
    });
  }

  function filaRev(it) {
    return `<div class="linea-edit" data-row style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 34px 8px 12px">
      <input data-f="nom" value="${esc(it.nombre)}" style="flex:1 1 140px;min-width:0" />
      <input data-f="cant" type="number" step="any" inputmode="decimal" value="${it.cantidad}" style="width:64px" />
      <input data-f="uni" value="${esc(it.unidad)}" placeholder="uni" style="width:72px" />
      <button data-del-rev class="quitar" title="Quitar">✕</button>
      <span class="sub" style="flex-basis:100%;font-size:11px${it.enInventario ? "" : ";color:var(--amber-osc)"}">${it.enInventario ? "✓ en tu inventario" : "insumo nuevo"}</span>
    </div>`;
  }

  function grupos() {
    const g = new Map();
    for (const it of editing.items) {
      const p = (it.proveedor || "").trim() || "Sin proveedor";
      if (!g.has(p)) g.set(p, []);
      g.get(p).push(it);
    }
    return g;
  }

  function pintarItems() {
    const cont = el.querySelector("#rqLista");
    if (!editing.items.length) {
      cont.innerHTML = `<div class="card"><div class="sub">Lista vacía. Agrega insumos arriba.</div></div>`;
      return;
    }
    let html = "";
    for (const [prov, list] of grupos()) {
      html += `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <h2 style="margin:0">🏪 ${esc(prov)}</h2><span class="val">${money(totalDe(list))}</span></div>
        <div style="margin-top:8px">${list.map(filaItem).join("")}</div>
      </div>`;
    }
    html += `<div class="card">
      <div class="row-stats">
        <div class="stat"><div class="n">${money(totalDe(editing.items))}</div><div class="l">Total</div></div>
        <div class="stat"><div class="n">${editing.items.length}</div><div class="l">Insumos</div></div>
      </div>
      <div class="fila" style="margin-top:12px;gap:8px;flex-wrap:wrap">
        <button class="btn" id="rqWa">📋 Copiar para WhatsApp</button>
        <button class="btn sec" id="rqCsv">⬇ Exportar CSV</button>
        <button class="btn sec" id="rqPdf" title="Abre la impresión: elige 'Guardar como PDF'">📄 Guardar PDF</button>
      </div>
      <button class="btn sec" id="rqDel" style="margin-top:10px;color:var(--rojo)">Borrar esta requisición</button>
    </div>`;
    cont.innerHTML = html;

    cont.querySelectorAll("[data-i]").forEach((row) => {
      const it = editing.items[Number(row.dataset.i)];
      row.querySelector("[data-f='estat']").addEventListener("click", () => {
        it.estatus = it.estatus === "pedido" ? "pendiente" : "pedido";
        actualizarChip(); pintarItems(); guardar();
      });
      row.querySelector("[data-f='cant']").addEventListener("change", (ev) => { it.cantidad = num(ev.target.value); pintarItems(); guardar(); });
      row.querySelector("[data-f='precio']").addEventListener("change", (ev) => { it.precio = num(ev.target.value); pintarItems(); guardar(); });
      row.querySelector("[data-f='prov']").addEventListener("change", (ev) => {
        const v = ev.target.value;
        if (v === "__otro__") {
          const nom = (prompt("Nombre del proveedor:", it.proveedor || "") || "").trim();
          if (nom) it.proveedor = nom;
          pintarItems(); guardar(); return;
        }
        it.proveedor = v.trim();
        const pr = provsDe(it.nombre).find((p) => p.proveedor === it.proveedor);
        if (pr) it.precio = pr.precio;   // toma el precio de ESE proveedor
        pintarItems(); guardar();
      });
      row.querySelector("[data-del]").addEventListener("click", () => { editing.items.splice(Number(row.dataset.i), 1); pintarItems(); guardar(); });
    });
    cont.querySelector("#rqWa").addEventListener("click", copiarWa);
    cont.querySelector("#rqCsv").addEventListener("click", exportarCsv);
    cont.querySelector("#rqPdf").addEventListener("click", exportarPdf);
    cont.querySelector("#rqDel").addEventListener("click", borrar);
  }

  // Proveedores a los que ya le compramos ESTE insumo (con su último precio).
  function provsDe(nombre) {
    const hit = byName.get((nombre || "").toLowerCase());
    if (!hit) return [];
    const seen = new Map(); // registros vienen recientes primero → 1er precio = el último
    for (const r of hit.registros) {
      const p = (r.proveedor || "").trim();
      if (p && !seen.has(p)) seen.set(p, num(r.precio));
    }
    return [...seen.entries()].map(([proveedor, precio]) => ({ proveedor, precio }));
  }

  function filaItem(it) {
    const idx = editing.items.indexOf(it);
    const provs = provsDe(it.nombre);
    const provCampo = provs.length
      ? `<select data-f="prov" style="flex:1 1 100px;min-width:0">
          ${provs.map((p) => `<option value="${esc(p.proveedor)}"${p.proveedor === it.proveedor ? " selected" : ""}>${esc(p.proveedor)} · ${money(p.precio)}</option>`).join("")}
          ${it.proveedor && !provs.some((p) => p.proveedor === it.proveedor) ? `<option value="${esc(it.proveedor)}" selected>${esc(it.proveedor)}</option>` : ""}
          <option value="__otro__">✏️ Otro proveedor…</option>
        </select>`
      : `<input data-f="prov" value="${esc(it.proveedor)}" placeholder="Proveedor" style="flex:1 1 100px;min-width:0" />`;
    const ie = estatusInfo(it.estatus);
    return `<div class="barra-row" data-i="${idx}" style="gap:6px;flex-wrap:wrap;border-bottom:1px solid var(--linea);padding:8px 0">
      <span class="etq" style="width:100%;font-weight:600;display:flex;align-items:center;gap:8px">
        <button data-f="estat" class="chip" title="Cambiar estatus" style="background:${ie.c};border:none;cursor:pointer;flex:none">${ie.t}</button>
        <span style="flex:1;min-width:0">${esc(it.nombre)}</span>
        <span class="val" style="margin-left:auto">${money(montoDe(it))}</span></span>
      <input data-f="cant" type="number" step="any" inputmode="decimal" value="${it.cantidad}" style="width:64px" />
      <span class="sub" style="align-self:center">${esc(it.unidad)} ×</span>
      <input data-f="precio" type="number" step="any" inputmode="decimal" value="${it.precio}" style="width:80px" />
      ${provCampo}
      <button class="linkbtn" data-del style="color:var(--rojo);padding:0 6px;font-size:16px">✕</button>
    </div>`;
  }

  function actualizarChip() {
    const c = el.querySelector("#rqChip");
    if (!c) return;
    const e = estatusInfo(derivar(editing.items));
    c.textContent = e.t; c.style.background = e.c;
  }

  // ───────────── exportar / guardar ─────────────
  function textoWa() {
    const e = estatusInfo(derivar(editing.items));
    let t = `📋 *Requisición ${hoyTxt()}*  (${e.t})\n`;
    for (const [prov, list] of grupos()) {
      t += `\n🏪 *${prov}*\n`;
      for (const it of list) {
        t += `${it.estatus === "pedido" ? "✅" : "•"} ${it.nombre} — ${num(it.cantidad)} ${it.unidad}${num(it.precio) ? ` — ${money(montoDe(it))}` : ""}\n`;
      }
      t += `   Subtotal: ${money(totalDe(list))}\n`;
    }
    t += `\n*TOTAL: ${money(totalDe(editing.items))}*`;
    return t;
  }
  async function copiarWa() {
    const txt = textoWa();
    try {
      await navigator.clipboard.writeText(txt);
      const b = el.querySelector("#rqWa"); b.textContent = "✅ Copiado";
      setTimeout(() => { b.textContent = "📋 Copiar para WhatsApp"; }, 1600);
    } catch (e) { alert("Copia esto y pégalo:\n\n" + txt); }
  }
  function exportarCsv() {
    const filas = [];
    for (const [prov, list] of grupos())
      for (const it of list)
        filas.push([prov, it.nombre, num(it.cantidad), it.unidad, num(it.precio), montoDe(it)]);
    descargarCSV("requisicion-" + hoyTxt().replace(" ", "-"),
      ["Proveedor", "Insumo", "Cantidad", "Unidad", "Precio unit.", "Monto"], filas);
  }

  // Genera un PDF REAL y lo descarga (no depende del diálogo de impresión).
  // Si no hay internet para cargar la librería, cae al respaldo de impresión.
  async function exportarPdf() {
    const btn = el.querySelector("#rqPdf");
    const txtOrig = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Generando…"; }
    try {
      const mod = await import("https://esm.sh/jspdf@2.5.2");
      const JsPDF = mod.jsPDF || (mod.default && mod.default.jsPDF) || mod.default;
      const doc = new JsPDF({ unit: "mm", format: "a4" });
      const M = 14, W = 210, RIGHT = W - M;
      const e = estatusInfo(derivar(editing.items));
      let y = 18;

      doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.setTextColor(14, 58, 57);
      doc.text("Requisición de compras", M, y); y += 5.5;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(110, 106, 92);
      doc.text(`${hoyTxt()} · ${e.t} · ${editing.items.length} insumo${editing.items.length === 1 ? "" : "s"}`, M, y); y += 5;

      const encabezado = () => {
        doc.setDrawColor(14, 58, 57); doc.setLineWidth(0.5); doc.line(M, y, RIGHT, y); y += 4;
        doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(14, 58, 57);
        doc.text("INSUMO", M + 5, y);
        doc.text("CANTIDAD", M + 96, y);
        doc.text("PRECIO", RIGHT - 32, y, { align: "right" });
        doc.text("MONTO", RIGHT, y, { align: "right" });
        y += 2.5; doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.2); doc.line(M, y, RIGHT, y); y += 4;
      };
      const salto = () => { if (y > 270) { doc.addPage(); y = 18; encabezado(); } };
      encabezado();

      for (const [prov, list] of grupos()) {
        salto();
        doc.setFillColor(244, 239, 226); doc.rect(M, y - 3.6, RIGHT - M, 5.6, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(14, 58, 57);
        doc.text(String(prov).slice(0, 55), M + 1.5, y); y += 6;

        doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(34, 32, 26);
        for (const it of list) {
          salto();
          doc.text(it.estatus === "pedido" ? "OK" : "-", M, y);
          doc.text(String(it.nombre || "").slice(0, 44), M + 5, y);
          doc.text(`${num(it.cantidad)} ${it.unidad || ""}`.trim(), M + 96, y);
          doc.text(num(it.precio) ? money(num(it.precio)) : "-", RIGHT - 32, y, { align: "right" });
          doc.text(num(it.precio) ? money(montoDe(it)) : "-", RIGHT, y, { align: "right" });
          y += 5;
        }
        salto();
        doc.setFont("helvetica", "bold"); doc.setTextColor(110, 106, 92);
        doc.text("Subtotal " + String(prov).slice(0, 28), RIGHT - 32, y, { align: "right" });
        doc.text(money(totalDe(list)), RIGHT, y, { align: "right" });
        doc.setDrawColor(225, 225, 225); doc.setLineWidth(0.2); doc.line(M, y + 1.5, RIGHT, y + 1.5);
        y += 8;
      }

      salto();
      doc.setDrawColor(14, 58, 57); doc.setLineWidth(0.5); doc.line(M, y, RIGHT, y); y += 6;
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(14, 58, 57);
      doc.text("TOTAL", RIGHT - 32, y, { align: "right" });
      doc.text(money(totalDe(editing.items)), RIGHT, y, { align: "right" });

      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(168, 162, 150);
      doc.text("Generado con Platify", W / 2, 288, { align: "center" });

      doc.save("Requisicion-" + hoyTxt().replace(/ /g, "-") + ".pdf");
    } catch (err) {
      console.warn("PDF directo falló, uso impresión:", err);
      imprimirPdf();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = txtOrig || "📄 Guardar PDF"; }
    }
  }

  // Respaldo: documento con formato + impresión del sistema ("Guardar como PDF").
  function imprimirPdf() {
    const e = estatusInfo(derivar(editing.items));
    const fecha = hoyTxt();
    let filas = "";
    for (const [prov, list] of grupos()) {
      filas += `<tr class="prov"><td colspan="5">${esc(prov)}</td></tr>`;
      for (const it of list) {
        filas += `<tr>
          <td class="c">${it.estatus === "pedido" ? "✔" : "○"}</td>
          <td>${esc(it.nombre)}</td>
          <td class="c">${num(it.cantidad)} ${esc(it.unidad || "")}</td>
          <td class="r">${num(it.precio) ? money(num(it.precio)) : "—"}</td>
          <td class="r">${num(it.precio) ? money(montoDe(it)) : "—"}</td>
        </tr>`;
      }
      filas += `<tr class="sub"><td colspan="4" class="r">Subtotal ${esc(prov)}</td><td class="r">${money(totalDe(list))}</td></tr>`;
    }

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
      <title>Requisicion-${esc(fecha.replace(/ /g, "-"))}</title>
      <style>
        *{box-sizing:border-box}
        body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#22201a;margin:22px}
        h1{font-size:20px;margin:0 0 2px;color:#0e3a39}
        .meta{color:#6f6a5c;font-size:12px;margin-bottom:16px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th{text-align:left;border-bottom:2px solid #0e3a39;padding:6px 4px;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#0e3a39}
        td{padding:6px 4px;border-bottom:1px solid #eee}
        tr.prov td{background:#f4efe2;font-weight:700;color:#0e3a39;padding-top:9px}
        tr.sub td{font-weight:700;border-bottom:2px solid #ddd;color:#6f6a5c}
        .c{text-align:center}.r{text-align:right}
        .total{margin-top:16px;text-align:right;font-size:16px;font-weight:800;color:#0e3a39}
        .pie{margin-top:26px;color:#a8a296;font-size:10px;text-align:center}
        @media print{ body{margin:12mm} tr{page-break-inside:avoid} }
      </style></head><body>
      <h1>Requisición de compras</h1>
      <div class="meta">${esc(fecha)} · ${esc(e.t)} · ${editing.items.length} insumo${editing.items.length === 1 ? "" : "s"}</div>
      <table>
        <thead><tr><th></th><th>Insumo</th><th class="c">Cantidad</th><th class="r">Precio</th><th class="r">Monto</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <div class="total">TOTAL: ${money(totalDe(editing.items))}</div>
      <div class="pie">Generado con Platify</div>
    </body></html>`;

    const ifr = document.createElement("iframe");
    ifr.setAttribute("aria-hidden", "true");
    ifr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";
    document.body.appendChild(ifr);
    const doc = ifr.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    setTimeout(() => {
      try { ifr.contentWindow.focus(); ifr.contentWindow.print(); }
      catch (err) { alert("No pude abrir la impresión en este dispositivo."); }
      setTimeout(() => { try { ifr.remove(); } catch (e2) {} }, 60000); // no quitarlo antes de imprimir
    }, 350);
  }

  async function borrar() {
    if (!confirm("¿Borrar esta requisición del historial?")) return;
    try {
      if (!editing._nuevo) await store.borrarRequisicion(editing.id);
      vista = "lista"; editing = null; pintar();
    } catch (e) { alert("No pude borrar: " + ((e && e.message) || e)); }
  }

  async function guardar(explicito) {
    editing.total = totalDe(editing.items);
    editing.estatus = derivar(editing.items);   // el general sale del de cada producto
    editing._nuevo = false;
    const msg = el.querySelector("#rqSaveMsg");
    if (explicito && msg) msg.innerHTML = `<div class="sub" style="margin-top:6px">Guardando…</div>`;
    try {
      await store.guardarRequisicion(editing);
      if (explicito && msg) msg.innerHTML = `<div class="ok-box" style="margin-top:6px">✅ Guardado. Puedes volver y editarla cuando quieras.</div>`;
    } catch (e) {
      if (explicito && msg) msg.innerHTML = `<div class="error-box" style="margin-top:6px">No pude guardar. ¿Corriste <b>requisiciones.sql</b> en Supabase? (${esc((e && e.message) || e)})</div>`;
      // sin `explicito` queda local y se reintenta al siguiente cambio
    }
  }

  return unsub;
}
