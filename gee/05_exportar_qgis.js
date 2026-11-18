// ============================================================
// EXPORTACIÓN PARA QGIS
// Lee el asset de 02_deforestacion_soja_eudr_v1.js y exporta a Drive
// los rásters que usan el flujo de QGIS (carpeta qgis/ del repo):
//
//   1. clasificacion_v2.tif  — clases EUDR 0–5 (Byte, 10 m)
//   2. anio_perdida.tif      — año de pérdida, este análisis (UInt16, 10 m)
//   3. anio_hansen.tif       — año de pérdida Hansen 2021–2024 dentro del
//                              bosque 2020 (UInt16, 10 m)
//   4. s2_rgb_2025.tif       — fondo Sentinel-2 RGB, estación seca 2025
//                              (Byte, 30 m) — OPCIONAL, consume más cuota
//
// Todos en EPSG:32720 (UTM 20S). Valor sin dato: 255 en la clasificación
// y 0 en los rásters de año (píxeles sin pérdida = transparentes).
// ============================================================

var CFG = {
  asset: 'projects/my-project-javier-464019/assets/eudr_chaco_v1',
  hansen: 'UMD/hansen/global_forest_change_2024_v1_12',
  carpetaDrive: 'EUDR_Chaco_QGIS',
  crs: 'EPSG:32720',
  minPixeles: 50,

  // El fondo RGB recalcula Sentinel-2: dejar en false si la cuota es justa
  exportarFondoRgb: true,
  escalaFondo: 30
};

var eudr = ee.Image(CFG.asset);
var aoi = eudr.geometry();


// ---------------- CLASIFICACIÓN V2 (misma lógica que 03 y 04) ----------------
var clase = eudr.select('clase');
var anio = eudr.select('anio_perdida');

var umbralSuelo = ee.Number(eudr.get('umbral_suelo_p10')).multiply(10000);
var hansenSi = eudr.select('perdida_hansen').unmask(0).eq(1);
var p10Final = eudr.select('p10_2025');
var sueloFinal = p10Final.unmask(10000).lt(umbralSuelo);

var pasturaBruta = hansenSi.and(anio.eq(0)).and(sueloFinal.not()).and(p10Final.mask());
var pastura = pasturaBruta.selfMask()
  .connectedPixelCount(CFG.minPixeles + 1, true)
  .gte(CFG.minPixeles)
  .unmask(0)
  .and(pasturaBruta);

var claseV2 = clase.where(pastura, 5).rename('clase_v2').toByte();


// ---------------- AÑOS ----------------
var anioPerdida = anio.updateMask(anio.gt(0)).rename('anio_perdida').toUint16();
var anioHansen = ee.Image(CFG.hansen).select('lossyear').add(2000)
  .updateMask(hansenSi).clip(aoi).rename('anio_hansen').toUint16();


// ---------------- EXPORTACIONES ----------------
function exportar(img, nombre, escala, sinDato) {
  Export.image.toDrive({
    image: img,
    description: nombre,
    folder: CFG.carpetaDrive,
    fileNamePrefix: nombre,
    region: aoi,
    scale: escala,
    crs: CFG.crs,
    maxPixels: 1e11,
    fileFormat: 'GeoTIFF',
    formatOptions: {cloudOptimized: true, noData: sinDato}
  });
}

exportar(claseV2, 'clasificacion_v2', 10, 255);
exportar(anioPerdida, 'anio_perdida', 10, 0);
exportar(anioHansen, 'anio_hansen', 10, 0);

if (CFG.exportarFondoRgb) {
  var rgb = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(aoi)
    .filterDate('2025-06-01', '2025-10-01')
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
    .linkCollection(ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED'), ['cs_cdf'])
    .map(function (img) { return img.updateMask(img.select('cs_cdf').gte(0.6)); })
    .median()
    .select(['B4', 'B3', 'B2'])
    // Reflectancia 0–2500 → 1–255 (0 queda reservado para "sin dato")
    .unitScale(0, 2500).multiply(254).add(1).clamp(1, 255)
    .clip(aoi)
    .toByte();
  exportar(rgb, 's2_rgb_2025', CFG.escalaFondo, 0);
}

print('Tareas creadas. Lanzarlas desde la pestaña Tasks.');
print('Carpeta de Drive:', CFG.carpetaDrive);
