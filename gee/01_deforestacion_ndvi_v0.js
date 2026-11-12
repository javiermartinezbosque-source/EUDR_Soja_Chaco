// ============================================================
// TRAZABILIDAD EUDR — DEFORESTACIÓN POR SOJA
// Zona: Chaco argentino
// Período de análisis: 31/12/2020 (fecha corte EUDR) — 2026
// Sensores: Sentinel-2 + Landsat 8/9
// ============================================================

// --- 1. Área de estudio ---
// Ajustar según zona específica. Ejemplo: zona sojera de Santiago del Estero
var areaEstudio = ee.Geometry.Rectangle([-63.5, -27.0, -62.5, -26.0]);
Map.centerObject(areaEstudio, 10);

// --- 2. Fechas clave según EUDR ---
var fechaCorteEUDR = '2020-12-31';  // Fecha crítica del reglamento
var inicioBaseline = '2020-01-01';
var finBaseline    = '2020-12-31';
var inicioActual   = '2025-01-01';
var finActual      = '2026-09-15';

// --- 3. Función NDVI Sentinel-2 con corrección ---
function ndviSentinel2(imagen) {
  var ndvi = imagen.normalizedDifference(['B8', 'B4']).rename('NDVI');
  var scl = imagen.select('SCL');
  var mascara = scl.neq(3)   // sombra
    .and(scl.neq(8))         // nube media
    .and(scl.neq(9))         // nube alta
    .and(scl.neq(10));       // cirrus
  return ndvi.updateMask(mascara)
    .copyProperties(imagen, ['system:time_start']);
}

// --- 4. Composites baseline (2020) y actual (2025-2026) ---
var s2Baseline = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(areaEstudio)
  .filterDate(inicioBaseline, finBaseline)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
  .map(ndviSentinel2);

var s2Actual = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(areaEstudio)
  .filterDate(inicioActual, finActual)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
  .map(ndviSentinel2);

print('Imágenes Sentinel-2 baseline 2020:', s2Baseline.size());
print('Imágenes Sentinel-2 actual 2025-2026:', s2Actual.size());

var ndviBaseline = s2Baseline.max().rename('NDVI_2020');
var ndviActual   = s2Actual.max().rename('NDVI_actual');

// --- 5. Detección de pérdida forestal ---
// Umbral de bosque: NDVI > 0.6 (bosque nativo denso)
// Umbral de deforestación: pasó de bosque a NDVI < 0.4 (suelo/cultivo)

var eraForestal2020 = ndviBaseline.gt(0.6);
var noForestalActual = ndviActual.lt(0.4);

var deforestacionEUDR = eraForestal2020.and(noForestalActual)
  .rename('Deforestacion_EUDR');

var mapaDelta = ndviActual.subtract(ndviBaseline).rename('Delta_NDVI');

// --- 6. Visualización ---
Map.addLayer(ndviBaseline, {min: 0, max: 1,
  palette: ['red', 'yellow', 'green']}, 'NDVI Baseline 2020', false);

Map.addLayer(ndviActual, {min: 0, max: 1,
  palette: ['red', 'yellow', 'green']}, 'NDVI Actual 2025-2026', false);

Map.addLayer(mapaDelta, {min: -0.5, max: 0.5,
  palette: ['red', 'white', 'green']}, 'Delta NDVI', false);

Map.addLayer(deforestacionEUDR.selfMask(),
  {palette: ['#ff0000']},
  '🔴 DEFORESTACIÓN post-EUDR (2020-2026)');

// --- 7. Cuantificación de la deforestación ---
var areaDeforestada = deforestacionEUDR.multiply(ee.Image.pixelArea())
  .reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: areaEstudio,
    scale: 10,
    maxPixels: 1e10
  });

print('📊 Área deforestada post-EUDR (m²):', areaDeforestada);

// Convertir a hectáreas
var haDeforestada = ee.Number(areaDeforestada.get('Deforestacion_EUDR'))
  .divide(10000);
print('🌳 Hectáreas deforestadas post-EUDR:', haDeforestada);

// --- 8. Exportación ---
Export.image.toDrive({
  image: deforestacionEUDR,
  description: 'Deforestacion_EUDR_Chaco',
  folder: 'EUDR_Chaco',
  fileNamePrefix: 'Deforestacion_EUDR_Chaco',
  region: areaEstudio,
  scale: 10,
  crs: 'EPSG:32720',  // UTM 20S para Chaco argentino
  maxPixels: 1e10,
  fileFormat: 'GeoTIFF'
});

Export.image.toDrive({
  image: ndviBaseline,
  description: 'NDVI_baseline_2020',
  folder: 'EUDR_Chaco',
  fileNamePrefix: 'NDVI_baseline_2020',
  region: areaEstudio,
  scale: 10,
  crs: 'EPSG:32720',
  maxPixels: 1e10,
  fileFormat: 'GeoTIFF'
});

Export.image.toDrive({
  image: ndviActual,
  description: 'NDVI_actual_2025_2026',
  folder: 'EUDR_Chaco',
  fileNamePrefix: 'NDVI_actual_2025_2026',
  region: areaEstudio,
  scale: 10,
  crs: 'EPSG:32720',
  maxPixels: 1e10,
  fileFormat: 'GeoTIFF'
});
