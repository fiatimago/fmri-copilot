// ================== PANTALLA DEL PACIENTE (modo presentador) ==================
// Esta ventana no tiene controles propios: solo refleja lo que le manda la
// ventana de control por BroadcastChannel. Se abre desde el botón
// "Pantalla del paciente" (en Investigación o en Nueva sesión) y se arrastra
// al proyector/segundo monitor, poniéndola en pantalla completa con F11.
//
// El canal depende de qué página la abrió:
//   pantalla.html               → Investigación (investigacion.js)
//   pantalla.html?canal=sesion  → Nueva sesión (session.js)

const CHANNELS = {
  investigacion: "fmri-investigacion-presenter",
  sesion: "fmri-sesion-presenter",
};
const canal = new URLSearchParams(window.location.search).get("canal");
const presenterChannel = new BroadcastChannel(CHANNELS[canal] || CHANNELS.investigacion);

// Solo se salta a la posición de la ventana de control si el desfase supera
// este umbral. Antes se hacía seekTo cada 3s sin condición, y cada salto
// obligaba a YouTube a volver a cargar → el video se veía "cortado".
const SEEK_DRIFT_THRESHOLD_S = 0.5;

const stageImage = document.getElementById("stage-image");
const youtubeStage = document.getElementById("youtube-player-proj-wrapper"); // el envoltorio, NO el div que la API de YouTube reemplaza

let ytPlayer;
let isYtPlayerReady = false;
let pendingVideoId = null; // por si "show-video" llega antes de que el reproductor esté listo

function onYouTubeIframeAPIReady() {
  ytPlayer = new YT.Player("youtube-player-proj", {
    height: "100%",
    width: "100%",
    playerVars: {
      controls: 0, // el paciente nunca ve controles de YouTube
      disablekb: 1,
      rel: 0,
      modestbranding: 1,
      iv_load_policy: 3,
      cc_load_policy: 0,
    },
    events: { onReady: onYtPlayerReady },
  });
}

function onYtPlayerReady() {
  isYtPlayerReady = true;
  // Silenciado: el audio sale de la ventana de control (mismo computador).
  // Si sonaran los dos reproductores habría eco por el pequeño desfase, y
  // además el navegador puede bloquear la reproducción automática con sonido
  // en esta ventana porque aquí nadie hace clic.
  ytPlayer.mute();
  if (pendingVideoId) {
    ytPlayer.cueVideoById(pendingVideoId);
    pendingVideoId = null;
  }
}

function showImage(src) {
  if (isYtPlayerReady) ytPlayer.pauseVideo();
  youtubeStage.hidden = true;
  stageImage.hidden = false;
  stageImage.src = src;
}

function showVideo(videoId) {
  stageImage.hidden = true;
  youtubeStage.hidden = false;
  if (isYtPlayerReady) ytPlayer.cueVideoById(videoId);
  else pendingVideoId = videoId;
}

function showBlank() {
  stageImage.hidden = true;
  stageImage.src = "";
  youtubeStage.hidden = true;
  if (isYtPlayerReady) ytPlayer.stopVideo();
}

// force = true en pausas y al (re)abrir la ventana, para quedar en el cuadro
// exacto; en la sincronización periódica solo se salta si hay desfase real.
function syncTo(seconds, force) {
  if (!isYtPlayerReady) return;
  const drift = Math.abs(ytPlayer.getCurrentTime() - seconds);
  if (force || drift > SEEK_DRIFT_THRESHOLD_S) ytPlayer.seekTo(seconds, true);
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
      showVideo(msg.videoId);
      break;
    case "play-explainer":
    case "play-video":
      if (isYtPlayerReady) ytPlayer.playVideo();
      break;
    case "pause-explainer":
    case "pause-video":
      if (isYtPlayerReady) ytPlayer.pauseVideo();
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
