// ================== ESTADO ==================
let allTasks = [];
let sequence = [];
let currentTaskId = null;
let currentSegment = "main"; // "explainer" | "main" — qué video de la tarea activa está sonando
let explainersEnabled = true;
let handedness = "diestro";
let language = "es";

let player;
let isPlayerReady = false;

// ================== DOM ==================
const btnToggleTasks = document.getElementById("btn-toggle-tasks");
const availableTasksPanel = document.getElementById("available-tasks-panel");
const availableTasksList = document.getElementById("available-tasks-list");
const sequenceList = document.getElementById("sequence-list");
const sequenceEmptyHint = document.getElementById("sequence-empty-hint");

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
const btnOpenPresenter = document.getElementById("btn-open-presenter");

// ================== MODO PRESENTADOR (pantalla del paciente) ==================
// Misma idea que en Investigación: una ventana sin controles (pantalla.html)
// que refleja el video que está sonando aquí, comunicada por
// BroadcastChannel. Usa un canal propio ("sesion") para que no se cruce con
// la pantalla del paciente de Investigación si ambas páginas están abiertas.
const presenterChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("fmri-sesion-presenter") : null;
let presenterSyncInterval = null; // reenvía la posición del video cada 3s mientras suena

btnOpenPresenter.addEventListener("click", () => {
  window.open("pantalla.html?canal=sesion", "fmri-pantalla-paciente-sesion", "width=1280,height=720");
  btnOpenPresenter.blur();
});

function postToPresenter(msg) {
  if (presenterChannel) presenterChannel.postMessage(msg);
}

function currentVideoId() {
  const def = currentTaskId && resolveTaskDef(currentTaskId);
  if (!def) return null;
  return currentSegment === "explainer" ? def.explainerYoutubeId : def.youtubeId;
}

// Estado completo para una pantalla del paciente que se acaba de abrir/reabrir.
function broadcastCurrentState() {
  const videoId = currentVideoId();
  if (!videoId || !restScreen.hidden) {
    postToPresenter({ type: "show-blank" });
    return;
  }
  postToPresenter({ type: "show-video", videoId });
  if (isPlayerReady) {
    const playing = player.getPlayerState() === YT.PlayerState.PLAYING;
    postToPresenter({ type: "seek-video", seconds: player.getCurrentTime(), force: true });
    postToPresenter({ type: playing ? "play-video" : "pause-video" });
  }
}

if (presenterChannel) {
  presenterChannel.addEventListener("message", (event) => {
    if (event.data && event.data.type === "request-state") broadcastCurrentState();
  });
}

// ================== BOTÓN PAUSA / REANUDAR ==================
btnPauseNav.addEventListener("click", () => {
  if (isPlayerReady && currentTaskId && restScreen.hidden) togglePlayPause();
  btnPauseNav.blur(); // evita que la barra espaciadora "haga clic" sobre el botón y pause dos veces
});

function updatePauseButtonState() {
  btnPauseNav.disabled = !isPlayerReady || !currentTaskId || !restScreen.hidden;
  const playing = isPlayerReady && player.getPlayerState() === YT.PlayerState.PLAYING;
  btnPauseNav.textContent = playing ? "⏸" : "▶";
}

// ================== UTILIDADES ==================
function whenReady(fn) {
  return (...args) => { if (isPlayerReady) fn(...args); };
}

// Convierte "MM:SS" a segundos totales. Devuelve 0 si el formato no es válido
// (por ejemplo, si todavía queda un placeholder "MM:SS" sin completar).
function durationToSeconds(mmss) {
  if (!mmss) return 0;
  const parts = mmss.split(":").map((p) => parseInt(p, 10));
  if (parts.length !== 2 || parts.some(isNaN)) return 0;
  return parts[0] * 60 + parts[1];
}

// Convierte segundos totales de vuelta a "MM:SS", con padding de ceros.
function secondsToDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Duración que se muestra en las listas, usando exclusivamente los valores
// escritos a mano en tasks.json (duration / explainerDuration).
function getDisplayDuration(def) {
  const taskSeconds = durationToSeconds(def.duration);
  const explainerSeconds = durationToSeconds(def.explainerDuration);

  if (!explainersEnabled || !explainerSeconds) {
    return { text: secondsToDuration(taskSeconds), tooltip: "" };
  }

  const total = taskSeconds + explainerSeconds;
  return {
    text: secondsToDuration(total),
    tooltip: `${def.explainerDuration} explicativo + ${def.duration} tarea`,
  };
}

// Devuelve título, duración, youtubeId y explainerYoutubeId de una tarea,
// resolviendo lateralidad (ej. MENV) e idioma.
function resolveTaskDef(taskId) {
  const task = allTasks.find((t) => t.id === taskId);
  if (!task) return null;

  const base = task.variants ? (task.variants[handedness] || task.variants.diestro) : task;
  const langData = base[language] || base.es;

  return {
    title: task.title,
    duration: langData.duration,
    explainerDuration: langData.explainerDuration,
    youtubeId: langData.youtubeId,
    explainerYoutubeId: langData.explainerYoutubeId,
  };
}

