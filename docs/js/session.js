// ================== ESTADO ==================
// La secuencia es una lista de INSTANCIAS: la misma tarea puede estar varias
// veces (ej. motor con la mano derecha y luego con la izquierda). Cada
// instancia tiene su número de repetición, su mano (si la tarea la usa) y si
// lleva video explicativo.
let allTasks = [];
let sequence = []; // [{ id, taskId, n, hand, explainer }] en el orden de la lista
let currentId = null; // instancia cargada en el reproductor
let currentSegment = "main"; // "explainer" | "main" — qué video de la instancia está cargado
let currentVideoPath = null; // ruta del archivo cargado (ej. "videos/muni_es_tarea.mp4")
let explainersEnabled = true;
let handedness = "diestro";
let language = "es";
let nextInstanceNumber = 1; // para los id internos (s1, s2…)
const repeatCounters = {}; // taskId → última repetición asignada (#1, #2…)

// ================== DOM ==================
const player = document.getElementById("video-player");

const addTaskButtons = document.getElementById("add-task-buttons");
const sequenceList = document.getElementById("sequence-list");
const sequenceEmptyHint = document.getElementById("sequence-empty-hint");
const sequenceCount = document.getElementById("sequence-count");
const sequenceTotal = document.getElementById("sequence-total-duration");
const preloadStatus = document.getElementById("preload-status");

const toggleExplainers = document.getElementById("toggle-explainers");
const handednessButtons = document.querySelectorAll(".handedness-btn");
const languageButtons = document.querySelectorAll(".language-btn");
const paramsSummary = document.getElementById("params-summary");

const nowTitle = document.getElementById("now-title");
const nowDetail = document.getElementById("now-detail");

const restScreen = document.getElementById("rest-screen");
const btnContinueNext = document.getElementById("btn-continue-next");
const btnStartTask = document.getElementById("btn-start-task");

const btnPrevTask = document.getElementById("btn-prev-task");
const btnNextTask = document.getElementById("btn-next-task");
const btnPauseNav = document.getElementById("btn-pause-nav");
const btnDownloadReport = document.getElementById("btn-download-report");
const btnOpenPresenter = document.getElementById("btn-open-presenter");
const presenterState = document.getElementById("presenter-state");

const panelGuion = document.getElementById("panel-guion");
const guionTabs = document.querySelectorAll(".guion-tab");
const guionBody = document.getElementById("guion-body");
const panelActivaciones = document.getElementById("panel-activaciones");
const activacionesBody = document.getElementById("activaciones-body");

const HAND_WORD = { derecha: "Derecha", izquierda: "Izquierda" };
const HAND_SHORT = { derecha: "Der.", izquierda: "Izq." };

function isVideoPlaying() {
  return !!currentVideoPath && !player.paused && !player.ended;
}

// ================== INSTANCIAS ==================
function taskMeta(taskId) {
  return allTasks.find((t) => t.id === taskId) || null;
}

function instanceById(id) {
  return sequence.find((inst) => inst.id === id) || null;
}

function currentInstance() {
  return instanceById(currentId);
}

// "Motor unilateral #2": el número aparece cuando la tarea está más de una vez
// o cuando ya no es la primera repetición.
function instanceLabel(inst, short = false) {
  const meta = taskMeta(inst.taskId);
  const name = meta ? (short ? meta.shortTitle || meta.title : meta.title) : inst.taskId;
  const repeated = inst.n > 1 || sequence.filter((i) => i.taskId === inst.taskId).length > 1;
  return repeated ? `${name} #${inst.n}` : name;
}

function usesExplainer(inst) {
  const def = resolveTaskDef(inst.taskId);
  return explainersEnabled && inst.explainer && !!def.explainerVideo;
}

// Mano propuesta para una tarea motora nueva: la dominante primero; si ya hay
// una con esa mano y falta la otra, la otra.
function proposeHand(taskId) {
  const dominant = handedness === "zurdo" ? "izquierda" : "derecha";
  const other = dominant === "derecha" ? "izquierda" : "derecha";
  const used = sequence.filter((i) => i.taskId === taskId).map((i) => i.hand);
  return used.includes(dominant) && !used.includes(other) ? other : dominant;
}

function createInstance(taskId) {
  const meta = taskMeta(taskId);
  repeatCounters[taskId] = (repeatCounters[taskId] || 0) + 1;
  return {
    id: `s${nextInstanceNumber++}`,
    taskId,
    n: repeatCounters[taskId],
    hand: meta && meta.manoSeleccionable ? proposeHand(taskId) : null,
    // El explicativo va solo la primera vez que la tarea aparece en la secuencia.
    explainer: !sequence.some((i) => i.taskId === taskId),
  };
}

// ================== MODO PRESENTADOR (pantalla del paciente) ==================
// Una ventana sin controles (pantalla.html) que refleja el video que está
// sonando aquí, comunicada por BroadcastChannel. Usa un canal propio
// ("sesion") para que no se cruce con la pantalla del paciente de
// Investigación si ambas páginas están abiertas. Se le manda la RUTA del
// archivo; ella busca la copia ya descargada en el caché del navegador.
const presenterChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("fmri-sesion-presenter") : null;
let presenterSyncInterval = null; // reenvía la posición del video cada 3s mientras suena
let lastPresenterContact = 0; // última vez que la pantalla del paciente respondió

