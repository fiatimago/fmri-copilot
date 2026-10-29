# Guía de instalación: entorno de neuroimagen en Ubuntu (WSL) — v2, organizada

## Para qué sirve esta guía

Instala desde cero todo lo necesario para seguir la **Guía de procesamiento fMRI** (bidscoin, validador BIDS, ANTs, fMRIPrep, FSL/FEAT, confusores, nifti2dicom) y la volumetría (FreeSurfer), con las carpetas organizadas en tres zonas:

- **`~/programas`** — todo lo que se instala.
- **`~/fiatimago`** — repositorios del equipo (Fiat Imago).
- **`~/estudios`** — los estudios que se están procesando.

**Todo se hace en la terminal de Ubuntu.** La única excepción es el paso 0, que instala Ubuntu.

La misma estructura sirve para cualquier equipo: las rutas se escriben con `~` o `$HOME`, que es la carpeta del usuario (`/home/karen` en el portátil, `/home/neuro` en el trabajo). Por eso los comandos funcionan sin cambios en los dos.

---

## Antes de empezar: cómo leer esta guía

- Copia y pega **un bloque a la vez**, y espera a que termine antes de pegar el siguiente.
- Las líneas que empiezan con `#` son comentarios y no hacen nada.
- Cuando un comando lleva `sudo`, Ubuntu pide **tu contraseña de Linux**. Mientras la escribes **no aparece nada en pantalla**, ni asteriscos. Eso es normal: escríbela y presiona Enter.
- Lo que aparece en `MAYÚSCULAS_CON_GUION` (por ejemplo `TU_USUARIO_DE_WINDOWS`) hay que reemplazarlo por tu dato real.
- Deja el computador **conectado a la corriente**. Todo el proceso toma 2–3 horas, casi todo descargas, y ocupa unos 50 GB.
- **Comillas:** si copias desde Word o PDF y ves `SyntaxError: invalid character`, son comillas curvas (`' '`). Bórralas y escríbelas a mano en la terminal.

---

## Estructura final

```
/home/karen/
├── programas/
│   ├── instaladores/           ← archivos descargados (.py .sh .deb .zip); se pueden borrar al final
│   ├── config/
│   │   ├── entorno.sh          ← TODAS las rutas y variables (igual en todos los equipos)
│   │   └── local.sh            ← (opcional) ajustes que solo aplican a ESTE equipo
│   ├── fsl/                    ← FSL + FSLeyes + FEAT
│   ├── miniconda3/             ← Python y el entorno bioimg
│   ├── mango/                  ← visor Mango
│   ├── freesurfer → /usr/local/freesurfer/7.4.1   (acceso directo)
│   ├── radiolili/              ← nii2dicom, fmri_confounds_extract, nifti2dicom
│   └── templateflow/           ← plantillas MNI que descargan fMRIPrep y ANTs
│
├── fiatimago/
│   └── radio-tools/            ← repo del equipo (por ahora vacío)
│
├── estudios/
│   ├── disenos/                ← 100x20.fsf, 150x30.fsf
│   ├── fmri/
│   │   └── PSEUDONIMO/         ← un estudio = una carpeta
│   └── volumetria/
│       └── PSEUDONIMO/
│
├── license.txt                                   ← licencia FreeSurfer (igual que en la guía)
└── .cache/templateflow  → programas/templateflow (acceso directo)
```

**¿Por qué hay un acceso directo?** La guía de procesamiento busca las plantillas en `$HOME/.cache/templateflow`. La carpeta real vive dentro de `programas/`, y el acceso directo hace que los comandos de la guía la encuentren **sin cambiar ni una letra**. La licencia, en cambio, queda directamente en `~/license.txt`, igual que en la guía.

---

## Qué se instala y de dónde sale

