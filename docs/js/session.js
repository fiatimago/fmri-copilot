// ================== ESTADO ==================
let allTasks = [];
let sequence = [];
let currentTaskId = null;
let currentSegment = "main"; // "explainer" | "main" — qué video de la tarea activa está cargado
let currentVideoPath = null; // ruta del archivo cargado en el reproductor (ej. "videos/muni_es_tarea.mp4")
let explainersEnabled = true;
let handedness = "diestro";
let language = "es";

// ================== DOM ==================
const player = document.getElementById("video-player");

const btnToggleTasks = document.getElementById("btn-toggle-tasks");
const availableTasksPanel = document.getElementById("available-tasks-panel");
const availableTasksList = document.getElementById("available-tasks-list");
const sequenceList = document.getElementById("sequence-list");
const sequenceEmptyHint = document.getElementById("sequence-empty-hint");
const preloadStatus = document.getElementById("preload-status");

const toggleExplainers = document.getElementById("toggle-explainers");
const handednessButtons = document.querySelectorAll(".handedness-btn");
const languageButtons = document.querySelectorAll(".language-btn");

const nowPlaying = document.getElementById("now-playing");
const currentTaskName = document.getElementById("current-task-name");
const progressLabel = document.getElementById("progress-label");

const restScreen = document.getElementById("rest-screen");
const btnContinueNext = document.getElementById("btn-continue-next");
const btnStartTask = document.getElementById("btn-start-task");

const btnPrevTask = document.getElementById("btn-prev-task");
const btnNextTask = document.getElementById("btn-next-task");
const btnPauseNav = document.getElementById("btn-pause-nav");
const btnDownloadReport = document.getElementById("btn-download-report");
const btnOpenPresenter = document.getElementById("btn-open-presenter");

function isVideoPlaying() {
  return !!currentVideoPath && !player.paused && !player.ended;
}

// ================== MODO PRESENTADOR (pantalla del paciente) ==================
// Una ventana sin controles (pantalla.html) que refleja el video que está
// sonando aquí, comunicada por BroadcastChannel. Usa un canal propio
// ("sesion") para que no se cruce con la pantalla del paciente de
// Investigación si ambas páginas están abiertas. Se le manda la RUTA del
// archivo; ella busca la copia ya descargada en el caché del navegador.
const presenterChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("fmri-sesion-presenter") : null;
let presenterSyncInterval = null; // reenvía la posición del video cada 3s mientras suena

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
    if (event.data && event.data.type === "request-state") broadcastCurrentState();
  });
}

// ================== REGISTRO DE LO QUE REALMENTE SE REPRODUJO ==================
// Cada video que llega a sonar (explicativo o tarea) genera una entrada con
// hora de inicio/fin, tiempo efectivo reproduciéndose (sin contar pausas),
// número de pausas y si terminó completo o se interrumpió (se cambió de
// tarea, se recargó por idioma/lateralidad, etc.). El idioma y la
// lateralidad se guardan por entrada porque pueden cambiar a mitad de sesión.
const sessionLog = [];
let currentLogEntry = null;
const sessionStartedAt = new Date();

