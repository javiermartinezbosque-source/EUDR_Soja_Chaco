// ============================================================
// VISOR LIVIANO — CLASIFICACIÓN EUDR CHACO
// Lee el asset generado por 02_deforestacion_soja_eudr_v1.js
// (sección 11). No recalcula series de Sentinel-2: consume muy
// poco cómputo y sirve para explorar, calibrar y hacer capturas.
// ============================================================

var ASSET = 'projects/my-project-javier-464019/assets/eudr_chaco_v1';
var HANSEN = 'UMD/hansen/global_forest_change_2024_v1_12';

var eudr = ee.Image(ASSET);
var aoi = eudr.geometry();
Map.centerObject(aoi, 10);

print('Parámetros del asset:', eudr.toDictionary());


// ---------------- CAPAS ----------------
var nombresClase = ['Otro', 'Bosque estable', 'Deforestación sin cultivo',
                    'Deforestación → cultivo (riesgo EUDR)', 'Cultivo sin conflicto'];
var paletaClase = ['f0f0f0', '1a7f37', 'f2a900', 'd62728', 'c9b98a'];

var clase = eudr.select('clase');
var anio = eudr.select('anio_perdida');

Map.addLayer(eudr.select('bosque_jrc').selfMask(), {palette: ['1a7f37']}, 'Bosque JRC 2020', false);
Map.addLayer(eudr.select('cultivo_verano').selfMask(), {palette: ['c9b98a']}, 'Cultivo de verano 2025/26', false);
Map.addLayer(eudr.select('perdida_hansen').selfMask(), {palette: ['ff00ff']}, 'Pérdida Hansen post-2020', false);
Map.addLayer(anio.selfMask(), {min: 2021, max: 2025, palette: ['ffffb2', 'fd8d3c', 'bd0026']},
  'Año de pérdida', false);
Map.addLayer(clase.selfMask(), {min: 0, max: 4, palette: paletaClase}, 'Clasificación EUDR');
Map.addLayer(ee.Image().paint(aoi, 1, 2), {palette: ['black']}, 'Área de estudio');

// Contexto regional (dataset precalculado: costo bajo)
Map.addLayer(
  ee.Image(HANSEN).select('lossyear').gte(21).selfMask()
    .clip(ee.Geometry.Rectangle([-65.5, -29.0, -58.0, -22.0])),
  {palette: ['ff00ff']}, 'Contexto: pérdida Hansen 2021+ (regional)', false);

// RGB Sentinel-2 bajo demanda (⚠️ estas dos capas sí calculan desde
// imágenes crudas: activarlas solo cuando haga falta verificar)
var s2Rgb = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoi)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 30))
  .linkCollection(ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED'), ['cs_cdf'])
  .map(function (img) { return img.updateMask(img.select('cs_cdf').gte(0.6)); });
var visRgb = {bands: ['B4', 'B3', 'B2'], min: 0, max: 2500};
Map.addLayer(s2Rgb.filterDate('2020-06-01', '2021-01-01').median().clip(aoi),
  visRgb, 'S2 RGB 2020 (fecha de corte)', false);
Map.addLayer(s2Rgb.filterDate('2025-06-01', '2025-10-01').median().clip(aoi),
  visRgb, 'S2 RGB 2025 (estación seca)', false);


// ---------------- LEYENDA ----------------
var leyenda = ui.Panel({style: {position: 'bottom-left', padding: '8px'}});
leyenda.add(ui.Label('Clasificación EUDR', {fontWeight: 'bold'}));
for (var i = 1; i < nombresClase.length; i++) {
  leyenda.add(ui.Panel([
    ui.Label('', {backgroundColor: '#' + paletaClase[i], padding: '8px', margin: '2px 6px 2px 0'}),
    ui.Label(nombresClase[i], {margin: '2px 0'})
  ], ui.Panel.Layout.flow('horizontal')));
}
Map.add(leyenda);


// ---------------- INSPECCIÓN POR CLIC ----------------
var bandasNdvi = ['p10_2020', 'p10_2025', 'ndvi_presiembra_p10', 'ndvi_pico_p90'];
var paraInspeccion = eudr.select(bandasNdvi).divide(10000)
  .addBands(eudr.select(['clase', 'anio_perdida', 'bosque_jrc']));

Map.onClick(function (coords) {
  var punto = ee.Geometry.Point([coords.lon, coords.lat]);
  print('Valores en', coords.lat.toFixed(5) + ', ' + coords.lon.toFixed(5),
        paraInspeccion.reduceRegion(ee.Reducer.first(), punto, 10));
});
Map.style().set('cursor', 'crosshair');


// ---------------- ESTADÍSTICAS BAJO DEMANDA ----------------
// Se calculan solo al apretar el botón, sobre el asset (no sobre Sentinel-2).
function hectareasPor(banda) {
  return ee.Image.pixelArea().divide(1e4).addBands(eudr.select(banda)).reduceRegion({
    reducer: ee.Reducer.sum().group({groupField: 1, groupName: banda}),
    geometry: aoi,
    scale: 10,
    maxPixels: 1e11,
    tileScale: 4
  });
}

// Imprime una tabla de texto (valor;hectáreas) lista para copiar
function imprimirTabla(banda, titulo, etiquetas) {
  hectareasPor(banda).evaluate(function (resultado, error) {
    if (error) {
      print('Error en ' + banda + ':', error);
      return;
    }
    var lineas = ['--- ' + titulo + ' ---', 'valor;etiqueta;hectareas'];
    resultado.groups.forEach(function (g) {
      var valor = g[banda];
      var etiqueta = etiquetas ? (etiquetas[valor] || '') : '';
      lineas.push(valor + ';' + etiqueta + ';' + Math.round(g.sum));
    });
    print(lineas.join('\n'));
  });
}

var boton = ui.Button({
  label: 'Calcular hectáreas',
  style: {position: 'top-center'},
  onClick: function () {
    imprimirTabla('clase', 'Hectáreas por clase', nombresClase);
    imprimirTabla('anio_perdida', 'Hectáreas por año de pérdida (0 = sin pérdida)');
    imprimirTabla('perdida_hansen', 'Hansen post-2020 dentro del bosque 2020',
                  {0: 'sin pérdida', 1: 'pérdida'});
  }
});
Map.add(boton);
