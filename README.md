# EUDR · Deforestación y soja en el Chaco argentino

Análisis geoespacial en **Google Earth Engine** para identificar deforestación posterior al **31/12/2020** (fecha de corte del Reglamento Europeo contra la Deforestación, **UE 2023/1115**) en zonas de expansión agrícola del Chaco argentino, y para estimar qué parte de esa deforestación terminó convertida en cultivo de verano (proxy de soja).

> Proyecto de portfolio. Los resultados son una aproximación metodológica y **no constituyen una evaluación de debida diligencia EUDR**.

<!-- TODO: agregar captura del mapa final -->
<!-- ![Clasificación EUDR](docs/mapa_clasificacion.png) -->

---

## Contexto

El EUDR exige que ciertos productos que ingresan al mercado europeo, entre ellos la soja, provengan de tierras **no deforestadas después del 31 de diciembre de 2020**. Para demostrarlo, los operadores necesitan información geolocalizada de las parcelas de producción.

La región chaqueña argentina combina dos cosas: una frontera agrícola activa y una gran superficie de bosque nativo seco. Por eso es un caso relevante para analizar ese criterio con teledetección.

> ⚠️ El calendario de aplicación del EUDR tuvo postergaciones y propuestas de modificación. Antes de citar fechas de entrada en vigor, conviene verificar la versión vigente en [EUR-Lex](https://eur-lex.europa.eu/eli/reg/2023/1115/oj).

## Pregunta

> Dentro del área de estudio, ¿cuánta superficie que era bosque al 31/12/2020 fue desmontada después y está hoy bajo cultivo de verano?

## Área de estudio

Un rectángulo de 1° × 1° (lon −63,5 a −62,5; lat −27,0 a −26,0) en el norte de Santiago del Estero, en el Chaco Semiárido. Es una zona con bosque nativo y avance agrícola.

## Datos

| Dataset | Uso | ID en GEE |
|---|---|---|
| Sentinel-2 SR Harmonized | Series de NDVI (2020–2026) | `COPERNICUS/S2_SR_HARMONIZED` |
| Cloud Score+ | Máscara de nubes | `GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED` |
| JRC Global Forest Cover 2020 | Bosque de referencia al corte EUDR | `JRC/GFC2020/V2` |
| Hansen Global Forest Change | Contraste independiente de pérdida | `UMD/hansen/global_forest_change_2024_v1_12` |

## Metodología

```
JRC bosque 2020 ──┐
                  ├─► Bosque al 31/12/2020 ──┐
NDVI p10 2020 ────┘                          │
                                             ├─► Pérdida post-2020 ──┐
NDVI p10 anual 2021–2025 ────────────────────┘    (≥ 0,5 ha)         │
                                                                     ├─► Clasificación EUDR
NDVI campaña 2025/26 (presiembra + pico) ─► Cultivo de verano ───────┘
```

1. **Bosque al corte.** Se parte del mapa JRC GFC2020 y se descartan los píxeles que ya mostraron suelo desnudo durante 2020, es decir, desmontes anteriores al corte o errores del mapa.
2. **Pérdida post-2020.** Se calcula el **percentil 10 anual del NDVI** (umbral de suelo desnudo: 0,28). Un bosque nativo mantiene cierta cobertura todo el año, mientras que un lote agrícola pasa por suelo desnudo (presiembra o poscosecha). El año de pérdida es el primero en que aparece suelo desnudo, y se exige que siga así en 2025 para no confundir un incendio con un desmonte.
3. **Cultivo de verano.** En la campaña 2025/26 se busca suelo desnudo entre octubre y diciembre (p10 de NDVI < 0,30) seguido de un pico de vegetación entre enero y marzo (p90 de NDVI > 0,70).
4. **Unidad mínima de 0,5 ha** para la pérdida y para el cultivo, de acuerdo con la definición de bosque de la FAO que usa el EUDR. En el cultivo, además, elimina píxeles sueltos en monte abierto que pasan los umbrales sin ser lotes.
5. **Clasificación final:**

| Clase | Significado |
|---|---|
| 1 · Bosque estable | Bosque en 2020 sin pérdida posterior |
| 2 · Deforestación sin cultivo | Pérdida post-2020, sin cultivo de verano detectado |
| 3 · **Deforestación → cultivo** | Pérdida post-2020 y cultivo de verano en 2025/26: **riesgo EUDR** |
| 4 · Cultivo sin conflicto | Cultivo sobre tierras que no eran bosque en 2020 |

6. **Validación cruzada** con la pérdida de Hansen (`lossyear ≥ 2021`) dentro del mismo bosque 2020.

### Calibración de umbrales

Los umbrales se ajustaron con una calibración exploratoria: se inspeccionaron píxeles representativos de cada clase (`docs/puntos_calibracion.csv`).

| Uso del suelo | p10 anual de NDVI | Presiembra (p10) | Pico (p90) |
|---|---|---|---|
| Bosque estable | 0,41–0,42 | 0,51 | 0,80 |
| Cultivo consolidado | 0,15–0,23 | 0,13–0,19 | 0,86–0,91 |
| Lote recién desmontado | 0,16 | 0,15–0,19 | 0,60–0,69 |

- El umbral de suelo desnudo pasó de 0,25 a **0,28**, cerca del punto medio entre cultivo (≤ 0,23) y bosque (≥ 0,34).
- El pico por sí solo no separa bosque de cultivo (el bosque llega a 0,80). Lo que separa es la combinación con la **presiembra**.
- Los lotes desmontados recientemente pueden tener un pico más bajo que los cultivos consolidados. Con el umbral de 0,70, un mismo lote puede quedar repartido entre las clases 2 y 3 (ver Limitaciones).

Para verificar visualmente conviene usar los composites RGB de Sentinel-2 que incluye el script, no la capa "Satélite" de Google: esa capa no indica su fecha y puede ser anterior al desmonte.

## Resultados

Área analizada: **1.104.666 ha**. Son estimaciones sin evaluación formal de exactitud (ver Limitaciones).

### Clasificación EUDR

| Clase | Hectáreas | % del área |
|---|---:|---:|
| Bosque estable | 816.229 | 73,9% |
| Deforestación sin cultivo | 5.517 | 0,5% |
| **Deforestación → cultivo (riesgo EUDR)** | **20.275** | **1,8%** |
| Cultivo sin conflicto | 144.638 | 13,1% |
| Otro | 118.007 | 10,7% |

### Indicadores clave

- **Bosque al 31/12/2020:** 842.021 ha (76% del área).
- **Deforestación post-2020:** 25.792 ha, equivalente al **3,1% del bosque 2020** en cinco años.
- **Conversión a cultivo de verano:** el **79%** de la superficie desmontada (20.275 ha) tenía cultivo de verano en la campaña 2025/26. Es probablemente una estimación conservadora (ver Limitaciones).

### Pérdida por año

| Año | Hectáreas |
|---|---:|
| 2021 | 5.138 |
| 2022 | 4.909 |
| 2023 | 5.343 |
| 2024 | 4.710 |
| 2025 | 5.692 |
| **Total** | **25.792** |

El ritmo es estable, alrededor de 5.200 ha/año. El dato de 2025 es menos robusto: la persistencia se verifica en el mismo año, así que un incendio de 2025 podría contarse como desmonte.

### Comparación con Hansen (2021–2024)

| Fuente | Pérdida dentro del bosque 2020 |
|---|---:|
| Este análisis | 20.100 ha |
| Hansen GFC | 41.086 ha |

Este análisis detecta aproximadamente **la mitad** de la pérdida que registra Hansen en el mismo período. Las causas probables, todavía no verificadas, son:
- se exige que la pérdida persista, por lo que se excluyen incendios con rebrote;
- Hansen registra pérdida de copa por rolados y degradación, que no llegan a dejar suelo desnudo;
- se aplica una unidad mínima de 0,5 ha.

Las dos fuentes coinciden en los desmontes agrícolas grandes. Revisar las zonas donde no coinciden queda como próximo paso.

## Limitaciones

- **Cultivo de verano ≠ soja.** Con NDVI solo no se distingue la soja del maíz, el algodón o el sorgo. Separar la soja requeriría un mapa de cultivos o un clasificador entrenado con verdad de campo.
- **Clasificación por píxel.** En lotes recién desmontados, el NDVI del pico varía dentro del mismo lote, y parte del lote puede quedar como "deforestación sin cultivo" (clase 2). Por eso la clase 3 es probablemente una **estimación conservadora**. Una clasificación por lote (objetos) reduciría este efecto.
- **Umbrales calibrados a mano.** Los valores de NDVI se ajustaron inspeccionando píxeles. No hay una validación estadística con puntos de referencia independientes.
- **Dependencia del mapa JRC.** Sus errores de comisión u omisión en el bosque chaqueño seco se trasladan al resultado.
- **Bosque seco y caducifolio.** La caída estacional del NDVI en bosques degradados o abiertos puede generar falsos positivos.
- **Sequías e incendios.** Pueden bajar el NDVI sin que haya desmonte. La condición de persistencia los reduce, pero no los elimina.
- **Alcance legal.** El EUDR también considera la degradación forestal y la legalidad según la normativa del país productor (en Argentina, la Ley 26.331 y los OTBN provinciales). Este análisis no evalúa esos aspectos.

## Cómo reproducirlo

El cálculo completo es pesado: series de Sentinel-2 de 6 años a 10 m. Por eso se separa en dos pasos.

**Paso 1 · Procesamiento (una sola vez)**
1. Abrir [Google Earth Engine Code Editor](https://code.earthengine.google.com/).
2. Pegar `gee/02_deforestacion_soja_eudr_v1.js` y ajustar el bloque `CFG`: área, años, umbrales y `assetId` con el proyecto propio.
3. Con `soloExportar: true`, ejecutar con **Run**. Solo se crean las tareas, sin calcular nada en el mapa.
4. En **Tasks**, lanzar `Asset_EUDR_Chaco_v1` (obligatoria para el visor). Opcionalmente, lanzar también las exportaciones a Drive: CSV de estadísticas y GeoTIFFs.

**Paso 2 · Exploración (liviano)**
1. Pegar `gee/03_visor_eudr.js` y ejecutar.
2. Hacer clic en el mapa para ver los valores de NDVI de cada umbral, y usar el botón **Calcular hectáreas** para las estadísticas.

Para recalibrar los umbrales con el mapa en vivo, usar `soloExportar: false` en el script 02. Ojo: consume bastante más cuota.

## Estructura

```
gee/
├── 01_deforestacion_ndvi_v0.js      # Primera versión (composites max de NDVI)
├── 02_deforestacion_soja_eudr_v1.js # Procesamiento completo + exportación a asset
└── 03_visor_eudr.js                 # Visor liviano sobre el asset
docs/
└── puntos_calibracion.csv           # Píxeles usados para calibrar los umbrales
```

La v0 se conserva como registro: el composite `max()` de NDVI no distingue un bosque de un cultivo en su pico de crecimiento, por lo que subestimaba la conversión a soja. Ese problema motivó la v1.

## Próximos pasos

- [x] Calibración exploratoria de umbrales
- [x] Cálculo de superficies y comparación con Hansen
- [ ] Analizar las zonas donde Hansen registra pérdida y este análisis no
- [ ] Clasificación por lote para reducir la fragmentación entre las clases 2 y 3
- [ ] Validación con muestreo aleatorio estratificado e interpretación visual
- [ ] Incorporar un mapa de cultivos para separar la soja
- [ ] Cruzar con las categorías de los OTBN provinciales

## Autor

Javier Martínez Bosque
