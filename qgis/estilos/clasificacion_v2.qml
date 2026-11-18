<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.44.15" styleCategories="Symbology">
  <pipe>
    <provider>
      <resampling enabled="false" zoomedInResamplingMethod="nearestNeighbour" zoomedOutResamplingMethod="nearestNeighbour" maxOversampling="2"/>
    </provider>
    <rasterrenderer type="paletted" band="1" opacity="1" alphaBand="-1" nodataColor="">
      <rasterTransparency/>
      <minMaxOrigin>
        <limits>None</limits>
        <extent>WholeRaster</extent>
        <statAccuracy>Estimated</statAccuracy>
        <cumulativeCutLower>0.02</cumulativeCutLower>
        <cumulativeCutUpper>0.98</cumulativeCutUpper>
        <stdDevFactor>2</stdDevFactor>
      </minMaxOrigin>
      <colorPalette>
        <paletteEntry value="0" color="#f0f0f0" alpha="0" label="Otro (sin color)"/>
        <paletteEntry value="1" color="#1a7f37" alpha="255" label="Bosque estable"/>
        <paletteEntry value="2" color="#f2a900" alpha="255" label="Deforestación post-2020 sin cultivo"/>
        <paletteEntry value="3" color="#d62728" alpha="255" label="Deforestación post-2020 → cultivo (riesgo EUDR)"/>
        <paletteEntry value="4" color="#c9b98a" alpha="255" label="Cultivo sin conflicto"/>
        <paletteEntry value="5" color="#8c510a" alpha="255" label="Conversión probable a pastura / silvopastoril"/>
      </colorPalette>
    </rasterrenderer>
    <brightnesscontrast brightness="0" contrast="0" gamma="1"/>
    <huesaturation saturation="0" grayscaleMode="0" colorizeOn="0" colorizeRed="255" colorizeGreen="128" colorizeBlue="128" colorizeStrength="100" invertColors="0"/>
    <rasterresampler maxOversampling="2"/>
    <resamplingStage>resamplingFilter</resamplingStage>
  </pipe>
  <blendMode>0</blendMode>
</qgis>
