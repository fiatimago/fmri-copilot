# Guía de procesamiento fMRI (paso 3)

## Antes de empezar: reglas básicas

- Pega **un bloque a la vez** y espera a que termine.
- **No cierres la terminal** durante el procesamiento. Las variables del paso 1 (`BASE_DIR`, `SUBJ_ID`...) solo existen en esa ventana. Si la cierras o abres otra, **vuelve a pegar el bloque del paso 1**.
- Para comprobar que las variables siguen vivas: `echo $BASE_DIR`. Si sale vacío, repite el paso 1.
- **Dos tipos de rutas:**
  - Si el comando empieza con `docker run`, usa rutas **de adentro** del contenedor (`/data`, `/out`, `/work`).
  - Si no, usa rutas **reales** (`$BASE_DIR/...`).
- Para ver cualquier carpeta en Windows: `explorer.exe .` (abre la carpeta donde estas).
- `sudo` pide tu contraseña de Linux, y no se ve mientras la escribes.

---

## Paso 0 — Exportar las imágenes desde syngo.via

1. En syngo.via, busca el estudio de resonancia funcional en el navegador de pacientes.
2. Selecciona las secuencias **anatómicas volumétricas** y las **BOLD**.
3. Clic en **Exportar → Archivo de sistema** y elige una carpeta de Windows (por ejemplo `C:\fmri\ApellidoNombre`).
4. Valida que estén todas las secuencias y que la exportación haya sido exitosa.

Los DICOM se copian a Ubuntu en el paso 1.

---

## Paso 1 — Definir variables y crear el estudio

### 1.1 Variables (editar solo esta sección)

```bash
# --- EDITAR SOLO ESTA SECCIÓN ---
NAME="NAME"                     # nombre paciente
YOURUSER="f000"                     # Tu usuario
SUBJ_ID="01"                    # ID BIDS del sujeto
```
```bash
EXPORT_DIR="/mnt/c/Users/$YOURUSER/Documents/estudios/fmri/$NAME" # carpeta con los DICOM
BASE_DIR="$ESTUDIOS/fmri/$NAME"
LICENSE_PATH="$HOME/license.txt"
```

