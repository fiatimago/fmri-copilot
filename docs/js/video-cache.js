// ================== VIDEOS PROPIOS: DESCARGA Y CACHÉ LOCAL ==================
// Lo usan session.js, investigacion.js y pantalla.js.
//
// Idea: antes de reproducir, cada video de la secuencia se descarga COMPLETO
// y se guarda en el almacenamiento del navegador (Cache Storage). Durante la
// sesión se reproduce desde ahí, así que no depende de la red ni hay
// buffering a mitad de una adquisición.
//
// - Queda guardado entre sesiones: el segundo día ya no se descarga, salvo
//   que el archivo haya cambiado en GitHub (se compara el ETag del servidor).
// - Si no hay red pero el video ya estaba guardado, se usa el guardado.
// - Si el navegador no permite Cache Storage, se descarga a memoria igual
//   (solo dura mientras la página esté abierta).
// - La pantalla del paciente (otra ventana, mismo sitio) lee el mismo caché.

const VideoCache = (() => {
  const CACHE_NAME = "fmri-videos-v1";
  const objectUrls = new Map(); // src → blob: URL listo para reproducir
  const states = new Map(); // src → { status: "downloading"|"ready"|"error", progress: 0..1, error? }
  const inflight = new Map(); // src → Promise de la descarga en curso
  const listeners = new Set();

  function setState(src, state) {
    states.set(src, state);
    listeners.forEach((fn) => fn(src, state));
  }

  async function openCache() {
    try {
      return "caches" in window ? await caches.open(CACHE_NAME) : null;
    } catch (err) {
      return null; // ej. navegación privada en algunos navegadores
    }
  }

  function useBlob(src, blob) {
    objectUrls.set(src, URL.createObjectURL(blob));
    setState(src, { status: "ready", progress: 1 });
  }

  // ¿La copia guardada sigue siendo la misma que está en el servidor?
  // Sin red → se asume que sí (mejor reproducir la guardada que nada).
  async function isCachedCopyCurrent(src, cached) {
    try {
      const head = await fetch(src, { method: "HEAD", cache: "no-store" });
      if (!head.ok) return true;
      const serverTag = head.headers.get("ETag");
      const cachedTag = cached.headers.get("ETag");
      if (serverTag && cachedTag) return serverTag === cachedTag;
      const serverLen = head.headers.get("Content-Length");
      return !serverLen || serverLen === cached.headers.get("Content-Length");
    } catch (err) {
      return true;
    }
  }

  async function downloadWithProgress(src) {
    const resp = await fetch(src, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const total = Number(resp.headers.get("Content-Length")) || 0;
    const chunks = [];
    let received = 0;

    if (resp.body && resp.body.getReader) {
      const reader = resp.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        setState(src, { status: "downloading", progress: total ? received / total : 0 });
      }
    } else {
      chunks.push(new Uint8Array(await resp.arrayBuffer()));
    }

    const type = resp.headers.get("Content-Type") || "video/mp4";
    const blob = new Blob(chunks, { type });
    const headers = { "Content-Type": type, "Content-Length": String(blob.size) };
    const etag = resp.headers.get("ETag");
    if (etag) headers.ETag = etag;
    return { blob, headers };
  }

  // Descarga (o recupera del caché) un video. Devuelve una promesa que se
  // resuelve cuando está listo para reproducirse sin red. Nunca lanza error:
  // si falla queda en estado "error" y el video se reproduce desde la red.
  function preload(src) {
    if (!src) return Promise.resolve();
    if (states.get(src)?.status === "ready") return Promise.resolve();
    if (inflight.has(src)) return inflight.get(src);

    const job = (async () => {
      setState(src, { status: "downloading", progress: 0 });
      const cache = await openCache();
      let cached = null;
      try {
        cached = cache ? await cache.match(src) : null;
        if (cached && (await isCachedCopyCurrent(src, cached))) {
          useBlob(src, await cached.blob());
          return;
        }
        const { blob, headers } = await downloadWithProgress(src);
        if (cache) {
          try {
            await cache.put(src, new Response(blob, { headers }));
          } catch (err) {
            console.warn("No se pudo guardar en caché (¿sin espacio?):", src, err);
          }
        }
        useBlob(src, blob);
      } catch (err) {
        if (cached) {
          console.warn("Falló la descarga, se usa la copia guardada:", src, err);
          useBlob(src, await cached.blob());
        } else {
          console.error("No se pudo descargar el video:", src, err);
          setState(src, { status: "error", progress: 0, error: String(err) });
        }
      } finally {
        inflight.delete(src);
      }
    })();

    inflight.set(src, job);
    return job;
  }

  // URL para poner en <video>.src: la copia local si ya está, si no la de red.
  function playableUrl(src) {
    return objectUrls.get(src) || src;
  }

  // Para la pantalla del paciente: usa lo que haya en caché SIN descargar ni
  // consultar al servidor (la ventana de control ya se encargó de eso).
  async function playableUrlFromCache(src) {
    if (objectUrls.has(src)) return objectUrls.get(src);
    const cache = await openCache();
    const cached = cache ? await cache.match(src) : null;
    if (!cached) return src;
    const url = URL.createObjectURL(await cached.blob());
    objectUrls.set(src, url);
    return url;
  }

  // Copia guardada (sin verificar si está al día), o null. Para leer
  // metadatos como la duración sin gastar red.
  async function peekCachedBlob(src) {
    const cache = await openCache();
    const cached = cache ? await cache.match(src) : null;
    return cached ? cached.blob() : null;
  }

  return {
    preload,
    peekCachedBlob,
    playableUrl,
    playableUrlFromCache,
    getState: (src) => states.get(src) || null,
    onChange: (fn) => listeners.add(fn),
  };
})();

// Duración real de un archivo de video (segundos), leyendo solo sus
// metadatos. Se memoriza para no volver a pedirla.
const VideoDurations = (() => {
  const known = new Map(); // src → segundos
  const pending = new Map();

  function probe(src) {
    if (!src) return Promise.resolve(0);
    if (known.has(src)) return Promise.resolve(known.get(src));
    if (pending.has(src)) return pending.get(src);

    const p = (async () => {
      // Si ya está guardado en caché se lee de ahí, sin gastar red.
      const blob = VideoCache.getState(src)?.status === "ready" ? null : await VideoCache.peekCachedBlob(src);
      const tempUrl = blob ? URL.createObjectURL(blob) : null;

      return new Promise((resolve) => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.muted = true;
        const done = (seconds) => {
          if (tempUrl) URL.revokeObjectURL(tempUrl);
          known.set(src, seconds);
          pending.delete(src);
          v.removeAttribute("src");
          v.load();
          resolve(seconds);
        };
        v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : 0);
        v.onerror = () => {
          console.warn("No se pudo leer la duración de:", src);
          done(0);
        };
        v.src = tempUrl || VideoCache.playableUrl(src);
      });
    })();

    pending.set(src, p);
    return p;
  }

  return { probe, get: (src) => known.get(src) || 0 };
})();