function openLogEntry() {
  const def = resolveTaskDef(currentTaskId);
  const now = Date.now();
  currentLogEntry = {
    taskId: currentTaskId,
    title: def ? def.title : currentTaskId,
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

// ================== REPORTE DE LA SESIÓN ==================
function msToClock(ms) {
  return secondsToDuration(Math.round(ms / 1000));
}

function timeOfDay(ts) {
  return new Date(ts).toLocaleTimeString("es-CO", { hour12: false });
}

const LANG_LABEL = { es: "Español", en: "English" };
const HAND_LABEL = { diestro: "Diestro", zurdo: "Zurdo" };
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

function buildSessionReport() {
  const now = new Date();
  const entries = sessionLog.map(snapshotEntry);
  const lines = [];

  lines.push("REPORTE DE SESIÓN — FMRI Assistant (Nueva sesión)");
  lines.push(`Generado: ${now.toLocaleString("es-CO")}`);
  lines.push(`Página abierta desde: ${sessionStartedAt.toLocaleString("es-CO")}`);
  lines.push("");
  lines.push("Configuración al momento del reporte:");
  lines.push(`  Videos explicativos: ${explainersEnabled ? "activados" : "desactivados"}`);
  lines.push(`  Idioma: ${LANG_LABEL[language]}`);
  lines.push(`  Lateralidad: ${HAND_LABEL[handedness]} (solo cambia el video de MENV)`);
  lines.push("");

  // ---- Secuencia planeada ----
  lines.push("=".repeat(70));
  lines.push("SECUENCIA PLANEADA (orden actual en la lista)");
  lines.push("=".repeat(70));
  if (sequence.length === 0) lines.push("  (vacía)");
  sequence.forEach((taskId, i) => {
    const def = resolveTaskDef(taskId);
    const taskSec = VideoDurations.get(def.video);
    let explainerText = "sin explicativo";
    if (explainersEnabled) {
      explainerText = def.explainerVideo
        ? `explicativo ${formatDuration(VideoDurations.get(def.explainerVideo))}`
        : "explicativo no disponible en este idioma";
    }
    lines.push(`  ${i + 1}. ${def.title} (${taskId}) — tarea ${formatDuration(taskSec)} | ${explainerText}`);
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
    lines.push(`${i + 1}. [${timeOfDay(s.startedAt)} – ${end}] ${s.title} (${s.taskId}) — ${SEGMENT_LABEL[s.segment]}`);
    lines.push(`   Idioma: ${LANG_LABEL[s.language]} | Lateralidad: ${HAND_LABEL[s.handedness]} | Archivo: ${fileName(s.file)}`);
    lines.push(
      `   Duración del video: ${s.videoDurationS ? msToClock(s.videoDurationS * 1000) : "—"} | ` +
      `Reproducido: ${msToClock(s.playedMs)} | Total: ${msToClock(s.wallMs)} | Pausas: ${s.pauses}`
    );
    lines.push(`   Estado: ${entryStatus(s)}`);
    lines.push("");
  });

  // ---- Resumen por tarea ----
  lines.push("=".repeat(70));
  lines.push("RESUMEN POR TAREA");
  lines.push("=".repeat(70));
  const taskIds = [...new Set([...sequence, ...entries.map((s) => s.taskId)])];
  if (taskIds.length === 0) lines.push("  (sin tareas)");
  taskIds.forEach((taskId) => {
    const def = resolveTaskDef(taskId);
    const ofTask = entries.filter((s) => s.taskId === taskId);
    const describe = (segment) => {
      const list = ofTask.filter((s) => s.segment === segment);
      if (list.length === 0) return segment === "explainer" ? "no se mostró" : "no se reprodujo";
      const played = list.reduce((sum, s) => sum + s.playedMs, 0);
      const anyCompleted = list.some((s) => s.completed);
      const times = list.length > 1 ? ` (${list.length} veces)` : "";
      return `${anyCompleted ? "completo" : "incompleto"}${times}, reproducido ${msToClock(played)}`;
    };
    lines.push(`- ${def ? def.title : taskId} (${taskId})${sequence.includes(taskId) ? "" : " — ya no está en la secuencia"}`);
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

// Devuelve título y rutas de video/explicativo de una tarea, resolviendo
// lateralidad (ej. MENV) e idioma. explainerVideo es null si no existe en
// ese idioma (hoy: inglés).
function resolveTaskDef(taskId) {
  const task = allTasks.find((t) => t.id === taskId);
  if (!task) return null;

  const base = task.variants ? (task.variants[handedness] || task.variants.diestro) : task;
  const langData = base[language] || base.es;

  return {
    title: task.title,
    video: langData.video,
    explainerVideo: langData.explainerVideo || null,
  };
}

function hasExplainer(def) {
  return explainersEnabled && !!def.explainerVideo;
}

function taskTotalSeconds(def) {
  return VideoDurations.get(def.video) + (hasExplainer(def) ? VideoDurations.get(def.explainerVideo) : 0);
}

function getDisplayDuration(def) {
  const taskSec = VideoDurations.get(def.video);
  const explainerSec = hasExplainer(def) ? VideoDurations.get(def.explainerVideo) : 0;
  const known = taskSec > 0 && (!hasExplainer(def) || explainerSec > 0);
  return {
    text: known ? formatDuration(taskSec + explainerSec) : "…",
    tooltip: hasExplainer(def) ? `${formatDuration(explainerSec)} explicativo + ${formatDuration(taskSec)} tarea` : "",
  };
}

function computeSequenceTotalSeconds() {
  return sequence.reduce((total, taskId) => total + taskTotalSeconds(resolveTaskDef(taskId)), 0);
}

function updateSequenceTotalLabel() {
  const el = document.getElementById("sequence-total-duration");
  if (!el) return;
  if (sequence.length === 0) {
    el.textContent = "";
    return;
  }
  el.innerHTML = `Duración total estimada: <strong>${formatDuration(computeSequenceTotalSeconds())}</strong>`;
}

// Lee la duración real de los videos del idioma/lateralidad actuales y
// refresca las listas cuando las tiene.
function probeAllDurations() {
  const srcs = [];
  allTasks.forEach((task) => {
    const def = resolveTaskDef(task.id);
    srcs.push(def.video);
    if (def.explainerVideo) srcs.push(def.explainerVideo);
  });
  srcs.forEach((src) =>
    VideoDurations.probe(src).then(() => {
      refreshAllDurations();
      updateSequenceTotalLabel();
    })
  );
}

// ================== DESCARGA PREVIA DE LOS VIDEOS ==================
// Todo lo que está en la secuencia (y su explicativo, si están activados)
// se descarga completo en segundo plano, en el orden de la secuencia.
function videosNeededFor(taskId) {
  const def = resolveTaskDef(taskId);
  const srcs = [];
  if (hasExplainer(def)) srcs.push(def.explainerVideo);
  srcs.push(def.video);
  return srcs;
}

async function preloadSequence() {
  for (const taskId of [...sequence]) {
    for (const src of videosNeededFor(taskId)) {
      await VideoCache.preload(src);
    }
  }
}

function taskPreloadText(taskId) {
  const states = videosNeededFor(taskId).map((src) => VideoCache.getState(src));
  if (states.some((s) => s && s.status === "error")) return "⚠ no se pudo descargar, se usará internet";
  if (states.every((s) => s && s.status === "ready")) return "✓ listo sin conexión";
  const downloading = states.find((s) => s && s.status === "downloading");
  if (downloading) return `descargando… ${Math.round(downloading.progress * 100)}%`;
  return "en espera de descarga";
}

function refreshPreloadStatus() {
  sequence.forEach((taskId) => {
    const small = sequenceList.querySelector(`.sequence-item[data-task-id="${taskId}"] .preload-state`);
    if (small) small.textContent = taskPreloadText(taskId);
  });
  if (sequence.length === 0) {
    preloadStatus.textContent = "";
    return;
  }
  const all = sequence.flatMap(videosNeededFor);
  const ready = all.filter((src) => VideoCache.getState(src)?.status === "ready").length;
  preloadStatus.textContent = ready === all.length
    ? "✓ Todos los videos de la secuencia están descargados."
    : `Descargando videos de la secuencia: ${ready}/${all.length} listos.`;
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

// ================== CATÁLOGO DE TAREAS ==================
fetch("data/tasks.json")
  .then((r) => r.json())
  .then((data) => {
    allTasks = data.tasks;
    renderAvailableTasks();
    probeAllDurations();
  })
  .catch((err) => {
    availableTasksList.innerHTML = "<li>⚠ No se pudo cargar el catálogo de tareas.</li>";
    console.error("Error cargando tasks.json:", err);
  });

// ================== MOSTRAR / OCULTAR TAREAS DISPONIBLES ==================
btnToggleTasks.addEventListener("click", () => {
  const isHidden = availableTasksPanel.hidden;
  availableTasksPanel.hidden = !isHidden;
  btnToggleTasks.textContent = isHidden ? "Ocultar tareas disponibles" : "Mostrar tareas disponibles";
});

// ================== AJUSTES: EXPLICATIVOS / LATERALIDAD / IDIOMA ==================
// Cualquier cambio vuelve a calcular duraciones, descarga lo que falte y
// recarga la tarea actual si está en pausa (nunca interrumpe una que suena).
function onSettingsChanged() {
  probeAllDurations();
  refreshAllDurations();
  updateSequenceTotalLabel();
  preloadSequence();
  refreshPreloadStatus();
  if (currentTaskId && !isTaskCurrentlyPlaying(currentTaskId)) loadTask(currentTaskId);
}

toggleExplainers.addEventListener("change", () => {
  explainersEnabled = toggleExplainers.checked;
  onSettingsChanged();
});

handednessButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    handedness = btn.dataset.hand;
    handednessButtons.forEach((b) => b.classList.toggle("active", b === btn));
    onSettingsChanged();
  });
});

languageButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    language = btn.dataset.lang;
    languageButtons.forEach((b) => b.classList.toggle("active", b === btn));
    onSettingsChanged();
  });
});

