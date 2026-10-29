console.log("investigacion.js — v6: controles iguales a Nueva sesión (Anterior / ▶⏸ / Siguiente)");

// ================== ESTADO ==================
let allTasks = [];
let sequence = []; // array de instancias: { instanceId, taskId, label, numBlocks, blockDuration, stimuliPerBlock, schedule }
let currentInstanceId = null;
// true en cuanto algo arrancó en la sesión (cualquier explicativo o
// secuencia de imágenes). Mientras sea false, la sesión "no ha empezado" y
// el escenario sigue siempre a la primera de la lista. Vuelve a false solo
// si se vacía la secuencia.
let sessionStarted = false;
// Se incrementa cada vez que cambia qué instancia manda en pantalla (carga
// una nueva, o se vacía la secuencia). Cualquier callback asíncrono viejo
// (precarga de imágenes de una instancia ya borrada) se compara contra este
// número antes de tocar el DOM — si no coincide, no hace nada.
let stageGeneration = 0;

// ================== MODO PRESENTADOR (pantalla del paciente) ==================
// Ventana separada, sin controles, que solo refleja lo que el paciente debe
// ver. Se comunica con esta ventana por BroadcastChannel — sin servidor,
// sin dependencias nuevas. Si el navegador no soporta BroadcastChannel
// (muy poco probable hoy en día), el botón simplemente no hace nada útil,
// pero el resto de la app sigue funcionando igual.
const presenterChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("fmri-investigacion-presenter") : null;
let presenterWindowRef = null;

const btnOpenPresenter = document.getElementById("btn-open-presenter");
btnOpenPresenter.addEventListener("click", () => {
  presenterWindowRef = window.open("pantalla.html", "fmri-pantalla-paciente", "width=1280,height=720");
});

if (presenterChannel) {
  presenterChannel.addEventListener("message", (event) => {
    if (event.data && event.data.type === "request-state") broadcastCurrentState();
  });
}

// Le manda a la pantalla del paciente exactamente lo que corresponde según
// el estado actual — se usa tanto en cada cambio real como cuando la
// pantalla del paciente se abre/reabre y pide "el estado actual" de una.
function broadcastCurrentState() {
  if (!presenterChannel) return;

  if (!currentInstanceId || !restScreen.hidden) {
    presenterChannel.postMessage({ type: "show-blank" });
    return;
  }

  if (currentSegment === "explainer") {
    const instance = getCurrentInstance();
    const def = instance && resolveExplainerDef(instance.taskId);
    if (!def) {
      presenterChannel.postMessage({ type: "show-blank" });
      return;
    }
    presenterChannel.postMessage({ type: "show-explainer", src: def.explainerVideo });
    presenterChannel.postMessage({ type: "seek-explainer", seconds: explainerPlayer.currentTime, force: true });
    presenterChannel.postMessage({ type: isPlaying ? "play-explainer" : "pause-explainer" });
    return;
  }

  if (!stageImage.hidden && stageImage.src) {
    presenterChannel.postMessage({ type: "show-image", src: stageImage.src });
  } else {
    presenterChannel.postMessage({ type: "show-blank" });
  }
}
let nextInstanceNumber = 1;

let currentStepIndex = -1;
let playStartTimestamp = 0;
let elapsedAtPauseMs = 0;
let isPlaying = false;

// ================== RELOJ DE LA SECUENCIA ==================
// Cuando la ventana de control queda oculta (minimizada, otra pestaña, o
// tapada por la pantalla del paciente en pantalla completa), el navegador
// frena los setInterval normales: a 1 vez por segundo y, tras unos minutos,
// hasta 1 vez por minuto. Por eso antes la secuencia se pausaba al ocultarse.
// Ahora el "tic" lo da un Web Worker, al que el navegador no le aplica ese
// frenado, así la secuencia sigue a tiempo aunque la ventana no esté visible.
// El tiempo transcurrido se sigue midiendo con Date.now(), así que un tic
// tardío nunca acumula error: solo cambia la imagen un poco después.
const sequenceTicker = (() => {
  const TICK_MS = 50;
  let worker = null;
  let fallbackId = null;
  try {
    const src = `let id=null;onmessage=(e)=>{clearInterval(id);if(e.data==="start")id=setInterval(()=>postMessage(0),${TICK_MS});};`;
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    worker.onmessage = () => tick();
  } catch (err) {
    console.warn("No se pudo crear el Worker del reloj; se usa setInterval (puede frenarse en segundo plano).", err);
    worker = null;
  }
  return {
    start() {
      this.stop();
      if (worker) worker.postMessage("start");
      else fallbackId = setInterval(tick, TICK_MS);
    },
    stop() {
      if (worker) worker.postMessage("stop");
      clearInterval(fallbackId);
      fallbackId = null;
    },
  };
})();
let imagesPreloaded = false;

// Explicativos (reutilizan el mismo catálogo que "Nueva sesión")
let explainerTasks = [];
let explainersEnabled = true;
let language = "es";
let handedness = "diestro";
let currentSegment = "images"; // "explainer" | "images" — qué se está mostrando en el escenario
let presenterSyncInterval = null; // reenvía la posición del explicativo a la pantalla del paciente cada 3s

// ================== DOM ==================
const taskSelect = document.getElementById("task-select-inv");
const numBlocksInput = document.getElementById("num-blocks-input");
const numBlocksHint = document.getElementById("num-blocks-hint");
const blockDurationInput = document.getElementById("block-duration-input");
const stimuliPerBlockInput = document.getElementById("stimuli-per-block-input");
const stimuliPerBlockHint = document.getElementById("stimuli-per-block-hint");
const repeatModeRandomCheckbox = document.getElementById("repeat-mode-random");
const repeatModeHint = document.getElementById("repeat-mode-hint");
const statStimulusTime = document.getElementById("stat-stimulus-time");
const statTaskTotalTime = document.getElementById("stat-task-total-time");
const btnAddInstance = document.getElementById("btn-add-instance");

const sequenceList = document.getElementById("sequence-list-inv");
const sequenceEmptyHint = document.getElementById("sequence-empty-hint-inv");
const sequenceTotalLabel = document.getElementById("sequence-total-duration-inv");
const preloadStatus = document.getElementById("preload-status-inv");
const btnDownloadReport = document.getElementById("btn-download-report");

const nowPlaying = document.getElementById("now-playing-inv");
const currentInstanceName = document.getElementById("current-instance-name-inv");
const progressLabel = document.getElementById("progress-label-inv");

