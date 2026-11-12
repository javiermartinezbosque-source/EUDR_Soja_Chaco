// ============================================================
// TRAZABILIDAD EUDR — DEFORESTACIÓN ASOCIADA A SOJA
// Zona: Chaco argentino (límite Santiago del Estero / Chaco)
// Fecha de corte EUDR: 31/12/2020 (Reglamento UE 2023/1115)
// Sensor: Sentinel-2 SR Harmonized + Cloud Score+
// Referencias: JRC Global Forest Cover 2020, Hansen GFC
// ============================================================
//
// Lógica:
//   1. Bosque al 31/12/2020  -> mapa JRC GFC2020 (referencia EUDR),
//      descartando píxeles que ya mostraban suelo desnudo en 2020.
//   2. Pérdida post-2020      -> percentil 10 anual de NDVI: un bosque
//      nunca llega a suelo desnudo; un lote agrícola sí (presiembra/
//      poscosecha). Se exige que la pérdida persista en el último año.
//   3. Cultivo de verano      -> fenología de la campaña: suelo desnudo
//      en oct-dic y pico de NDVI en ene-mar (proxy de soja; NDVI solo
//      no separa soja de maíz u otros cultivos de verano).
//   4. Cruce + unidad mínima de 0,5 ha (definición FAO usada por EUDR).
//
// ⚠️ Los umbrales son valores de partida: calibrarlos inspeccionando
//    píxeles de bosque, lotes agrícolas y desmontes conocidos.
// ============================================================


// ---------------- 0. CONFIGURACIÓN ----------------
var CFG = {
  // Área de estudio. Alternativa: dibujar una geometría y reemplazarla.
  aoi: ee.Geometry.Rectangle([-63.5, -27.0, -62.5, -26.0]),

  // Años completos a analizar después del corte
  anioBase: 2020,
  aniosPost: [2021, 2022, 2023, 2024, 2025],

  // Campaña agrícola para detectar cultivo de verano (2025/26)
  presiembra: ['2025-10-01', '2026-01-01'],
  picoCultivo: ['2026-01-01', '2026-04-01'],

  // Umbrales (calibrar)
  umbralSueloP10: 0.28,   // p10 anual de NDVI por debajo = hubo suelo desnudo
                          // (calibración: cultivos 0.15–0.23, bosque 0.34–0.42;
                          //  ver docs/puntos_calibracion.csv)
  umbralPresiembra: 0.30, // NDVI bajo antes de la siembra
  umbralPicoCultivo: 0.70,// NDVI alto en el pico del cultivo
                          // (cultivos consolidados 0.86–0.91; lotes recién
                          //  desmontados pueden quedar entre 0.60 y 0.70)

  // Ventanas para composites RGB de verificación visual (estación seca)
  rgbCorte: ['2020-06-01', '2021-01-01'],
  rgbActual: ['2025-06-01', '2025-10-01'],
  umbralCloudScore: 0.60, // Cloud Score+ (cs_cdf): 0 = nube, 1 = despejado

  // Unidad mínima: 0,5 ha = 50 píxeles de 10 m
  minPixeles: 50,

  // Datasets de referencia (⚠️ verificar ID/versión vigente en el catálogo)
  jrcForest: 'JRC/GFC2020/V2',
  hansen: 'UMD/hansen/global_forest_change_2024_v1_12',

  // true = solo crea las tareas de exportación (no dibuja capas en el mapa
  // ni calcula al hacer clic). Usar así para ahorrar cuota de cómputo.
  soloExportar: true,

  // Asset de salida para el visor liviano (03_visor_eudr.js)
  assetId: 'projects/my-project-javier-464019/assets/eudr_chaco_v1',

  crs: 'EPSG:32720', // UTM 20S
  escala: 10,
  carpetaDrive: 'EUDR_Chaco'
};

var aoi = CFG.aoi;
Map.centerObject(aoi, 10);
Map.addLayer(ee.Image().paint(aoi, 1, 2), {palette: ['black']}, 'Área de estudio');


// ---------------- 1. SENTINEL-2 + MÁSCARA DE NUBES ----------------
var csPlus = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');

