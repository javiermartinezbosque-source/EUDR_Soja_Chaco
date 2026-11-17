// ============================================================
// ANÁLISIS POR PARCELA — SCREENING EUDR + LEY 26.331
// Lee el asset de 02_deforestacion_soja_eudr_v1.js y evalúa
// polígonos de parcelas (p. ej., los que entrega un proveedor).
//
// Por parcela devuelve:
//   - hectáreas por clase EUDR (v2, con pastura probable)
//   - años de pérdida (este análisis y Hansen)
//   - dictamen EUDR de screening
//   - dictamen de legalidad según OTBN (si se carga el asset OTBN)
//
// ⚠️ Es una herramienta de screening para priorizar verificaciones,
//    no un dictamen legal ni una evaluación de debida diligencia.
// ============================================================


// ---------------- 0. CONFIGURACIÓN ----------------
var CFG = {
  asset: 'projects/my-project-javier-464019/assets/eudr_chaco_v1',
  hansen: 'UMD/hansen/global_forest_change_2024_v1_12',

  // Parcelas a evaluar. null = usar las parcelas de demostración (ficticias).
  // Para usar parcelas reales: subir un shapefile/CSV como asset (Assets >
  // NEW > Shape files) y poner aquí su ruta.
  parcelasAsset: null,
  campoIdParcela: 'id',

  // OTBN (Ley 26.331). null = no se evalúa legalidad.
  // Subir la capa del OTBN provincial como asset e indicar el campo que
  // contiene la categoría y cómo se escriben sus valores.
  otbnAsset: null,
  otbnCampo: 'CATEGORIA',
  otbnValores: {
    'I': 1, '1': 1, 'ROJO': 1,
    'II': 2, '2': 2, 'AMARILLO': 2,
    'III': 3, '3': 3, 'VERDE': 3
  },

  // Superficie mínima para considerar una señal como relevante
  // (igual a la unidad mínima del análisis: 0,5 ha)
  toleranciaHa: 0.5,
  minPixeles: 50,

  crs: 'EPSG:32720',
  carpetaDrive: 'EUDR_Chaco'
};


// ---------------- 1. CLASIFICACIÓN V2 (misma lógica que 03_visor_eudr.js) ----------------
var eudr = ee.Image(CFG.asset);
var clase = eudr.select('clase');
var anio = eudr.select('anio_perdida');

var umbralSuelo = ee.Number(eudr.get('umbral_suelo_p10')).multiply(10000);
var hansenSi = eudr.select('perdida_hansen').unmask(0).eq(1);
var p10Final = eudr.select('p10_2025');
var sueloFinal = p10Final.unmask(10000).lt(umbralSuelo);

// Pérdida Hansen 2021–2024 sin suelo desnudo en 2025 (con datos válidos)
var pasturaBruta = hansenSi.and(anio.eq(0)).and(sueloFinal.not()).and(p10Final.mask());
var pastura = pasturaBruta.selfMask()
  .connectedPixelCount(CFG.minPixeles + 1, true)
  .gte(CFG.minPixeles)
  .unmask(0)
  .and(pasturaBruta);

var claseV2 = clase.where(pastura, 5).rename('clase_v2');


// ---------------- 2. PARCELAS ----------------
// Parcelas de DEMOSTRACIÓN: cuadrados de ~100 ha centrados en los puntos
// de calibración (docs/puntos_calibracion.csv). Son FICTICIAS: no
// corresponden a ningún productor ni proveedor real.
var puntosDemo = [
  ['DEMO-01', -62.95468, -26.50742, 'bosque estable'],
  ['DEMO-02', -62.98558, -26.66226, 'desmonte post-2020 con cultivo'],
  ['DEMO-03', -63.14282, -26.57744, 'cultivo previo a 2020'],
  ['DEMO-04', -62.96910, -26.40168, 'desmonte post-2020 con pico bajo'],
  ['DEMO-05', -62.58321, -26.75186, 'silvopastoril probable']
];