btnOpenPresenter.addEventListener("click", () => {
  window.open("pantalla.html?canal=sesion", "fmri-pantalla-paciente-sesion", "width=1280,height=720");
  btnOpenPresenter.blur();
});

function postToPresenter(msg) {
  if (presenterChannel) presenterChannel.postMessage(msg);
}

// Estado completo para una pantalla del paciente que se acaba de abrir/reabrir.
function broadcastCurrentState() {
  if (!currentVideoPath || !restScreen.hidden) {
    postToPresenter({ type: "show-blank" });
    return;
  }
  postToPresenter({ type: "show-video", src: currentVideoPath });
  postToPresenter({ type: "seek-video", seconds: player.currentTime, force: true });
  postToPresenter({ type: isVideoPlaying() ? "play-video" : "pause-video" });
}

if (presenterChannel) {
  presenterChannel.addEventListener("message", (event) => {
    const type = event.data && event.data.type;
    if (type === "request-state" || type === "pong") lastPresenterContact = Date.now();
    if (type === "request-state") broadcastCurrentState();
    if (type === "request-state" || type === "pong") updatePresenterIndicator();
  });
}

// Indicador "conectada / no abierta": se le pregunta a la pantalla del
// paciente cada 2 s; si no responde en 5 s, se considera cerrada.
function updatePresenterIndicator() {
  const connected = Date.now() - lastPresenterContact < 5000;
  presenterState.textContent = connected ? "conectada" : "no abierta";
  presenterState.classList.toggle("on", connected);
}
setInterval(() => {
  postToPresenter({ type: "ping" });
  updatePresenterIndicator();
}, 2000);
updatePresenterIndicator();

// ================== REGISTRO DE LO QUE REALMENTE SE REPRODUJO ==================
// Cada video que llega a sonar (explicativo o tarea) genera una entrada con
// hora de inicio/fin, tiempo efectivo reproduciéndose (sin contar pausas),
// número de pausas y si terminó completo o se interrumpió (se cambió de
// tarea, se recargó por idioma/lateralidad, etc.). Idioma, lateralidad y mano
// se guardan por entrada porque pueden cambiar a mitad de sesión.
const sessionLog = [];
let currentLogEntry = null;
const sessionStartedAt = new Date();

function openLogEntry() {
  const inst = currentInstance();
  const now = Date.now();
  currentLogEntry = {
    instanceId: inst.id,
    taskId: inst.taskId,
    label: instanceLabel(inst),
    hand: inst.hand,
    segment: currentSegment, // "explainer" | "main"
    file: currentVideoPath,
    language,
    handedness,
    startedAt: now,
    endedAt: null,
    playingSince: now,
    playedMs: 0,
    pauses: 0,
    videoDurationS: Number.isFinite(player.duration) ? player.duration : 0,
    completed: false,
  };
  sessionLog.push(currentLogEntry);
}

function logPlaying() {
  if (!currentLogEntry) openLogEntry();
  else if (currentLogEntry.playingSince === null) currentLogEntry.playingSince = Date.now();
  if (!currentLogEntry.videoDurationS && Number.isFinite(player.duration)) currentLogEntry.videoDurationS = player.duration;
}

function logPaused() {
  const e = currentLogEntry;
  if (!e || e.playingSince === null) return;
  e.playedMs += Date.now() - e.playingSince;
  e.playingSince = null;
  e.pauses++;
}

// completed = true solo cuando el video llegó a su final.
function closeLogEntry(completed) {
  const e = currentLogEntry;
  if (!e) return;
  const now = Date.now();
  if (e.playingSince !== null) e.playedMs += now - e.playingSince;
  e.playingSince = null;
  e.endedAt = now;
  e.completed = completed;
  currentLogEntry = null;
}

function isInstanceCompleted(inst) {
  return sessionLog.some((e) => e.instanceId === inst.id && e.segment === "main" && e.completed);
}

// ================== REPORTE DE LA SESIÓN ==================
function msToClock(ms) {
  return secondsToDuration(Math.round(ms / 1000));
}

function timeOfDay(ts) {
  return new Date(ts).toLocaleTimeString("es-CO", { hour12: false });
}

const LANG_LABEL = { es: "Español", en: "English" };
const HANDEDNESS_LABEL = { diestro: "Diestro", zurdo: "Zurdo" };
const SEGMENT_LABEL = { explainer: "Video explicativo", main: "Tarea" };

// Copia de la entrada con los tiempos "hasta ahora" si el video sigue abierto.
function snapshotEntry(e) {
  const now = Date.now();
  const playedMs = e.playedMs + (e.playingSince !== null ? now - e.playingSince : 0);
  return { ...e, playedMs, wallMs: (e.endedAt || now) - e.startedAt, open: e.endedAt === null };
}

function entryStatus(s) {
  if (s.open) return "en curso al generar el reporte";
  return s.completed ? "completo" : "interrumpido";
}

function fileName(path) {
  return path ? path.split("/").pop() : "—";
}

const handText = (hand) => (hand ? ` · mano ${hand}` : "");