var ndviCol = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoi)
  .filterDate(CFG.anioBase + '-01-01', CFG.picoCultivo[1])
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 60))
  .linkCollection(csPlus, ['cs_cdf'])
  .map(function (img) {
    var despejado = img.select('cs_cdf').gte(CFG.umbralCloudScore);
    var ndvi = img.updateMask(despejado)
      .normalizedDifference(['B8', 'B4'])
      .rename('NDVI');
    return ee.Image(ndvi.copyProperties(img, ['system:time_start']));
  });

// Percentil 10 anual de NDVI
function p10Anual(anio) {
  return ndviCol
    .filterDate(anio + '-01-01', (anio + 1) + '-01-01')
    .reduce(ee.Reducer.percentile([10]))
    .rename('p10_' + anio);
}

// Suelo desnudo en algún momento del año (sin datos -> 0, criterio conservador)
function sueloDesnudo(anio) {
  return p10Anual(anio).lt(CFG.umbralSueloP10).unmask(0);
}


// ---------------- 2. BOSQUE AL 31/12/2020 ----------------
var jrc = ee.ImageCollection(CFG.jrcForest).mosaic().select('Map');
var bosqueJRC = jrc.eq(1).unmask(0).clip(aoi);

// Si en 2020 ya hubo suelo desnudo, se desmontó antes del corte (o el JRC
// lo clasificó mal): no corresponde a deforestación post-EUDR.
var sueloEn2020 = sueloDesnudo(CFG.anioBase);
var bosque2020 = bosqueJRC.and(sueloEn2020.not()).rename('bosque2020');


// ---------------- 3. PÉRDIDA POST-2020 Y AÑO DE PÉRDIDA ----------------
var ultimoAnio = CFG.aniosPost[CFG.aniosPost.length - 1];
var persistente = sueloDesnudo(ultimoAnio); // sigue sin bosque al final

// Año de pérdida = primer año con suelo desnudo (se recorre de atrás hacia adelante)
var anioPerdida = ee.Image(0);
CFG.aniosPost.slice().reverse().forEach(function (anio) {
  anioPerdida = anioPerdida.where(sueloDesnudo(anio), anio);
});

var perdidaBruta = bosque2020.and(persistente).and(anioPerdida.gt(0));

// Unidad mínima 0,5 ha (en el mapa interactivo depende del zoom;
// en exportaciones y estadísticas se calcula a 10 m)
var perdida = perdidaBruta.selfMask()
  .connectedPixelCount(CFG.minPixeles + 1, true)
  .gte(CFG.minPixeles)
  .unmask(0)
  .and(perdidaBruta)
  .rename('perdida');

anioPerdida = anioPerdida.updateMask(perdida).rename('anio_perdida');


// ---------------- 4. CULTIVO DE VERANO (PROXY DE SOJA) ----------------
var ndviPresiembra = ndviCol.filterDate(CFG.presiembra[0], CFG.presiembra[1])
  .reduce(ee.Reducer.percentile([10]));
var ndviPico = ndviCol.filterDate(CFG.picoCultivo[0], CFG.picoCultivo[1])
  .reduce(ee.Reducer.percentile([90]));

var cultivoBruto = ndviPresiembra.lt(CFG.umbralPresiembra)
  .and(ndviPico.gt(CFG.umbralPicoCultivo))
  .unmask(0);

// Unidad mínima 0,5 ha: elimina píxeles sueltos en monte abierto
var cultivoVerano = cultivoBruto.selfMask()
  .connectedPixelCount(CFG.minPixeles + 1, true)
  .gte(CFG.minPixeles)
  .unmask(0)
  .and(cultivoBruto)
  .rename('cultivo_verano');


// ---------------- 5. CLASIFICACIÓN EUDR ----------------
// 1 = Bosque 2020 estable
// 2 = Deforestación post-2020 sin cultivo de verano detectado
// 3 = Deforestación post-2020 CON cultivo de verano  -> riesgo EUDR
// 4 = Cultivo de verano en área sin bosque en 2020  -> sin conflicto EUDR
var clase = ee.Image(0)
  .where(bosque2020.and(perdida.not()), 1)
  .where(perdida.and(cultivoVerano.not()), 2)
  .where(perdida.and(cultivoVerano), 3)
  .where(bosque2020.not().and(cultivoVerano), 4)
  .clip(aoi)
  .rename('clase')
  .toByte();

