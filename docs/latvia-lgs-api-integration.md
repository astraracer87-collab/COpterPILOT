# Lettland (LV) – API-Analyse & Integrationsauftrag

Übergabe-Dokument zu Lettlands UAS-Geozonen (LGS / SJSC „Latvijas gaisa
satiksme", AIS Latvia). Stand: 2026-11-15. Freigabe liegt vor.

Quellen vom Product Owner: `m.airspace.lv/mob/map`, `ais.lgs.lv/page/UAS_geozones`.

---

## 1. Kurzfassung

- Lettland hat **zwei Einstiegspunkte**:
  1. **`ais.lgs.lv/page/UAS_geozones`** – Seite des lettischen AIS, die auf das
     **„Latvian AIXM 5.1 Web Portal"** verweist (AIM-Umgebung). Deutet auf
     einen **AIXM-5.1-/ED-269-Datensatz** hin.
  2. **`m.airspace.lv/mob/map`** – mobile **Angular-Karte** (AIRSPACE.LV) für
     Piloten.
- Beide sind **ohne Login** erreichbar (HTTP 200). Der konkrete
  maschinenlesbare Daten-Endpunkt (GeoJSON/AIXM/WFS) ließ sich statisch noch
  nicht sicher festnageln (Angular-Bundle lädt die API dynamisch).
- Lettland (LGS) ist ein bekannter **ED-269-Veröffentlicher** – es existiert
  mit hoher Wahrscheinlichkeit ein sauberer ED-269-Feed.

## 2. Offener Punkt (nächster Schritt)
1. **Aus dem Browser:** `m.airspace.lv/mob/map` öffnen → DevTools → Netzwerk →
   die Datenanfrage mit den Zonen (GeoJSON/WFS/JSON) kopieren. Damit baue ich
   den Abruf sofort.
2. **Bei LGS/AIS (`ais.lgs.lv`) erfragen:** den **ED-269-/AIXM-5.1-Export** der
   UAS-Geozonen (bevorzugt – passt auf die vorhandene ED-269-Pipeline).

## 3. Verifizierte Fakten
- `ais.lgs.lv/page/UAS_geozones` → Verweis auf „Latvian AIXM 5.1 Web Portal".
- `m.airspace.lv/mob/map` → Angular-App (`main.*.js`, `runtime.*.js`), AIRSPACE.LV.
- Keine Authentifizierung auf den Einstiegsseiten.

## 4. Integration (sobald Endpoint vorliegt)
- Bei ED-269: wie AT/PT (`finalize(raw,"lv")`). Bei AIXM 5.1: Parser nötig
  (XML → internes Modell) oder, falls die Mobile-App GeoJSON nutzt, direkt das.
- `"lv"` in die Länderliste. Label `LV: "LGS / AIS Latvia (ED-269/AIXM)"`.
  Refresh täglich.

> **Stand:** Zwei öffentliche Einstiegspunkte verifiziert; der exakte
> Daten-Endpunkt fehlt noch (Browser-Capture oder ED-269/AIXM von LGS).