function buildSessionReport() {
  const now = new Date();
  const entries = sessionLog.map(snapshotEntry);
  const lines = [];

  lines.push("REPORTE DE SESIÓN — fMRI Copilot (Nueva sesión)");
  lines.push(`Generado: ${now.toLocaleString("es-CO")}`);
  lines.push(`Página abierta desde: ${sessionStartedAt.toLocaleString("es-CO")}`);
  lines.push("");
  lines.push("Configuración al momento del reporte:");
  lines.push(`  Videos explicativos: ${explainersEnabled ? "activados" : "desactivados"}`);
  lines.push(`  Idioma: ${LANG_LABEL[language]}`);
  lines.push(`  Lateralidad: ${HANDEDNESS_LABEL[handedness]} (solo cambia el video de MENV)`);
  lines.push("");

  // ---- Secuencia planeada ----
  lines.push("=".repeat(70));
  lines.push("SECUENCIA PLANEADA (orden actual en la lista)");
  lines.push("=".repeat(70));
  if (sequence.length === 0) lines.push("  (vacía)");
  sequence.forEach((inst, i) => {
    const def = resolveTaskDef(inst.taskId);
    let explainerText = "sin explicativo";
    if (usesExplainer(inst)) explainerText = `explicativo ${formatDuration(VideoDurations.get(def.explainerVideo))}`;
    else if (explainersEnabled && inst.explainer && !def.explainerVideo) explainerText = "explicativo no disponible en este idioma";
    lines.push(`  ${i + 1}. ${instanceLabel(inst)} (${inst.taskId})${handText(inst.hand)} — tarea ${formatDuration(VideoDurations.get(def.video))} | ${explainerText}`);
  });
  if (sequence.length > 0) lines.push(`  Duración total estimada: ${formatDuration(computeSequenceTotalSeconds())}`);
  lines.push("");

  // ---- Registro cronológico ----
  lines.push("=".repeat(70));
  lines.push("REGISTRO DE REPRODUCCIÓN (en el orden en que sonaron)");
  lines.push("=".repeat(70));
  lines.push("Reproducido = tiempo efectivo sonando (sin pausas). Total = desde que empezó hasta que terminó, con pausas.");
  lines.push("");
  if (entries.length === 0) lines.push("  (no se reprodujo ningún video)");
  entries.forEach((s, i) => {
    const end = s.open ? "…" : timeOfDay(s.endedAt);
    lines.push(`${i + 1}. [${timeOfDay(s.startedAt)} – ${end}] ${s.label} (${s.taskId})${handText(s.hand)} — ${SEGMENT_LABEL[s.segment]}`);
    lines.push(`   Idioma: ${LANG_LABEL[s.language]} | Lateralidad: ${HANDEDNESS_LABEL[s.handedness]} | Archivo: ${fileName(s.file)}`);
    lines.push(
      `   Duración del video: ${s.videoDurationS ? msToClock(s.videoDurationS * 1000) : "—"} | ` +
      `Reproducido: ${msToClock(s.playedMs)} | Total: ${msToClock(s.wallMs)} | Pausas: ${s.pauses}`
    );
    lines.push(`   Estado: ${entryStatus(s)}`);
    lines.push("");
  });

  // ---- Resumen por tarea de la secuencia (cada repetición por separado) ----
  lines.push("=".repeat(70));
  lines.push("RESUMEN POR TAREA");
  lines.push("=".repeat(70));
  const instanceIds = [...new Set([...sequence.map((i) => i.id), ...entries.map((s) => s.instanceId)])];
  if (instanceIds.length === 0) lines.push("  (sin tareas)");
  instanceIds.forEach((id) => {
    const inSeq = instanceById(id);
    const ofInst = entries.filter((s) => s.instanceId === id);
    const label = inSeq ? instanceLabel(inSeq) : ofInst[0].label;
    const taskId = inSeq ? inSeq.taskId : ofInst[0].taskId;
    const hand = inSeq ? inSeq.hand : ofInst[0].hand;
    const describe = (segment) => {
      const list = ofInst.filter((s) => s.segment === segment);
      if (list.length === 0) return segment === "explainer" ? "no se mostró" : "no se reprodujo";
      const played = list.reduce((sum, s) => sum + s.playedMs, 0);
      const anyCompleted = list.some((s) => s.completed);
      const times = list.length > 1 ? ` (${list.length} veces)` : "";
      return `${anyCompleted ? "completo" : "incompleto"}${times}, reproducido ${msToClock(played)}`;
    };
    lines.push(`- ${label} (${taskId})${handText(hand)}${inSeq ? "" : " — ya no está en la secuencia"}`);
    lines.push(`    Explicativo: ${describe("explainer")}`);
    lines.push(`    Tarea:       ${describe("main")}`);
  });

  return lines.join("\n");
}