// Actualiza la duración mostrada de TODAS las tareas en ambas listas.
function refreshAllDurations() {
  allTasks.forEach((task) => {
    const display = getDisplayDuration(resolveTaskDef(task.id));
    const selectors = [
      `#available-tasks-list li[data-task-id="${task.id}"] .task-duration`,
      `#sequence-list .sequence-item[data-task-id="${task.id}"] .task-duration`,
    ];
    selectors.forEach((sel) => {
      const el = document.querySelector(sel);
      if (el) {
        el.textContent = display.text;
        el.title = display.tooltip;
      }
    });
  });
}

// ================== LISTA DE TAREAS DISPONIBLES ==================
function renderAvailableTasks() {
  availableTasksList.innerHTML = "";
  allTasks.forEach((task) => {
    const def = resolveTaskDef(task.id);
    const display = getDisplayDuration(def);

    const li = document.createElement("li");
    li.draggable = true;
    li.dataset.taskId = task.id;
    li.innerHTML = `
      <span class="task-title">${def.title}</span>
      <span class="task-duration" title="${display.tooltip}">${display.text}</span>
      <button class="task-action-btn btn-add" type="button" title="Agregar a la secuencia">+</button>
    `;

    li.addEventListener("dragstart", (e) => {
      if (sequence.includes(task.id)) { e.preventDefault(); return; }
      e.dataTransfer.setData("text/plain", JSON.stringify({ type: "new", taskId: task.id }));
    });

    li.querySelector(".task-action-btn").addEventListener("click", () => addTaskToSequence(task.id));

    availableTasksList.appendChild(li);
  });
  refreshAvailableTasksState();
}

