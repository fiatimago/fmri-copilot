# radio-tools

Herramientas y scripts de Fiat Imago para el procesamiento de neuroimagen. Cada herramienta vive en su propia carpeta con su manual (`README.md`) y su historial de cambios (`CHANGELOG.md`).

Este repo explica **la herramienta**: qué hace, cómo se instala, qué recibe y qué devuelve. **Cuándo** se usa dentro de un estudio lo explica la Biblia (libro de Hechos), que enlaza aquí.

## Catálogo

| Herramienta | Qué hace | Estado | Versión |
|---|---|---|---|
| [`fmri_quick_fsl`](fmri_quick_fsl/) | Pipeline de fMRI: validación en caliente con FSL y flujo completo DICOM → BIDS → fMRIPrep → FEAT → DICOM | En desarrollo | v0.2.0 |
| `nifti2dicom3axis` | Exporta resultados de FEAT a DICOM en los tres planos para syngo.via | Por migrar | |
| `rename_labels` | Agrega los sufijos `_0` / `_1` a las imágenes de los paradigmas | Por migrar | |

Estados: **Por migrar**, **En desarrollo**, **Estable** (usada en estudios), **Archivada**.

## Agregar una herramienta nueva

1. Crea una rama `feature/nombre-herramienta`.
2. Copia `_plantilla_herramienta/` con el nombre de la herramienta.
3. Llena el `README.md` y el `CHANGELOG.md`.
4. Agrega la fila al catálogo de arriba.
5. Abre un Pull Request; otro miembro lo revisa.

## Versiones y trazabilidad

- Toda herramienta usada en estudios clínicos tiene versión (`v1.0.0`) y `CHANGELOG.md`.
- Se registra con qué versión se procesó cada estudio. Si aparece un bug, así se sabe qué estudios revisar.

## Regla de oro

Ningún dato de pacientes en este repo. Para probar las herramientas se usan los datos de `datos_prueba/`, que son sintéticos o están anonimizados. Las licencias (por ejemplo, la de FreeSurfer) tampoco se suben.

El `.gitignore` de la raíz bloquea en todo el repo los formatos de imagen médica (DICOM, NIfTI, carpetas `.feat`), las licencias y las configuraciones locales con rutas de cada computador. Si un archivo de prueba **sintético** de verdad tiene que vivir aquí, se agrega a propósito con `git add -f ruta/al/archivo` y se documenta en `datos_prueba/README.md`.

## Aviso

Estas herramientas son prototipos de investigación. No son dispositivos médicos ni software de diagnóstico validado clínicamente.