var nombresClase = ['Otro', 'Bosque estable', 'Deforestación sin cultivo',
                    'Deforestación → cultivo (riesgo EUDR)', 'Cultivo sin conflicto'];
var paletaClase = ['f0f0f0', '1a7f37', 'f2a900', 'd62728', 'c9b98a'];


// ---------------- 6. REFERENCIA HANSEN (CONTRASTE) ----------------
var hansen = ee.Image(CFG.hansen);
var perdidaHansen = hansen.select('lossyear')
  .gte(CFG.anioBase - 2000 + 1)   // 21 = 2021
  .and(bosque2020)
  .rename('perdida_hansen');


// ---------------- 7. VISUALIZACIÓN ----------------
if (!CFG.soloExportar) {
// Composites RGB de Sentinel-2 para verificar visualmente. La capa
// "Satélite" de Google no indica su fecha y puede ser anterior al desmonte.
var s2Rgb = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoi)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
  .linkCollection(csPlus, ['cs_cdf'])
  .map(function (img) {
    return img.updateMask(img.select('cs_cdf').gte(CFG.umbralCloudScore));
  });
var visRgb = {bands: ['B4', 'B3', 'B2'], min: 0, max: 2500};
Map.addLayer(s2Rgb.filterDate(CFG.rgbCorte[0], CFG.rgbCorte[1]).median().clip(aoi),
  visRgb, 'S2 RGB 2020 (fecha de corte)', false);
Map.addLayer(s2Rgb.filterDate(CFG.rgbActual[0], CFG.rgbActual[1]).median().clip(aoi),
  visRgb, 'S2 RGB 2025 (estación seca)', false);

Map.addLayer(bosqueJRC.selfMask(), {palette: ['1a7f37']}, 'Bosque JRC 2020', false);
Map.addLayer(cultivoVerano.selfMask(), {palette: ['c9b98a']}, 'Cultivo de verano 2025/26', false);
Map.addLayer(perdidaHansen.selfMask(), {palette: ['ff00ff']}, 'Pérdida Hansen post-2020', false);
Map.addLayer(anioPerdida,
  {min: CFG.aniosPost[0], max: ultimoAnio, palette: ['ffffb2', 'fd8d3c', 'bd0026']},
  'Año de pérdida', false);
Map.addLayer(clase.selfMask(), {min: 0, max: 4, palette: paletaClase}, 'Clasificación EUDR');

// Leyenda
var leyenda = ui.Panel({style: {position: 'bottom-left', padding: '8px'}});
leyenda.add(ui.Label('Clasificación EUDR', {fontWeight: 'bold'}));
for (var i = 1; i < nombresClase.length; i++) {
  leyenda.add(ui.Panel([
    ui.Label('', {backgroundColor: '#' + paletaClase[i], padding: '8px', margin: '2px 6px 2px 0'}),
    ui.Label(nombresClase[i], {margin: '2px 0'})
  ], ui.Panel.Layout.flow('horizontal')));
}
Map.add(leyenda);

// Contexto regional: pérdida Hansen post-2020 en el Gran Chaco argentino,
// útil para evaluar si el rectángulo cae en un foco de desmonte.
var chacoRegional = ee.Geometry.Rectangle([-65.5, -29.0, -58.0, -22.0]);
Map.addLayer(
  ee.Image(CFG.hansen).select('lossyear').gte(21).selfMask().clip(chacoRegional),
  {palette: ['ff00ff']}, 'Contexto: pérdida Hansen 2021+ (regional)', false);
} // fin visualización


// ---------------- 8. ESTADÍSTICAS (EXPORTADAS COMO TABLA) ----------------
var haPixel = ee.Image.pixelArea().divide(1e4);

function tablaAgrupada(imgGrupo, nombreGrupo) {
  var stats = haPixel.addBands(imgGrupo.rename(nombreGrupo)).reduceRegion({
    reducer: ee.Reducer.sum().group({groupField: 1, groupName: nombreGrupo}),
    geometry: aoi,
    scale: CFG.escala,
    crs: CFG.crs,
    maxPixels: 1e11,
    tileScale: 4
  });
  return ee.FeatureCollection(ee.List(stats.get('groups')).map(function (g) {
    g = ee.Dictionary(g);
    return ee.Feature(null, {
      grupo: nombreGrupo,
      valor: g.get(nombreGrupo),
      hectareas: g.get('sum')
    });
  }));
}