function parcelaDemo(p) {
  var lon = p[1], lat = p[2];
  return ee.Feature(
    ee.Geometry.Rectangle([lon - 0.005, lat - 0.0045, lon + 0.005, lat + 0.0045]),
    {id: p[0], descripcion: 'FICTICIA - centrada en punto de ' + p[3]});
}

var parcelas = CFG.parcelasAsset
  ? ee.FeatureCollection(CFG.parcelasAsset).map(function (f) {
      return f.set({id: f.get(CFG.campoIdParcela), descripcion: ''});
    })
  : ee.FeatureCollection(puntosDemo.map(parcelaDemo));


// ---------------- 3. OTBN (LEY 26.331) ----------------
// 1 = Categoría I (rojo), 2 = II (amarillo), 3 = III (verde), 0 = sin OTBN
var hayOtbn = CFG.otbnAsset !== null;
var otbn;

if (hayOtbn) {
  var dicc = ee.Dictionary(CFG.otbnValores);
  otbn = ee.FeatureCollection(CFG.otbnAsset)
    .map(function (f) {
      var v = f.get(CFG.otbnCampo);
      var texto = ee.String(ee.Algorithms.If(
        ee.Algorithms.IsEqual(ee.Algorithms.ObjectType(v), 'String'),
        v,
        ee.Number(v).toInt().format('%d')));
      return f.set('cat_otbn', dicc.get(texto.trim().toUpperCase(), 0));
    })
    .filter(ee.Filter.gt('cat_otbn', 0))
    .reduceToImage(['cat_otbn'], ee.Reducer.first())
    .unmask(0)
    .rename('otbn');
} else {
  otbn = ee.Image(0).rename('otbn');
}


// ---------------- 4. SUPERFICIES POR PARCELA ----------------
var haPx = ee.Image.pixelArea().divide(1e4);
var desmAgri = claseV2.eq(2).or(claseV2.eq(3));   // deforestación detectada por suelo desnudo
var desmPast = claseV2.eq(5);                      // conversión probable a pastura

var bandas = ee.Image.cat([
  haPx.multiply(claseV2.gte(0)).rename('ha_analizada'),
  haPx.multiply(claseV2.eq(1)).rename('ha_bosque_estable'),
  haPx.multiply(claseV2.eq(2)).rename('ha_defor_sin_cultivo'),
  haPx.multiply(claseV2.eq(3)).rename('ha_defor_con_cultivo'),
  haPx.multiply(claseV2.eq(4)).rename('ha_cultivo_sin_conflicto'),
  haPx.multiply(claseV2.eq(5)).rename('ha_pastura_probable'),
  haPx.multiply(hansenSi).rename('ha_hansen_2021_2024'),
  haPx.multiply(desmAgri.and(otbn.eq(0))).rename('ha_desm_agri_sin_otbn'),
  haPx.multiply(desmAgri.and(otbn.eq(1))).rename('ha_desm_agri_cat_I'),
  haPx.multiply(desmAgri.and(otbn.eq(2))).rename('ha_desm_agri_cat_II'),
  haPx.multiply(desmAgri.and(otbn.eq(3))).rename('ha_desm_agri_cat_III'),
  haPx.multiply(desmPast.and(otbn.eq(0))).rename('ha_past_sin_otbn'),
  haPx.multiply(desmPast.and(otbn.eq(1))).rename('ha_past_cat_I'),
  haPx.multiply(desmPast.and(otbn.eq(2))).rename('ha_past_cat_II'),
  haPx.multiply(desmPast.and(otbn.eq(3))).rename('ha_past_cat_III')
]);

var conSuperficies = bandas.reduceRegions({
  collection: parcelas,
  reducer: ee.Reducer.sum(),
  scale: 10,
  crs: CFG.crs,
  tileScale: 4
});

// Años de pérdida (mínimo y máximo dentro de la parcela)
var hansenAnio = ee.Image(CFG.hansen).select('lossyear').add(2000).updateMask(hansenSi);
var anios = anio.updateMask(anio.gt(0)).rename('anio_perdida')
  .addBands(hansenAnio.rename('anio_hansen'));

