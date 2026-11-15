# Slowakei (SK) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu **gis.lps.sk/vfrm** (LPS SR / Letové prevádzkové služby).
Stand: 2026-11-15. Freigabe liegt vor.

---

## 1. Kurzfassung

- Die VFR-Manual-Karte (`gis.lps.sk/vfrm`) ist eine **ArcGIS Web AppBuilder
  (3.25)**-App. Basiskarten von `gis.lps.sk/server` + ArcGIS Online.
- Die **Luftraum-/Zonendaten** liegen auf
  `gis.lps.sk/server/rest/services/VFRM/Airspaces/FeatureServer`, sind aber
  **token-geschützt** (`499 Token Required`) – also nicht anonym abrufbar.
- Öffentlich auf der ArcGIS-Online-Organisation
  `services6.arcgis.com/tQvZ8qYlocseRVy6` sind nur:
  `VFRM_dynamic_view` (= **VFRM_warnings**, NOTAM-ähnliche Warnungen),
  `KOŠICE_CTR_WSL1` (eine CTR), `ANC500_search` (Kartensuche) – **nicht** der
  vollständige Zonensatz.

## 2. Offener Punkt (blockierend)
Die eigentlichen UAS-/Luftraumzonen sind hinter einem ArcGIS-Token. Die
WAB-App beschafft diesen Token selbst (App-Login/Proxy). Wege:
1. **Bei LPS SR erfragen:** öffentlicher Endpoint oder **ED-269-Export** der
   Geozonen (sauberste Lösung; nach EU-2019/947 sollte ED-269 existieren).
2. **App-Token/Proxy analysieren:** Wie die VFRM-App den Token holt (ggf.
   `gis.lps.sk/vfrm/proxy` oder ein anonymer App-Token) – aufwändiger und
   fragiler; nur falls (1) nicht möglich.

## 3. Verifizierte Fakten
- App: ArcGIS WAB 3.25 auf `gis.lps.sk/vfrm`.
- Daten-Service (token): `gis.lps.sk/server/rest/services/VFRM/Airspaces/FeatureServer` (499).
- Öffentliche AGOL-Org: `services6.arcgis.com/tQvZ8qYlocseRVy6` (nur Warnungen/CTR/Suche).

## 4. Integration (sobald Zugang geklärt)
- Bei ED-269: wie AT/PT behandeln. Bei ArcGIS-FeatureServer (mit Token/öffentlich):
  `/query?...&f=geojson`, `shared/slovakiaGeozones.ts` für das Feld-Mapping.
- `"sk"` in die Länderliste. Label `SK: "LPS SR"`. Refresh täglich.

> **Stand:** Plattform und Daten-Service identifiziert; der Zonensatz ist
> token-geschützt. Nächster Schritt: öffentlichen Endpoint/ED-269 von LPS SR.
