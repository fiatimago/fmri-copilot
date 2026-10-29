# Validación de activaciones en el equipo (paso 2)

## Para qué sirve esta guía

Es una **validación en caliente**: apenas el tecnólogo termina de adquirir las tareas, se corre un FEAT rápido sobre las BOLD para confirmar que el estudio sirve **mientras el paciente sigue en el equipo**. Así, si una tarea salió con mucho movimiento o sin activación, se puede decidir repetirla antes de que el paciente se vaya.

Revisa tres cosas por tarea:

1. Que FEAT no muestre errores.
2. Que el movimiento no supere el punto de corte (**1.5 mm**).
3. Que la señal siga el diseño de bloques y aparezcan las activaciones esperadas.

> **Esto no es el resultado clínico.** Es un análisis rápido sin fMRIPrep ni factores de confusión. El resultado que va a syngo.via / AGFA sale de la **Guía de procesamiento fMRI** (paso 3).

---

## Antes de empezar

- El equipo debe tener el entorno instalado según la [Guía de instalación](#instalacion): FSL, el entorno `bioimg` (trae `dcm2niix`) y los diseños en `~/estudios/disenos/`.
- Todo se hace en la terminal de Ubuntu, salvo la exportación desde syngo.via.
- Pega **un bloque a la vez** y espera a que termine.
- **No cierres la terminal**: las variables del paso 1 solo existen en esa ventana. Si la cierras, vuelve a pegar el bloque 1.1.

### Dónde queda todo

La validación vive **dentro de la carpeta del estudio**, en su propia subcarpeta, separada de lo que usa el procesamiento completo:

```
~/estudios/fmri/NAME/
├── validacion/          ← ESTA GUÍA
│   ├── dicom/           ← BOLD exportadas de syngo.via
│   └── nifti/           ← BOLD convertidas + carpetas .feat
├── dicom/sub-01/        ← (paso 3) anatómica + BOLD para el procesamiento completo
└── ...
```

Así, cuando se haga el procesamiento completo (paso 3), `bidscoin` solo lee `dicom/sub-01` y no ve los archivos de la validación.

---

## Paso 0 — Pedir y exportar las BOLD

1. Al terminar las tareas, pide al tecnólogo que **envíe a syngo.via las series BOLD** (las que llevan `ep2d_bold` en el nombre).
2. En syngo.via, busca el estudio en el navegador de pacientes y selecciona **solo las series BOLD**.
3. Clic en **Exportar → Archivo de sistema** y elige la carpeta de Windows **`C:\fmri\validacion\NAME`** (reemplaza `NAME` por el mismo nombre que usarás en el paso 1).
4. Valida que estén todas las series y que la exportación haya sido exitosa.

> Usa `C:\fmri\validacion\...` y **no** `C:\fmri\NAME`. Esa segunda carpeta es la del export completo del paso 3; si se mezclan, el procesamiento completo recibe series BOLD duplicadas.

---

## Paso 1 — Variables, carpetas y copia de los DICOM

### 1.1 Variables (editar solo esta sección)

```bash
# --- EDITAR SOLO ESTA SECCIÓN ---
NAME="NAME"                                  # mismo nombre que usarás en el paso 3
EXPORT_DIR="/mnt/c/fmri/validacion/$NAME"    # carpeta del export de syngo.via
# --------------------------------
VAL_DIR="$ESTUDIOS/fmri/$NAME/validacion"
```

> En Ubuntu, `C:\` es `/mnt/c/`. Las barras van al revés: `/`.

### 1.2 Crear las carpetas y copiar los DICOM

```bash
mkdir -p "$VAL_DIR/dicom" "$VAL_DIR/nifti"
cp -r "$EXPORT_DIR"/* "$VAL_DIR/dicom/"
ls "$VAL_DIR/dicom" | head
```

Si `ls` no muestra nada, revisa `EXPORT_DIR` en el bloque 1.1.

---

## Paso 2 — Convertir DICOM a NIfTI (dcm2niix)

```bash
conda activate bioimg
dcm2niix -f "%d_%t" -p n -z y -b y -ba y -o "$VAL_DIR/nifti" "$VAL_DIR/dicom"
conda deactivate
```

- `-f "%d_%t"`: el archivo se llama como la serie más la hora de adquisición.
- `-z y`: comprime (`.nii.gz`). `-b y -ba y`: crea el `.json` de metadatos, sin datos del paciente.
- `conda deactivate` es **obligatorio** antes de FSL: `bioimg` le cambia el Python a FSL.

Verifica:

```bash
ls "$VAL_DIR/nifti/"*bold*.nii.gz
```

Debe aparecer un `.nii.gz` (con su `.json`) por cada tarea BOLD.

---

## Paso 3 — Análisis rápido con FEAT

### 3.1 Elegir el diseño de cada tarea

| Tarea | Volúmenes | Diseño a cargar |
|---|---|---|
| Motor mano der/izq | 100 | `100x20.fsf` |
| Lenguaje historia | 100 | `100x20.fsf` |
| Memoria episódica no verbal | 100 | `100x20.fsf` |
| Rostros | 100 | `100x20.fsf` |
| Memoria episódica verbal | 60 | `100x20.fsf` |
| Lenguaje visoverbal | 150 | `150x30.fsf` |
| Memoria de trabajo n-back | 150 | `150x30.fsf` |

### 3.2 Abrir FEAT

```bash
fsl &
```

Clic en **FEAT FMRI analysis**.

![Menú de FSL](guias/img/validacion/fsl_menu.png)

Se abre la ventana de FEAT:

![Ventana de FEAT vacía](guias/img/validacion/feat_vacio.png)

### 3.3 Cargar el diseño institucional

1. Clic en **Load**, abajo.
2. Navega a la carpeta de diseños. Para ver la ruta exacta:
   ```bash
   echo $DISENOS
   ```
   Puedes pegar esa ruta en el campo **Filter** de la ventana y dar Enter.
3. Elige **`100x20.fsf`** o **`150x30.fsf`** según la tabla 3.1 y clic en **OK**.

FEAT se actualiza con los datos del diseño:

![FEAT con el diseño cargado](guias/img/validacion/feat_diseno_cargado.png)

### 3.4 Cargar la BOLD de la tarea

1. Pestaña **Data → Select 4D data**.
2. Clic en el icono de carpeta.

   ![Ventana Select input data](guias/img/validacion/select_4d.png)

3. Navega a la carpeta de NIfTI. Para ver la ruta:
   ```bash
   echo "$VAL_DIR/nifti/"
   ```
4. Elige el `.nii.gz` de la tarea (el que lleva `bold` y el nombre de la tarea) y clic en **OK**, y otra vez **OK**.
5. Revisa en la pestaña **Data** que:
   - **Total volumes** coincida con la tabla 3.1 (100, 150 o 60).
   - **TR (s)** sea **2.0**.

   Si no coinciden, cargaste otra serie o el diseño equivocado.

> **Output directory** se deja vacío. FEAT crea la carpeta `NOMBRE_DE_LA_SERIE.feat` al lado del NIfTI, dentro de `validacion/nifti/`.

### 3.5 Ejecutar

Clic en **Go**. El botón se deshabilita mientras procesa.

FEAT intenta abrir el reporte en un navegador. **Si no se abre ninguno**, ábrelo desde Windows:

```bash
cd "$VAL_DIR/nifti" && explorer.exe . ; cd -
```

Entra a la carpeta `.feat` de la tarea y abre `report.html`.

> **¿Ya terminó?** El texto rojo **"Still running"** del reporte no siempre se actualiza. Para confirmarlo, revisa si ya existe el mapa final:
> ```bash
> ls "$VAL_DIR/nifti/"*.feat/thresh_zstat1.nii.gz
> ```
> Cuando aparece el archivo de esa tarea, FEAT terminó.

**Repite desde el paso 3.3 para cada tarea.** Puedes lanzar la siguiente mientras revisas la anterior.

---

## Paso 4 — Validación de los resultados

Para cada tarea, en `report.html`:

1. **Sin errores.** El reporte no debe mostrar mensajes de error. Si los hay, revisa que el diseño y el número de volúmenes coincidan (paso 3.4).
2. **Pre-stats — movimiento.** En la gráfica de desplazamiento medio de MCFLIRT, el movimiento no debe superar **1.5 mm**.
3. **Post-stats — señal y activación.** Solo si pasó el movimiento:
   - Al final de la página, la **gráfica temporal** (datos en rojo) debe seguir el patrón de bloques del modelo.

     ![Ejemplo de gráfica temporal de Post-stats](guias/img/validacion/serie_temporal.png)

   - Deben verse regiones del parénquima con activación estadísticamente significativa, coherentes con las **activaciones esperadas** de cada paradigma en la [guía de entrevista](#entrevista).

### Si una tarea no pasa

Avísale de inmediato al tecnólogo y al equipo, con el paciente todavía en el equipo, para decidir si se repite esa tarea. Si se repite, exporta de nuevo esa serie (paso 0), cópiala (paso 1.2) y conviértela (paso 2): `dcm2niix` le pone otra hora en el nombre, así que no pisa la anterior.

Al terminar todas las tareas, cierra FEAT.

---

## Solución de problemas

- **`dcm2niix: command not found`** → no activaste `bioimg`. Ejecuta `conda activate bioimg` y repite el paso 2.
- **FSL o FEAT dan errores raros de Python** → `bioimg` quedó activo. Ejecuta `conda deactivate` y vuelve a abrir `fsl &`.
- **`echo $VAL_DIR` sale vacío** → cerraste la terminal. Vuelve a pegar el bloque 1.1.
- **No abre ninguna ventana de FSL** o sale en blanco → ver **Reiniciar WSL** en la [guía de procesamiento](#procesamiento).
