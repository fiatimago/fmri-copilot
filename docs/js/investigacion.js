console.log("investigacion.js — v4: sin pausa al ocultar la ventana, reloj en Web Worker");

// ================== ESTADO ==================
let allTasks = [];
let sequence = []; // array de instancias: { instanceId, taskId, label, numBlocks, blockDuration, stimuliPerBlock, schedule }
let currentInstanceId = null;
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
    presenterChannel.postMessage({ type: "show-explainer", videoId: def.explainerYoutubeId });
    if (isYtPlayerReady) {
      presenterChannel.postMessage({ type: "seek-explainer", seconds: ytPlayer.getCurrentTime(), force: true });
      presenterChannel.postMessage({ type: isPlaying ? "play-explainer" : "pause-explainer" });
    }
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
let ytPlayer;
let isYtPlayerReady = false;
let pendingAutoStartAfterPreload = false; // el explicativo terminó antes de que las imágenes cargaran
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
const btnDownloadReport = document.getElementById("btn-download-report");

const nowPlaying = document.getElementById("now-playing-inv");
const currentInstanceName = document.getElementById("current-instance-name-inv");
const progressLabel = document.getElementById("progress-label-inv");

const stageContainer = document.getElementById("stage-container");
const stageImage = document.getElementById("stage-image");
const youtubeStage = document.getElementById("youtube-player-inv-wrapper"); // el envoltorio, NO el div que la API de YouTube reemplaza
const customControls = document.getElementById("custom-controls");
const restScreen = document.getElementById("rest-screen-inv");
const btnContinueNext = document.getElementById("btn-continue-next-inv");

const btnPrevInstance = document.getElementById("btn-prev-instance");
const btnNextInstance = document.getElementById("btn-next-instance");

const toggleExplainers = document.getElementById("toggle-explainers-inv");
const languageButtons = document.querySelectorAll("#language-selector-inv .language-btn");
const handednessButtons = document.querySelectorAll("#handedness-selector-inv .handedness-btn");

const btnPlayPause = document.getElementById("btn-play-pause-inv");
const btnPauseImagesNav = document.getElementById("btn-pause-images-nav"); // mismo control, atajo visible junto a Anterior/Siguiente
const btnReset = document.getElementById("btn-reset-inv");
const btnSkipStep = document.getElementById("btn-skip-step-inv");
const btnExtendStep = document.getElementById("btn-extend-step-inv");
const btnFullscreen = document.getElementById("btn-fullscreen-inv");

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
  .then((data) => { explainerTasks = data.tasks; })
  .catch((err) => console.error("No se pudo cargar tasks.json (explicativos):", err));

// Resuelve el explicativo de una tarea según idioma y lateralidad actuales.
// Solo menv tiene variantes por lateralidad (diestro/zurdo); el resto la
// ignora automáticamente porque no tiene la clave "variants".
function resolveExplainerDef(taskId) {
  const task = explainerTasks.find((t) => t.id === taskId);
  if (!task) return null;
  const base = task.variants ? (task.variants[handedness] || task.variants.diestro) : task;
  const langData = base[language] || base.es;
  return { explainerYoutubeId: langData.explainerYoutubeId, explainerDuration: langData.explainerDuration };
}

// ================== AJUSTES: EXPLICATIVOS / IDIOMA / LATERALIDAD ==================
toggleExplainers.addEventListener("change", () => {
  explainersEnabled = toggleExplainers.checked;
  reloadIfPausedAndAffected();
});

languageButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    language = btn.dataset.lang;
    languageButtons.forEach((b) => b.classList.toggle("active", b === btn));
    reloadIfPausedAndAffected();
  });
});

handednessButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    handedness = btn.dataset.hand;
    handednessButtons.forEach((b) => b.classList.toggle("active", b === btn));
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
  syncSequenceState(instance.instanceId);
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
    <span class="task-title">${instance.label}</span>
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

function syncSequenceState(preferredInstanceId) {
  const orderedIds = [...sequenceList.querySelectorAll(".sequence-item")].map((li) => li.dataset.instanceId);
  sequence.sort((a, b) => orderedIds.indexOf(a.instanceId) - orderedIds.indexOf(b.instanceId));

  sequenceEmptyHint.hidden = sequence.length > 0;
  btnDownloadReport.disabled = sequence.length === 0;
  updateSequenceTotalLabel();
  updateSequenceUI();

  if (sequence.length === 0) {
    resetStageToEmpty();
    return;
  }

  if (isPlaying) {
    // No interrumpir la reproducción en curso — pero sí refrescar todo lo
    // que no requiere tocar el escenario: la etiqueta de posición y si
    // ahora hay una tarea siguiente disponible (ej. si se acaba de agregar
    // una mientras algo sonaba, "Siguiente" debe habilitarse al instante).
    updateProgressLabelPosition();
    updateNavButtonsState();
    return;
  }

  // En pausa (o sin nada reproduciéndose): normalmente el escenario refleja
  // la primera tarea de la secuencia. La excepción es justo después de
  // agregar una tarea nueva — ahí se prefiere mostrar la que se acaba de
  // agregar (para que su explicativo aparezca), no la primera de la lista.
  const targetId = preferredInstanceId && sequence.some((i) => i.instanceId === preferredInstanceId)
    ? preferredInstanceId
    : sequence[0].instanceId;
  loadInstance(targetId);
}