| Herramienta | Para qué (en la guía de procesamiento) | De dónde sale | Dónde queda |
|---|---|---|---|
| Herramientas básicas (`git`, `wget`, `curl`, `unzip`, compiladores) | Descargar e instalar lo demás | Ubuntu (`apt`) | Sistema |
| Librerías gráficas X11 | Que abran las ventanas de FSL / FSLeyes | Ubuntu (`apt`) | Sistema |
| Java (`default-jre`) | Que funcione Mango | Ubuntu (`apt`) | Sistema |
| Docker Engine | Correr bidscoin, validador, ANTs y fMRIPrep | Repositorio oficial de Docker | Sistema |
| Imagen `marcelzwiers/bidscoin` | bidsmapper + bidscoiner (DICOM → BIDS) | Docker Hub | Docker |
| Imagen `bids/validator` | Validación BIDS | Docker Hub | Docker |
| Imagen `antsx/ants` | Registro de pacientes con lesión | Docker Hub | Docker |
| Imagen `nipreps/fmriprep` | Preprocesamiento | Docker Hub | Docker |
| FSL (FSLeyes, FEAT) | Segmentar la lesión; análisis funcional | Instalador oficial de Oxford | `~/programas/fsl` |
| Miniconda + entorno `bioimg` | numpy, nibabel, pydicom, matplotlib, scipy, pillow, pandas, bidscoin, dcm2niix | Anaconda / pip / conda-forge | `~/programas/miniconda3` |
| GitHub `RadioLili/fmri_confounds_extract` | Archivo de confusores para FEAT | GitHub privado | `~/programas/radiolili` |
| GitHub `RadioLili/nifti2dicom` | Resultado → DICOM para syngo.via / AGFA | GitHub privado | `~/programas/radiolili` |
| GitHub `RadioLili/nii2dicom` | Está en los prerrequisitos de la guía (no se usa en ningún paso) | GitHub privado | `~/programas/radiolili` |
| Licencia FreeSurfer | Obligatoria para fMRIPrep | Tu respaldo | `~/license.txt` |
| FreeSurfer 7.4.1 | Volumetría (`recon-all`, `asegstats2table`, `freeview`) | Paquete `.deb` oficial | `/usr/local/freesurfer` + acceso directo |
| Mango | Visor de imágenes | mangoviewer.com | `~/programas/mango` |
| GitHub `fiatimago/radio-tools` | Herramientas propias del equipo (futuro) | GitHub privado | `~/fiatimago/radio-tools` |
| Plantillas MNI (templateflow) | Usadas por ANTs y fMRIPrep | Se descargan solas la primera vez | `~/programas/templateflow` |

---

## Paso 0 — Instalar Ubuntu 22.04 (único paso en PowerShell)

Abre PowerShell y ejecuta:

```powershell
wsl --install -d Ubuntu-22.04
```

Se abre una ventana de Ubuntu que pide:
- **Usuario:** `karen` (en el trabajo es `neuro`)
- **Contraseña:** la que quieras. No se ve mientras escribes.

Si la ventana no se abre sola, busca **"Ubuntu 22.04"** en el menú de inicio.

> **A partir de aquí, todo se hace dentro de la terminal de Ubuntu.**

---

## Paso 1 — Crear las carpetas

```bash
mkdir -p ~/programas/{instaladores,config,radiolili,templateflow}
mkdir -p ~/fiatimago
mkdir -p ~/estudios/{disenos,fmri,volumetria}
```

Acceso directo para las plantillas MNI:

```bash
mkdir -p ~/.cache
ln -s ~/programas/templateflow ~/.cache/templateflow
```

Verifica:

```bash
ls ~
ls ~/programas
```

---

## Paso 2 — Archivo de configuración `entorno.sh`

Este archivo reúne **todas las rutas y variables** en un solo lugar y reemplaza las líneas sueltas que antes se iban agregando al `.bashrc`. Se carga solo cada vez que abres Ubuntu.

Dos detalles de cómo funciona:

- **Funciona en cualquier equipo.** Busca cada programa en la estructura nueva (`~/programas/...`) y, si no lo encuentra, en la antigua (`~/fsl`, `~/miniconda3`, `~/Mango`, `~/trabajo`). Así sirve también en equipos que todavía no se han migrado.
- **Calcula la RAM y los núcleos del equipo.** fMRIPrep usa el 80 % de la RAM que tiene WSL, y todos los núcleos menos 2.
- Si un programa todavía no está instalado, lo salta sin dar error.

