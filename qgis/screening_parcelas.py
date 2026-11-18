# -*- coding: utf-8 -*-
"""
SCREENING EUDR POR PARCELA — versión QGIS (probado en QGIS 3.44 con las parcelas demo)

Reproduce en QGIS el análisis de gee/04_parcelas_eudr.js a partir de los
rásters exportados con gee/05_exportar_qgis.js. No requiere Earth Engine.

Uso:
  1. Descargar de Drive la carpeta EUDR_Chaco_QGIS.
  2. Ajustar las rutas del bloque CONFIGURACIÓN.
  3. QGIS > Complementos > Consola de Python > Mostrar editor >
     abrir este archivo > Ejecutar.

Resultado:
  - screening_parcelas.gpkg (capa con superficies y dictamen por parcela)
  - screening_parcelas.csv  (misma tabla, para planillas)
  - capas cargadas en el proyecto con sus estilos
  - reporte en la consola

⚠️ Herramienta de screening para priorizar verificaciones. No es un
   dictamen legal ni una evaluación de debida diligencia. No evalúa la
   legalidad según la normativa argentina (Ley 26.331 / OTBN).
"""

import inspect
from pathlib import Path

import processing
from qgis.core import (
    QgsCategorizedSymbolRenderer,
    QgsFeature,
    QgsField,
    QgsFillSymbol,
    QgsProject,
    QgsRasterLayer,
    QgsRendererCategory,
    QgsVectorFileWriter,
    QgsVectorLayer,
)
from qgis.PyQt.QtCore import QVariant

# ---------------- CONFIGURACIÓN ----------------
# Carpeta con los GeoTIFF descargados de Drive (EUDR_Chaco_QGIS)
CARPETA_RASTERS = Path(r"C:/ruta/a/EUDR_Chaco_QGIS")
# Carpeta del repositorio (la que contiene gee/, qgis/ y docs/), para estilos
# y parcelas demo. Si no es válida, se deduce de la ubicación de este script.
CARPETA_REPO = Path(r"C:/ruta/a/EUDR_Soja_Chaco")

# Parcelas a evaluar (GeoJSON, shapefile, GPKG...). Por defecto, las demo FICTICIAS.
PARCELAS = CARPETA_REPO / "qgis" / "datos" / "parcelas_demo.geojson"
CAMPO_ID = "id"

SALIDA_GPKG = CARPETA_RASTERS / "screening_parcelas.gpkg"
SALIDA_CSV = CARPETA_RASTERS / "screening_parcelas.csv"

TOLERANCIA_HA = 0.5  # igual a la unidad mínima del análisis

CLASES = {
    0: "Otro",
    1: "Bosque estable",
    2: "Deforestación post-2020 sin cultivo",
    3: "Deforestación post-2020 → cultivo",
    4: "Cultivo sin conflicto",
    5: "Conversión probable a pastura / silvopastoril",
}

DICTAMENES = [
    ("SIN DEFORESTACIÓN POST-2020 DETECTADA", "#00c853"),
    ("REVISAR: señales menores a la tolerancia (posible efecto de borde)", "#ffd600"),
    ("REVISAR: conversión probable a pastura/silvopastoril (encuadre EUDR incierto)", "#ff9800"),
    ("ALTO RIESGO: deforestación post-2020 detectada", "#ff1744"),
]


# ---------------- 0. VERIFICAR RUTAS ----------------
if not (CARPETA_REPO / "qgis" / "estilos").is_dir():
    _script = Path(inspect.currentframe().f_code.co_filename)
    if (_script.parent.parent / "qgis" / "estilos").is_dir():
        CARPETA_REPO = _script.parent.parent
        print(f"CARPETA_REPO deducida de la ubicación del script: {CARPETA_REPO}")
        if str(PARCELAS).startswith(r"C:/ruta/a") or not PARCELAS.exists():
            PARCELAS = CARPETA_REPO / "qgis" / "datos" / "parcelas_demo.geojson"
    else:
        raise FileNotFoundError(
            f"CARPETA_REPO no es válida: {CARPETA_REPO}\n"
            "Debe ser la carpeta que contiene gee/, qgis/ y docs/ "
            "(ojo: al descomprimir el ZIP de GitHub suele quedar una carpeta dentro de otra).")

if not CARPETA_RASTERS.is_dir():
    raise FileNotFoundError(f"CARPETA_RASTERS no existe: {CARPETA_RASTERS}")


