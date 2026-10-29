// ================== PANTALLA DEL PACIENTE (modo presentador) ==================
// Esta ventana no tiene controles propios: solo refleja lo que le manda la
// ventana de control por BroadcastChannel. Se abre desde el botón
// "Pantalla del paciente" (en Investigación o en Nueva sesión) y se arrastra
// al proyector/segundo monitor, poniéndola en pantalla completa con F11.
//
// El canal depende de qué página la abrió:
//   pantalla.html               → Investigación (investigacion.js)
//   pantalla.html?canal=sesion  → Nueva sesión (session.js)
//
// Los videos se toman de la copia que la ventana de control ya descargó al
// caché del navegador (VideoCache); esta ventana no descarga nada por su cuenta.
// El video va silenciado: el audio sale de la ventana de control.

const CHANNELS = {
  investigacion: "fmri-investigacion-presenter",
  sesion: "fmri-sesion-presenter",
};
const canal = new URLSearchParams(window.location.search).get("canal");
const presenterChannel = new BroadcastChannel(CHANNELS[canal] || CHANNELS.investigacion);

// Solo se salta a la posición de la ventana de control si el desfase supera
// este umbral; saltar siempre haría que el video se viera "cortado".
const SEEK_DRIFT_THRESHOLD_S = 0.5;

const stageImage = document.getElementById("stage-image");
const stageVideo = document.getElementById("stage-video");

// Buscar la copia en caché es asíncrono, así que los mensajes de play/pause/
// posición que lleguen mientras tanto se guardan y se aplican al cargar.
let loadToken = 0; // invalida cargas viejas si llega otro video antes de terminar
let videoReady = false;
let wantPlaying = false;
let pendingSeek = null;

async function showVideo(src) {
  const myToken = ++loadToken;
  videoReady = false;
  wantPlaying = false;
  pendingSeek = null;
  stageImage.hidden = true;
  stageVideo.hidden = false;

  const url = await VideoCache.playableUrlFromCache(src);
  if (myToken !== loadToken) return;
  stageVideo.src = url;
  stageVideo.load();
}

stageVideo.addEventListener("loadedmetadata", () => {
  videoReady = true;
  if (pendingSeek !== null) stageVideo.currentTime = pendingSeek;
  pendingSeek = null;
  if (wantPlaying) stageVideo.play().catch(() => {});
});

function playVideo() {
  wantPlaying = true;
  if (videoReady) stageVideo.play().catch(() => {});
}

function pauseVideo() {
  wantPlaying = false;
  if (videoReady) stageVideo.pause();
}

// force = true en pausas, saltos manuales y al (re)abrir la ventana, para
// quedar en el cuadro exacto; en la sincronización periódica solo se salta
// si hay desfase real.
function syncTo(seconds, force) {
  if (!videoReady) {
    pendingSeek = seconds;
    return;
  }
  const drift = Math.abs(stageVideo.currentTime - seconds);
  if (force || drift > SEEK_DRIFT_THRESHOLD_S) stageVideo.currentTime = seconds;
}

function stopVideo() {
  loadToken++;
  videoReady = false;
  wantPlaying = false;
  stageVideo.pause();
  stageVideo.hidden = true;
}

function showImage(src) {
  stopVideo();
  stageImage.hidden = false;
  stageImage.src = src;
}

function showBlank() {
  stopVideo();
  stageVideo.removeAttribute("src");
  stageVideo.load();
  stageImage.hidden = true;
  stageImage.src = "";
}

presenterChannel.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg) return;
  switch (msg.type) {
    case "show-image":
      showImage(msg.src);
      break;
    // "*-explainer" lo usa Investigación; "*-video" lo usa Nueva sesión.
    case "show-explainer":
    case "show-video":
      showVideo(msg.src);
      break;
    case "play-explainer":
    case "play-video":
      playVideo();
      break;
    case "pause-explainer":
    case "pause-video":
      pauseVideo();
      break;
    case "seek-explainer":
    case "seek-video":
      syncTo(msg.seconds, !!msg.force);
      break;
    case "show-blank":
      showBlank();
      break;
  }
});

// Al abrir (o reabrir) esta ventana, pide a la ventana de control que
// vuelva a mandar el estado actual — así no queda en blanco si se cerró y
// se reabrió a mitad de sesión.
presenterChannel.postMessage({ type: "request-state" });