// Suma la duración de todas las tareas en la secuencia actual, incluyendo
// los explicativos si el interruptor está activado.
function computeSequenceTotalSeconds() {
  return sequence.reduce((total, taskId) => {
    const def = resolveTaskDef(taskId);
    const taskSeconds = durationToSeconds(def.duration);
    const explainerSeconds = explainersEnabled ? durationToSeconds(def.explainerDuration) : 0;
    return total + taskSeconds + explainerSeconds;
  }, 0);
}

function updateSequenceTotalLabel() {
  const el = document.getElementById("sequence-total-duration");
  if (!el) return;
  if (sequence.length === 0) {
    el.textContent = "";
    return;
  }
  const total = computeSequenceTotalSeconds();
  el.innerHTML = `Duración total estimada: <strong>${secondsToDuration(total)}</strong>`;
}

// ================== CATÁLOGO DE TAREAS ==================
fetch("data/tasks.json")
  .then((r) => r.json())
  .then((data) => {
    allTasks = data.tasks;
    renderAvailableTasks();
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

// ================== INTERRUPTOR DE EXPLICATIVOS ==================
toggleExplainers.addEventListener("change", () => {
  explainersEnabled = toggleExplainers.checked;
  refreshAllDurations();
  updateSequenceTotalLabel();
  if (currentTaskId && !isTaskCurrentlyPlaying(currentTaskId)) {
    loadTask(currentTaskId);
  }
});

// ================== SELECTOR DE LATERALIDAD ==================
handednessButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    handedness = btn.dataset.hand;
    handednessButtons.forEach((b) => b.classList.toggle("active", b === btn));
    refreshAllDurations();
    updateSequenceTotalLabel();
    reloadIfPausedAndAffected();
  });
});

// ================== SELECTOR DE IDIOMA ==================
languageButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    language = btn.dataset.lang;
    languageButtons.forEach((b) => b.classList.toggle("active", b === btn));
    refreshAllDurations();
    updateSequenceTotalLabel();
    reloadIfPausedAndAffected();
  });
});

// Recarga la tarea actual si está en pausa (nunca interrumpe una que se está reproduciendo).
function reloadIfPausedAndAffected() {
  if (currentTaskId && !isTaskCurrentlyPlaying(currentTaskId)) {
    loadTask(currentTaskId);
  }
}

// Actualiza la duración mostrada de TODAS las tareas en ambas listas.
function refreshAllDurations() {
  allTasks.forEach((task) => {
    const def = resolveTaskDef(task.id);
    const display = getDisplayDuration(def);

    const availDurationEl = availableTasksList.querySelector(`li[data-task-id="${task.id}"] .task-duration`);
    if (availDurationEl) {
      availDurationEl.textContent = display.text;
      availDurationEl.title = display.tooltip;
    }

    const seqDurationEl = sequenceList.querySelector(`.sequence-item[data-task-id="${task.id}"] .task-duration`);
    if (seqDurationEl) {
      seqDurationEl.textContent = display.text;
      seqDurationEl.title = display.tooltip;
    }
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
    const taskId = li.dataset.taskId;
    const inSequence = sequence.includes(taskId);
    li.hidden = inSequence;
    li.draggable = !inSequence;
  });
}

