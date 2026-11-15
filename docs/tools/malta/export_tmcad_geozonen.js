// Export der Geozonen aus tmcad.idronect.com/map (Transport Malta, Idronect)
// Nutzung: Karte öffnen, warten bis die Zonen sichtbar sind, F12 → Konsole,
// dieses Skript einfügen und Enter drücken. Es lädt die Datei
// "malta_geozonen_roh_<datum>.geojson" herunter.
//
// Funktionsweise: Die Seite rendert die Zonen mit deck.gl. Der Layer
// "GeoJsonLayers" enthält einen Eintrag mit id "operator-zones", dessen
// "geojson" eine FeatureCollection (Polygone) ist. Das Skript liest genau
// diese bereits geladenen Daten aus dem React-Zustand – es schickt keine
// eigenen Anfragen an den Server.
(() => {
  const findLayers = () => {
    for (const canvas of document.querySelectorAll('canvas')) {
      const key = Object.keys(canvas).find(k => k.startsWith('__reactFiber'));
      let f = key && canvas[key];
      for (let i = 0; f && i < 80; i++, f = f.return) {
        const p = f.memoizedProps;
        if (p && p.layers && p.viewState) return p.layers.flat(5).filter(Boolean);
      }
    }
    return null;
  };

  const layers = findLayers();
  if (!layers) return console.error('deck.gl-Layer nicht gefunden – ist die Karte geladen?');

  const geoLayer = layers.find(l => l.id === 'GeoJsonLayers');
  const entry = geoLayer && (geoLayer.props.data || []).find(d => d.id === 'operator-zones');
  if (!entry || !entry.geojson) return console.error('Layer "operator-zones" nicht gefunden.');

  const fc = {
    type: 'FeatureCollection',
    metadata: {
      quelle: location.origin + location.pathname,
      exportiert: new Date().toISOString(),
      anzahl: entry.geojson.features.length,
    },
    features: entry.geojson.features,
  };

  const blob = new Blob([JSON.stringify(fc)], { type: 'application/geo+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `malta_geozonen_roh_${new Date().toISOString().slice(0, 10)}.geojson`;
  a.click();
  URL.revokeObjectURL(a.href);
  console.log(`✔ ${fc.features.length} Zonen exportiert`);
})();