# ---------------- 1. RÁSTERS ----------------
def cargar_raster(nombre):
    """Carga un ráster exportado por GEE. Si GEE lo dividió en varios
    archivos (nombre-0000000000-0000000000.tif, ...), arma un VRT."""
    archivos = sorted(CARPETA_RASTERS.glob(f"{nombre}*.tif"))
    if not archivos:
        raise FileNotFoundError(f"No se encontró {nombre}*.tif en {CARPETA_RASTERS}")
    if len(archivos) == 1:
        ruta = str(archivos[0])
    else:
        ruta = str(CARPETA_RASTERS / f"{nombre}.vrt")
        processing.run("gdal:buildvirtualraster", {
            "INPUT": [str(a) for a in archivos],
            "RESOLUTION": 0,
            "SEPARATE": False,
            "PROJ_DIFFERENCE": False,
            "ADD_ALPHA": False,
            "OUTPUT": ruta,
        })
    capa = QgsRasterLayer(ruta, nombre)
    if not capa.isValid():
        raise RuntimeError(f"No se pudo abrir {ruta}")
    return capa


clasificacion = cargar_raster("clasificacion_v2")
anio_perdida = cargar_raster("anio_perdida")
anio_hansen = cargar_raster("anio_hansen")

crs = clasificacion.crs()
ha_por_pixel = clasificacion.rasterUnitsPerPixelX() * clasificacion.rasterUnitsPerPixelY() / 1e4


# ---------------- 2. PARCELAS ----------------
parcelas = QgsVectorLayer(str(PARCELAS), "parcelas", "ogr")
if not parcelas.isValid():
    raise RuntimeError(
        f"No se pudo abrir {PARCELAS}\n"
        "Revisar PARCELAS y CARPETA_REPO (debe ser la carpeta que contiene gee/, qgis/ y docs/).")

reproyectadas = processing.run("native:reprojectlayer", {
    "INPUT": parcelas,
    "TARGET_CRS": crs,
    "OUTPUT": "memory:",
})["OUTPUT"]


# ---------------- 3. ESTADÍSTICAS ZONALES ----------------
# Píxeles por clase dentro de cada parcela (campos HISTO_0 ... HISTO_5)
histograma = processing.run("native:zonalhistogram", {
    "INPUT_RASTER": clasificacion,
    "RASTER_BAND": 1,
    "INPUT_VECTOR": reproyectadas,
    "COLUMN_PREFIX": "HISTO_",
    "OUTPUT": "memory:",
})["OUTPUT"]

# Años de pérdida: 5 = mínimo, 6 = máximo
con_anios = processing.run("native:zonalstatisticsfb", {
    "INPUT": histograma,
    "INPUT_RASTER": anio_perdida,
    "RASTER_BAND": 1,
    "COLUMN_PREFIX": "anio_",
    "STATISTICS": [5, 6],
    "OUTPUT": "memory:",
})["OUTPUT"]

con_hansen = processing.run("native:zonalstatisticsfb", {
    "INPUT": con_anios,
    "INPUT_RASTER": anio_hansen,
    "RASTER_BAND": 1,
    "COLUMN_PREFIX": "hansen_",
    "STATISTICS": [5, 6],
    "OUTPUT": "memory:",
})["OUTPUT"]


# ---------------- 4. DICTAMEN ----------------
def valor(feature, campo):
    """Valor numérico de un campo, 0 si falta o es NULL."""
    if feature.fields().indexOf(campo) < 0:
        return 0
    try:
        v = feature[campo]
        return float(v) if v else 0.0   # NULL de QGIS se evalúa como falso
    except (TypeError, ValueError):
        return 0.0


def pixeles_clase(feature, c):
    for nombre in (f"HISTO_{c}", f"HISTO_{c}.0"):
        if feature.fields().indexOf(nombre) >= 0:
            return valor(feature, nombre)
    return 0


def rango_anios(feature, prefijo):
    mn, mx = valor(feature, prefijo + "min"), valor(feature, prefijo + "max")
    if not mn:
        return "-"
    return f"{int(mn)}" if mn == mx else f"{int(mn)}–{int(mx)}"


campos = [
    ("id", QVariant.String), ("descripcion", QVariant.String),
    ("ha_parcela", QVariant.Double), ("pct_analizada", QVariant.Double),
    ("ha_bosque_estable", QVariant.Double), ("ha_defor_con_cultivo", QVariant.Double),
    ("ha_defor_sin_cultivo", QVariant.Double), ("ha_pastura_probable", QVariant.Double),
    ("ha_cultivo_sin_conflicto", QVariant.Double), ("ha_otro", QVariant.Double),
    ("anios_perdida", QVariant.String), ("anios_hansen", QVariant.String),
    ("ha_conversion_post2020", QVariant.Double),
    ("codigo_eudr", QVariant.Int), ("dictamen_eudr", QVariant.String),
    ("aviso", QVariant.String),
]

resultado = QgsVectorLayer(f"Polygon?crs={crs.authid()}", "Screening EUDR", "memory")
proveedor = resultado.dataProvider()
proveedor.addAttributes([QgsField(n, t) for n, t in campos])
resultado.updateFields()