btnDownloadReport.addEventListener("click", () => {
  const blob = new Blob([buildSessionReport()], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`; // hora local
  const a = document.createElement("a");
  a.href = url;
  a.download = `sesion-${stamp}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  btnDownloadReport.blur();
});

// ================== BOTÓN PAUSA / REANUDAR ==================
btnPauseNav.addEventListener("click", () => {
  if (currentVideoPath && restScreen.hidden) togglePlayPause();
  btnPauseNav.blur(); // evita que la barra espaciadora "haga clic" sobre el botón y pause dos veces
});

function updatePauseButtonState() {
  btnPauseNav.disabled = !currentVideoPath || !restScreen.hidden;
  btnPauseNav.textContent = isVideoPlaying() ? "⏸" : "▶";
}

// ================== UTILIDADES ==================
function secondsToDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Duración leída del archivo; "…" mientras todavía no se conoce.
function formatDuration(seconds) {
  return seconds > 0 ? secondsToDuration(Math.round(seconds)) : "…";
}

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Devuelve título y rutas de video/explicativo de una tarea, resolviendo
// lateralidad (ej. MENV) e idioma. explainerVideo es null si no existe en
// ese idioma (hoy: inglés).
function resolveTaskDef(taskId) {
  const task = taskMeta(taskId);
  if (!task) return null;

  const base = task.variants ? (task.variants[handedness] || task.variants.diestro) : task;
  const langData = base[language] || base.es;

  return {
    title: task.title,
    video: langData.video,
    explainerVideo: langData.explainerVideo || null,
  };
}

function instanceSeconds(inst) {
  const def = resolveTaskDef(inst.taskId);
  return VideoDurations.get(def.video) + (usesExplainer(inst) ? VideoDurations.get(def.explainerVideo) : 0);
}

function instanceDurationText(inst) {
  const def = resolveTaskDef(inst.taskId);
  const taskSec = VideoDurations.get(def.video);
  const explainerSec = usesExplainer(inst) ? VideoDurations.get(def.explainerVideo) : 0;
  const known = taskSec > 0 && (!usesExplainer(inst) || explainerSec > 0);
  return {
    text: known ? formatDuration(taskSec + explainerSec) : "…",
    tooltip: usesExplainer(inst) ? `${formatDuration(explainerSec)} explicativo + ${formatDuration(taskSec)} tarea` : "",
  };
}

function computeSequenceTotalSeconds() {
  return sequence.reduce((total, inst) => total + instanceSeconds(inst), 0);
}

function updateSequenceTotalLabel() {
  sequenceCount.textContent = sequence.length ? `(${sequence.length})` : "";
  sequenceTotal.innerHTML = sequence.length
    ? `Total <strong>${formatDuration(computeSequenceTotalSeconds())}</strong>`
    : "";
}

// Lee la duración real de los videos del idioma/lateralidad actuales y
// refresca la lista cuando las tiene.
function probeAllDurations() {
  allTasks.forEach((task) => {
    const def = resolveTaskDef(task.id);
    [def.video, def.explainerVideo].filter(Boolean).forEach((src) =>
      VideoDurations.probe(src).then(() => {
        refreshSequenceDurations();
        updateSequenceTotalLabel();
      })
    );
  });
}

// ================== DESCARGA PREVIA DE LOS VIDEOS ==================
// Todo lo que está en la secuencia (y su explicativo, si lo lleva) se
// descarga completo en segundo plano, en el orden de la secuencia. Un video
// repetido se descarga una sola vez.
function videosNeededFor(inst) {
  const def = resolveTaskDef(inst.taskId);
  const srcs = [];
  if (usesExplainer(inst)) srcs.push(def.explainerVideo);
  srcs.push(def.video);
  return srcs;
}

async function preloadSequence() {
  for (const inst of [...sequence]) {
    for (const src of videosNeededFor(inst)) {
      await VideoCache.preload(src);
    }
  }
}

// "ready" | "error" | "downloading" | "waiting", y el progreso si descarga.
function instancePreloadState(inst) {
  const states = videosNeededFor(inst).map((src) => VideoCache.getState(src));
  if (states.some((s) => s && s.status === "error")) return { state: "error" };
  if (states.every((s) => s && s.status === "ready")) return { state: "ready" };
  const downloading = states.find((s) => s && s.status === "downloading");
  if (downloading) return { state: "downloading", progress: downloading.progress };
  return { state: "waiting" };
}

const PRELOAD_TEXT = {
  ready: "✓ sin conexión",
  error: "⚠ se usará internet",
  waiting: "en espera",
};

function refreshPreloadStatus() {
  sequence.forEach((inst) => {
    const el = sequenceList.querySelector(`.sequence-item[data-instance-id="${inst.id}"] .preload-state`);
    if (!el) return;
    const st = instancePreloadState(inst);
    el.textContent = st.state === "downloading" ? `⏳ ${Math.round(st.progress * 100)}%` : PRELOAD_TEXT[st.state];
    el.dataset.state = st.state;
  });
  if (sequence.length === 0) {
    preloadStatus.textContent = "";
    return;
  }
  const all = [...new Set(sequence.flatMap(videosNeededFor))];
  const ready = all.filter((src) => VideoCache.getState(src)?.status === "ready").length;
  preloadStatus.textContent = ready === all.length
    ? "✓ Todos los videos de la secuencia están descargados."
    : `Descargando videos: ${ready}/${all.length} listos.`;
}

VideoCache.onChange((src, state) => {
  refreshPreloadStatus();
  // Si el video que está cargado (y aún sin empezar) terminó de descargarse,
  // se cambia a la copia local para que ya no dependa de la red.
  if (src === currentVideoPath && state.status === "ready" && player.paused && player.currentTime === 0) {
    const local = VideoCache.playableUrl(src);
    if (player.src !== local) {
      player.src = local;
      player.load();
    }
  }
});

// ================== CATÁLOGO DE TAREAS Y GUION ==================
fetch("data/tasks.json")
  .then((r) => r.json())
  .then((data) => {
    allTasks = data.tasks;
    renderAddButtons();
    probeAllDurations();
    renderGuion();
  })
  .catch((err) => {
    addTaskButtons.innerHTML = '<p class="hint">⚠ No se pudo cargar el catálogo de tareas.</p>';
    console.error("Error cargando tasks.json:", err);
  });

Guion.load().then(renderGuion);

// ================== PANELES PLEGABLES ==================
// Cada panel recuerda si quedó abierto o plegado (solo en este navegador).
document.querySelectorAll("details[data-remember]").forEach((panel) => {
  const key = `ns-panel-${panel.id}`;
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) panel.open = saved === "1";
  } catch (err) { /* sin almacenamiento: se usa el estado por defecto */ }
  panel.addEventListener("toggle", () => {
    try { localStorage.setItem(key, panel.open ? "1" : "0"); } catch (err) { /* ignorar */ }
  });
});