```bash
cat > ~/programas/config/entorno.sh << 'EOF'
# =====================================================================
# entorno.sh — rutas y variables del entorno de neuroimagen
# Igual en todos los equipos. Los ajustes propios de un equipo van en
# ~/programas/config/local.sh (se carga ANTES que este archivo).
# =====================================================================

# Devuelve la primera ruta que exista
buscar() { for d in "$@"; do [ -e "$d" ] && { echo "$d"; return; }; done; }

# ---- Carpetas principales -------------------------------------------
export PROGRAMAS="$HOME/programas"
export FIATIMAGO="$HOME/fiatimago"
export ESTUDIOS=$(buscar "$HOME/estudios" "$HOME/trabajo")
export DISENOS="$ESTUDIOS/disenos"

# ---- Programas (estructura nueva primero, antigua después) ----------
export CONDA_DIR=$(buscar "$HOME/programas/miniconda3" "$HOME/miniconda3")
export MANGO_DIR=$(buscar "$HOME/programas/mango" "$HOME/Mango")
export RADIOLILI_DIR=$(buscar "$HOME/programas/radiolili" "$HOME/radiolili")

# ---- Licencia FreeSurfer (misma ruta que usa la guía) ---------------
export LICENSE_PATH="$HOME/license.txt"
export FS_LICENSE="$LICENSE_PATH"

# ---- FreeSurfer -----------------------------------------------------
if [ -d /usr/local/freesurfer/7.4.1 ]; then
  export FREESURFER_HOME=/usr/local/freesurfer/7.4.1
  source "$FREESURFER_HOME/SetUpFreeSurfer.sh" > /dev/null
fi

# ---- FSL (va después de FreeSurfer para que sus comandos queden primero)
_fsl=$(buscar "$HOME/programas/fsl" "$HOME/fsl")
if [ -n "$_fsl" ]; then
  export FSLDIR="$_fsl"
  source "$FSLDIR/etc/fslconf/fsl.sh"
  export PATH="$FSLDIR/share/fsl/bin:$PATH"
fi
unset _fsl

# ---- Recursos para fMRIPrep (local.sh puede fijarlos) ---------------
_ram_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
export FMRIPREP_MEM=${FMRIPREP_MEM:-$(( _ram_mb * 80 / 100 ))}
export FMRIPREP_NCPUS=${FMRIPREP_NCPUS:-$(( $(nproc) - 2 ))}
unset _ram_mb

# ---- Atajos ---------------------------------------------------------
alias mango='(cd "$MANGO_DIR" && java -jar Mango.jar &)'
alias estudios='cd "$ESTUDIOS"'
EOF
```

Conecta el archivo al `.bashrc`:

```bash
cat >> ~/.bashrc << 'EOF'

# ===== Entorno de neuroimagen =====
[ -f "$HOME/programas/config/local.sh" ] && source "$HOME/programas/config/local.sh"
source "$HOME/programas/config/entorno.sh"
EOF
```

Con esto quedan dos atajos: `mango` abre el visor y `estudios` te lleva a la carpeta de estudios.

> **`local.sh` es opcional.** Solo se crea si un equipo necesita valores distintos a los calculados. Por ejemplo, para fijar la memoria de fMRIPrep:
> ```bash
> echo 'export FMRIPREP_MEM=10000' > ~/programas/config/local.sh
> ```

---