// Único punto que deja el escenario completamente limpio (sin instancia
// activa). Detiene TODO lo que pueda estar sonando (imágenes o YouTube) y
// oculta ambos escenarios — antes solo se detenía el tick de imágenes y el
// video de YouTube podía quedar sonando de fondo con la pantalla en negro.
function resetStageToEmpty() {
  stageGeneration++; // invalida cualquier callback pendiente de una instancia anterior (ej. precarga en curso)
  stopAnyPlayback();
  clearInterval(presenterSyncInterval);
  currentInstanceId = null;
  currentSegment = "images";
  nowPlaying.hidden = true;
  restScreen.hidden = true;
  stageImage.hidden = true;
  stageImage.src = "";
  youtubeStage.hidden = true;
  customControls.hidden = false;
  progressBarFilled.style.width = "0%";
  [btnPlayPause, btnPauseImagesNav, btnReset, btnSkipStep, btnExtendStep, btnFullscreen].forEach((b) => (b.disabled = true));
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
  const totalSeconds = sequence.reduce((sum, inst) => sum + inst.schedule.totalTaskMs / 1000, 0);
  sequenceTotalLabel.innerHTML = `Duración total estimada: <strong>${formatSeconds(totalSeconds)}</strong>`;
}

// ================== REPORTE DE LA SESIÓN ==================
// Genera un .txt con lo que REALMENTE se programó para cada instancia
// (instance.schedule), no con los datos de catálogo — así el reporte
// refleja fielmente qué imagen sonó en qué orden, incluso si hubo
// aleatorización o préstamo de imágenes entre bloques.
function buildSessionReport() {
  const lines = [];
  const now = new Date();
  const totalSeconds = sequence.reduce((sum, inst) => sum + inst.schedule.totalTaskMs / 1000, 0);

  lines.push("REPORTE DE SESIÓN — FMRI Task Visualizer (Investigación)");
  lines.push(`Generado: ${now.toLocaleString("es-CO")}`);
  lines.push(`Duración total de la sesión: ${formatSeconds(totalSeconds)}`);
  lines.push("");
  lines.push(`Videos explicativos: ${explainersEnabled ? "activados" : "desactivados"}`);
  lines.push(`Idioma: ${language === "en" ? "English" : "Español"}`);
  lines.push(`Lateralidad: ${handedness === "zurdo" ? "Zurdo" : "Diestro"}`);
  lines.push("");
  lines.push("Orden de tareas:");
  sequence.forEach((inst, i) => lines.push(`  ${i + 1}. ${inst.label}`));
  lines.push("");
  lines.push("=".repeat(70));

  sequence.forEach((inst, i) => {
    const task = allTasks.find((t) => t.id === inst.taskId);
    const numCycles = inst.numBlocks / 2;

    lines.push("");
    lines.push(`INSTANCIA ${i + 1}: ${task ? task.title : inst.taskId} (${inst.taskId})`);
    lines.push(
      `Bloques: ${inst.numBlocks} (${numCycles} ciclos) | Duración por bloque: ${inst.blockDuration}s | ` +
      `Estímulos por bloque: ${inst.stimuliPerBlock} | Modo: ${inst.repeatMode}` +
      (inst.schedule.repeated ? " (se usó repetición/préstamo entre bloques)" : "")
    );
    lines.push(`Tiempo por estímulo: ${formatSeconds(inst.blockDuration / inst.stimuliPerBlock)}`);
    lines.push(`Duración total de esta tarea: ${formatSeconds(inst.schedule.totalTaskMs / 1000)}`);

    ["reposo", "activación"].forEach((tipo) => {
      const stepsOfType = inst.schedule.steps.filter((s) => s.type === tipo);
      lines.push("");
      lines.push(`--- ${tipo.toUpperCase()} ---`);
      lines.push("Imágenes por bloque, en el orden en que se muestran:");
      const vectorByBlock = [];
      for (let c = 1; c <= numCycles; c++) {
        const stepsOfCycle = stepsOfType.filter((s) => s.cycle === c);
        const names = stepsOfCycle.map((s) => s.src.split("/").pop());
        lines.push(`  Bloque ${c}: ${names.join(", ")}`);
        vectorByBlock.push(stepsOfCycle.map((s) => (s.label === null || s.label === undefined ? "-" : s.label)).join(""));
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
  const content = buildSessionReport();
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  const a = document.createElement("a");
  a.href = url;
  a.download = `sesion-investigacion-${stamp}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
  youtubeStage.hidden = false;
  stageImage.hidden = true;
  customControls.hidden = true;
}

function showImageStage() {
  youtubeStage.hidden = true;
  stageImage.hidden = false;
  customControls.hidden = false;
}

// ================== CARGA Y REPRODUCCIÓN DE UNA INSTANCIA ==================
function loadInstance(instanceId) {
  const myGeneration = ++stageGeneration;
  currentInstanceId = instanceId;
  restScreen.hidden = true;
  stopAnyPlayback();

  const instance = sequence.find((i) => i.instanceId === instanceId);
  const explainerDef = resolveExplainerDef(instance.taskId);
  const startWithExplainer = explainersEnabled && !!(explainerDef && explainerDef.explainerYoutubeId);
  currentSegment = startWithExplainer ? "explainer" : "images";

  updateNowPlayingLabel();
  updateNavButtonsState();
  updateSequenceUI();

  btnFullscreen.disabled = false; // no depende de la precarga de imágenes
  imagesPreloaded = false;
  pendingAutoStartAfterPreload = false;
  [btnPlayPause, btnPauseImagesNav, btnReset, btnSkipStep, btnExtendStep].forEach((b) => (b.disabled = true));

  // Las imágenes se precargan en paralelo al explicativo (si lo hay), para
  // que al terminar el video la secuencia arranque sin espera. Si para
  // cuando termine de precargar ya se borró esta instancia o se cargó otra,
  // "myGeneration" ya no coincide y el callback no toca nada.
  preloadImages(instance.schedule.steps, (hasMissing) => {
    if (myGeneration !== stageGeneration) return;
    imagesPreloaded = true;
    if (!hasMissing) updateNowPlayingLabel(); // restaura "(1/3)" si el aviso de precarga lo tapó

    if (currentSegment === "images") {
      [btnPlayPause, btnPauseImagesNav, btnReset].forEach((b) => (b.disabled = false));
      loadVisualForStep(instance, 0);
    }
    if (pendingAutoStartAfterPreload) {
      pendingAutoStartAfterPreload = false;
      loadVisualForStep(instance, 0);
      startPlayback();
    }
  });

  if (startWithExplainer) {
    showExplainerStage();
    if (isYtPlayerReady) ytPlayer.cueVideoById(explainerDef.explainerYoutubeId);
    if (presenterChannel) presenterChannel.postMessage({ type: "show-explainer", videoId: explainerDef.explainerYoutubeId });
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

// ================== REPRODUCTOR DE YOUTUBE (solo para explicativos) ==================
function onYouTubeIframeAPIReady() {
  ytPlayer = new YT.Player("youtube-player-inv", {
    height: "100%",
    width: "100%",
    playerVars: {
      controls: 1,
      rel: 0,
      modestbranding: 1,
      iv_load_policy: 3,
      cc_load_policy: 0,
    },
    events: { onReady: onYtPlayerReady, onStateChange: onYtPlayerStateChange, onError: onYtPlayerError },
  });
}

function onYtPlayerReady() {
  isYtPlayerReady = true;
  if (currentSegment === "explainer") {
    const instance = getCurrentInstance();
    const def = instance && resolveExplainerDef(instance.taskId);
    if (def) ytPlayer.cueVideoById(def.explainerYoutubeId);
  }
}

function onYtPlayerError(event) {
  console.error("YouTube error (explicativo), code:", event.data);
  currentInstanceName.textContent = "⚠ Error al cargar el video explicativo (código " + event.data + ")";
}

function onYtPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    isPlaying = true;
    updateSequenceUI();
    if (presenterChannel) {
      presenterChannel.postMessage({ type: "seek-explainer", seconds: ytPlayer.getCurrentTime() });
      presenterChannel.postMessage({ type: "play-explainer" });
      // Reenvía la posición cada 3s mientras suena, para corregir cualquier
      // pequeño desajuste entre los dos reproductores (cada ventana tiene
      // el suyo — nunca quedan perfectamente cuadro a cuadro, pero así no
      // se acumula diferencia a lo largo del video).
      clearInterval(presenterSyncInterval);
      presenterSyncInterval = setInterval(() => {
        presenterChannel.postMessage({ type: "seek-explainer", seconds: ytPlayer.getCurrentTime() });
      }, 3000);
    }
  } else if (event.data === YT.PlayerState.PAUSED) {
    isPlaying = false;
    updateSequenceUI();
    clearInterval(presenterSyncInterval);
    if (presenterChannel) {
      presenterChannel.postMessage({ type: "seek-explainer", seconds: ytPlayer.getCurrentTime(), force: true });
      presenterChannel.postMessage({ type: "pause-explainer" });
    }
  } else if (event.data === YT.PlayerState.ENDED) {
    clearInterval(presenterSyncInterval);
    finishExplainer();
  }
}

// El explicativo terminó: pasa directo a la secuencia de imágenes, sin
// pantalla intermedia. Si las imágenes ya están listas, arranca de una vez
// (comportamiento "fluido"); si no, queda pendiente y arranca sola en
// cuanto termine de precargar.
function finishExplainer() {
  const instance = getCurrentInstance();
  if (!instance) return;
  currentSegment = "images";
  isPlaying = false;
  showImageStage();
  updateNowPlayingLabel();

  if (imagesPreloaded) {
    [btnPlayPause, btnPauseImagesNav, btnReset].forEach((b) => (b.disabled = false));
    loadVisualForStep(instance, 0);
    startPlayback();
  } else {
    pendingAutoStartAfterPreload = true;
  }
}


// ================== CONTROLES DE REPRODUCCIÓN ==================
btnPlayPause.addEventListener("click", () => {
  if (currentSegment !== "images" || !imagesPreloaded) return;
  isPlaying ? pausePlayback() : startPlayback();
});
btnPauseImagesNav.addEventListener("click", () => btnPlayPause.click());

function setPlayPauseIcon(icon) {
  btnPlayPause.textContent = icon;
  btnPauseImagesNav.textContent = icon;
}

function startPlayback() {
  const instance = getCurrentInstance();
  if (!instance || instance.schedule.steps.length === 0) return;
  isPlaying = true;
  setPlayPauseIcon("⏸");
  btnSkipStep.disabled = false;
  btnExtendStep.disabled = false;

  playStartTimestamp = Date.now() - elapsedAtPauseMs;
  sequenceTicker.start();
  updateSequenceUI();
}

function pausePlayback() {
  isPlaying = false;
  setPlayPauseIcon("▶");
  sequenceTicker.stop();
  elapsedAtPauseMs = Date.now() - playStartTimestamp;
  btnSkipStep.disabled = true;
  btnExtendStep.disabled = true;
  updateSequenceUI();
}

function stopPlayback() {
  isPlaying = false;
  setPlayPauseIcon("▶");
  sequenceTicker.stop();
  elapsedAtPauseMs = 0;
  btnSkipStep.disabled = true;
  btnExtendStep.disabled = true;
}

// Detiene cualquier mecanismo de reproducción activo (el tick de imágenes o
// el video de YouTube), sin importar en qué segmento esté la instancia que
// se está dejando atrás. Se llama siempre al cambiar de instancia.
function stopAnyPlayback() {
  stopPlayback();
  if (isYtPlayerReady) ytPlayer.stopVideo();
}

btnReset.addEventListener("click", () => {
  stopPlayback();
  const instance = getCurrentInstance();
  if (instance) loadVisualForStep(instance, 0);
});

btnFullscreen.addEventListener("click", () => {
  document.fullscreenElement ? document.exitFullscreen() : stageContainer.requestFullscreen();
});

// ================== CONTROLES MANUALES EN VIVO ==================
btnSkipStep.addEventListener("click", () => {
  if (!isPlaying) return;
  const instance = getCurrentInstance();
  const nextIndex = currentStepIndex + 1;

  if (nextIndex >= instance.schedule.steps.length) {
    finishCurrentInstance();
    return;
  }
  const targetElapsed = instance.schedule.cumulativeStarts[nextIndex];
  playStartTimestamp = Date.now() - targetElapsed;
});

btnExtendStep.addEventListener("click", () => {
  if (!isPlaying || currentStepIndex < 0) return;
  const instance = getCurrentInstance();
  const extraSeconds = 5;
  const extraMs = extraSeconds * 1000;

  instance.schedule.steps[currentStepIndex].duration += extraSeconds;
  for (let i = currentStepIndex + 1; i < instance.schedule.cumulativeStarts.length; i++) {
    instance.schedule.cumulativeStarts[i] += extraMs;
  }
  instance.schedule.totalTaskMs += extraMs;
});

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
  stopPlayback();
  const index = sequence.findIndex((i) => i.instanceId === currentInstanceId);
  const isLast = index === -1 || index >= sequence.length - 1;
  btnContinueNext.hidden = isLast;
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