// ================== AJUSTES: EXPLICATIVOS / LATERALIDAD / IDIOMA ==================
// Cualquier cambio vuelve a calcular duraciones, descarga lo que falte y
// recarga la tarea actual si está en pausa (nunca interrumpe una que suena).
function updateParamsSummary() {
  paramsSummary.textContent =
    `${language.toUpperCase()} · ${HANDEDNESS_LABEL[handedness]} · Explicativos ${explainersEnabled ? "✓" : "✗"}`;
}

function onSettingsChanged() {
  updateParamsSummary();
  probeAllDurations();
  renderSequence();
  preloadSequence();
  renderGuion();
  if (currentId && !isInstanceCurrentlyPlaying(currentId)) loadInstance(currentId);
}

toggleExplainers.addEventListener("change", () => {
  explainersEnabled = toggleExplainers.checked;
  onSettingsChanged();
});

handednessButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    handedness = btn.dataset.hand;
    handednessButtons.forEach((b) => b.classList.toggle("active", b === btn));
    btn.blur();
    onSettingsChanged();
  });
});

languageButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    language = btn.dataset.lang;
    languageButtons.forEach((b) => b.classList.toggle("active", b === btn));
    btn.blur();
    onSettingsChanged();
  });
});

updateParamsSummary();

// ================== BOTONES PARA AGREGAR TAREAS ==================
function renderAddButtons() {
  addTaskButtons.innerHTML = "";
  allTasks.forEach((task) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "add-task-btn";
    btn.draggable = true;
    btn.dataset.taskId = task.id;
    btn.title = `Agregar «${task.title}» a la secuencia (se puede repetir)`;
    btn.textContent = `+ ${task.shortTitle || task.title}`;
    btn.addEventListener("click", () => {
      addInstance(task.id);
      btn.blur();
    });
    btn.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ type: "new", taskId: task.id }));
    });
    addTaskButtons.appendChild(btn);
  });
}

// ================== AGREGAR / QUITAR / EDITAR INSTANCIAS ==================
function addInstance(taskId, beforeId = null) {
  const inst = createInstance(taskId);
  const at = beforeId ? sequence.findIndex((i) => i.id === beforeId) : -1;
  if (at >= 0) sequence.splice(at, 0, inst);
  else sequence.push(inst);
  onSequenceChanged();
}

function removeInstance(id) {
  if (isInstanceCurrentlyPlaying(id)) return;
  sequence = sequence.filter((i) => i.id !== id);
  onSequenceChanged();
}