## Paso 3 — Actualizar Ubuntu e instalar lo básico

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y build-essential curl wget git unzip ca-certificates gnupg
sudo apt-get install -y libxft2 libxrender1 libxext6 libsm6 libxt6 default-jre
```

Verifica Java:

```bash
java -version
```

---

## Paso 4 — RAM para WSL y arranque automático (systemd)

### 4.1 Asignar RAM a WSL

Por defecto WSL usa solo la mitad de la RAM. Vamos a darle el 75 %: 12 GB en un equipo de 16 GB.

Primero mira cuál es tu usuario de Windows:

```bash
ls /mnt/c/Users
```

Aparecerán carpetas como `Public`, `Default` y **la tuya**. Escríbela en esta línea:

```bash
WINUSER="TU_USUARIO_DE_WINDOWS"
```

Crea el archivo de configuración. Este archivo vive en Windows, pero se escribe desde Ubuntu:

```bash
cat > /mnt/c/Users/$WINUSER/.wslconfig << 'EOF'
[wsl2]
memory=12GB
processors=8
swap=16GB
EOF
```

> En otros equipos ajusta `memory` a cerca del 75 % de su RAM (32 GB → `memory=24GB`) y `processors` al número de procesadores lógicos.

### 4.2 Activar systemd

Con systemd activado, Docker arranca solo y **ya no hay que escribir `sudo service docker start`** cada vez.

```bash
cat /etc/wsl.conf
```

Si el resultado **no** dice `systemd=true`, ejecuta:

```bash
echo -e "[boot]\nsystemd=true" | sudo tee -a /etc/wsl.conf
```

### 4.3 Reiniciar WSL

```bash
wsl.exe --shutdown
```

La ventana se cierra. Espera unos 10 segundos y vuelve a abrir Ubuntu. Verifica:

```bash
free -h     # en "Mem", total ≈ 11-12Gi
nproc       # 8
```

---

## Paso 5 — Docker (motor nativo, sin Docker Desktop)

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Activa el arranque automático y dale permiso a tu usuario para usar Docker sin `sudo`:

```bash
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
wsl.exe --shutdown
```

Vuelve a abrir Ubuntu y verifica:

```bash
docker run hello-world
```

Si aparece **"Hello from Docker!"**, Docker quedó bien instalado.

---

## Paso 6 — Imágenes Docker

Son unos 20 GB en total y pueden tardar más de una hora.

```bash
docker pull marcelzwiers/bidscoin:latest
docker pull nipreps/fmriprep:latest
docker pull bids/validator:latest
docker pull antsx/ants:latest
docker images
```

Si la red tiene un proxy con certificado propio (pasa en redes institucionales), puede salir un error SSL. En ese caso prueba con otra red.

---

## Paso 7 — FSL

```bash
cd ~/programas/instaladores
wget https://fsl.fmrib.ox.ac.uk/fsldownloads/fslinstaller.py
python3 fslinstaller.py -d $HOME/programas/fsl
```

`-d` le indica al instalador dónde poner FSL. La descarga pesa varios GB.

Al terminar, **cierra Ubuntu y vuelve a abrirlo** para que `entorno.sh` cargue FSL. Verifica:

```bash
echo $FSLDIR     # /home/karen/programas/fsl
which fsl
fsl &            # abre el menú de FSL (FEAT)
fsleyes &        # abre FSLeyes
```

---

## Paso 8 — Miniconda y el entorno `bioimg`

```bash
cd ~/programas/instaladores
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh
bash Miniconda3-latest-Linux-x86_64.sh -b -p $HOME/programas/miniconda3
$HOME/programas/miniconda3/bin/conda init bash
source ~/.bashrc
```

Configuración inicial:

```bash
# Que conda NO se active solo al abrir Ubuntu (se activa cuando la guía lo pide)
conda config --set auto_activate_base false

# Aceptar términos de los canales
conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main
conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r
```

Crea el entorno `bioimg`:

```bash
conda create -n bioimg python=3.11 -y
conda activate bioimg
pip install numpy nibabel pydicom matplotlib scipy pillow pandas bidscoin
conda install -c conda-forge dcm2niix -y
```

Verifica:

```bash
python -c "import numpy,nibabel,pydicom,scipy,pandas; print('OK')"
dcm2niix -v
```

> **Importante:** con `bioimg` activo usa siempre `python`, no `python3`. Fuera de conda, `python3` puede apuntar al Python interno de FSL.

---

## Paso 9 — Repositorios de RadioLili

### 9.1 Token de GitHub

En el navegador, entra a GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)**. Marca el permiso **`repo`** y genera el token. **Cópialo de inmediato**: no se vuelve a mostrar. Nunca lo compartas por chat ni por correo.

### 9.2 Clonar e instalar

El primer comando hace que Ubuntu recuerde el token durante 1 hora:

```bash
git config --global credential.helper 'cache --timeout=3600'