// ================== AGREGAR / QUITAR DE LA SECUENCIA ==================
function addTaskToSequence(taskId) {
  if (sequence.includes(taskId)) return;
  const li = createSequenceItem(taskId);
  sequenceList.appendChild(li);
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
    <span class="task-title">${def.title}</span>
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
  refreshAvailableTasksState();

  if (sequence.length === 0) {
    currentTaskId = null;
    nowPlaying.hidden = true;
    restScreen.hidden = true;
    btnPrevTask.disabled = true;
    btnNextTask.disabled = true;
    if (isPlayerReady) player.stopVideo();
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
  return isPlayerReady && taskId === currentTaskId && player.getPlayerState() === YT.PlayerState.PLAYING;
}

function updateSequenceUI() {
  const items = [...sequenceList.querySelectorAll(".sequence-item")];
  items.forEach((li, index) => {
    const taskId = li.dataset.taskId;
    const locked = isTaskCurrentlyPlaying(taskId);

    li.draggable = !locked;
    li.classList.toggle("locked", locked);

    li.querySelector(".btn-move-up").disabled = locked || index === 0;
    li.querySelector(".btn-move-down").disabled = locked || index === items.length - 1;
    li.querySelector(".task-action-btn").disabled = locked;
  });
  refreshAvailableTasksState();
}

// ================== CARGA DE TAREAS (con o sin explicativo) ==================
function loadTask(taskId) {
  currentTaskId = taskId;
  restScreen.hidden = true;
  btnStartTask.hidden = true;
  const def = resolveTaskDef(taskId);

  const startWithExplainer = explainersEnabled && !!def.explainerYoutubeId;
  currentSegment = startWithExplainer ? "explainer" : "main";
  const videoId = startWithExplainer ? def.explainerYoutubeId : def.youtubeId;

  if (isPlayerReady) player.cueVideoById(videoId);
  clearInterval(presenterSyncInterval);
  postToPresenter({ type: "show-video", videoId });
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
btnPrevTask.addEventListener("click", whenReady(() => {
  const index = sequence.indexOf(currentTaskId);
  if (index > 0) loadTask(sequence[index - 1]);
  btnPrevTask.blur();
}));

btnNextTask.addEventListener("click", whenReady(() => {
  const index = sequence.indexOf(currentTaskId);
  if (index !== -1 && index < sequence.length - 1) loadTask(sequence[index + 1]);
  btnNextTask.blur();
}));

btnContinueNext.addEventListener("click", whenReady(() => {
  const index = sequence.indexOf(currentTaskId);
  if (index !== -1 && index < sequence.length - 1) loadTask(sequence[index + 1]);
  btnContinueNext.blur();
}));

// ================== PLAYER DE YOUTUBE (con sus controles nativos) ==================
function onYouTubeIframeAPIReady() {
  player = new YT.Player("youtube-player", {
    height: "100%",
    width: "100%",
    playerVars: {
      controls: 1,        // controles nativos de YouTube, visibles
      rel: 0,
      modestbranding: 1,
      iv_load_policy: 3,
      cc_load_policy: 0,  // subtítulos apagados por defecto; el usuario los activa manualmente si quiere
    },
    events: { onReady: onPlayerReady, onStateChange: onPlayerStateChange, onError: onPlayerError },
  });
}

function onPlayerReady() {
  isPlayerReady = true;
  if (currentTaskId) loadTask(currentTaskId);
  updatePauseButtonState();
}

function onPlayerError(event) {
  console.error("YouTube error, code:", event.data);
  currentTaskName.textContent = "⚠ Error al cargar el video (código " + event.data + ")";
}

function onPlayerStateChange(event) {
  updateSequenceUI();

  if (event.data === YT.PlayerState.PLAYING) {
    restScreen.hidden = true;
    postToPresenter({ type: "seek-video", seconds: player.getCurrentTime() });
    postToPresenter({ type: "play-video" });
    // Corrige el desfase entre ambos reproductores cada 3s. La pantalla del
    // paciente solo salta si la diferencia supera su umbral, así que no
    // hay cortes visibles mientras estén sincronizados.
    clearInterval(presenterSyncInterval);
    presenterSyncInterval = setInterval(() => {
      postToPresenter({ type: "seek-video", seconds: player.getCurrentTime() });
    }, 3000);
  } else if (event.data === YT.PlayerState.PAUSED) {
    clearInterval(presenterSyncInterval);
    postToPresenter({ type: "seek-video", seconds: player.getCurrentTime(), force: true });
    postToPresenter({ type: "pause-video" });
  } else if (event.data === YT.PlayerState.ENDED) {
    clearInterval(presenterSyncInterval);
    if (currentSegment === "explainer") {
      currentSegment = "main";
      showPauseBeforeTask();
      updateNowPlayingLabel();
    } else {
      showRestScreen();
    }
  }

  updatePauseButtonState();
}

function showRestScreen() {
  const index = sequence.indexOf(currentTaskId);
  const isLast = index === -1 || index >= sequence.length - 1;
  btnContinueNext.hidden = isLast;
  btnStartTask.hidden = true;
  restScreen.hidden = false;
  postToPresenter({ type: "show-blank" });
  updatePauseButtonState();
}

// Pantalla negra entre el video explicativo y la tarea: la tarea no arranca
// sola, el técnico la inicia con "Iniciar tarea" cuando el paciente esté listo.
function showPauseBeforeTask() {
  btnContinueNext.hidden = true;
  btnStartTask.hidden = false;
  restScreen.hidden = false;
  postToPresenter({ type: "show-blank" });
  updatePauseButtonState();
}

btnStartTask.addEventListener("click", whenReady(() => {
  const def = resolveTaskDef(currentTaskId);
  if (!def) return;
  restScreen.hidden = true;
  btnStartTask.hidden = true;
  // Primero avisar a la pantalla del paciente y luego cargar: así el
  // "play" que dispara loadVideoById siempre le llega después del cambio de video.
  postToPresenter({ type: "show-video", videoId: def.youtubeId });
  player.loadVideoById(def.youtubeId);
  btnStartTask.blur();
}));

// ================== ATAJO DE BARRA ESPACIADORA (opcional) ==================
// No es un control visual — es solo un atajo de teclado. Si prefieres depender
// 100% del comportamiento nativo de YouTube, borra este bloque completo.
function togglePlayPause() {
  const state = player.getPlayerState();
  state === YT.PlayerState.PLAYING ? player.pauseVideo() : player.playVideo();
}

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || !isPlayerReady) return;
  // En las pantallas negras (pausa antes de la tarea / descanso) la barra
  // espaciadora no hace nada: se avanza solo con los botones.
  if (!restScreen.hidden) return;
  const tag = document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  event.preventDefault();
  togglePlayPause();
});