function moveInstance(id, direction) {
  if (isInstanceCurrentlyPlaying(id)) return;
  const i = sequence.findIndex((inst) => inst.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= sequence.length) return;
  [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
  onSequenceChanged();
}

function setInstanceHand(id, hand) {
  const inst = instanceById(id);
  if (!inst || isInstanceCurrentlyPlaying(id)) return;
  inst.hand = hand;
  renderSequence();
  if (id === currentId) {
    updateNowBar();
    renderGuion();
  }
}

function toggleInstanceExplainer(id) {
  const inst = instanceById(id);
  if (!inst || isInstanceCurrentlyPlaying(id)) return;
  inst.explainer = !inst.explainer;
  renderSequence();
  updateSequenceTotalLabel();
  preloadSequence();
  if (id === currentId) loadInstance(id);
}

// ================== SECUENCIA: DIBUJO, ORDEN Y ARRASTRE ==================
function renderSequence() {
  sequenceList.innerHTML = "";
  sequence.forEach((inst, index) => {
    const meta = taskMeta(inst.taskId);
    const def = resolveTaskDef(inst.taskId);
    const locked = isInstanceCurrentlyPlaying(inst.id);
    const isCurrent = inst.id === currentId;
    const done = isInstanceCompleted(inst);
    const dur = instanceDurationText(inst);

    const li = document.createElement("li");
    li.className = "sequence-item";
    li.classList.toggle("current", isCurrent);
    li.classList.toggle("done", done);
    li.classList.toggle("locked", locked);
    li.draggable = !locked;
    li.dataset.instanceId = inst.id;

    const status = isCurrent ? "▶" : done ? "✓" : "";
    const statusTitle = isCurrent ? "Tarea cargada" : done ? "Completada" : "";

    let handHtml = "";
    if (meta && meta.manoSeleccionable) {
      handHtml = `<span class="hand-toggle" title="Mano con la que se hace la tarea">${
        ["derecha", "izquierda"].map((h) =>
          `<button type="button" class="hand-btn${inst.hand === h ? " active" : ""}" data-hand="${h}"${locked ? " disabled" : ""}>${HAND_SHORT[h]}</button>`
        ).join("")}</span>`;
    }

    let explainerHtml = "";
    if (explainersEnabled && def.explainerVideo) {
      explainerHtml = `<button type="button" class="expl-toggle${inst.explainer ? " on" : ""}"${locked ? " disabled" : ""}
        title="${inst.explainer ? "Con video explicativo (clic para quitarlo)" : "Sin video explicativo (clic para agregarlo)"}">🎬</button>`;
    }

    li.innerHTML = `
      <span class="seq-status" title="${statusTitle}">${status}</span>
      <span class="drag-handle">⠿</span>
      <div class="seq-main">
        <div class="seq-title">${index + 1}. ${escapeHtml(instanceLabel(inst, true))}</div>
        <div class="seq-meta">${handHtml}${explainerHtml}<small class="preload-state"></small></div>
      </div>
      <span class="task-duration" title="${dur.tooltip}">${dur.text}</span>
      <div class="move-buttons">
        <button class="btn-move btn-move-up" type="button" title="Subir"${locked || index === 0 ? " disabled" : ""}>▲</button>
        <button class="btn-move btn-move-down" type="button" title="Bajar"${locked || index === sequence.length - 1 ? " disabled" : ""}>▼</button>
      </div>
      <button class="task-action-btn btn-remove" type="button" title="Quitar"${locked ? " disabled" : ""}>✕</button>
    `;

    li.querySelector(".btn-move-up").addEventListener("click", () => moveInstance(inst.id, -1));
    li.querySelector(".btn-move-down").addEventListener("click", () => moveInstance(inst.id, 1));
    li.querySelector(".btn-remove").addEventListener("click", () => removeInstance(inst.id));
    li.querySelectorAll(".hand-btn").forEach((b) =>
      b.addEventListener("click", () => {
        setInstanceHand(inst.id, b.dataset.hand);
        b.blur();
      })
    );
    const expl = li.querySelector(".expl-toggle");
    if (expl) expl.addEventListener("click", () => toggleInstanceExplainer(inst.id));

    li.addEventListener("dragstart", (e) => {
      if (isInstanceCurrentlyPlaying(inst.id)) { e.preventDefault(); return; }
      li.classList.add("dragging");
      e.dataTransfer.setData("text/plain", JSON.stringify({ type: "move", id: inst.id }));
    });
    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      const order = [...sequenceList.querySelectorAll(".sequence-item")].map((el) => el.dataset.instanceId);
      sequence.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      onSequenceChanged();
    });

    sequenceList.appendChild(li);
  });
  sequenceEmptyHint.hidden = sequence.length > 0;
  refreshPreloadStatus();
  updateSequenceTotalLabel();
}

function refreshSequenceDurations() {
  sequence.forEach((inst) => {
    const el = sequenceList.querySelector(`.sequence-item[data-instance-id="${inst.id}"] .task-duration`);
    if (!el) return;
    const dur = instanceDurationText(inst);
    el.textContent = dur.text;
    el.title = dur.tooltip;
  });
}