nuevas = []
for f in con_hansen.getFeatures():
    ha = {c: pixeles_clase(f, c) * ha_por_pixel for c in CLASES}
    ha_parcela = f.geometry().area() / 1e4
    ha_analizada = sum(ha.values())
    agri = ha[2] + ha[3]
    past = ha[5]

    if agri >= TOLERANCIA_HA:
        codigo = 3
    elif past >= TOLERANCIA_HA:
        codigo = 2
    elif agri + past > 0:
        codigo = 1
    else:
        codigo = 0

    # Se cuentan píxeles enteros cuyo centro cae en la parcela: en el borde
    # pueden sumar algo más que el área exacta, por eso se limita a 100 %.
    pct = min(100.0, 100 * ha_analizada / ha_parcela) if ha_parcela else 0
    ident = f[CAMPO_ID] if f.fields().indexOf(CAMPO_ID) >= 0 else str(f.id())
    desc = f["descripcion"] if f.fields().indexOf("descripcion") >= 0 else ""

    nueva = QgsFeature(resultado.fields())
    nueva.setGeometry(f.geometry())
    nueva.setAttributes([
        str(ident), str(desc or ""),
        round(ha_parcela, 2), round(pct, 1),
        round(ha[1], 2), round(ha[3], 2), round(ha[2], 2), round(ha[5], 2),
        round(ha[4], 2), round(ha[0], 2),
        rango_anios(f, "anio_"), rango_anios(f, "hansen_"),
        round(agri + past, 2),
        codigo, DICTAMENES[codigo][0],
        "Parcela parcialmente fuera del área analizada" if pct < 95 else "",
    ])
    nuevas.append(nueva)

proveedor.addFeatures(nuevas)
resultado.updateExtents()


# ---------------- 5. GUARDAR ----------------
def guardar(capa, ruta, driver, nombre_capa=None):
    opciones = QgsVectorFileWriter.SaveVectorOptions()
    opciones.driverName = driver
    opciones.fileEncoding = "UTF-8"
    if nombre_capa:
        opciones.layerName = nombre_capa
    error = QgsVectorFileWriter.writeAsVectorFormatV3(
        capa, str(ruta), QgsProject.instance().transformContext(), opciones)
    if error[0] != QgsVectorFileWriter.NoError:
        raise RuntimeError(f"Error al guardar {ruta}: {error[1]}")


guardar(resultado, SALIDA_GPKG, "GPKG", "screening_eudr")
guardar(resultado, SALIDA_CSV, "CSV")


# ---------------- 6. CARGAR EN EL PROYECTO ----------------
proyecto = QgsProject.instance()

estilos = CARPETA_REPO / "qgis" / "estilos"
for capa, qml in ((anio_hansen, "anio_hansen.qml"),
                  (anio_perdida, "anio_perdida.qml"),
                  (clasificacion, "clasificacion_v2.qml")):
    capa.loadNamedStyle(str(estilos / qml))
    proyecto.addMapLayer(capa)
    if capa is not clasificacion:
        proyecto.layerTreeRoot().findLayer(capa.id()).setItemVisibilityChecked(False)

capa_gpkg = QgsVectorLayer(f"{SALIDA_GPKG}|layername=screening_eudr", "Screening EUDR", "ogr")
categorias = []
for codigo, (texto, color) in enumerate(DICTAMENES):
    simbolo = QgsFillSymbol.createSimple({
        "color": "0,0,0,0",
        "outline_color": color,
        "outline_width": "0.8",
    })
    categorias.append(QgsRendererCategory(codigo, simbolo, texto))
capa_gpkg.setRenderer(QgsCategorizedSymbolRenderer("codigo_eudr", categorias))
proyecto.addMapLayer(capa_gpkg)


# ---------------- 7. REPORTE ----------------
for f in capa_gpkg.getFeatures():
    print(
        f"=== {f['id']} {('(' + f['descripcion'] + ')') if f['descripcion'] else ''}\n"
        f"Superficie: {f['ha_parcela']:.1f} ha ({f['pct_analizada']:.1f}% analizada)\n"
        f"Bosque estable: {f['ha_bosque_estable']:.1f} ha\n"
        f"Deforestación post-2020 → cultivo: {f['ha_defor_con_cultivo']:.1f} ha\n"
        f"Deforestación post-2020 sin cultivo: {f['ha_defor_sin_cultivo']:.1f} ha\n"
        f"Conversión probable a pastura: {f['ha_pastura_probable']:.1f} ha\n"
        f"Cultivo sin conflicto: {f['ha_cultivo_sin_conflicto']:.1f} ha\n"
        f"Años de pérdida (este análisis / Hansen): {f['anios_perdida']} / {f['anios_hansen']}\n"
        f"EUDR: {f['dictamen_eudr']}"
        + (f"\nAviso: {f['aviso']}" if f["aviso"] else "")
    )

print(f"\nResultados guardados en:\n  {SALIDA_GPKG}\n  {SALIDA_CSV}")