> En Ubuntu, `C:\` es `/mnt/c/` y una USB suele ser `/mnt/d/`. Las barras van al revés: `/`.

### 1.2 Crear la carpeta y copiar los DICOM

```bash
mkdir -p "$BASE_DIR/dicom/sub-$SUBJ_ID"
cp -r "$EXPORT_DIR"/* "$BASE_DIR/dicom/sub-$SUBJ_ID/"
cd "$BASE_DIR"
```

### 1.3 Verificar

```bash
echo "Estudio:   $BASE_DIR"
echo "Sujeto:    sub-$SUBJ_ID"
echo "Licencia:  $LICENSE_PATH"
echo "fMRIPrep:  $FMRIPREP_NCPUS núcleos, $FMRIPREP_MEM MB"
ls "$BASE_DIR/dicom/sub-$SUBJ_ID" | head
```

Si alguna línea sale vacía, revisa el bloque 1.1.

> **Importante:** en `dicom/sub-01` solo deben quedar **archivos DICOM** (`.dcm`), o carpetas de series si el export las trae así.

---

## Paso 2 — Mapeo y configuración (BIDSMAPPER)

Vincula las secuencias del resonador con el estándar BIDS.

```bash
docker run -ti --rm \
  -e DISPLAY=$DISPLAY \
  -v /tmp/.X11-unix:/tmp/.X11-unix \
  -v "$BASE_DIR/dicom":/data/raw:ro \
  -v "$BASE_DIR/bids_output":/data/bids \
  marcelzwiers/bidscoin:latest \
  bidsmapper /data/raw /data/bids -s
```

En la interfaz gráfica:

1. En la primera ventana, clic en **OK**.
2. En la lista de secuencias, clic en **Edit** sobre la **secuencia anatómica**. Solo se edita esa.
3. Borra el contenido del campo **acq** y déjalo en blanco. Esto es necesario para los pasos siguientes.
4. Clic en **OK**.
5. Clic en **SAVE**, y otra vez **SAVE** en la ventana emergente.
6. Cierra la interfaz.

**Resultado:** `bids_output/code/bidscoin/bidsmap.yaml`

---

## Paso 3 — Conversión DICOM a BIDS (BIDSCOINER)

```bash
docker run -ti --rm \
  -v "$BASE_DIR/dicom":/data/raw:ro \
  -v "$BASE_DIR/bids_output":/data/bids \
  marcelzwiers/bidscoin:latest \
  bidscoiner /data/raw /data/bids
```

**Devuélvete los permisos** (Docker deja los archivos a nombre del administrador):

```bash
sudo chown -R $USER:$USER "$BASE_DIR"
```

Verifica:

```bash
ls "$BASE_DIR/bids_output/sub-$SUBJ_ID/anat"
ls "$BASE_DIR/bids_output/sub-$SUBJ_ID/func"
```

Debes ver el `..._T1w.nii.gz` en `anat` y los `..._bold.nii.gz` en `func`.

---

## Paso 4 — Validación BIDS (BIDSVALIDATOR)

```bash
docker run -ti --rm \
  -v "$BASE_DIR/bids_output":/data:ro \
  bids/validator /data
```

**Se puede continuar si salen warnings.** Solo los **errores** requieren revisión.

---
## Paso 4 3/4 - OJO AQUI
> **¿El paciente tiene lesión?**
> - **No** → salta al **paso 8A**.
> - **Sí** → sigue con el paso 5.
>
> En pacientes con lesión, una segmentación correcta y un registro espacial robusto son esenciales para preservar la validez anatómica de los datos funcionales.

## Paso 5 — Segmentación de la lesión (FSLeyes)

### 5.1 Abrir la anatomía directamente en FSLeyes

```bash
ls "$BASE_DIR/bids_output/sub-$SUBJ_ID/anat/"
fsleyes "$BASE_DIR/bids_output/sub-$SUBJ_ID/anat/"*_T1w.nii.gz &
```

> Si hay varias anatómicas y la lesión se ve mejor en otra, ábrela desde **File → Add from file**.

### 5.2 Crear la máscara

1. **Tools → Edit mode**. Aparecen las barras de edición a la izquierda y arriba.
2. Clic en **"Create an empty 3D image which has the same dimensions as the currently selected image"**. Aparece en la *overlay list* una imagen con el sufijo `_mask`. En la sección *Location* puedes comprobar que los tamaños coinciden.
3. En la *overlay list*, selecciona la **imagen original**.
4. En la barra de edición:
   - Activa la herramienta de **selección**.
   - Activa **threshold** y **3D**.
   - Mueve la barra **intensity threshold** hasta que el área de la lesión quede pintada de morado.
   - Activa **límite circular** y **vecindad por intensidad**.
5. En **Target**, selecciona la imagen con sufijo `_mask`.
6. Navega por la imagen y haz clic sobre la región que quieres agregar.
7. Clic en **"Fill selected voxels"**. La segmentación aparece en blanco.
8. Repite los pasos 6 y 7 hasta cubrir toda la lesión o lesiones. Si necesitas un selector más grande o más pequeño, ajusta **search radius** en la barra superior.

> **Usa una sola máscara para todas las lesiones.**

### 5.3 Guardar la máscara (la ubicación es obligatoria)

1. En la *overlay list*, clic en el icono de **guardar** a la izquierda de la máscara.
2. Navega a la carpeta que muestra este comando:
   ```bash
   echo "$BASE_DIR/bids_output/sub-$SUBJ_ID/anat/"
   ```
3. Nombre del archivo: **`sub-01_label-lesion_mask.nii.gz`**, con el número de tu `SUBJ_ID`.
4. Clic en **Save**.

Verifica:

```bash
ls "$BASE_DIR/bids_output/sub-$SUBJ_ID/anat/"*lesion_mask*
```

> Si guardas la máscara en otra carpeta, el script de ANTs no la encuentra.

---

## Paso 6 — Crear `.bidsignore`

Evita que el validador BIDS rechace la máscara de lesión.

```bash
cat > "$BASE_DIR/bids_output/.bidsignore" << 'EOF'
extra_data/
sub-*_ct.*
*_label-lesion_roi.nii.gz
*_label-lesion_mask.nii.gz
EOF
cat "$BASE_DIR/bids_output/.bidsignore"
```

---

## Paso 7 — Registro ANTs al espacio MNI152 (solo pacientes con lesión)

### 7.1 Crear el script

Pega el bloque completo. Crea `run_ants_lesion.sh` dentro de la carpeta del estudio.

```bash
cat > "$BASE_DIR/run_ants_lesion.sh" << 'EOF'
#!/bin/bash
# run_ants_lesion.sh — Registro ANTs con cost function masking
# Uso: ./run_ants_lesion.sh /ruta/al/estudio

# -- EDITAR ---------------------------------------------------------
SUBJ="01"
PROJ="${1}"
TEMPLATEFLOW="${HOME}/.cache/templateflow"
THREADS=8
# -------------------------------------------------------------------

ANAT="${PROJ}/bids_output/sub-${SUBJ}/anat"
WORK="${PROJ}/work/sub-${SUBJ}/ants"
DERIV="${PROJ}/anat_derivatives/sub-${SUBJ}/anat"
TMPL_DIR="${TEMPLATEFLOW}/tpl-MNI152NLin2009cAsym"

mkdir -p "${WORK}" "${DERIV}"

# ── VERIFICAR / DESCARGAR TEMPLATEFLOW ───────────────────────────
TMPL_FILE="${TMPL_DIR}/tpl-MNI152NLin2009cAsym_res-01_T1w.nii.gz"
TMPL_MASK_FILE="${TMPL_DIR}/tpl-MNI152NLin2009cAsym_res-01_desc-brain_mask.nii.gz"

if [ ! -f "${TMPL_FILE}" ] || [ ! -f "${TMPL_MASK_FILE}" ]; then
    echo ">>> Templateflow no encontrado. Descargando..."
    docker run --rm \
        -v "${TEMPLATEFLOW}:/templateflow" \
        -e TEMPLATEFLOW_HOME=/templateflow \
        nipreps/fmriprep:latest \
        python -c "
import templateflow.api as tf
tf.get('MNI152NLin2009cAsym', resolution=1, desc=None, suffix='T1w')
tf.get('MNI152NLin2009cAsym', resolution=1, desc='brain', suffix='mask')
print('Descarga completa.')
"
else
    echo ">>> Templateflow OK."
fi

# Paths dentro del contenedor
C_ANAT="/data/anat"
C_WORK="/data/work"
C_DERIV="/data/deriv"
C_TMPL="/data/template"

T1_LOCAL=$(find "${ANAT}" -name "*_T1w.nii.gz" | head -1)
T1="${C_ANAT}/$(basename ${T1_LOCAL})"
MASK="${C_ANAT}/sub-${SUBJ}_label-lesion_mask.nii.gz"
TMPL="${C_TMPL}/tpl-MNI152NLin2009cAsym_res-01_T1w.nii.gz"
TMPL_MASK="${C_TMPL}/tpl-MNI152NLin2009cAsym_res-01_desc-brain_mask.nii.gz"
OUT="${C_WORK}/sub-${SUBJ}_to_MNI_"

BM="${C_WORK}/sub-${SUBJ}_BrainExtractionMask.nii.gz"
BMNL="${C_WORK}/sub-${SUBJ}_brain_mask_nolesion.nii.gz"

# Funcion helper
ants() {
    docker run --rm \
        -v "${ANAT}:${C_ANAT}:ro" \
        -v "${WORK}:${C_WORK}" \
        -v "${DERIV}:${C_DERIV}" \
        -v "${TMPL_DIR}:${C_TMPL}:ro" \
        antsx/ants "$@"
}

# ── PASO A: Extraccion de cerebro ─────────────────────────────────
echo ""
echo ">>> PASO A: Extrayendo cerebro..."
ants antsBrainExtraction.sh \
    -d 3 \
    -a "${T1}" \
    -e "${TMPL}" \
    -m "${TMPL_MASK}" \
    -o "${C_WORK}/sub-${SUBJ}_"

# ── PASO B: Mascara sin lesion ────────────────────────────────────
echo ""
echo ">>> PASO B: Generando mascara sin lesion..."
ants ImageMath 3 \
    "${BMNL}" \
    - \
    "${BM}" \
    "${MASK}"

ants ThresholdImage 3 \
    "${BMNL}" \
    "${BMNL}" \
    0.5 1 1 0

# ── PASO C: Registro ANTs SyN con cost function masking ───────────
echo ""
echo ">>> PASO C: Registro ANTs (45-90 min)..."
ants antsRegistration \
    --dimensionality 3 \
    --float 1 \
    --output "[${OUT},${OUT}Warped.nii.gz]" \
    --interpolation LanczosWindowedSinc \
    --use-histogram-matching 0 \
    --winsorize-image-intensities "[0.005,0.995]" \
    --initial-moving-transform "[${TMPL},${T1},1]" \
    --transform "Rigid[0.1]" \
        --metric "MI[${TMPL},${T1},1,32,Regular,0.25]" \
        --masks "[${TMPL_MASK},${BMNL}]" \
        --convergence "[1000x500x250x100,1e-6,10]" \
        --shrink-factors 8x4x2x1 \
        --smoothing-sigmas 3x2x1x0vox \
    --transform "Affine[0.1]" \
        --metric "MI[${TMPL},${T1},1,32,Regular,0.25]" \
        --masks "[${TMPL_MASK},${BMNL}]" \
        --convergence "[1000x500x250x100,1e-6,10]" \
        --shrink-factors 8x4x2x1 \
        --smoothing-sigmas 3x2x1x0vox \
    --transform "SyN[0.1,3,0]" \
        --metric "CC[${TMPL},${T1},1,4]" \
        --masks "[${TMPL_MASK},${BMNL}]" \
        --convergence "[100x70x50x20,1e-6,10]" \
        --shrink-factors 8x4x2x1 \
        --smoothing-sigmas 3x2x1x0vox \
    --verbose 1

# ── PASO D: Convertir transformaciones a .h5 ─────────────────────
echo ""
echo ">>> PASO D: Convirtiendo transformaciones a .h5..."
# nativo -> MNI
ants antsApplyTransforms \
    -d 3 \
    --input "${T1}" \
    --reference-image "${TMPL}" \
    --transform "${OUT}1Warp.nii.gz" \
    --transform "${OUT}0GenericAffine.mat" \
    --output "Linear[${C_DERIV}/sub-${SUBJ}_from-T1w_to-MNI152NLin2009cAsym_mode-image_xfm.h5,1]"

# MNI -> nativo (inversa)
ants antsApplyTransforms \
    -d 3 \
    --input "${TMPL}" \
    --reference-image "${T1}" \
    --transform "[${OUT}0GenericAffine.mat,1]" \
    --transform "${OUT}1InverseWarp.nii.gz" \
    --output "Linear[${C_DERIV}/sub-${SUBJ}_from-MNI152NLin2009cAsym_to-T1w_mode-image_xfm.h5,1]"

# ── PASO E: Organizar anat_derivatives ───────────────────────────
echo ""
echo ">>> PASO E: Organizando anat_derivatives..."
cp "${WORK}/sub-${SUBJ}_to_MNI_Warped.nii.gz" \
   "${DERIV}/sub-${SUBJ}_space-MNI152NLin2009cAsym_desc-preproc_T1w.nii.gz"
cp "${WORK}/sub-${SUBJ}_BrainExtractionMask.nii.gz" \
   "${DERIV}/sub-${SUBJ}_desc-brain_mask.nii.gz"

echo ""
echo "Listo. Verifica visualmente:"
echo "  ${WORK}/sub-${SUBJ}_to_MNI_Warped.nii.gz"
EOF
chmod +x "$BASE_DIR/run_ants_lesion.sh"
```

> Si tu `SUBJ_ID` no es `01`, cambia `SUBJ="01"` dentro del script: `nano "$BASE_DIR/run_ants_lesion.sh"`, editas la línea, y guardas con **Ctrl+O, Enter, Ctrl+X**.

### 7.2 Ejecutar

```bash
cd "$BASE_DIR"
./run_ants_lesion.sh "$BASE_DIR"
sudo chown -R $USER:$USER "$BASE_DIR"
```

**Tiempo estimado: 45–90 minutos** (depende del compu).

### 7.3 Revisión de calidad (obligatoria)

Abre el resultado y el template MNI juntos:

```bash
fsleyes "$BASE_DIR/work/sub-$SUBJ_ID/ants/sub-${SUBJ_ID}_to_MNI_Warped.nii.gz" \
        "$FSLDIR/data/standard/MNI152_T1_1mm.nii.gz" &
```

> Equivale a la guía anterior: abrir el `_Warped` y luego **File → Add Standard → MNI152_T1_1mm.nii.gz**.

Verifica visualmente que el registro sea correcto. **Un registro fallido produce resultados incorrectos en todos los análisis posteriores.**

---

## Paso 8 — Preprocesamiento (fMRIPrep)

Los comandos generan salidas en espacio MNI152 y en el espacio anatómico del paciente. Usa **solo uno** de los dos bloques.

### 8A — Paciente SIN lesión

```bash
docker run -ti --rm \
  -v "$BASE_DIR/bids_output":/data:ro \
  -v "$BASE_DIR/fmriprep_output":/out \
  --tmpfs /work:exec,mode=777 \
  -v "$LICENSE_PATH":/opt/freesurfer/license.txt:ro \
  -v "$HOME/.cache/templateflow":/templateflow \
  -e TEMPLATEFLOW_HOME=/templateflow \
  nipreps/fmriprep:latest \
  /data /out participant \
  --participant-label "$SUBJ_ID" \
  --work-dir /work \
  --fs-no-reconall \
  --output-spaces MNI152NLin6Asym:res-2 T1w \
  --n_cpus $FMRIPREP_NCPUS \
  --mem $FMRIPREP_MEM \
  --low-mem \
  --notrack
```

### 8B — Paciente CON lesión

Se agrega `-d fmriprep=/anat_deriv` para que fMRIPrep use el registro corregido de ANTs (paso 7) y salte el preprocesamiento anatómico interno.

```bash
docker run -ti --rm \
  -v "$BASE_DIR/bids_output":/data:ro \
  -v "$BASE_DIR/fmriprep_output":/out \
  -v "$BASE_DIR/anat_derivatives":/anat_deriv:ro \
  --tmpfs /work:exec,mode=777 \
  -v "$LICENSE_PATH":/opt/freesurfer/license.txt:ro \
  -v "$HOME/.cache/templateflow":/templateflow \
  -e TEMPLATEFLOW_HOME=/templateflow \
  nipreps/fmriprep:latest \
  /data /out participant \
  --participant-label "$SUBJ_ID" \
  --skip_bids_validation \
  -d fmriprep=/anat_deriv \
  --work-dir /work \
  --fs-no-reconall \
  --output-spaces MNI152NLin6Asym:res-2 T1w \
  --n_cpus $FMRIPREP_NCPUS \
  --mem $FMRIPREP_MEM \
  --low-mem \
  --notrack
```

### 8.1 Después de cualquiera de los dos

```bash
sudo chown -R $USER:$USER "$BASE_DIR"
ls "$BASE_DIR/fmriprep_output/sub-$SUBJ_ID/func/"
```

**Revisa el reporte de calidad de fMRIPrep:**

```bash
cd "$BASE_DIR/fmriprep_output" && explorer.exe . ; cd "$BASE_DIR"
```

Abre `sub-01.html` con doble clic.

---

## Paso 9 — Extracción de factores de confusión

Usa los archivos `..._desc-confounds_timeseries.tsv` que generó fMRIPrep.

### 9.1 Todas las tareas de una vez (recomendado)

```bash
conda activate bioimg
mkdir -p "$BASE_DIR/confounds"
```

```bash
for f in "$BASE_DIR"/fmriprep_output/sub-$SUBJ_ID/func/*_desc-confounds_timeseries.tsv; do
  echo ">>> Procesando: $(basename "$f")"
  fmri-confounds-extract \
    --inputfilepath "$f" \
    --outputdir "$BASE_DIR/confounds/"
done

ls "$BASE_DIR/confounds"
```

### 9.2 Una sola tarea (alternativa)

```bash
conda activate bioimg
TAREA="NOMBRE_DE_LA_TAREA"
fmri-confounds-extract \
  --inputfilepath "$BASE_DIR/fmriprep_output/sub-$SUBJ_ID/func/sub-${SUBJ_ID}_task-${TAREA}_desc-confounds_timeseries.tsv" \
  --outputdir "$BASE_DIR/confounds/"
```

### 9.3 Desactivar el entorno (obligatorio antes de FSL)

```bash
conda deactivate
```

> `bioimg` genera conflictos con FSL: algunos programas de FSL tomarían el Python equivocado.

---

## Paso 10 — Análisis funcional (FEAT)

### 10.1 Definir la tarea

Cada tarea lleva un **código corto**. Ese código se usa en tres lugares: el nombre de la carpeta de FEAT, la carpeta de DICOM de salida y el texto que aparece en las DICOM.

| Tarea | Código |
|---|---|
| Motor mano der/izq | `MOTOR_DER/IZQ` |
| Memoria episódica no verbal | `MENV` |
| Memoria episódica verbal | `MEV` |
| Lenguaje historia | `LH` |
| Lenguaje viso verbal | `LVV` |

Usa siempre el mismo código para la misma tarea, en mayúsculas y sin espacios, tildes ni ñ.

### 10.2 Abrir FSL

```bash
fsl &
```

Clic en **FEAT FMRI analysis**.

### 10.3 Cargar el diseño institucional

1. Clic en **Load**, abajo.
2. Navega a `/home/karen/estudios/disenos/`.
3. Elige **`100x20.fsf`** o **`150x30.fsf`** según la tarea, y clic en **OK**.

### 10.4 Cargar los datos 4D

1. Pestaña **Data → Select 4D data**.
2. Clic en el icono de carpeta.
3. Navega a `.../fmriprep_output/sub-01/func/`.
4. Elige el archivo de la tarea que termina en **`space-MNI152NLin6Asym_res-2_desc-preproc_bold.nii.gz`**.

   > Para cada tarea hay **dos** archivos `desc-preproc_bold`: uno `space-T1w` y otro `space-MNI152NLin6Asym_res-2`. Usa siempre el **MNI**, porque el paso 11 trabaja en espacio MNI.

5. Clic en **OK** y otra vez **OK**. FEAT actualiza automáticamente los datos de la imagen.

### 10.5 Agregar los factores de confusión

1. Pestaña **Stats**.
2. Activa **Add additional confound EVs**.
3. Clic en **Select confound EVs text file**, luego en el icono de carpeta.
4. Navega a `.../NAME/confounds/` y elige el archivo **de esta tarea**.
5. Clic en **OK**.

### 10.7 Ejecutar

Clic en **Go**. El botón se deshabilita mientras procesa.

FEAT intenta abrir el reporte en un navegador. **Si no se abre ninguno**, ábrelo desde Windows:

```bash
cd "$BASE_DIR/feat" && explorer.exe . ; cd "$BASE_DIR"
```

Entra a la carpeta `.feat` (de tu tarea) y abre `report.html`. Recarga la página hasta que desaparezca el texto rojo **"Still running"**.

### 10.8 Validación de los resultados

1. **Antes de continuar**, valida que el reporte **no muestre mensajes de error**.
2. **Prestats:** revisa que el movimiento del paciente no supere el punto de corte de calidad (**1.5 mm**).
3. Si cumple, **Poststats:**
   - Que la señal hemodinámica concuerde con el diseño experimental (gráfica temporal al final de la página).
   - Que se vean las regiones del parénquima con activación estadísticamente significativa.

**Repite desde el paso 10.1 para cada tarea.** Al terminar, cierra FEAT.

---

## Paso 11 — Alineación de los hallazgos y conversión a DICOM

Como anatomía y funcional están en el mismo espacio MNI, el resultado se superpone directamente.

### 11.1 Elegir el DICOM de referencia

```bash
find "$BASE_DIR/dicom/sub-$SUBJ_ID" -type f | head -20
```

Copia la ruta de un archivo DICOM de la **serie anatómica** y pégala abajo.

### 11.2 Convertir (una vez por tarea)

```bash
conda activate bioimg
cd "$BASE_DIR"
```
```bash
# --- EDITAR ---
DICOMREF="DICOM DE REFERENCIA"
TAREA="MENV"
NOMBREFEAT="NOMBRE DE LA CARPETA EN FUNC"
```
```bash
FEAT_DIR="$BASE_DIR/fmriprep_output/sub-$SUBJ_ID/func/$NOMBREFEAT$"
DCMREF="$BASE_DIR/dicom/sub-$SUBJ_ID/$DICOMREF"
```
```bash
ANAT=$(ls "$BASE_DIR"/fmriprep_output/sub-$SUBJ_ID/anat/*space-MNI152NLin6Asym_res-2_desc-preproc_T1w.nii.gz)
ZSTAT="$FEAT_DIR/thresh_zstat1.nii.gz"
SALIDA="$BASE_DIR/out_dicom/$TAREA"

echo "Tarea:    $TAREA"
echo "Anatomía: $ANAT"
echo "Thresh_zstat1:    $ZSTAT"
echo "Salida:   $SALIDA"
ls "$ANAT" "$ZSTAT" "$DCMREF"
```
```bash
nifti2dicom \
  --anat "$ANAT" \
  --mask "$ZSTAT" \
  --dcmref "$DCMREF" \
  --outputdir "$SALIDA" \
  --text "Mapeo $TAREA" \
  --vmin 2.3 \
  --alpha 0.8

conda deactivate
```

- **`TAREA`** define dos cosas: el nombre de la carpeta de salida (`out_dicom/MENV`) y el texto que aparece en las DICOM (`MENV`). Si quieres un texto más largo en las DICOM, por ejemplo `--text "fMRI $TAREA"`, cámbialo solo en esa línea.
- La anatomía es la misma para todo el paciente; solo cambian `TAREA` y `FEAT_DIR`.
- Si `ls` muestra "No such file", revisa `FEAT_DIR` y `DCMREF` antes de convertir.

### 11.3 Validación y envío

1. Abre la carpeta del resultado:
   ```bash
   cd "$BASE_DIR/out_dicom" && explorer.exe . ; cd "$BASE_DIR"
   ```
   Verifica el resultado con tu visor DICOM de preferencia (Mango: `mango`).
2. **Importa en syngo.via** y valida que coincida la información del paciente.
3. **Exporta a AGFA.**

> Los pasos 2 y 3 se hacen en el equipo del trabajo.

---

## Paso 12 — Cierre del estudio

- Revisa que estén completos: `fmriprep_output/`, `feat/`, `out_dicom/`.
- **Cada mes**, desde el equipo del trabajo, se copia `~/estudios/fmri/` a InvesNeuro y luego se limpia. **`~/estudios/disenos/` no se toca.**

### Cómo queda la carpeta del estudio

```
~/estudios/fmri/NAME/
├── dicom/sub-01/     ← DICOM originales (no se modifican)
├── bids_output/
│   ├── code/bidscoin/bidsmap.yaml
│   ├── .bidsignore
│   └── sub-01/anat/  sub-01/func/   (+ máscara de lesión)
├── run_ants_lesion.sh            (solo con lesión)
├── work/sub-01/ants/             (solo con lesión)
├── anat_derivatives/             (solo con lesión)
├── fmriprep_output/
│   ├── sub-01.html   ← reporte de calidad
|   ├── sub-01/anat/
│   └── sub-01/func/
|       └── tareas.feat/   ← si se deja vacio en FEAT
├── confounds/
└── out_dicom/
    ├── MENV/              ← lo que va a syngo.via / AGFA
    └── LH/
```

---

## Solución de problemas

### Reiniciar WSL

Apaga y vuelve a arrancar limpio Ubuntu, la pantalla de WSL (WSLg) y Docker. **Es lo primero que hay que intentar** cuando una ventana sale en blanco o algo se comporta raro sin explicación.

1. Cierra todas las ventanas de Ubuntu.
2. Abre **PowerShell** desde el menú de inicio de Windows (no la terminal de Ubuntu) y ejecuta:
   ```powershell
   wsl --shutdown
   ```
   > Desde Ubuntu también funciona `wsl.exe --shutdown`, pero solo si la conexión con Windows está bien. Si da `Exec format error`, usa PowerShell.
3. Espera unos 10 segundos y abre Ubuntu de nuevo.
4. **Vuelve a declarar las variables del paso 1.1**, porque el reinicio las borra.

### Reparar la conexión con Windows (`Exec format error`)

**Qué pasa:** Ubuntu abre programas de Windows (`.exe`) gracias a una regla interna llamada **WSLInterop**. Con systemd activado, esa regla se puede borrar, sobre todo después de instalar paquetes como Java. Sin ella, `wsl.exe`, `cmd.exe` y `explorer.exe` dan `Exec format error`.

**Solución (una sola vez por equipo):**

1. En Ubuntu, crea el archivo que hace que la regla se vuelva a registrar siempre:
   ```bash
   sudo sh -c 'echo ":WSLInterop:M::MZ::/init:PF" > /usr/lib/binfmt.d/WSLInterop.conf'
   ```
2. Reinicia WSL desde **PowerShell** (ver **Reiniciar WSL** arriba).
3. Abre Ubuntu y comprueba:
   ```bash
   cmd.exe /c ver
   cat /proc/sys/fs/binfmt_misc/WSLInterop
   ```
   - El primero debe mostrar `Microsoft Windows [Versión ...]`. El aviso de "rutas UNC" que sale antes es normal.
   - El segundo debe empezar con `enabled`.

> **Para equipos nuevos:** conviene crear este archivo justo después de activar systemd y de instalar Java, para que el problema no aparezca.

---

## Observaciones pendientes (no aplicadas en esta versión)

Quedan documentadas para revisarlas con el equipo. **Esta guía no las cambia**, para mantener el flujo igual al del trabajo.

1. **Espacio MNI en pacientes con lesión:** ANTs registra contra `MNI152NLin2009cAsym`, pero fMRIPrep pide la salida en `MNI152NLin6Asym`. Conviene verificar si fMRIPrep usa el registro corregido de ANTs para ese espacio o si calcula uno propio.
2. **Versiones fijas:** todas las imágenes usan `:latest`. Para trazabilidad clínica conviene fijar versiones (por ejemplo `nipreps/fmriprep:25.2.x`).
3. **`THREADS=8` en el script de ANTs:** la variable se define pero no se usa.
