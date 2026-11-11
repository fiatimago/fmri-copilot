// ================== GUION AL PACIENTE ==================
// Lo usa session.js para el panel "Guion" de Nueva sesión.
//
// El texto NO se copia al código: se lee de la guía de entrevista
// (guias/entrevista_paciente.md), la misma que se ve en Guías. Si se edita la
// guía, el guion de Nueva sesión se actualiza solo.
//
// Cómo se encuentra cada parte en la guía:
//   - "## Entrevista ..."            → pestaña Entrevista.
//   - "## Paradigma motor unilateral (100x20)", etc. → guion de cada tarea.
//     En tasks.json, guion.seccion dice con qué texto empieza el título.
//   - "### Versión paciente diestro/zurdo" (MENV) → se muestra solo la que
//     corresponde a la lateralidad (guion.subseccionPorLateralidad).
//   - El bloque "> **Activaciones esperadas** ..." va aparte (sección plegada),
//     porque es para el técnico y no se le lee al paciente.
//   - "derecha/izquierda" se reemplaza por la mano elegida en la tarea motora.
//
// El markdown se convierte con un lector propio y pequeño (párrafos, títulos
// ###, citas, listas, negrita, cursiva y código) para no depender de una
// librería de internet en la sala del resonador.

const Guion = (() => {
  const GUIA_URL = "guias/entrevista_paciente.md";
  let sections = null; // [{ title, lines }]
  let loadError = null;

  // ---------- Lectura de la guía ----------
  function parseSections(md) {
    const result = [];
    let current = null;
    md.split(/\r?\n/).forEach((line) => {
      const h2 = line.match(/^##\s+(.+?)\s*$/);
      if (h2 && !line.startsWith("###")) {
        current = { title: h2[1], lines: [] };
        result.push(current);
      } else if (current && line.trim() !== "---") {
        current.lines.push(line);
      }
    });
    return result;
  }

  function load() {
    return fetch(GUIA_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((md) => {
        sections = parseSections(md);
      })
      .catch((err) => {
        loadError = String(err);
        console.error("No se pudo cargar la guía de entrevista:", err);
      });
  }

  const normalize = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

  function findSection(startsWith) {
    if (!sections) return null;
    const key = normalize(startsWith);
    return sections.find((s) => normalize(s.title).startsWith(key)) || null;
  }

  // Separa el bloque de cita que empieza con "**Activaciones esperadas**".
  function splitActivaciones(lines) {
    const guion = [];
    const activaciones = [];
    let i = 0;
    while (i < lines.length) {
      const isQuote = lines[i].startsWith(">");
      if (isQuote && /^\>\s*\*\*Activaciones esperadas\*\*/.test(lines[i])) {
        while (i < lines.length && lines[i].startsWith(">")) {
          activaciones.push(lines[i]);
          i++;
        }
        continue;
      }
      guion.push(lines[i]);
      i++;
    }
    // Quita la línea del título "**Activaciones esperadas**" (ya está en el panel).
    const body = activaciones
      .map((l) => l.replace(/^>\s?/, ""))
      .filter((l) => !/^\*\*Activaciones esperadas\*\*\s*$/.test(l.trim()));
    return { guion, activaciones: body };
  }

  // Conserva lo que hay antes del primer ### y solo la subsección elegida.
  function pickSubsection(lines, subTitle) {
    const out = [];
    let mode = "preamble"; // preamble | keep | skip
    lines.forEach((line) => {
      const h3 = line.match(/^###\s+(.+?)\s*$/);
      if (h3) {
        mode = normalize(h3[1]).startsWith(normalize(subTitle)) ? "keep" : "skip";
        return; // el título de la subsección no se muestra
      }
      if (mode !== "skip") out.push(line);
    });
    return out;
  }

  // ---------- Markdown mínimo → HTML ----------
  const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function inline(text) {
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  }

  function render(lines) {
    const html = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") { i++; continue; }

      const h3 = line.match(/^###\s+(.+)/);
      if (h3) { html.push(`<h4>${inline(h3[1])}</h4>`); i++; continue; }

      if (line.startsWith(">")) {
        const quoted = [];
        while (i < lines.length && lines[i].startsWith(">")) {
          quoted.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        html.push(`<blockquote>${render(quoted)}</blockquote>`);
        continue;
      }

      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
          i++;
        }
        html.push(`<ul>${items.join("")}</ul>`);
        continue;
      }

      const para = [];
      while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith(">") &&
             !/^###\s/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i])) {
        para.push(lines[i].trim());
        i++;
      }
      html.push(`<p>${inline(para.join(" "))}</p>`);
    }
    return html.join("");
  }

  // ---------- API ----------
  function status() {
    if (loadError) return { ok: false, message: `No se pudo cargar la guía de entrevista (${loadError}).` };
    if (!sections) return { ok: false, message: "Cargando guion…" };
    return { ok: true };
  }

  function entrevista() {
    const st = status();
    if (!st.ok) return { html: `<p class="hint">${escapeHtml(st.message)}</p>` };
    const sec = findSection("Entrevista");
    if (!sec) return { html: '<p class="hint">La guía no tiene una sección "Entrevista".</p>' };
    return { html: render(splitActivaciones(sec.lines).guion) };
  }

  // cfg: guion de tasks.json · opts: { handedness, hand }
  function forTask(cfg, opts) {
    const st = status();
    if (!st.ok) return { html: `<p class="hint">${escapeHtml(st.message)}</p>`, activacionesHtml: "" };
    const sec = cfg && findSection(cfg.seccion);
    if (!sec) {
      const name = cfg ? cfg.seccion : "esta tarea";
      return { html: `<p class="hint">La guía de entrevista no tiene guion para «${escapeHtml(name)}».</p>`, activacionesHtml: "" };
    }

    // Las activaciones se separan primero: en MENV están después de las dos
    // versiones y se perderían al quedarse solo con una.
    const parts = splitActivaciones(sec.lines);
    let lines = parts.guion;
    if (cfg.subseccionPorLateralidad) {
      const sub = cfg.subseccionPorLateralidad[opts.handedness];
      if (sub) lines = pickSubsection(lines, sub);
    }
    if (opts.hand) {
      const mano = opts.hand.toUpperCase();
      lines = lines.map((l) => l.replace(/derecha\s*\/\s*izquierda/gi, mano));
    }

    return { html: render(lines), activacionesHtml: render(parts.activaciones) };
  }

  return { load, entrevista, forTask };
})();