cd ~/programas/radiolili
git clone https://github.com/RadioLili/nii2dicom.git
git clone https://github.com/RadioLili/fmri_confounds_extract.git
git clone https://github.com/RadioLili/nifti2dicom.git
```

Cuando pida **Username**, escribe tu usuario de GitHub. Cuando pida **Password**, pega el **token**, no tu contraseña. Tampoco se ve al pegar.

Instala las herramientas dentro de `bioimg`:

```bash
conda activate bioimg
pip install ./fmri_confounds_extract
pip install ./nifti2dicom
```

Verifica:

```bash
fmri-confounds-extract --help
nifti2dicom --help
conda deactivate
```

> **Para actualizar** cuando el equipo publique cambios: `cd ~/programas/radiolili/NOMBRE_REPO && git pull && conda activate bioimg && pip install .`

---

## Paso 10 — Licencia de FreeSurfer

Copia la licencia desde donde la tengas guardada en Windows. Con `ls` puedes buscarla:

```bash
ls /mnt/c/Users/$WINUSER/
cp "/mnt/c/Users/$WINUSER/RUTA/A/license.txt" ~/license.txt
cat ~/license.txt
```

Queda en `~/license.txt`, la misma ruta que usa la guía de procesamiento.

> Si `$WINUSER` sale vacía porque cerraste Ubuntu, vuelve a correr la línea `WINUSER="..."` del paso 4.1.

---

## Paso 11 — FreeSurfer 7.4.1

```bash
cd ~/programas/instaladores
wget https://surfer.nmr.mgh.harvard.edu/pub/dist/freesurfer/7.4.1/freesurfer_ubuntu22-7.4.1_amd64.deb
sudo apt-get update
sudo apt-get install -y ./freesurfer_ubuntu22-7.4.1_amd64.deb
ln -s /usr/local/freesurfer/7.4.1 ~/programas/freesurfer
```

Cierra y vuelve a abrir Ubuntu, y verifica:

```bash
echo $FREESURFER_HOME   # /usr/local/freesurfer/7.4.1
recon-all --version
freeview --version
```

> La guía anterior copiaba la licencia dentro de FreeSurfer con `sudo cp`. Ya no hace falta, porque `entorno.sh` le indica dónde está mediante `FS_LICENSE`.

---

## Paso 12 — Mango

```bash
cd ~/programas/instaladores
wget https://mangoviewer.com/downloads/mango_unix.zip
unzip mango_unix.zip -d ~/programas/
ls ~/programas/
```

Si la carpeta quedó como `Mango`, con mayúscula, renómbrala:

```bash
mv ~/programas/Mango ~/programas/mango
```

Cierra y vuelve a abrir Ubuntu, y escribe:

```bash
mango
```

---

## Paso 13 — Repositorio del equipo (Fiat Imago)

```bash
cd ~/fiatimago
git clone https://github.com/fiatimago/radio-tools.git
```

Si el repo todavía está vacío, aparece el aviso *"You appear to have cloned an empty repository"*. Es normal.

---

## Paso 14 — Diseños de FEAT

Copia los `.fsf` a `disenos`:

```bash
cp "/mnt/c/Users/$WINUSER/RUTA/A/100x20.fsf" ~/estudios/disenos/
cp "/mnt/c/Users/$WINUSER/RUTA/A/150x30.fsf" ~/estudios/disenos/
ls ~/estudios/disenos
```

---

## Paso 15 — Verificación final

Cierra y vuelve a abrir Ubuntu, y ejecuta:

```bash
echo "--- Rutas ---"
echo "FSLDIR=$FSLDIR"
echo "FREESURFER_HOME=$FREESURFER_HOME"
echo "ESTUDIOS=$ESTUDIOS"
echo "DISENOS=$DISENOS"
echo "MANGO_DIR=$MANGO_DIR"
echo "FMRIPREP_MEM=$FMRIPREP_MEM  FMRIPREP_NCPUS=$FMRIPREP_NCPUS"

echo "--- Accesos directos ---"
ls -la ~/license.txt ~/.cache/templateflow ~/programas/freesurfer

echo "--- Docker ---"
docker images

echo "--- FSL / FreeSurfer ---"
which fsl fsleyes feat
recon-all --version

echo "--- Python ---"
conda activate bioimg
python -c "import numpy,nibabel,pydicom,scipy,pandas; print('OK')"
dcm2niix -v
fmri-confounds-extract --help | head -3
nifti2dicom --help | head -3
conda deactivate

