# Guía QGIS: mapa final y screening por parcela

Escrita para QGIS 3.44. Los nombres de los menús pueden variar levemente según el idioma y la versión de la interfaz.

**Reparto de tareas:** Google Earth Engine procesa las series de Sentinel-2 y QGIS presenta los resultados y evalúa parcelas. En QGIS no se reprocesa nada.

---

## 1. Obtener los datos

1. En GEE, ejecutar `gee/05_exportar_qgis.js` y lanzar las tareas desde **Tasks**:

   | Archivo | Contenido | Tipo | Sin dato |
   |---|---|---|---|
   | `clasificacion_v2.tif` | Clases EUDR 0–5 | Byte, 10 m | 255 |
   | `anio_perdida.tif` | Año de pérdida (este análisis) | UInt16, 10 m | 0 |
   | `anio_hansen.tif` | Año de pérdida Hansen 2021–2024 | UInt16, 10 m | 0 |
   | `s2_rgb_2025.tif` | Fondo Sentinel-2 RGB (opcional) | Byte, 30 m | 0 |

2. Descargar la carpeta `EUDR_Chaco_QGIS` de Google Drive.
   - Si GEE dividió algún ráster en varios archivos (`nombre-0000000000-0000000000.tif`, …), el script de screening los une automáticamente en un VRT. Para el mapa, se puede hacer lo mismo con **Ráster > Miscelánea > Construir ráster virtual**.
   - **Los rásters no se suben al repositorio** (GitHub rechaza archivos de más de 100 MB).

## 2. Proyecto y estilos

1. Proyecto nuevo con SRC **EPSG:32720** (WGS 84 / UTM zona 20S).
2. Cargar los rásters y aplicar los estilos de `qgis/estilos/`: **Propiedades de la capa > Simbología > Estilo > Cargar estilo**.
   - `clasificacion_v2.qml`: paleta de clases, igual a la de GEE (la clase "Otro" es transparente).
   - `anio_perdida.qml` y `anio_hansen.qml`: escala de amarillo (2021) a rojo oscuro (2025).
3. Fondo `s2_rgb_2025.tif`: **Color multibanda** (R = banda 1, G = 2, B = 3), mínimo 1 y máximo 255, con 0 como "sin dato".
4. Cargar `qgis/datos/area_estudio.geojson` con solo el contorno (sin relleno, línea negra de 0,5 mm).

## 3. Screening por parcela (`screening_parcelas.py`)

1. Abrir **Complementos > Consola de Python > Mostrar editor**.
2. Abrir `qgis/screening_parcelas.py` y ajustar `CARPETA_RASTERS` y `CARPETA_REPO`.
3. Ejecutar. El script:
   - calcula las hectáreas por clase de cada parcela con el **histograma zonal**;
   - calcula los años de pérdida con las **estadísticas zonales**;
   - aplica las mismas reglas de dictamen que `gee/04_parcelas_eudr.js`;
   - guarda `screening_parcelas.gpkg` y `screening_parcelas.csv`;
   - carga las capas con sus estilos (borde de cada parcela coloreado según el dictamen).
4. **Control:** con las parcelas demo, los resultados coinciden con los de GEE: los mismos dictámenes y años, y diferencias de como mucho 0,6 ha por clase (menos del 1%). Las diferencias vienen de cómo cada programa decide qué píxeles del borde caen dentro del polígono, y de que QGIS mide superficies en el plano UTM y GEE sobre el elipsoide.

Para evaluar **parcelas reales**, cambiar `PARCELAS` por el archivo del proveedor (GeoJSON, shapefile o GPKG) y `CAMPO_ID` por su campo identificador.

## 4. Mapa final (diseñador de impresión)

**Proyecto > Nuevo diseño de impresión**, en A4 horizontal.

| Elemento | Contenido sugerido |
|---|---|
| Mapa principal | `clasificacion_v2` sobre el fondo RGB, con el contorno del área de estudio. Escala de alrededor de 1:600.000 para que entre el área completa. |
| Título | *Deforestación post-2020 y destino del suelo* |
| Subtítulo | *Norte de Santiago del Estero, Argentina · Fecha de corte EUDR: 31/12/2020* |
| Mapa de ubicación | Argentina con las provincias y un rectángulo rojo en el área de estudio (ver nota abajo). |
| Leyenda | Solo `clasificacion_v2`, sin la clase "Otro". Agregar la nota "Sin color: otros usos". |
| Cuadro de resultados | Texto con los indicadores clave: 44.039 ha convertidas (5,2% del bosque 2020); 46% a cultivo de verano, 41% a pastura/silvopastoril. |
| Escala gráfica | En km. |
| Flecha de norte | Simple. |
| Grilla | Coordenadas geográficas cada 0,25°, solo en el borde. |
| Fuentes | *Contiene datos modificados de Copernicus Sentinel (2020–2026). Bosque 2020: JRC Global Forest Cover 2020. Pérdida de referencia: Hansen et al. (2013), Global Forest Change. Procesamiento: Google Earth Engine.* |
| Nota | *Proyecto de portfolio. No constituye una evaluación de debida diligencia EUDR.* |

**Mapa de ubicación:** para los límites provinciales, recomiendo la capa oficial del **Instituto Geográfico Nacional (IGN)** de Argentina, que publica capas SIG descargables. Si se usa otra fuente de límites internacionales (por ejemplo, Natural Earth), conviene revisar cómo representa el territorio argentino: la cartografía que se publica en Argentina tiene requisitos de representación oficial.

**Exportar:**
- PNG a 300 ppp para la portada del README (reemplazar `docs/mapa_clasificacion.jpg`; si pesa mucho, convertir a JPG);
- PDF para presentaciones.

Conviene guardar el diseño como plantilla (`.qpt`) en `qgis/` para poder regenerarlo.