var tablaClases = tablaAgrupada(clase, 'clase');
var tablaAnios = tablaAgrupada(anioPerdida.unmask(0).toInt16(), 'anio_perdida');
var tablaAniosRiesgo = tablaAgrupada(
  anioPerdida.updateMask(clase.eq(3)).unmask(0).toInt16(), 'anio_perdida_riesgo');
var tablaHansen = tablaAgrupada(perdidaHansen.toByte(), 'perdida_hansen');

var tablaFinal = tablaClases.merge(tablaAnios).merge(tablaAniosRiesgo).merge(tablaHansen);

Export.table.toDrive({
  collection: tablaFinal,
  description: 'Estadisticas_EUDR_Chaco',
  folder: CFG.carpetaDrive,
  fileFormat: 'CSV',
  selectors: ['grupo', 'valor', 'hectareas']
});


// ---------------- 9. EXPORTACIÓN DE RASTERS ----------------
function exportar(img, nombre) {
  Export.image.toDrive({
    image: img,
    description: nombre,
    folder: CFG.carpetaDrive,
    fileNamePrefix: nombre,
    region: aoi,
    scale: CFG.escala,
    crs: CFG.crs,
    maxPixels: 1e11,
    fileFormat: 'GeoTIFF'
  });
}

exportar(clase, 'Clasificacion_EUDR_Chaco');
exportar(anioPerdida.unmask(0).toInt16(), 'Anio_perdida_Chaco');


// ---------------- 10. INSPECCIÓN RÁPIDA PARA CALIBRAR ----------------
// Hacer clic en el mapa imprime los valores de NDVI usados en cada umbral.
var paraInspeccion = p10Anual(CFG.anioBase)
  .addBands(p10Anual(ultimoAnio))
  .addBands(ndviPresiembra.rename('NDVI_presiembra_p10'))
  .addBands(ndviPico.rename('NDVI_pico_p90'))
  .addBands(bosqueJRC.rename('bosque_JRC'))
  .addBands(clase);

if (!CFG.soloExportar) {
  Map.onClick(function (coords) {
    var punto = ee.Geometry.Point([coords.lon, coords.lat]);
    print('Valores en', coords.lat.toFixed(5) + ', ' + coords.lon.toFixed(5),
          paraInspeccion.reduceRegion(ee.Reducer.first(), punto, CFG.escala));
  });
  Map.style().set('cursor', 'crosshair');
}


// ---------------- 11. EXPORTACIÓN A ASSET (PARA EL VISOR LIVIANO) ----------------
// Todas las bandas en Int16. Las de NDVI se guardan multiplicadas por 10000.
function ndviEntero(img, nombre) {
  return img.multiply(10000).round().toInt16().rename(nombre);
}

var paraAsset = ee.Image.cat([
  clase.toInt16(),
  anioPerdida.unmask(0).toInt16(),
  bosque2020.toInt16(),
  cultivoVerano.toInt16(),
  perdidaHansen.toInt16(),
  bosqueJRC.toInt16().rename('bosque_jrc'),
  ndviEntero(p10Anual(CFG.anioBase), 'p10_' + CFG.anioBase),
  ndviEntero(p10Anual(ultimoAnio), 'p10_' + ultimoAnio),
  ndviEntero(ndviPresiembra, 'ndvi_presiembra_p10'),
  ndviEntero(ndviPico, 'ndvi_pico_p90')
]).clip(aoi).set({
  version: 'v1',
  umbral_suelo_p10: CFG.umbralSueloP10,
  umbral_presiembra: CFG.umbralPresiembra,
  umbral_pico_cultivo: CFG.umbralPicoCultivo,
  min_pixeles: CFG.minPixeles,
  jrc: CFG.jrcForest,
  hansen: CFG.hansen
});

Export.image.toAsset({
  image: paraAsset,
  description: 'Asset_EUDR_Chaco_v1',
  assetId: CFG.assetId,
  region: aoi,
  scale: CFG.escala,
  crs: CFG.crs,
  maxPixels: 1e11,
  pyramidingPolicy: {
    '.default': 'mode',            // bandas categóricas
    'p10_2020': 'mean',
    'p10_2025': 'mean',
    'ndvi_presiembra_p10': 'mean',
    'ndvi_pico_p90': 'mean'
  }
});
