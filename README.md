# fMRI Copilot

Herramienta web para presentar, desde el computador de la sala de control del resonador, los paradigmas que el paciente realiza durante un estudio de resonancia magnética funcional (fMRI): videos explicativos, videos de las tareas y secuencias de imágenes por bloques. Incluye además las guías del equipo para preparar el entorno, entrevistar al paciente, validar en el equipo y procesar los estudios.

Reemplaza el flujo de transportar un computador hasta el resonador: todo corre en el navegador del equipo ya instalado en la sala.

Publicada en: **https://fiatimago.github.io/fmri-copilot/**

![Status](https://img.shields.io/badge/status-en%20desarrollo-yellow)

---

## Alcance y limitaciones

- Es una **herramienta interna de presentación de estímulos**. No es un dispositivo médico ni software de diagnóstico, y no procesa ni almacena datos de pacientes.
- **El inicio de cada tarea es manual** (botón ▶ o barra espaciadora). No se sincroniza con el pulso de disparo del resonador.
- **Si se pausa una tarea durante la adquisición, sus tiempos dejan de coincidir con el diseño del análisis** (archivo `.fsf` de FEAT). El reporte de la sesión deja constancia de cada pausa con la hora y el segundo del paradigma en que ocurrió.

---

## Páginas

| Página | Para qué sirve |
|---|---|
| **Nueva sesión** (`nueva-sesion.html`) | Arma y reproduce la secuencia clínica de paradigmas en video. |
| **Investigación** (`investigacion.html`) | Arma y reproduce paradigmas como secuencias de imágenes por bloques, con número de bloques, duración y estímulos por bloque configurables. |
| **Pantalla del paciente** (`pantalla.html`) | Ventana sin controles que muestra al paciente lo mismo que la ventana de control. Se abre desde las dos páginas anteriores. |
| **Guías** (`guias.html`) | Guías del equipo, escritas en markdown: instalación del entorno, entrevista al paciente, validación en el equipo y procesamiento fMRI. |

---

## Características

### Nueva sesión e Investigación
- **Secuencia de tareas:** se agregan con **+** (o arrastrándolas, en Nueva sesión) y se reordenan con ▲▼. Al armar la secuencia se carga la primera tarea de la lista. En Investigación, mientras la sesión no haya empezado, el escenario sigue a la primera aunque se reordene la lista.
- **Idioma (Español/English), lateralidad (diestro/zurdo) y videos explicativos** activables. La lateralidad solo cambia el explicativo de MENV.
- **Controles:** Anterior, ▶/⏸ y Siguiente, más la **barra espaciadora**. Todo lo que se reproduce arranca siempre con ▶.
- **Pantallas negras entre momentos:**
  - al terminar el explicativo, la tarea queda en pausa detrás de **"Continuar a la tarea"**;
  - al terminar la tarea, aparece **"Siguiente tarea"**.
- **Bloqueo:** la tarea que se está reproduciendo no se puede mover ni quitar.
- **Pantalla del paciente:** se sincroniza por `BroadcastChannel`, va silenciada (el audio sale de la ventana de control) y se pone en negro en las pausas y si se cierra la ventana de control.
- **Videos sin conexión:** al agregar una tarea, sus videos se descargan completos al navegador y quedan guardados para las siguientes sesiones. Cada tarea muestra "✓ listo sin conexión" cuando su video está descargado.
- **Reporte de la sesión (.txt):** incluye la configuración, la secuencia programada y el registro de lo que realmente pasó: hora de inicio y fin de cada video o secuencia, tiempo efectivo, pausas y si terminó completo o se interrumpió.
- **Protección de la sesión:** mientras haya una sesión armada, los enlaces de la barra se abren en otra pestaña y el navegador pide confirmación antes de recargar o cerrar.

### Solo en Nueva sesión
- **Todo en una pantalla:** a la izquierda, fija, la barra **AHORA** (tarea, repetición, mano, explicativo o tarea y posición), el reproductor y los controles; a la derecha, con su propio scroll, los paneles plegables de **Parámetros** y **Guion**, la **Secuencia** y el reporte. Cada panel recuerda si quedó abierto o plegado.
- **Tareas repetibles:** la misma tarea puede agregarse varias veces (#1, #2…). El explicativo va solo en la primera; en las repeticiones se puede activar con 🎬.
- **Mano en la tarea motora:** cada tarea motora tiene su selector Der./Izq. (la segunda se propone con la mano que falta). El video es el mismo; cambian el guion y el reporte.
- **Guion al paciente:** pestañas **Entrevista** y **Tarea actual**, tomadas de `docs/guias/entrevista_paciente.md`. Dice la mano elegida en motor y muestra la versión diestro o zurdo de MENV. Las **activaciones esperadas** van en una sección plegada. En English no se muestra, porque todavía no hay guion en inglés.
- **Indicador de la pantalla del paciente:** "conectada" o "no abierta".

### Solo en Investigación
- **Configuración por tarea:** número de bloques (pares reposo/activación), duración de cada bloque y estímulos por bloque. Si se piden más imágenes de las que hay, se repiten en orden (loop) o aleatorizadas (random), sin mezclar reposo con activación.
- **El reporte incluye el detalle de imágenes por bloque** en el orden mostrado y el vector de clasificación de cada una: 0 = el paciente permanece quieto, 1 = el paciente mueve el dedo.
- **El reloj de la secuencia corre en un Web Worker**, así que la secuencia sigue a tiempo aunque la ventana de control quede oculta o tapada.

---

## Cómo usarlo en la sala

1. Entra a **Nueva sesión** (o **Investigación**) y elige idioma, lateralidad y si van los videos explicativos.
2. Agrega las tareas y ordénalas. **Espera a que todas marquen "✓ listo sin conexión"** antes de empezar.
3. Haz clic en **🖥️ Pantalla del paciente**, arrastra esa ventana al monitor del paciente y ponla en pantalla completa con **F11**.
4. Reproduce el explicativo con **▶**. Al terminar, haz clic en **Continuar a la tarea** y, cuando el paciente y el resonador estén listos, arranca la tarea con **▶**.
5. Al terminar la tarea, haz clic en **Siguiente tarea** y repite.
6. **Descarga el reporte antes de cerrar la página:** el registro solo vive mientras la página está abierta.

---

## Stack técnico

Intencionalmente simple: **HTML, CSS y JavaScript puro**, sin frameworks ni build steps, alojado como sitio estático en **GitHub Pages** (carpeta `docs/`). Cada sección es un archivo HTML real con su propia URL.

| Pieza | Tecnología |
|---|---|
| Reproducción de video | Elemento `<video>` del navegador, con archivos propios en `docs/videos/` |
| Descarga previa y caché de videos | Cache Storage del navegador (`js/video-cache.js`) |
| Pantalla del paciente | `BroadcastChannel` entre ventanas del mismo sitio |
| Reloj de Investigación | Web Worker |
| Guías | Markdown convertido con [marked](https://marked.js.org/) (se carga desde `cdn.jsdelivr.net`) |
| Hosting | GitHub Pages |

La página de guías necesita acceso a `cdn.jsdelivr.net` para cargar `marked`. Si la red lo bloquea, las guías no se muestran; el resto del sitio no depende de eso.

---

## Estructura del repositorio

```
fmri-copilot/
├── private/                      # Configuración sensible (ignorada por git, salvo .gitkeep)
├── docs/                         # Raíz servida por GitHub Pages
│   ├── index.html                # Home
│   ├── nueva-sesion.html         # Sesión clínica con videos
│   ├── investigacion.html        # Paradigmas por imágenes
│   ├── pantalla.html             # Pantalla del paciente
│   ├── guias.html                # Visor de guías
│   ├── css/style.css
│   ├── js/
│   │   ├── session.js            # Lógica de Nueva sesión
│   │   ├── guion.js              # Guion al paciente (lee la guía de entrevista)
│   │   ├── investigacion.js      # Lógica de Investigación
│   │   ├── pantalla.js           # Lógica de la pantalla del paciente
│   │   └── video-cache.js        # Descarga, caché y duración de los videos
│   ├── data/
│   │   ├── tasks.json            # Videos de cada tarea (idioma, lateralidad)
│   │   └── investigacion-tasks.json  # Tareas por imágenes y sus etiquetas 0/1
│   ├── videos/                   # MP4 de tareas y explicativos
│   ├── images/<tarea>/           # Imágenes de las tareas de Investigación
│   ├── guias/
│   │   ├── guias.json            # Índice de las guías
│   │   ├── *.md                  # Contenido de cada guía
│   │   └── img/                  # Imágenes de las guías
│   ├── assets/logo.png
│   └── version.json
├── .gitignore
└── README.md
```

**Mantenimiento de la barra de navegación:** está duplicada en `index.html`, `nueva-sesion.html`, `investigacion.html` y `guias.html`. Al cambiar el logo, un enlace o el nombre de la herramienta, hay que actualizar los cuatro archivos.

---

## Mantener el contenido

### Agregar o reemplazar un video
1. El video debe ser **MP4 con video H.264 y audio AAC** (Chrome y Edge no reproducen WMV), pesar **menos de 100 MB** (límite de GitHub por archivo) y tener el índice al inicio del archivo (*faststart*). Para dejarlo así con ffmpeg, desde Ubuntu:
   ```bash
   # MP4 que ya está en H.264: solo mover el índice al inicio, sin recomprimir
   ffmpeg -i original.mp4 -c copy -movflags +faststart nuevo.mp4
   # WMV u otro formato: convertir a MP4
   ffmpeg -i original.wmv -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart nuevo.mp4
   ```
2. Guárdalo en `docs/videos/` con el nombre `tarea_idioma[_lateralidad]_tipo.mp4`, por ejemplo `muni_es_tarea.mp4` o `menv_es_zurdo_explicativo.mp4`.
3. Pon su ruta en `docs/data/tasks.json`. La duración se lee del archivo, no hay que escribirla.
   ```json
   {
     "id": "muni",
     "title": "Tarea motora unilateral",
     "es": { "video": "videos/muni_es_tarea.mp4", "explainerVideo": "videos/muni_es_explicativo.mp4" },
     "en": { "video": "videos/muni_en_tarea.mp4", "explainerVideo": null }
   }
   ```
   `explainerVideo: null` significa que no hay explicativo en ese idioma: la tarea se carga directamente. Las tareas con variante por lateralidad (MENV) usan `"variants": { "diestro": {...}, "zurdo": {...} }`.
4. Sube **cada video en su versión final**: si después se reemplaza, git guarda también la versión anterior en el historial y el repo crece.

### Imágenes de Investigación
- Ruta: `docs/images/<prefijo>/<prefijo>_b<N>_<r|a><i>[_<0|1>].png`. Los bloques impares (`b1`, `b3`…) son reposo (`r`) y los pares son activación (`a`). `i` es la posición de la imagen dentro del bloque, y el sufijo `_0`/`_1` es su etiqueta. `lh` no lleva etiqueta.
- `docs/data/investigacion-tasks.json` define cada tarea: `prefijo`, `duracionEstandarBloque` (segundos), `standardNumBlocks` (estándar clínico) y `bloques`, con los arreglos de etiquetas de `reposo` y `activacion`.
- El sitio es estático y **no puede descubrir archivos por sí solo**: el nombre de cada imagen tiene que coincidir con lo que dice el JSON. Si falta alguna, la página lo avisa al cargar la tarea y la consola del navegador (F12) indica cuál es.

### Guion de Nueva sesión
El guion sale de `docs/guias/entrevista_paciente.md`: para cambiar lo que dice, se edita esa guía. Cada tarea de `tasks.json` dice con qué título empieza su sección (`"guion": { "seccion": "Paradigma motor unilateral" }`), y MENV además qué subsección corresponde a cada lateralidad (`subseccionPorLateralidad`). En las tareas con `"manoSeleccionable": true`, el texto `derecha/izquierda` de la guía se reemplaza por la mano elegida. Si se cambia el título de una sección en la guía, hay que actualizarlo también en `tasks.json`.

### Agregar o editar una guía
1. Escribe o edita el `.md` en `docs/guias/` (las imágenes van en `docs/guias/img/`).
2. Si es una guía nueva, agrégala a `docs/guias/guias.json`:
   ```json
   { "id": "procesamiento", "grupo": "Después del estudio", "titulo": "Procesamiento fMRI",
     "archivo": "procesamiento_fmri.md", "version": "v2", "fecha": "2026-10" }
   ```
3. Al cambiar el contenido de una guía, sube su `version` y su `fecha`: es lo que aparece bajo el título.

---

## Correrlo en local

No se puede abrir con doble clic (`file://`), porque el navegador bloquea las lecturas de archivos con `fetch()`. Necesitas un servidor local:

**Opción A: VS Code con Live Server (recomendada).** Haz clic derecho sobre `docs/index.html` y elige **Open with Live Server**.

**Opción B: terminal con Python**
```bash
cd docs
python3 -m http.server 8000
```
Luego abre `http://localhost:8000`.

En local, el navegador puede no conservar los videos descargados de una sesión a otra. En GitHub Pages sí quedan guardados.

---

## Flujo de trabajo (Git)

Este repo sigue **GitHub Flow**:

- `main` siempre es la versión estable y publicada.
- Todo cambio se hace en una rama descriptiva, `feature/lo-que-hace`, y entra a `main` por **Pull Request**.
- Después de fusionar, la rama se puede borrar o conservar. Si se conserva, hay que ponerla al día con `main` antes de volver a usarla.

```bash
git switch main
git pull origin main
git switch -c feature/nombre-descriptivo

# ... trabajar y hacer commits ...

git push -u origin feature/nombre-descriptivo
# abrir Pull Request en GitHub hacia main
```

### Trabajar desde varios computadores
- **Antes de editar, trae lo último** con `git pull` (o **Sync** en VS Code). Si dos computadores hacen commits sobre la misma rama sin traer los del otro, la rama diverge.
- Configura una vez en cada computador `git config pull.rebase false`, para que `git pull` pueda mezclar ramas divergentes.
- Revisa que el autor de los commits sea el correcto (`git config user.name` y `git config user.email`), sobre todo en equipos compartidos.

### Ver qué tiene una rama que `main` no tiene
```bash
git fetch origin
git log --oneline origin/main..origin/NOMBRE-RAMA
```
O en GitHub: `https://github.com/fiatimago/fmri-copilot/compare/main...NOMBRE-RAMA`

### Puntos de restauración
Antes de fusionar cambios grandes, se marca el estado anterior de `main` con un tag:

```bash
git fetch origin
git tag nombre-del-punto origin/main
git push origin nombre-del-punto
```

Para volver a ese punto:

```bash
git switch -c hotfix/restaurar nombre-del-punto
git push -u origin hotfix/restaurar
# abrir PR hacia main
```

| Tag | Estado que guarda |
|---|---|
| `esquema-una-pagina` | El sitio como una sola página con vistas ocultas por JavaScript, antes de dividirlo en páginas HTML reales |
| `antes-de-controles-nativos-yt` | Antes de pasar a los controles nativos de YouTube |
| `antes-de-idioma-en` | Antes de agregar el idioma inglés |
| `antes-de-videos-propios` | Antes de reemplazar YouTube por videos propios |
| `antes-de-guias` | Antes de agregar la página de guías |
| `pre-investigacion-merge`, `v0.1.0` | Tags anteriores del repo |

---

## Autores

Desarrollado por el equipo de imágenes diagnósticas (Fiat Imago) para uso interno.