var conAnios = anios.reduceRegions({
  collection: conSuperficies,
  reducer: ee.Reducer.minMax(),
  scale: 10,
  crs: CFG.crs,
  tileScale: 4
});


// ---------------- 5. DICTÁMENES ----------------
function n(f, prop) { return ee.Number(ee.Algorithms.If(f.get(prop), f.get(prop), 0)); }

function dictaminar(f) {
  var tol = CFG.toleranciaHa;
  var agri = n(f, 'ha_defor_sin_cultivo').add(n(f, 'ha_defor_con_cultivo'));
  var past = n(f, 'ha_pastura_probable');
  var haParcela = f.geometry().area(1).divide(1e4);
  var cobertura = n(f, 'ha_analizada').divide(haParcela);

  // --- Screening EUDR ---
  // 3 = alto riesgo, 2 = revisar (pastura), 1 = revisar (señales menores), 0 = sin señales
  var codigo = ee.Number(ee.Algorithms.If(agri.gte(tol), 3,
               ee.Algorithms.If(past.gte(tol), 2,
               ee.Algorithms.If(agri.add(past).gt(0), 1, 0))));
  var textosEudr = ee.List([
    'SIN DEFORESTACIÓN POST-2020 DETECTADA',
    'REVISAR: señales menores a la tolerancia (posible efecto de borde)',
    'REVISAR: conversión probable a pastura/silvopastoril (encuadre EUDR incierto)',
    'ALTO RIESGO: deforestación post-2020 detectada'
  ]);

  // --- Legalidad (Ley 26.331 / OTBN) ---
  var agriI_II = n(f, 'ha_desm_agri_cat_I').add(n(f, 'ha_desm_agri_cat_II'));
  var pastI_II = n(f, 'ha_past_cat_I').add(n(f, 'ha_past_cat_II'));
  var cat_III = n(f, 'ha_desm_agri_cat_III').add(n(f, 'ha_past_cat_III'));
  var sinOtbn = n(f, 'ha_desm_agri_sin_otbn').add(n(f, 'ha_past_sin_otbn'));

  var legalidad = hayOtbn
    ? ee.Algorithms.If(agriI_II.gte(tol),
        'PROBABLE INCUMPLIMIENTO Ley 26.331: desmonte en categoría I/II',
      ee.Algorithms.If(pastI_II.gte(tol),
        'VERIFICAR: pastura/silvopastoril en categoría I/II (¿plan de manejo aprobado?)',
      ee.Algorithms.If(cat_III.gte(tol),
        'VERIFICAR PERMISO: desmonte en categoría III (requiere autorización)',
      ee.Algorithms.If(sinOtbn.gte(tol),
        'VERIFICAR: desmonte fuera de polígonos OTBN',
        'Sin desmonte post-2020 que evaluar'))))
    : 'OTBN no cargado: legalidad no evaluada';

  var aviso = ee.Algorithms.If(cobertura.lt(0.95),
    'Parcela parcialmente fuera del área analizada', '');

  return f.set({
    ha_parcela: haParcela,
    pct_analizada: cobertura.multiply(100),
    ha_conversion_post2020: agri.add(past),
    codigo_eudr: codigo,
    dictamen_eudr: textosEudr.get(codigo),
    dictamen_legalidad: legalidad,
    aviso: aviso
  });
}

var resultado = conAnios.map(dictaminar);


// ---------------- 6. MAPA ----------------
var paletaClase = ['f0f0f0', '1a7f37', 'f2a900', 'd62728', 'c9b98a', '8c510a'];
Map.addLayer(claseV2.selfMask(), {min: 0, max: 5, palette: paletaClase}, 'Clasificación EUDR v2');
if (hayOtbn) {
  Map.addLayer(otbn.selfMask(), {min: 1, max: 3, palette: ['e31a1c', 'ffd700', '33a02c']},
    'OTBN (I rojo · II amarillo · III verde)', false, 0.6);
}