const stageImage = document.getElementById("stage-image");
const explainerPlayer = document.getElementById("video-player-inv"); // reproductor de los videos explicativos
const customControls = document.getElementById("custom-controls");
const restScreen = document.getElementById("rest-screen-inv");
const btnContinueNext = document.getElementById("btn-continue-next-inv");
const btnStartTask = document.getElementById("btn-start-task-inv");

const btnPrevInstance = document.getElementById("btn-prev-instance");
const btnNextInstance = document.getElementById("btn-next-instance");

const toggleExplainers = document.getElementById("toggle-explainers-inv");
const languageButtons = document.querySelectorAll("#language-selector-inv .language-btn");
const handednessButtons = document.querySelectorAll("#handedness-selector-inv .handedness-btn");

const btnPauseImagesNav = document.getElementById("btn-pause-images-nav"); // ▶/⏸ junto a Anterior/Siguiente

const progressBarFilled = document.getElementById("progress-bar-filled");

// ================== CATÁLOGO DE TAREAS ==================
fetch("data/investigacion-tasks.json")
  .then((r) => r.json())
  .then((data) => {
    allTasks = data.tasks;
    allTasks.forEach((task) => {
      const option = document.createElement("option");
      option.value = task.id;
      option.textContent = task.title;
      taskSelect.appendChild(option);
    });
  })
  .catch((err) => console.error("No se pudo cargar investigacion-tasks.json:", err));

// Mismo catálogo de videos explicativos que usa "Nueva sesión" — se
// reutiliza tal cual, sin duplicar guiones ni IDs de YouTube.
fetch("data/tasks.json")
  .then((r) => r.json())
  .then((data) => {
    explainerTasks = data.tasks;
    onExplainerSettingsChanged();
  })
  .catch((err) => console.error("No se pudo cargar tasks.json (explicativos):", err));

// Resuelve el explicativo de una tarea según idioma y lateralidad actuales.
// Solo menv tiene variantes por lateralidad (diestro/zurdo); el resto la
// ignora automáticamente porque no tiene la clave "variants".
function resolveExplainerDef(taskId) {
  const task = explainerTasks.find((t) => t.id === taskId);
  if (!task) return null;
  const base = task.variants ? (task.variants[handedness] || task.variants.diestro) : task;
  const langData = base[language] || base.es;
  return { explainerVideo: langData.explainerVideo || null }; // null si no existe en ese idioma (hoy: inglés)
}

// ================== AJUSTES: EXPLICATIVOS / IDIOMA / LATERALIDAD ==================
// Cualquier cambio de explicativos/idioma/lateralidad: vuelve a medir
// duraciones, descarga los explicativos que falten y refresca totales.
function onExplainerSettingsChanged() {
  explainerPathsInSequence().forEach((src) => VideoDurations.probe(src).then(updateSequenceTotalLabel));
  preloadSequenceExplainers();
  refreshPreloadStatus();
  updateSequenceTotalLabel();
}

toggleExplainers.addEventListener("change", () => {
  explainersEnabled = toggleExplainers.checked;
  onExplainerSettingsChanged();
  reloadIfPausedAndAffected();
});

languageButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    language = btn.dataset.lang;
    languageButtons.forEach((b) => b.classList.toggle("active", b === btn));
    onExplainerSettingsChanged();
    reloadIfPausedAndAffected();
  });
});

handednessButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    handedness = btn.dataset.hand;
    handednessButtons.forEach((b) => b.classList.toggle("active", b === btn));
    onExplainerSettingsChanged();
    reloadIfPausedAndAffected();
  });
});

// Recarga la instancia actual si está en pausa (nunca interrumpe una que se
// está reproduciendo, sea explicativo o secuencia de imágenes).
function reloadIfPausedAndAffected() {
  if (currentInstanceId && !isPlaying) {
    loadInstance(currentInstanceId);
  }
}

// ================== UTILIDADES ==================
function formatSeconds(totalSeconds) {
  const rounded = Math.round(totalSeconds * 100) / 100;
  return rounded.toFixed(2) + "s";
}