function refreshAvailableTasksState() {
  [...availableTasksList.children].forEach((li) => {
    const inSequence = sequence.includes(li.dataset.taskId);
    li.hidden = inSequence;
    li.draggable = !inSequence;
  });
}

// ================== AGREGAR / QUITAR DE LA SECUENCIA ==================
function addTaskToSequence(taskId) {
  if (sequence.includes(taskId)) return;
  sequenceList.appendChild(createSequenceItem(taskId));
  syncSequenceFromDOM();
}

function removeTaskFromSequence(taskId) {
  if (isTaskCurrentlyPlaying(taskId)) return;
  const li = sequenceList.querySelector(`.sequence-item[data-task-id="${taskId}"]`);
  if (li) li.remove();
  syncSequenceFromDOM();
}

// ================== SECUENCIA (drag & drop + botones) ==================
function createSequenceItem(taskId) {
  const def = resolveTaskDef(taskId);
  const display = getDisplayDuration(def);

  const li = document.createElement("li");
  li.className = "sequence-item";
  li.draggable = true;
  li.dataset.taskId = taskId;
  li.innerHTML = `
    <span class="drag-handle">⠿</span>
    <span class="task-title">${def.title}<small class="preload-state"></small></span>
    <span class="task-duration" title="${display.tooltip}">${display.text}</span>
    <div class="move-buttons">
      <button class="btn-move btn-move-up" type="button" title="Subir">▲</button>
      <button class="btn-move btn-move-down" type="button" title="Bajar">▼</button>
    </div>
    <button class="task-action-btn btn-remove" type="button" title="Quitar">✕</button>
  `;

  li.addEventListener("dragstart", (e) => {
    if (isTaskCurrentlyPlaying(taskId)) { e.preventDefault(); return; }
    li.classList.add("dragging");
    e.dataTransfer.setData("text/plain", JSON.stringify({ type: "move" }));
  });
  li.addEventListener("dragend", () => {
    li.classList.remove("dragging");
    syncSequenceFromDOM();
  });

  li.querySelector(".btn-move-up").addEventListener("click", () => moveSequenceItem(li, -1));
  li.querySelector(".btn-move-down").addEventListener("click", () => moveSequenceItem(li, 1));
  li.querySelector(".task-action-btn").addEventListener("click", () => removeTaskFromSequence(taskId));

  return li;
}

function moveSequenceItem(li, direction) {
  if (isTaskCurrentlyPlaying(li.dataset.taskId)) return;
  if (direction === -1 && li.previousElementSibling) {
    sequenceList.insertBefore(li, li.previousElementSibling);
  } else if (direction === 1 && li.nextElementSibling) {
    sequenceList.insertBefore(li.nextElementSibling, li);
  }
  syncSequenceFromDOM();
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
    if (sequence.includes(data.taskId)) return;
    const li = createSequenceItem(data.taskId);
    const afterElement = getDragAfterElement(sequenceList, e.clientY);
    afterElement ? sequenceList.insertBefore(li, afterElement) : sequenceList.appendChild(li);
    syncSequenceFromDOM();
  } else if (data.type === "move") {
    syncSequenceFromDOM();
  }
});

