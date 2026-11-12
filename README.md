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
2. **Pérdida post-2020.** Se calcula el **percentil 10 anual del NDVI**. Un bosque nativo mantiene cierta cobertura todo el año, mientras que un lote agrícola pasa por suelo desnudo (presiembra o poscosecha). El año de pérdida es el primero en que aparece suelo desnudo, y se exige que siga así en 2025 para no confundir un incendio con un desmonte.
3. **Cultivo de verano.** En la campaña 2025/26 se busca suelo desnudo entre octubre y diciembre (p10 de NDVI < 0,30) seguido de un pico de vegetación entre enero y marzo (p90 de NDVI > 0,70).
4. **Unidad mínima de 0,5 ha**, de acuerdo con la definición de bosque de la FAO que usa el EUDR.
5. **Clasificación final:**

| Clase | Significado |
|---|---|
| 1 · Bosque estable | Bosque en 2020 sin pérdida posterior |
| 2 · Deforestación sin cultivo | Pérdida post-2020, sin cultivo de verano detectado |
| 3 · **Deforestación → cultivo** | Pérdida post-2020 y cultivo de verano en 2025/26: **riesgo EUDR** |
| 4 · Cultivo sin conflicto | Cultivo sobre tierras que no eran bosque en 2020 |

6. **Validación cruzada** con la pérdida de Hansen (`lossyear ≥ 2021`) dentro del mismo bosque 2020.

## Resultados

<!-- TODO: completar con el CSV exportado (Estadisticas_EUDR_Chaco.csv) -->

| Clase | Hectáreas |
|---|---|
| Bosque estable | _pendiente_ |
| Deforestación sin cultivo | _pendiente_ |
| Deforestación → cultivo | _pendiente_ |
| Cultivo sin conflicto | _pendiente_ |

Pérdida por año (2021–2025) y comparación con Hansen: _pendiente_.

## Limitaciones

- **Cultivo de verano ≠ soja.** Con NDVI solo no se distingue la soja del maíz, el algodón o el sorgo. Separar la soja requeriría un mapa de cultivos o un clasificador entrenado con verdad de campo.
- **Umbrales calibrados a mano.** Los valores de NDVI se ajustaron inspeccionando píxeles. No hay una validación estadística con puntos de referencia independientes.
- **Dependencia del mapa JRC.** Sus errores de comisión u omisión en el bosque chaqueño seco se trasladan al resultado.
- **Bosque seco y caducifolio.** La caída estacional del NDVI en bosques degradados o abiertos puede generar falsos positivos.
- **Sequías e incendios.** Pueden bajar el NDVI sin que haya desmonte. La condición de persistencia los reduce, pero no los elimina.
- **Alcance legal.** El EUDR también considera la degradación forestal y la legalidad según la normativa del país productor (en Argentina, la Ley 26.331 y los OTBN provinciales). Este análisis no evalúa esos aspectos.

## Cómo reproducirlo

1. Abrir [Google Earth Engine Code Editor](https://code.earthengine.google.com/).
2. Pegar el contenido de `gee/02_deforestacion_soja_eudr_v1.js`.
3. Ajustar el bloque `CFG` (área, años, umbrales) si hace falta y ejecutar con **Run**.
4. Desde la pestaña **Tasks**, lanzar las exportaciones a Google Drive (carpeta `EUDR_Chaco`).
5. Hacer clic en el mapa para ver en la consola los valores de NDVI usados en cada umbral.

## Estructura

```
gee/
├── 01_deforestacion_ndvi_v0.js      # Primera versión (composites max de NDVI)
└── 02_deforestacion_soja_eudr_v1.js # Versión actual
```

La v0 se conserva como registro: el composite `max()` de NDVI no distingue un bosque de un cultivo en su pico de crecimiento, por lo que subestimaba la conversión a soja. Ese problema motivó la v1.

## Próximos pasos

- [ ] Calibrar umbrales con puntos de referencia (bosque, lote, desmonte)
- [ ] Validación con muestreo aleatorio estratificado e interpretación visual
- [ ] Incorporar un mapa de cultivos para separar la soja
- [ ] Cruzar con las categorías de los OTBN provinciales

## Autor

Javier Martínez Bosque