var coloresDictamen = ee.List(['00c853', 'ffeb3b', 'ff9800', 'ff1744']);
var parcelasEstilo = resultado.map(function (f) {
  return f.set('estilo', {
    color: coloresDictamen.get(f.get('codigo_eudr')),
    width: 3,
    fillColor: '00000000'
  });
});
Map.addLayer(parcelasEstilo.style({styleProperty: 'estilo'}), {}, 'Parcelas (color = dictamen EUDR)');
Map.centerObject(parcelas, 11);

var leyenda = ui.Panel({style: {position: 'bottom-left', padding: '8px'}});
leyenda.add(ui.Label('Dictamen EUDR (borde de la parcela)', {fontWeight: 'bold'}));
[['00c853', 'Sin deforestación post-2020 detectada'],
 ['ffeb3b', 'Revisar: señales menores'],
 ['ff9800', 'Revisar: pastura / silvopastoril'],
 ['ff1744', 'Alto riesgo: deforestación post-2020']].forEach(function (c) {
  leyenda.add(ui.Panel([
    ui.Label('', {backgroundColor: '#' + c[0], padding: '8px', margin: '2px 6px 2px 0'}),
    ui.Label(c[1], {margin: '2px 0'})
  ], ui.Panel.Layout.flow('horizontal')));
});
Map.add(leyenda);


// ---------------- 7. REPORTE EN CONSOLA ----------------
function fmt(x) { return (x === null || x === undefined) ? '-' : Number(x).toFixed(1); }

resultado.evaluate(function (fc, error) {
  if (error) { print('Error:', error); return; }
  fc.features.forEach(function (f) {
    var p = f.properties;
    var anioNuestro = p.anio_perdida_min ? (p.anio_perdida_min + '–' + p.anio_perdida_max) : '-';
    var anioHansen = p.anio_hansen_min ? (p.anio_hansen_min + '–' + p.anio_hansen_max) : '-';
    print([
      '=== ' + p.id + ' ' + (p.descripcion ? '(' + p.descripcion + ')' : ''),
      'Superficie: ' + fmt(p.ha_parcela) + ' ha (' + fmt(p.pct_analizada) + '% analizada)',
      'Bosque estable: ' + fmt(p.ha_bosque_estable) + ' ha',
      'Deforestación post-2020 → cultivo: ' + fmt(p.ha_defor_con_cultivo) + ' ha',
      'Deforestación post-2020 sin cultivo: ' + fmt(p.ha_defor_sin_cultivo) + ' ha',
      'Conversión probable a pastura: ' + fmt(p.ha_pastura_probable) + ' ha',
      'Cultivo sin conflicto: ' + fmt(p.ha_cultivo_sin_conflicto) + ' ha',
      'Años de pérdida (este análisis / Hansen): ' + anioNuestro + ' / ' + anioHansen,
      'EUDR: ' + p.dictamen_eudr,
      'Legalidad: ' + p.dictamen_legalidad,
      p.aviso ? 'Aviso: ' + p.aviso : ''
    ].join('\n'));
  });
});


// ---------------- 8. EXPORTACIÓN ----------------
Export.table.toDrive({
  collection: resultado,
  description: 'Parcelas_EUDR_screening',
  folder: CFG.carpetaDrive,
  fileFormat: 'CSV',
  selectors: [
    'id', 'descripcion', 'ha_parcela', 'pct_analizada',
    'ha_bosque_estable', 'ha_defor_con_cultivo', 'ha_defor_sin_cultivo',
    'ha_pastura_probable', 'ha_cultivo_sin_conflicto', 'ha_hansen_2021_2024',
    'anio_perdida_min', 'anio_perdida_max', 'anio_hansen_min', 'anio_hansen_max',
    'ha_desm_agri_cat_I', 'ha_desm_agri_cat_II', 'ha_desm_agri_cat_III', 'ha_desm_agri_sin_otbn',
    'ha_past_cat_I', 'ha_past_cat_II', 'ha_past_cat_III', 'ha_past_sin_otbn',
    'ha_conversion_post2020', 'dictamen_eudr', 'dictamen_legalidad', 'aviso'
  ]
});