// Se llama siempre que la secuencia cambia: agregar, quitar o reordenar.
function syncSequenceFromDOM() {
  sequence = [...sequenceList.querySelectorAll(".sequence-item")].map((li) => li.dataset.taskId);
  sequenceEmptyHint.hidden = sequence.length > 0;
  btnDownloadReport.disabled = sequence.length === 0 && sessionLog.length === 0;
  refreshAvailableTasksState();
  preloadSequence();
  refreshPreloadStatus();

  if (sequence.length === 0) {
    currentTaskId = null;
    nowPlaying.hidden = true;
    restScreen.hidden = true;
    btnPrevTask.disabled = true;
    btnNextTask.disabled = true;
    closeLogEntry(false);
    unloadVideo();
    clearInterval(presenterSyncInterval);
    postToPresenter({ type: "show-blank" });
    updatePauseButtonState();
    updateSequenceTotalLabel();
    return;
  }

  if (!currentTaskId || !sequence.includes(currentTaskId)) {
    loadTask(sequence[0]);
  } else {
    updateNowPlayingLabel();
    updateNavButtonsState();
  }
  updateSequenceUI();
  updateSequenceTotalLabel();
}

function isTaskCurrentlyPlaying(taskId) {
  return taskId === currentTaskId && isVideoPlaying();
}

function updateSequenceUI() {
  const items = [...sequenceList.querySelectorAll(".sequence-item")];
  items.forEach((li, index) => {
    const locked = isTaskCurrentlyPlaying(li.dataset.taskId);
    li.draggable = !locked;
    li.classList.toggle("locked", locked);
    li.querySelector(".btn-move-up").disabled = locked || index === 0;
    li.querySelector(".btn-move-down").disabled = locked || index === items.length - 1;
    li.querySelector(".task-action-btn").disabled = locked;
  });
  refreshAvailableTasksState();
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

// ================== CARGA DE TAREAS (con o sin explicativo) ==================
function loadTask(taskId) {
  closeLogEntry(false); // si algo estaba a medias, queda registrado como interrumpido
  currentTaskId = taskId;
  restScreen.hidden = true;
  btnStartTask.hidden = true;
  const def = resolveTaskDef(taskId);

  currentSegment = hasExplainer(def) ? "explainer" : "main";
  setVideo(currentSegment === "explainer" ? def.explainerVideo : def.video);

  clearInterval(presenterSyncInterval);
  postToPresenter({ type: "show-video", src: currentVideoPath });
  updateNowPlayingLabel();
  updateNavButtonsState();
  updateSequenceUI();
  updatePauseButtonState();
}

function updateNowPlayingLabel() {
  const index = sequence.indexOf(currentTaskId);
  const def = resolveTaskDef(currentTaskId);
  const suffix = currentSegment === "explainer" ? " — video explicativo" : "";
  currentTaskName.textContent = def ? def.title + suffix : "—";
  progressLabel.textContent = `(${index + 1}/${sequence.length})`;
  nowPlaying.hidden = false;
}

function updateNavButtonsState() {
  const index = sequence.indexOf(currentTaskId);
  btnPrevTask.disabled = index <= 0;
  btnNextTask.disabled = index === -1 || index >= sequence.length - 1;
}

// ================== NAVEGAR ENTRE TAREAS ==================
btnPrevTask.addEventListener("click", () => {
  const index = sequence.indexOf(currentTaskId);
  if (index > 0) loadTask(sequence[index - 1]);
  btnPrevTask.blur();
});

btnNextTask.addEventListener("click", () => {
  const index = sequence.indexOf(currentTaskId);
  if (index !== -1 && index < sequence.length - 1) loadTask(sequence[index + 1]);
  btnNextTask.blur();
});

btnContinueNext.addEventListener("click", () => {
  const index = sequence.indexOf(currentTaskId);
  if (index !== -1 && index < sequence.length - 1) loadTask(sequence[index + 1]);
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
  updateSequenceUI();
  updatePauseButtonState();
});

player.addEventListener("pause", () => {
  // Al terminar, el navegador también dispara "pause": eso lo maneja "ended".
  if (player.ended) return;
  logPaused();
  clearInterval(presenterSyncInterval);
  postToPresenter({ type: "seek-video", seconds: player.currentTime, force: true });
  postToPresenter({ type: "pause-video" });
  updateSequenceUI();
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
    updateNowPlayingLabel();
  } else {
    showRestScreen();
  }
  updateSequenceUI();
  updatePauseButtonState();
});

player.addEventListener("error", () => {
  if (!currentVideoPath) return;
  const code = player.error ? player.error.code : "?";
  console.error("Error del reproductor:", currentVideoPath, player.error);
  currentTaskName.textContent = `⚠ No se pudo reproducir ${fileName(currentVideoPath)} (código ${code})`;
});

function showRestScreen() {
  const index = sequence.indexOf(currentTaskId);
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
  const def = resolveTaskDef(currentTaskId);
  if (!def) return;
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
  event.preventDefault();
  togglePlayPause();
});


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