echo "--- Diseños ---"
ls $DISENOS
```

Checklist:

- [ ] Las rutas muestran `/home/karen/programas/...`
- [ ] `~/license.txt` existe, y `templateflow` y `freesurfer` muestran flechas `→`
- [ ] Docker lista las 4 imágenes
- [ ] FSL, FSLeyes y FEAT responden
- [ ] FreeSurfer muestra la versión 7.4.1
- [ ] Python dice `OK`
- [ ] Los dos comandos de RadioLili responden
- [ ] `disenos` tiene los dos `.fsf`
- [ ] `mango` abre el visor

Para liberar espacio, borra los instaladores:

```bash
rm -rf ~/programas/instaladores/*
```

---

## Cómo se procesa un estudio con esta estructura

### Crear el estudio

Usa un **pseudónimo** sin espacios, tildes ni ñ, que no se repita entre estudios:

```bash
PSEUDO="PSEUDONIMO"
mkdir -p ~/estudios/fmri/$PSEUDO/dicom/sub-01
```

Copia los DICOM exportados. En Ubuntu el disco `C:` es `/mnt/c` y una USB suele aparecer como `/mnt/d`:

```bash
cp -r "/mnt/c/RUTA/DEL/EXPORT/"* ~/estudios/fmri/$PSEUDO/dicom/sub-01/
```

### Variables al inicio (reemplaza el bloque "Definición de variables de ruta" de la guía)

```bash
# --- EDITAR SOLO ESTA SECCIÓN ---
PSEUDO="PSEUDONIMO"
BASE_DIR="$ESTUDIOS/fmri/$PSEUDO"
SUBJ_ID="01"
LICENSE_PATH="$HOME/license.txt"
cd $BASE_DIR
# --------------------------------
```

Desde aquí, **la guía de procesamiento se sigue igual**, con estas diferencias:

| En la guía antigua | Ahora |
|---|---|
| "Abra Docker Desktop" | No hace falta: Docker arranca solo |
| `BASE_DIR="/mnt/c/..."` | `BASE_DIR="$ESTUDIOS/fmri/$PSEUDO"` |
| fMRIPrep `--n_cpus 6 --mem 20000` | `--n_cpus $FMRIPREP_NCPUS --mem $FMRIPREP_MEM` (cada equipo usa su RAM) |
| Cargar `100x20.fsf` / `150x30.fsf` en FEAT | Están en `~/estudios/disenos/` |
| `bidsmap.yaml` | Sin cambios: bidsmapper lo crea en `bids_output/code/bidscoin/` de cada estudio |

### Después del procesamiento

Cada mes, desde el computador del trabajo, se copia a InvesNeuro lo de `~/estudios/fmri/` y `~/estudios/volumetria/`, y luego se limpian esas dos carpetas. `disenos/` no se toca.

---

## Notas para replicar en los equipos del trabajo

- La guía es la misma. En el paso 0 el usuario es `neuro`, y como todo usa `~` o `$HOME`, las rutas se ajustan solas a `/home/neuro/...`.
- En el paso 4.1, ajusta `memory` y `processors` a la RAM y los procesadores de ese equipo.
- `entorno.sh` también reconoce la estructura antigua (`~/fsl`, `~/miniconda3`, `~/Mango`, `~/trabajo`). Así, un equipo que todavía no se ha migrado sigue funcionando con los mismos comandos.
- Por el firewall institucional, lo único que se ejecuta fuera de Ubuntu es el paso 0 (`wsl --install`).

---

## Paso 16 — VS Code (editor de código) dentro de Ubuntu

Se instala la versión de **Linux** de VS Code, dentro de `~/programas/vscode`, sin instalar nada en Windows. La ventana se abre igual que FSL o FSLeyes.

Se usa la versión **portable** (`.tar.gz` + carpeta `data/`). Así el programa, las extensiones y la configuración quedan juntos en `~/programas/vscode/`, sin carpetas ocultas en `~`.

```
~/programas/vscode/
├── bin/code        ← el comando que se usa
├── code            ← el programa
└── data/           ← extensiones y configuración (modo portable)
```

### 16.1 Librerías que necesita la ventana

```bash
sudo apt-get update
sudo apt-get install -y libnss3 libasound2 libgbm1 libxkbfile1 libsecret-1-0 libgtk-3-0 libxss1 libxshmfence1
```

### 16.2 Descargar e instalar en `programas`

```bash
cd ~/programas/instaladores
wget -O vscode.tar.gz "https://code.visualstudio.com/sha/download?build=stable&os=linux-x64"
tar -xzf vscode.tar.gz -C ~/programas/
mv ~/programas/VSCode-linux-x64 ~/programas/vscode
mkdir -p ~/programas/vscode/data
ls ~/programas/vscode
```

Deben aparecer `bin`, `code`, `data`, `resources` y otros archivos.

### 16.3 Agregarlo a `entorno.sh`

```bash
cat >> ~/programas/config/entorno.sh << 'FIN'

# ---- VS Code (portable en ~/programas/vscode) ------------------------
_vscode=$(buscar "$HOME/programas/vscode")
[ -n "$_vscode" ] && export PATH="$_vscode/bin:$PATH"
unset _vscode
export DONT_PROMPT_WSL_INSTALL=1
FIN
```

- La primera parte hace que el comando `code` funcione desde cualquier carpeta.
- `DONT_PROMPT_WSL_INSTALL=1` evita que VS Code pregunte cada vez si quieres usar la versión de Windows. Esa versión no se puede instalar en el trabajo.

### 16.4 Probar

Cierra Ubuntu, vuelve a abrirlo y ejecuta:

```bash
which code        # /home/USUARIO/programas/vscode/bin/code
code --version
code ~/fiatimago/radio-tools &
```

La primera vez puede tardar unos segundos en abrir.

**Si aparece el mensaje "An OS keyring couldn't be identified..."**, haz clic en **Use weaker encryption**. WSL no tiene el llavero de contraseñas de un escritorio Linux completo, así que VS Code guarda la sesión en su propia carpeta (`~/programas/vscode/data/`). No vuelve a preguntar.

### 16.5 Conectarlo con Python (`bioimg`)

1. En VS Code, abre **Extensiones** (**Ctrl+Shift+X**) e instala **Python**, de Microsoft.
2. **Ctrl+Shift+P → Python: Select Interpreter** y elige el que diga `bioimg`.
3. Si no aparece, elige **Enter interpreter path** y pega:
   ```
   /home/USUARIO/programas/miniconda3/envs/bioimg/bin/python
   ```
   (`USUARIO` es `karen` en el portátil y `neuro` en el trabajo).

Para confirmar que el modo portable funciona:

```bash
ls ~/programas/vscode/data     # debe aparecer la carpeta "extensions"
```

### 16.6 Actualizar VS Code

La versión `.tar.gz` no se actualiza sola. Para actualizarla, descarga la nueva versión y conserva la carpeta `data`, que tiene tus extensiones y tu configuración:

```bash
cd ~/programas/instaladores
wget -O vscode.tar.gz "https://code.visualstudio.com/sha/download?build=stable&os=linux-x64"
mv ~/programas/vscode/data ~/programas/vscode_data_tmp
rm -rf ~/programas/vscode
tar -xzf vscode.tar.gz -C ~/programas/
mv ~/programas/VSCode-linux-x64 ~/programas/vscode
mv ~/programas/vscode_data_tmp ~/programas/vscode/data
```

---

## Paso 17 — Git y GitHub (commits desde VS Code)

Git ya quedó instalado en el paso 3, y VS Code lo usa automáticamente. Solo falta configurarlo.

### 17.1 Tu nombre y correo (una sola vez por equipo)

Aparecen como autor de cada commit. Usa el **mismo correo de tu cuenta de GitHub**, para que los commits queden ligados a tu perfil:

```bash
git config --global user.name "TU NOMBRE"
git config --global user.email "TU_CORREO_DE_GITHUB"
git config --global init.defaultBranch main
```

### 17.2 Iniciar sesión en GitHub desde VS Code

1. En VS Code, haz clic en el ícono de **cuenta** (abajo a la izquierda) → **Sign in with GitHub**. También puedes iniciar sesión cuando VS Code lo pida al hacer el primer push.
2. Se abre el navegador. Autoriza a VS Code con tu cuenta de GitHub.
3. Regresa a VS Code. La sesión queda guardada.

No hace falta configurar llaves SSH ni tokens: VS Code se encarga de identificarte ante GitHub.

### 17.3 Cómo trabajar

1. Abre el repo:
   ```bash
   code ~/fiatimago/radio-tools &
   ```
2. Haz tus cambios.
3. Abre **Source Control** (**Ctrl+Shift+G**).
4. Escribe un mensaje que describa el cambio y haz clic en **Commit**.
5. Haz clic en **Sync Changes** o **Push** para subirlo a GitHub.

| Acción | Qué hace | ¿Necesita sesión de GitHub? |
|---|---|---|
| **Commit** | Guarda una "foto" de los cambios en tu computador | No |
| **Push / Sync** | Sube los commits a GitHub | Sí (la de VS Code) |
| **Pull** | Baja los cambios que otros subieron | Sí (en repos privados) |

> **Importante:** la sesión de GitHub vive **dentro de VS Code**. Haz los push desde VS Code o desde su terminal integrada (**View → Terminal**). Si haces `git push` desde la terminal normal de Ubuntu, te pedirá usuario y token.

### 17.4 Clonar un repo nuevo

```bash
cd ~/fiatimago
git clone https://github.com/fiatimago/NOMBRE_DEL_REPO.git
code NOMBRE_DEL_REPO &
```

Si el repo es privado y la terminal pide usuario y contraseña, haz la clonación desde VS Code: **Ctrl+Shift+P → Git: Clone**, pega la URL y elige la carpeta `~/fiatimago`.