function getDragAfterElement(container, y) {
  const items = [...container.querySelectorAll(".sequence-item:not(.dragging)")];
  return items.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

sequenceList.addEventListener("dragover", (e) => {
  e.preventDefault();
  const draggingEl = sequenceList.querySelector(".dragging");
  if (draggingEl) {
    const afterElement = getDragAfterElement(sequenceList, e.clientY);
    afterElement ? sequenceList.insertBefore(draggingEl, afterElement) : sequenceList.appendChild(draggingEl);
  }
});

sequenceList.addEventListener("drop", (e) => {
  e.preventDefault();
  let data;
  try { data = JSON.parse(e.dataTransfer.getData("text/plain") || "{}"); } catch { return; }
  if (data.type === "new") {
    const afterElement = getDragAfterElement(sequenceList, e.clientY);
    addInstance(data.taskId, afterElement ? afterElement.dataset.instanceId : null);
  }
  // "move": el nuevo orden se toma en dragend.
});

// Se llama siempre que la secuencia cambia: agregar, quitar o reordenar.
function onSequenceChanged() {
  btnDownloadReport.disabled = sequence.length === 0 && sessionLog.length === 0;
  preloadSequence();

  if (sequence.length === 0) {
    currentId = null;
    restScreen.hidden = true;
    btnPrevTask.disabled = true;
    btnNextTask.disabled = true;
    closeLogEntry(false);
    unloadVideo();
    clearInterval(presenterSyncInterval);
    postToPresenter({ type: "show-blank" });
    renderSequence();
    updateNowBar();
    updatePauseButtonState();
    renderGuion();
    return;
  }

  if (!currentId || !instanceById(currentId)) {
    loadInstance(sequence[0].id);
    return;
  }
  renderSequence();
  updateNowBar();
  updateNavButtonsState();
}

function isInstanceCurrentlyPlaying(id) {
  return id === currentId && isVideoPlaying();
}

// ================== BARRA "AHORA" ==================
function updateNowBar() {
  const inst = currentInstance();
  if (!inst) {
    nowTitle.textContent = "Agrega una tarea para empezar";
    nowDetail.textContent = "";
    return;
  }
  const index = sequence.indexOf(inst);
  const parts = [];
  if (inst.hand) parts.push(`mano ${inst.hand.toUpperCase()}`);
  parts.push(currentSegment === "explainer" ? "Video explicativo" : "Tarea");
  parts.push(`(${index + 1}/${sequence.length})`);
  nowTitle.textContent = instanceLabel(inst);
  nowDetail.textContent = parts.join(" · ");
}

// ================== GUION ==================
// Pestañas "Entrevista" y "Tarea actual". El texto sale de la guía de
// entrevista (ver guion.js). No hay guion en inglés: en English el panel se oculta.
let guionTab = "entrevista";

guionTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    guionTab = tab.dataset.tab;
    tab.blur();
    renderGuion();
  });
});

function renderGuion() {
  panelGuion.hidden = language !== "es";
  if (panelGuion.hidden) return;

  guionTabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === guionTab));

  if (guionTab === "entrevista") {
    guionBody.innerHTML = Guion.entrevista().html;
    panelActivaciones.hidden = true;
    return;
  }

  const inst = currentInstance();
  if (!inst) {
    guionBody.innerHTML = '<p class="hint">Agrega una tarea a la secuencia para ver su guion.</p>';
    panelActivaciones.hidden = true;
    return;
  }
  const meta = taskMeta(inst.taskId);
  const g = Guion.forTask(meta && meta.guion, { handedness, hand: inst.hand });
  const heading = `${escapeHtml(instanceLabel(inst))}${inst.hand ? ` · mano ${HAND_WORD[inst.hand].toLowerCase()}` : ""}`;
  guionBody.innerHTML = `<h4 class="guion-heading">${heading}</h4>${g.html}`;
  activacionesBody.innerHTML = g.activacionesHtml;
  panelActivaciones.hidden = !g.activacionesHtml;
}

// ================== REPRODUCTOR ==================
// Carga un archivo en el reproductor, en pausa. Usa la copia descargada si
// ya está lista; si no, lo lee desde internet mientras termina la descarga.
function setVideo(path) {
  currentVideoPath = path;
  player.src = VideoCache.playableUrl(path);
  player.load();
}

function unloadVideo() {
  currentVideoPath = null;
  player.pause();
  player.removeAttribute("src");
  player.load();
}

// ================== CARGA DE UNA INSTANCIA (con o sin explicativo) ==================
function loadInstance(id) {
  closeLogEntry(false); // si algo estaba a medias, queda registrado como interrumpido
  const changed = id !== currentId;
  currentId = id;
  restScreen.hidden = true;
  btnStartTask.hidden = true;
  const inst = currentInstance();
  const def = resolveTaskDef(inst.taskId);

  currentSegment = usesExplainer(inst) ? "explainer" : "main";
  setVideo(currentSegment === "explainer" ? def.explainerVideo : def.video);

  clearInterval(presenterSyncInterval);
  postToPresenter({ type: "show-video", src: currentVideoPath });

  // Ya en plena sesión, al cambiar de tarea el guion salta a "Tarea actual".
  if (changed && sessionLog.length > 0) guionTab = "tarea";

  renderSequence();
  updateNowBar();
  updateNavButtonsState();
  updatePauseButtonState();
  renderGuion();
}

function updateNavButtonsState() {
  const index = sequence.findIndex((i) => i.id === currentId);
  btnPrevTask.disabled = index <= 0;
  btnNextTask.disabled = index === -1 || index >= sequence.length - 1;
}

// ================== NAVEGAR ENTRE TAREAS ==================
function loadRelative(offset) {
  const index = sequence.findIndex((i) => i.id === currentId);
  const target = sequence[index + offset];
  if (index !== -1 && target) loadInstance(target.id);
}

btnPrevTask.addEventListener("click", () => {
  loadRelative(-1);
  btnPrevTask.blur();
});

btnNextTask.addEventListener("click", () => {
  loadRelative(1);
  btnNextTask.blur();
});

btnContinueNext.addEventListener("click", () => {
  loadRelative(1);
  btnContinueNext.blur();
});

// ================== EVENTOS DEL REPRODUCTOR ==================
player.addEventListener("play", () => {
  restScreen.hidden = true;
  logPlaying();
  postToPresenter({ type: "seek-video", seconds: player.currentTime });
  postToPresenter({ type: "play-video" });
  // Corrige el desfase entre ambos reproductores cada 3s. La pantalla del
  // paciente solo salta si la diferencia supera su umbral, así que no hay
  // cortes visibles mientras estén sincronizados.
  clearInterval(presenterSyncInterval);
  presenterSyncInterval = setInterval(() => {
    postToPresenter({ type: "seek-video", seconds: player.currentTime });
  }, 3000);
  renderSequence();
  updatePauseButtonState();
});