// "m:ss"; "…" si todavía no se conoce (ej. duración de un video sin leer).
function formatClock(totalSeconds) {
  if (!(totalSeconds > 0)) return "…";
  const t = Math.round(totalSeconds);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

function timeOfDay(ts) {
  return new Date(ts).toLocaleTimeString("es-CO", { hour12: false });
}

function fileName(path) {
  return path ? path.split("/").pop() : "—";
}

// Número fijo de la instancia ("#3"), para cruzar el registro con la lista
// aunque después se reordene la secuencia.
function instanceNumber(instance) {
  return instance.instanceId.replace("inst-", "#");
}

// Explicativo que se usaría para esta instancia con los ajustes actuales,
// o null si están desactivados o no existe en este idioma.
function explainerPathFor(instance) {
  if (!explainersEnabled) return null;
  const def = resolveExplainerDef(instance.taskId);
  return def && def.explainerVideo ? def.explainerVideo : null;
}

function explainerPathsInSequence() {
  return [...new Set(sequence.map(explainerPathFor).filter(Boolean))];
}

// Determina si, con esta configuración, en algún momento hay que "reciclar"
// bloques completos (más ciclos que bloques reales) o repetir imágenes
// dentro de un mismo bloque (más estímulos por bloque de los que ese bloque
// tiene nativamente). Es la base para saber si el modo loop/random aplica.
function computeRepeatNeeded(task, numCycles, stimuliPerBlock) {
  const N = task.bloques.length;
  if (numCycles > N) return true;
  for (let cycle = 0; cycle < numCycles; cycle++) {
    const blockIndex = cycle % N;
    if (task.bloques[blockIndex].reposo.length < stimuliPerBlock) return true;
  }
  return false;
}

// ================== SELECCIÓN DE TAREA BASE: prellenar con el estándar ==================
taskSelect.addEventListener("change", () => {
  const task = allTasks.find((t) => t.id === taskSelect.value);
  if (!task) return;

  // standardNumBlocks es la duración clínica estándar de la tarea (puede no
  // coincidir con la cantidad de imágenes físicas reales, ej. muni: 5
  // bloques nominales de 20s pero solo 1 imagen real por tipo que se repite).
  const standardBlocks = task.standardNumBlocks;
  const standardStimuli = Math.min(...task.bloques.map((b) => Math.min(b.activacion.length, b.reposo.length)));

  numBlocksInput.disabled = false;
  numBlocksInput.min = 6;
  numBlocksInput.step = 2;
  numBlocksInput.value = standardBlocks;
  numBlocksHint.textContent = `Estándar clínico: ${standardBlocks} bloques. Puedes pedir más: se repetirán según el modo elegido abajo.`;

  blockDurationInput.disabled = false;
  blockDurationInput.value = task.duracionEstandarBloque;

  stimuliPerBlockInput.disabled = false;
  stimuliPerBlockInput.min = 1;
  stimuliPerBlockInput.value = standardStimuli;
  stimuliPerBlockHint.textContent = `Esta tarea tiene ${standardStimuli} imagen(es) por bloque de forma nativa.`;

  repeatModeRandomCheckbox.disabled = false;
  repeatModeRandomCheckbox.checked = false; // cada tarea nueva arranca en loop por defecto

  btnAddInstance.disabled = false;
  recomputePreview();
});

[numBlocksInput, blockDurationInput, stimuliPerBlockInput].forEach((input) => {
  input.addEventListener("input", recomputePreview);
});
repeatModeRandomCheckbox.addEventListener("change", recomputePreview);

// Recalcula la vista previa (tiempo por estímulo, tiempo total) y si hace
// falta repetir imágenes, habilitando o no el selector loop/random.
function recomputePreview() {
  const task = allTasks.find((t) => t.id === taskSelect.value);
  const numBlocks = parseInt(numBlocksInput.value, 10) || 0;
  const blockDuration = parseFloat(blockDurationInput.value) || 0;
  const stimuliPerBlock = parseInt(stimuliPerBlockInput.value, 10) || 1;

  const stimulusSeconds = blockDuration / stimuliPerBlock;
  const totalSeconds = numBlocks * blockDuration;

  statStimulusTime.textContent = formatSeconds(stimulusSeconds);
  statTaskTotalTime.textContent = formatSeconds(totalSeconds);

  if (task) updateRepeatModeAvailability(task, numBlocks, stimuliPerBlock);
}

// ================== MODO DE REPETICIÓN (loop / random) ==================
// El checkbox solo se habilita cuando lo pedido excede las imágenes reales
// disponibles; si cabe, no aplica y queda deshabilitado y sin marcar (loop).
// El checkbox de aleatorizar ahora está siempre disponible, se necesite o
// no repetir/pedir prestado — así el técnico puede mezclar el orden de las
// imágenes dentro de cada bloque aunque haya exactamente las que hacen falta.
function updateRepeatModeAvailability(task, numBlocks, stimuliPerBlock) {
  const numCycles = numBlocks / 2;
  const repeatNeeded = computeRepeatNeeded(task, numCycles, stimuliPerBlock);
  const N = task.bloques.length;

  repeatModeHint.textContent = repeatNeeded
    ? numCycles > N
      ? `Se necesitan ${numCycles} bloques y esta tarea solo tiene ${N}: se repiten/mezclan bloques enteros.`
      : `Este bloque necesita ${stimuliPerBlock} imágenes y algunos solo tienen menos de forma nativa: se pide prestado del siguiente bloque.`
    : "No hace falta repetir nada, pero puedes aleatorizar el orden dentro de cada bloque igual.";
}

function getSelectedRepeatMode() {
  return repeatModeRandomCheckbox.checked ? "random" : "loop";
}

// ================== AGREGAR INSTANCIA A LA SECUENCIA ==================
btnAddInstance.addEventListener("click", () => {
  const task = allTasks.find((t) => t.id === taskSelect.value);
  if (!task) return;

  const numBlocks = parseInt(numBlocksInput.value, 10);
  const blockDuration = parseFloat(blockDurationInput.value);
  const stimuliPerBlock = parseInt(stimuliPerBlockInput.value, 10);
  const repeatMode = getSelectedRepeatMode();

  const instance = {
    instanceId: `inst-${nextInstanceNumber++}`,
    taskId: task.id,
    numBlocks,
    blockDuration,
    stimuliPerBlock,
    repeatMode,
  };
  instance.schedule = buildSchedule(task, instance);

  const repeatSuffix = instance.schedule.repeated ? ` (${repeatMode})` : "";
  instance.label = `${task.title} — ${numBlocks} bloques × ${blockDuration}s${repeatSuffix}`;

  sequence.push(instance);
  renderSequenceItem(instance);
  syncSequenceState();
});

// ================== CONSTRUCCIÓN DEL SCHEDULE ==================
// Las imágenes de lvv/menv/mev/muni tienen un sufijo _0 (negativo, el
// paciente permanece quieto) o _1 (positivo, el paciente mueve el dedo).
// lh no está clasificada todavía: su label es null y el nombre queda sin
// sufijo, igual que antes.
function buildImagePath(task, blockNumber, typeChar, imageIndex, label) {
  const suffix = label === null || label === undefined ? "" : `_${label}`;
  return `images/${task.prefijo}/${task.prefijo}_b${blockNumber}_${typeChar}${imageIndex}${suffix}.${task.extension || "png"}`;
}

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Arma la "ventana" de `count` imágenes de reposo y activación para un
// bloque real. El pool ya NO es de toda la tarea: es por bloque. Si el
// bloque no tiene suficientes imágenes propias, se completa corriendo hacia
// los bloques siguientes (cíclicamente por toda la tarea) — nunca repite
// dentro del mismo bloque mientras haya otro bloque del que tomar prestado.
// reposo y activación siempre toman EXACTAMENTE los mismos bloques/índices,
// así que su patrón positivo/negativo coincide antes de mezclar.
function buildBlockWindow(task, startBlockIndex, count) {
  const N = task.bloques.length;
  const reposo = [];
  const activacion = [];
  let blockIndex = startBlockIndex;
  let imgIndex = 0;

  while (reposo.length < count) {
    const bloque = task.bloques[blockIndex];
    if (imgIndex >= bloque.reposo.length) {
      blockIndex = (blockIndex + 1) % N;
      imgIndex = 0;
      continue;
    }
    const realBlockNumber = blockIndex + 1;
    const fileBlockReposo = realBlockNumber * 2 - 1;
    const fileBlockActivacion = realBlockNumber * 2;
    const rLabel = bloque.reposo[imgIndex];
    const aLabel = bloque.activacion[imgIndex];
    reposo.push({ src: buildImagePath(task, fileBlockReposo, "r", imgIndex + 1, rLabel), label: rLabel });
    activacion.push({ src: buildImagePath(task, fileBlockActivacion, "a", imgIndex + 1, aLabel), label: aLabel });
    imgIndex++;
  }

  return { reposo, activacion };
}

// "loop": deja la ventana en su orden natural. "random": mezcla las
// posiciones, pero con LA MISMA permutación para reposo y activación — así
// la imagen que cae en la posición k de reposo y la que cae en la posición
// k de activación siguen viniendo del mismo índice original, y su patrón
// positivo/negativo sigue coincidiendo aunque el orden visual cambie.
function shuffleWindow(window, mode) {
  if (mode !== "random") return window;
  const order = shuffle(window.reposo.map((_, i) => i));
  return {
    reposo: order.map((i) => window.reposo[i]),
    activacion: order.map((i) => window.activacion[i]),
  };
}

function buildSchedule(task, instance) {
  const numCycles = instance.numBlocks / 2;
  const N = task.bloques.length;
  const perImageDuration = instance.blockDuration / instance.stimuliPerBlock;
  const repeated = computeRepeatNeeded(task, numCycles, instance.stimuliPerBlock);

  const steps = [];
  for (let cycle = 1; cycle <= numCycles; cycle++) {
    const blockIndex = (cycle - 1) % N; // los bloques siempre rotan en orden: 1,2,3...N,1,2,3...
    const window = shuffleWindow(buildBlockWindow(task, blockIndex, instance.stimuliPerBlock), instance.repeatMode);

    window.reposo.forEach((img) => {
      steps.push({ type: "reposo", src: img.src, label: img.label, duration: perImageDuration, cycle });
    });
    window.activacion.forEach((img) => {
      steps.push({ type: "activación", src: img.src, label: img.label, duration: perImageDuration, cycle });
    });
  }

  const cumulativeStarts = [];
  let acc = 0;
  steps.forEach((step) => {
    cumulativeStarts.push(acc);
    acc += step.duration * 1000;
  });

  return { steps, cumulativeStarts, totalTaskMs: acc, repeated };
}

// ================== SECUENCIA: RENDER, REORDENAR, QUITAR ==================
function renderSequenceItem(instance) {
  const li = document.createElement("li");
  li.className = "sequence-item";
  li.dataset.instanceId = instance.instanceId;
  li.innerHTML = `
    <span class="task-title">${instance.label}<small class="preload-state"></small></span>
    <div class="move-buttons">
      <button class="btn-move btn-move-up" type="button" title="Subir">▲</button>
      <button class="btn-move btn-move-down" type="button" title="Bajar">▼</button>
    </div>
    <button class="task-action-btn btn-remove" type="button" title="Quitar">✕</button>
  `;

  li.querySelector(".btn-move-up").addEventListener("click", () => moveInstance(li, -1));
  li.querySelector(".btn-move-down").addEventListener("click", () => moveInstance(li, 1));
  li.querySelector(".task-action-btn").addEventListener("click", () => removeInstance(instance.instanceId));

  sequenceList.appendChild(li);
}

function moveInstance(li, direction) {
  if (isInstanceCurrentlyPlaying(li.dataset.instanceId)) return;
  if (direction === -1 && li.previousElementSibling) {
    sequenceList.insertBefore(li, li.previousElementSibling);
  } else if (direction === 1 && li.nextElementSibling) {
    sequenceList.insertBefore(li.nextElementSibling, li);
  }
  syncSequenceState();
}

function removeInstance(instanceId) {
  if (isInstanceCurrentlyPlaying(instanceId)) return;

  // Si la que se borra es la que está en pantalla (pausada), la limpiamos
  // de inmediato aquí mismo — no esperamos a que syncSequenceState() decida
  // qué mostrar después, así nunca queda ni un instante la imagen/video de
  // una tarea que ya no existe en la secuencia.
  if (instanceId === currentInstanceId) {
    resetStageToEmpty();
  }

  sequence = sequence.filter((inst) => inst.instanceId !== instanceId);
  const li = sequenceList.querySelector(`.sequence-item[data-instance-id="${instanceId}"]`);
  if (li) li.remove();
  syncSequenceState();
}

function syncSequenceState() {
  const orderedIds = [...sequenceList.querySelectorAll(".sequence-item")].map((li) => li.dataset.instanceId);
  sequence.sort((a, b) => orderedIds.indexOf(a.instanceId) - orderedIds.indexOf(b.instanceId));

  sequenceEmptyHint.hidden = sequence.length > 0;
  btnDownloadReport.disabled = sequence.length === 0 && sessionLog.length === 0;
  onExplainerSettingsChanged();
  updateSequenceUI();

  if (sequence.length === 0) {
    resetStageToEmpty();
    return;
  }

  // Antes de empezar la sesión, el escenario muestra SIEMPRE la primera de
  // la lista: al agregar, mover o quitar tareas se actualiza. Ya en curso se
  // queda en la que va (igual que en Nueva sesión), salvo que la hayan quitado.
  const currentStillThere = sequence.some((i) => i.instanceId === currentInstanceId);
  if (!currentStillThere || (!sessionStarted && sequence[0].instanceId !== currentInstanceId)) {
    loadInstance(sequence[0].instanceId);
    return;
  }
  updateProgressLabelPosition();
  updateNavButtonsState();
}

// Único punto que deja el escenario completamente limpio (sin instancia
// activa). Detiene TODO lo que pueda estar sonando (imágenes o YouTube) y
// oculta ambos escenarios — antes solo se detenía el tick de imágenes y el
// video de YouTube podía quedar sonando de fondo con la pantalla en negro.
function resetStageToEmpty() {
  stageGeneration++; // invalida cualquier callback pendiente de una instancia anterior (ej. precarga en curso)
  closeLogEntry(false);
  sessionStarted = false;
  stopAnyPlayback();
  clearInterval(presenterSyncInterval);
  currentInstanceId = null;
  currentSegment = "images";
  nowPlaying.hidden = true;
  restScreen.hidden = true;
  stageImage.hidden = true;
  stageImage.src = "";
  explainerPlayer.hidden = true;
  customControls.hidden = false;
  progressBarFilled.style.width = "0%";
  btnPauseImagesNav.disabled = true;
  btnPrevInstance.disabled = true;
  btnNextInstance.disabled = true;
  if (presenterChannel) presenterChannel.postMessage({ type: "show-blank" });
}

function updateProgressLabelPosition() {
  const index = sequence.findIndex((i) => i.instanceId === currentInstanceId);
  progressLabel.textContent = `(${index + 1}/${sequence.length})`;
}

function updateSequenceTotalLabel() {
  if (sequence.length === 0) {
    sequenceTotalLabel.textContent = "";
    return;
  }
  const imagesSec = sequence.reduce((sum, inst) => sum + inst.schedule.totalTaskMs / 1000, 0);
  const explainerPaths = sequence.map(explainerPathFor).filter(Boolean);
  if (explainerPaths.length === 0) {
    sequenceTotalLabel.innerHTML = `Duración total estimada: <strong>${formatClock(imagesSec)}</strong>`;
    return;
  }
  const durations = explainerPaths.map((src) => VideoDurations.get(src));
  const explainersSec = durations.every((d) => d > 0) ? durations.reduce((a, b) => a + b, 0) : 0;
  const total = explainersSec > 0 ? formatClock(imagesSec + explainersSec) : "…";
  sequenceTotalLabel.innerHTML =
    `Duración total estimada: <strong>${total}</strong> ` +
    `<span class="hint">(imágenes ${formatClock(imagesSec)} + explicativos ${formatClock(explainersSec)})</span>`;
}

// ================== DESCARGA PREVIA DE LOS EXPLICATIVOS ==================
// Igual que en Nueva sesión: los explicativos de TODA la secuencia se
// descargan completos en segundo plano, en orden, para reproducirlos sin red.
async function preloadSequenceExplainers() {
  for (const src of explainerPathsInSequence()) {
    await VideoCache.preload(src);
  }
}

function explainerPreloadText(instance) {
  const src = explainerPathFor(instance);
  if (!src) return explainersEnabled ? "sin explicativo en este idioma" : "";
  const st = VideoCache.getState(src);
  if (!st) return "explicativo: en espera de descarga";
  if (st.status === "ready") return "explicativo: ✓ listo sin conexión";
  if (st.status === "error") return "explicativo: ⚠ no se pudo descargar, se usará internet";
  return `explicativo: descargando… ${Math.round(st.progress * 100)}%`;
}

function refreshPreloadStatus() {
  sequence.forEach((inst) => {
    const small = sequenceList.querySelector(`.sequence-item[data-instance-id="${inst.instanceId}"] .preload-state`);
    if (small) small.textContent = explainerPreloadText(inst);
  });
  const paths = explainerPathsInSequence();
  if (paths.length === 0) {
    preloadStatus.textContent = "";
    return;
  }
  const ready = paths.filter((src) => VideoCache.getState(src)?.status === "ready").length;
  preloadStatus.textContent = ready === paths.length
    ? "✓ Todos los explicativos de la secuencia están descargados."
    : `Descargando explicativos: ${ready}/${paths.length} listos.`;
}

VideoCache.onChange(refreshPreloadStatus);

// ================== REGISTRO DE LO QUE REALMENTE SE REPRODUJO ==================
// Cada vez que algo arranca (un explicativo o una secuencia de imágenes) se
// abre una entrada con hora de inicio/fin, tiempo efectivo corriendo, pausas
// y estado final. Cada pausa y reanudación se anota con la hora y el segundo
// del paradigma en que ocurrió: si hubo pausas en las imágenes, los tiempos
// reales ya no coinciden con el diseño (.fsf) y el reporte lo deja dicho.
const sessionLog = [];
let currentLogEntry = null;
const sessionStartedAt = new Date();

function paradigmElapsedMs() {
  return isPlaying ? Date.now() - playStartTimestamp : elapsedAtPauseMs;
}

function openLogEntry(segment) {
  const instance = getCurrentInstance();
  if (!instance) return;
  const now = Date.now();
  currentLogEntry = {
    instanceId: instance.instanceId,
    number: instanceNumber(instance),
    label: instance.label,
    taskId: instance.taskId,
    segment, // "explainer" | "images"
    file: segment === "explainer" ? currentExplainerPath : null,
    videoDurationS: segment === "explainer" && Number.isFinite(explainerPlayer.duration) ? explainerPlayer.duration : 0,
    plannedMs: segment === "images" ? instance.schedule.totalTaskMs : 0,
    language,
    handedness,
    startedAt: now,
    endedAt: null,
    runningSince: now,
    playedMs: 0,
    pauses: 0,
    events: [], // { at, paradigmMs, text }
    completed: false,
    endNote: "",
  };
  sessionLog.push(currentLogEntry);
  btnDownloadReport.disabled = false;
}

function logEvent(text) {
  if (!currentLogEntry) return;
  currentLogEntry.events.push({
    at: Date.now(),
    paradigmMs: currentLogEntry.segment === "images" ? paradigmElapsedMs() : explainerPlayer.currentTime * 1000,
    text,
  });
}

// Se llama cada vez que algo arranca o se reanuda.
function logRunning(segment) {
  sessionStarted = true;
  const e = currentLogEntry;
  if (!e || e.segment !== segment || e.instanceId !== currentInstanceId) {
    closeLogEntry(false);
    openLogEntry(segment);
    return;
  }
  if (e.runningSince === null) {
    e.runningSince = Date.now();
    logEvent("▶ reanuda");
  }
}

function logPaused() {
  const e = currentLogEntry;
  if (!e || e.runningSince === null) return;
  e.playedMs += Date.now() - e.runningSince;
  e.runningSince = null;
  e.pauses++;
  logEvent("⏸ pausa");
}

// completed = true cuando llegó a su final; endNote explica cómo terminó si no.
function closeLogEntry(completed, endNote = "") {
  const e = currentLogEntry;
  if (!e) return;
  const now = Date.now();
  if (e.runningSince !== null) e.playedMs += now - e.runningSince;
  e.runningSince = null;
  e.endedAt = now;
  e.completed = completed;
  e.endNote = endNote;
  if (e.segment === "images") e.finalParadigmMs = paradigmElapsedMs();
  currentLogEntry = null;
}

// ================== REPORTE DE LA SESIÓN ==================
// Tres partes: (1) lo programado, (2) lo que realmente pasó, con horas e
// intervenciones manuales, y (3) el detalle de imágenes y vectores 0/1 de
// cada instancia, tomado del schedule real (incluye aleatorización y
// préstamo de imágenes entre bloques).
const LANG_LABEL = { es: "Español", en: "English" };
const HAND_LABEL = { diestro: "Diestro", zurdo: "Zurdo" };
const SEGMENT_LABEL = { explainer: "Video explicativo", images: "Secuencia de imágenes" };

function snapshotEntry(e) {
  const now = Date.now();
  const playedMs = e.playedMs + (e.runningSince !== null ? now - e.runningSince : 0);
  return { ...e, playedMs, wallMs: (e.endedAt || now) - e.startedAt, open: e.endedAt === null };
}

function entryStatus(s) {
  if (s.open) return "en curso al generar el reporte";
  if (s.completed) return "completa";
  return s.endNote ? `interrumpida (${s.endNote})` : "interrumpida";
}

function buildSessionReport() {
  const lines = [];
  const now = new Date();
  const entries = sessionLog.map(snapshotEntry);
  const sep = "=".repeat(70);

  lines.push("REPORTE DE SESIÓN — FMRI Assistant (Investigación)");
  lines.push(`Generado: ${now.toLocaleString("es-CO")}`);
  lines.push(`Página abierta desde: ${sessionStartedAt.toLocaleString("es-CO")}`);
  lines.push("");
  lines.push("Configuración al momento del reporte:");
  lines.push(`  Videos explicativos: ${explainersEnabled ? "activados" : "desactivados"}`);
  lines.push(`  Idioma: ${LANG_LABEL[language]}`);
  lines.push(`  Lateralidad: ${HAND_LABEL[handedness]} (solo cambia el explicativo de MENV)`);
  lines.push("");

  // ---- 1. Programado ----
  lines.push(sep);
  lines.push("1. SECUENCIA PROGRAMADA (orden actual en la lista)");
  lines.push(sep);
  if (sequence.length === 0) lines.push("  (vacía)");
  sequence.forEach((inst, i) => {
    const src = explainerPathFor(inst);
    let explainerText = "sin explicativo";
    if (explainersEnabled) explainerText = src ? `explicativo ${formatClock(VideoDurations.get(src))}` : "explicativo no disponible en este idioma";
    lines.push(`  ${i + 1}. [${instanceNumber(inst)}] ${inst.label} — imágenes ${formatClock(inst.schedule.totalTaskMs / 1000)} | ${explainerText}`);
  });
  if (sequence.length > 0) lines.push(`  ${sequenceTotalLabel.textContent}`);
  lines.push("");

  // ---- 2. Lo que pasó ----
  lines.push(sep);
  lines.push("2. REGISTRO DE REPRODUCCIÓN (en el orden en que ocurrió)");
  lines.push(sep);
  lines.push("Corriendo = tiempo efectivo en marcha (sin pausas). Total = de inicio a fin, con pausas.");
  lines.push("t = segundo del paradigma (o del video) en que ocurrió cada evento.");
  lines.push("");
  if (entries.length === 0) lines.push("  (no se reprodujo nada)");
  entries.forEach((s, i) => {
    const end = s.open ? "…" : timeOfDay(s.endedAt);
    lines.push(`${i + 1}. [${timeOfDay(s.startedAt)} – ${end}] ${s.number} ${s.label} — ${SEGMENT_LABEL[s.segment]}`);
    if (s.segment === "explainer") {
      lines.push(`   Idioma: ${LANG_LABEL[s.language]} | Lateralidad: ${HAND_LABEL[s.handedness]} | Archivo: ${fileName(s.file)}`);
      lines.push(`   Duración del video: ${formatClock(s.videoDurationS)} | Corriendo: ${formatClock(s.playedMs / 1000)} | Total: ${formatClock(s.wallMs / 1000)} | Pausas: ${s.pauses}`);
    } else {
      lines.push(`   Programado: ${formatSeconds(s.plannedMs / 1000)} | Corriendo: ${formatSeconds(s.playedMs / 1000)} | Total con pausas: ${formatSeconds(s.wallMs / 1000)} | Pausas: ${s.pauses}`);
    }
    lines.push(`   Estado: ${entryStatus(s)}`);
    if (s.events.length > 0) {
      lines.push("   Eventos:");
      s.events.forEach((ev) => lines.push(`     ${timeOfDay(ev.at)} (t=${formatSeconds(ev.paradigmMs / 1000)}) ${ev.text}`));
    }
    if (s.segment === "images") {
      lines.push(
        s.pauses > 0
          ? "   ⚠ Hubo pausas: los tiempos reales NO coinciden con el diseño programado."
          : "   Sin pausas: los tiempos coinciden con el diseño programado."
      );
    }
    lines.push("");
  });

  // ---- 3. Detalle de imágenes ----
  lines.push(sep);
  lines.push("3. DETALLE DE IMÁGENES POR INSTANCIA");
  lines.push(sep);
  sequence.forEach((inst, i) => {
    const task = allTasks.find((t) => t.id === inst.taskId);
    const numCycles = inst.numBlocks / 2;

    lines.push("");
    lines.push(`INSTANCIA ${i + 1} [${instanceNumber(inst)}]: ${task ? task.title : inst.taskId} (${inst.taskId})`);
    lines.push(
      `Bloques: ${inst.numBlocks} (${numCycles} ciclos) | Duración por bloque: ${inst.blockDuration}s | ` +
      `Estímulos por bloque: ${inst.stimuliPerBlock} | Modo: ${inst.repeatMode}` +
      (inst.schedule.repeated ? " (se usó repetición/préstamo entre bloques)" : "")
    );
    lines.push(`Tiempo por estímulo: ${formatSeconds(inst.blockDuration / inst.stimuliPerBlock)}`);
    lines.push(`Duración programada de esta tarea: ${formatSeconds(inst.schedule.totalTaskMs / 1000)}`);

    ["reposo", "activación"].forEach((tipo) => {
      const stepsOfType = inst.schedule.steps.filter((st) => st.type === tipo);
      lines.push("");
      lines.push(`--- ${tipo.toUpperCase()} ---`);
      lines.push("Imágenes por bloque, en el orden en que se muestran:");
      const vectorByBlock = [];
      for (let c = 1; c <= numCycles; c++) {
        const stepsOfCycle = stepsOfType.filter((st) => st.cycle === c);
        lines.push(`  Bloque ${c}: ${stepsOfCycle.map((st) => fileName(st.src)).join(", ")}`);
        vectorByBlock.push(stepsOfCycle.map((st) => (st.label === null || st.label === undefined ? "-" : st.label)).join(""));
      }
      lines.push("");
      lines.push('Vector (0=negativo, 1=positivo, "-"=sin clasificar):');
      lines.push(`  ${vectorByBlock.join(" ")}`);
    });

    lines.push("");
    lines.push("-".repeat(70));
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
  a.download = `sesion-investigacion-${stamp}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  btnDownloadReport.blur();
});

function isInstanceCurrentlyPlaying(instanceId) {
  return isPlaying && instanceId === currentInstanceId;
}

function updateSequenceUI() {
  const items = [...sequenceList.querySelectorAll(".sequence-item")];
  items.forEach((li, index) => {
    const locked = isInstanceCurrentlyPlaying(li.dataset.instanceId);
    li.classList.toggle("locked", locked);
    li.querySelector(".btn-move-up").disabled = locked || index === 0;
    li.querySelector(".btn-move-down").disabled = locked || index === items.length - 1;
    li.querySelector(".task-action-btn").disabled = locked;
  });
}

// ================== ESCENARIO: EXPLICATIVO vs IMÁGENES ==================
function showExplainerStage() {
  explainerPlayer.hidden = false;
  stageImage.hidden = true;
  customControls.hidden = true;
}

function showImageStage() {
  explainerPlayer.hidden = true;
  stageImage.hidden = false;
  customControls.hidden = false;
}

// ================== CARGA Y REPRODUCCIÓN DE UNA INSTANCIA ==================
function loadInstance(instanceId) {
  const myGeneration = ++stageGeneration;
  closeLogEntry(false, "se cambió de tarea o se recargó");
  currentInstanceId = instanceId;
  restScreen.hidden = true;
  btnStartTask.hidden = true;
  stopAnyPlayback();

  const instance = sequence.find((i) => i.instanceId === instanceId);
  const explainerDef = resolveExplainerDef(instance.taskId);
  const startWithExplainer = explainersEnabled && !!(explainerDef && explainerDef.explainerVideo);
  currentSegment = startWithExplainer ? "explainer" : "images";

  updateNowPlayingLabel();
  updateNavButtonsState();
  updateSequenceUI();

  imagesPreloaded = false;
  btnPauseImagesNav.disabled = true;

  // Las imágenes se precargan en paralelo al explicativo (si lo hay), para
  // que al terminar el video la secuencia arranque sin espera. Si para
  // cuando termine de precargar ya se borró esta instancia o se cargó otra,
  // "myGeneration" ya no coincide y el callback no toca nada.
  preloadImages(instance.schedule.steps, (hasMissing) => {
    if (myGeneration !== stageGeneration) return;
    imagesPreloaded = true;
    if (!hasMissing) updateNowPlayingLabel(); // restaura "(1/3)" si el aviso de precarga lo tapó

    // Si está en la pantalla negra previa a la tarea, no se muestra nada
    // todavía: la primera imagen aparece al pulsar "Continuar a la tarea".
    if (currentSegment === "images" && restScreen.hidden) {
      btnPauseImagesNav.disabled = false;
      loadVisualForStep(instance, 0);
    }
  });

  if (startWithExplainer) {
    showExplainerStage();
    setExplainerVideo(explainerDef.explainerVideo);
    btnPauseImagesNav.disabled = false; // ▶/⏸ también controla el explicativo
    if (presenterChannel) presenterChannel.postMessage({ type: "show-explainer", src: explainerDef.explainerVideo });
  } else {
    showImageStage();
  }
}

function updateNowPlayingLabel() {
  const instance = getCurrentInstance();
  const index = sequence.indexOf(instance);
  const suffix = currentSegment === "explainer" ? " — video explicativo" : "";
  currentInstanceName.textContent = instance ? instance.label + suffix : "—";
  progressLabel.textContent = `(${index + 1}/${sequence.length})`;
  nowPlaying.hidden = false;
}

function updateNavButtonsState() {
  const index = sequence.findIndex((i) => i.instanceId === currentInstanceId);
  btnPrevInstance.disabled = index <= 0;
  btnNextInstance.disabled = index === -1 || index >= sequence.length - 1;
}

function preloadImages(steps, onDone) {
  const urls = steps.map((s) => s.src);
  let processedCount = 0;
  let missingFiles = [];
  progressLabel.textContent = `Cargando imágenes... (0/${urls.length})`;

  if (urls.length === 0) { onDone(false); return; }

  urls.forEach((url) => {
    const img = new Image();
    img.onload = () => { processedCount++; checkIfDone(); };
    img.onerror = () => {
      processedCount++;
      missingFiles.push(url);
      console.warn(`⚠ Imagen no encontrada: ${url}`);
      checkIfDone();
    };
    img.src = url;
  });

  function checkIfDone() {
    if (processedCount === urls.length) {
      if (missingFiles.length > 0) {
        progressLabel.textContent = `⚠ Faltan ${missingFiles.length} imagen(es) — revisa la consola`;
        console.warn("Resumen de imágenes faltantes:", missingFiles);
      } else {
        progressLabel.textContent = "";
      }
      onDone(missingFiles.length > 0);
    }
  }
}

function loadVisualForStep(instance, index) {
  currentStepIndex = index;
  const step = instance.schedule.steps[index];
  if (!step) return;

  stageImage.src = step.src;
  stageImage.hidden = false;
  if (presenterChannel) presenterChannel.postMessage({ type: "show-image", src: step.src });
}

function getCurrentInstance() {
  return sequence.find((i) => i.instanceId === currentInstanceId);
}

// ================== NAVEGAR ENTRE INSTANCIAS (independiente de reproducción) ==================
btnPrevInstance.addEventListener("click", () => {
  const index = sequence.findIndex((i) => i.instanceId === currentInstanceId);
  if (index > 0) loadInstance(sequence[index - 1].instanceId);
});

btnNextInstance.addEventListener("click", () => {
  const index = sequence.findIndex((i) => i.instanceId === currentInstanceId);
  if (index !== -1 && index < sequence.length - 1) loadInstance(sequence[index + 1].instanceId);
});

// ================== REPRODUCTOR DE LOS VIDEOS EXPLICATIVOS ==================
// Mismo esquema que Nueva sesión: el archivo se descarga completo al
// navegador (VideoCache) y se reproduce desde la copia local.
let currentExplainerPath = null;

function setExplainerVideo(path) {
  currentExplainerPath = path;
  VideoCache.preload(path);
  explainerPlayer.src = VideoCache.playableUrl(path);
  explainerPlayer.load();
}

// Si el explicativo cargado (y aún sin empezar) termina de descargarse,
// se cambia a la copia local para que ya no dependa de la red.
VideoCache.onChange((src, state) => {
  if (src !== currentExplainerPath || state.status !== "ready") return;
  if (currentSegment !== "explainer" || !explainerPlayer.paused || explainerPlayer.currentTime !== 0) return;
  const local = VideoCache.playableUrl(src);
  if (explainerPlayer.src !== local) {
    explainerPlayer.src = local;
    explainerPlayer.load();
  }
});

explainerPlayer.addEventListener("error", () => {
  if (currentSegment !== "explainer") return;
  console.error("Error del reproductor (explicativo):", currentExplainerPath, explainerPlayer.error);
  currentInstanceName.textContent = "⚠ No se pudo reproducir el video explicativo";
});

explainerPlayer.addEventListener("play", () => {
  if (currentSegment !== "explainer") return;
  isPlaying = true;
  setPlayPauseIcon("⏸");
  logRunning("explainer");
  updateSequenceUI();
  if (presenterChannel) {
    presenterChannel.postMessage({ type: "seek-explainer", seconds: explainerPlayer.currentTime });
    presenterChannel.postMessage({ type: "play-explainer" });
    // Reenvía la posición cada 3s mientras suena; la pantalla del paciente
    // solo salta si el desfase supera su umbral.
    clearInterval(presenterSyncInterval);
    presenterSyncInterval = setInterval(() => {
      presenterChannel.postMessage({ type: "seek-explainer", seconds: explainerPlayer.currentTime });
    }, 3000);
  }
});

explainerPlayer.addEventListener("pause", () => {
  if (currentSegment !== "explainer" || explainerPlayer.ended) return; // el final lo maneja "ended"
  isPlaying = false;
  setPlayPauseIcon("▶");
  logPaused();
  updateSequenceUI();
  clearInterval(presenterSyncInterval);
  if (presenterChannel) {
    presenterChannel.postMessage({ type: "seek-explainer", seconds: explainerPlayer.currentTime, force: true });
    presenterChannel.postMessage({ type: "pause-explainer" });
  }
});

explainerPlayer.addEventListener("seeked", () => {
  if (currentSegment === "explainer" && presenterChannel) {
    presenterChannel.postMessage({ type: "seek-explainer", seconds: explainerPlayer.currentTime, force: true });
  }
});

explainerPlayer.addEventListener("ended", () => {
  if (currentSegment !== "explainer") return;
  closeLogEntry(true);
  clearInterval(presenterSyncInterval);
  finishExplainer();
});

// El explicativo terminó: se muestra una pantalla negra (también en la
// pantalla del paciente). "Continuar a la tarea" la quita y deja la primera
// imagen EN PAUSA; la secuencia arranca solo con ▶.
function finishExplainer() {
  const instance = getCurrentInstance();
  if (!instance) return;
  currentSegment = "images";
  isPlaying = false;
  setPlayPauseIcon("▶");
  btnPauseImagesNav.disabled = true; // se habilita al continuar
  updateNowPlayingLabel();
  updateSequenceUI();

  btnContinueNext.hidden = true;
  btnStartTask.hidden = false;
  restScreen.hidden = false;
  if (presenterChannel) presenterChannel.postMessage({ type: "show-blank" });
}

btnStartTask.addEventListener("click", () => {
  const instance = getCurrentInstance();
  if (!instance) return;
  restScreen.hidden = true;
  btnStartTask.hidden = true;
  showImageStage();
  btnStartTask.blur();

  // Si las imágenes aún cargan, el aviso de precarga se encarga de mostrar
  // la primera y habilitar ▶ en cuanto terminen.
  if (imagesPreloaded) {
    btnPauseImagesNav.disabled = false;
    loadVisualForStep(instance, 0);
  }
});


// ================== CONTROLES DE REPRODUCCIÓN ==================
// ▶/⏸ (y la barra espaciadora): controla lo que esté en pantalla, sea el
// video explicativo o la secuencia de imágenes. En las pantallas negras no hace nada.
function togglePlayback() {
  if (!currentInstanceId || !restScreen.hidden) return;
  if (currentSegment === "explainer") {
    if (explainerPlayer.paused) explainerPlayer.play().catch((err) => console.error("No se pudo reproducir:", err));
    else explainerPlayer.pause();
    return;
  }
  if (!imagesPreloaded) return;
  isPlaying ? pausePlayback() : startPlayback();
}

btnPauseImagesNav.addEventListener("click", () => {
  togglePlayback();
  btnPauseImagesNav.blur(); // evita que la barra espaciadora "haga clic" sobre el botón y alterne dos veces
});

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space") return;
  // Si el foco está en el reproductor, el navegador ya pausa/reproduce solo.
  if (document.activeElement === explainerPlayer) return;
  const tag = document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  event.preventDefault();
  togglePlayback();
});

function setPlayPauseIcon(icon) {
  btnPauseImagesNav.textContent = icon;
}

function startPlayback() {
  const instance = getCurrentInstance();
  if (!instance || instance.schedule.steps.length === 0) return;
  isPlaying = true;
  setPlayPauseIcon("⏸");

  playStartTimestamp = Date.now() - elapsedAtPauseMs;
  sequenceTicker.start();
  logRunning("images");
  updateSequenceUI();
}

function pausePlayback() {
  isPlaying = false;
  setPlayPauseIcon("▶");
  sequenceTicker.stop();
  elapsedAtPauseMs = Date.now() - playStartTimestamp;
  logPaused();
  updateSequenceUI();
}

function stopPlayback() {
  isPlaying = false;
  setPlayPauseIcon("▶");
  sequenceTicker.stop();
  elapsedAtPauseMs = 0;
}

// Detiene cualquier mecanismo de reproducción activo (el tick de imágenes o
// el video explicativo), sin importar en qué segmento esté la instancia que
// se está dejando atrás. Se llama siempre al cambiar de instancia.
function stopAnyPlayback() {
  stopPlayback();
  explainerPlayer.pause();
}

function tick() {
  const instance = getCurrentInstance();
  if (!instance) return;
  const elapsed = Date.now() - playStartTimestamp;

  if (elapsed >= instance.schedule.totalTaskMs) {
    finishCurrentInstance();
    return;
  }

  let newIndex = currentStepIndex;
  while (
    newIndex + 1 < instance.schedule.steps.length &&
    elapsed >= instance.schedule.cumulativeStarts[newIndex + 1]
  ) {
    newIndex++;
  }
  if (newIndex !== currentStepIndex) loadVisualForStep(instance, newIndex);

  updateProgressBar(instance, elapsed);
}

function updateProgressBar(instance, elapsed) {
  const step = instance.schedule.steps[currentStepIndex];
  if (!step) return;
  const stepStart = instance.schedule.cumulativeStarts[currentStepIndex];
  const percentage = ((elapsed - stepStart) / (step.duration * 1000)) * 100;
  progressBarFilled.style.width = Math.max(0, Math.min(100, percentage)) + "%";
}

function finishCurrentInstance() {
  closeLogEntry(true);
  stopPlayback();
  btnPauseImagesNav.disabled = true;
  const index = sequence.findIndex((i) => i.instanceId === currentInstanceId);
  const isLast = index === -1 || index >= sequence.length - 1;
  btnContinueNext.hidden = isLast;
  btnStartTask.hidden = true;
  restScreen.hidden = false;
  if (presenterChannel) presenterChannel.postMessage({ type: "show-blank" });
}

btnContinueNext.addEventListener("click", () => {
  const index = sequence.findIndex((i) => i.instanceId === currentInstanceId);
  if (index !== -1 && index < sequence.length - 1) {
    loadInstance(sequence[index + 1].instanceId);
  }
});

// ================== VISIBILIDAD DE LA PESTAÑA ==================
// Ya NO se pausa la secuencia al ocultar la ventana: durante una adquisición
// eso desalineaba el paradigma con el resonador. El reloj (Web Worker, ver
// "RELOJ DE LA SECUENCIA") sigue corriendo; al volver a la ventana solo se
// fuerza un tic para que la imagen en pantalla quede al día de inmediato.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && isPlaying) tick();
});