player.addEventListener("pause", () => {
  // Al terminar, el navegador también dispara "pause": eso lo maneja "ended".
  if (player.ended) return;
  logPaused();
  clearInterval(presenterSyncInterval);
  postToPresenter({ type: "seek-video", seconds: player.currentTime, force: true });
  postToPresenter({ type: "pause-video" });
  renderSequence();
  updatePauseButtonState();
});

// Si el técnico adelanta/retrocede con la barra del reproductor, la
// pantalla del paciente salta al mismo punto de inmediato.
player.addEventListener("seeked", () => {
  if (currentVideoPath) postToPresenter({ type: "seek-video", seconds: player.currentTime, force: true });
});

player.addEventListener("ended", () => {
  closeLogEntry(true);
  clearInterval(presenterSyncInterval);
  if (currentSegment === "explainer") {
    currentSegment = "main";
    showPauseBeforeTask();
  } else {
    showRestScreen();
  }
  renderSequence();
  updateNowBar();
  updatePauseButtonState();
});

player.addEventListener("error", () => {
  if (!currentVideoPath) return;
  const code = player.error ? player.error.code : "?";
  console.error("Error del reproductor:", currentVideoPath, player.error);
  nowDetail.textContent = `⚠ No se pudo reproducir ${fileName(currentVideoPath)} (código ${code})`;
});

function showRestScreen() {
  const index = sequence.findIndex((i) => i.id === currentId);
  const isLast = index === -1 || index >= sequence.length - 1;
  btnContinueNext.hidden = isLast;
  btnStartTask.hidden = true;
  restScreen.hidden = false;
  postToPresenter({ type: "show-blank" });
  updatePauseButtonState();
}

// Pantalla negra entre el video explicativo y la tarea. "Continuar a la
// tarea" solo quita la pantalla negra y deja la tarea cargada EN PAUSA: el
// arranque siempre es con ▶ (o la barra espaciadora), igual que el explicativo.
function showPauseBeforeTask() {
  btnContinueNext.hidden = true;
  btnStartTask.hidden = false;
  restScreen.hidden = false;
  postToPresenter({ type: "show-blank" });
  updatePauseButtonState();
}

btnStartTask.addEventListener("click", () => {
  const inst = currentInstance();
  if (!inst) return;
  const def = resolveTaskDef(inst.taskId);
  restScreen.hidden = true;
  btnStartTask.hidden = true;
  setVideo(def.video);
  postToPresenter({ type: "show-video", src: def.video });
  updatePauseButtonState();
  btnStartTask.blur();
});

// ================== ATAJO DE BARRA ESPACIADORA ==================
function togglePlayPause() {
  if (isVideoPlaying()) player.pause();
  else player.play().catch((err) => console.error("No se pudo reproducir:", err));
}

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || !currentVideoPath) return;
  // En las pantallas negras (pausa antes de la tarea / descanso) la barra
  // espaciadora no hace nada: se avanza solo con los botones.
  if (!restScreen.hidden) return;
  // Si el foco está en el reproductor, el navegador ya pausa/reproduce solo.
  if (document.activeElement === player) return;
  const tag = document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  // En los paneles plegables, la barra espaciadora abre/cierra el panel.
  if (tag === "SUMMARY") return;
  event.preventDefault();
  togglePlayPause();
});

// Estado inicial de la pantalla.
renderSequence();
updateNowBar();

// ================== PROTECCIÓN DE LA SESIÓN AL CAMBIAR DE PÁGINA ==================
// Cada sección del sitio es una página aparte: salir de esta (clic en la
// barra, recargar, cerrar) borra la secuencia armada y el registro del
// reporte, y corta el audio, que sale de esta ventana. Por eso, mientras haya
// una sesión armada:
//   1. Los enlaces de la barra (Guías, Home, la otra página) se abren en OTRA
//      pestaña; el enlace a esta misma página no hace nada.
//   2. Si igual se intenta salir (recargar, cerrar, escribir otra dirección),
//      el navegador pide confirmación (el texto del aviso lo pone él).
//   3. Si se confirma la salida, la pantalla del paciente se pone en negro
//      en vez de quedarse con un video sin control y sin audio.
function hasActiveSession() {
  return sequence.length > 0 || sessionLog.length > 0;
}

document.querySelectorAll(".navbar a[href]").forEach((link) => {
  link.addEventListener("click", (event) => {
    if (!hasActiveSession()) return;
    event.preventDefault();
    const target = new URL(link.href, window.location.href);
    if (target.pathname === window.location.pathname) return;
    window.open(target.href, "_blank", "noopener");
  });
});

window.addEventListener("beforeunload", (event) => {
  if (!hasActiveSession()) return;
  event.preventDefault();
  event.returnValue = ""; // necesario en algunos navegadores para mostrar el aviso
});

window.addEventListener("pagehide", () => {
  if (presenterChannel) presenterChannel.postMessage({ type: "show-blank" });
});
