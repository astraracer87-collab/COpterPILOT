# Anlagenabgleich Österreich und Dänemark

Recherche und öffentliche Dienstprüfung: **12.10.2026**.

## Ergebnis

**Keine Freischaltung eines Negativabgleichs.** Nationale amtliche Anlagenquellen existieren; die frühere österreichische Aussage „kein landesweiter offen nutzbarer Anlagenlayer bestätigt“ ist für Stromleitungen/Masten überholt. Ein **verlässlicher aktueller Vergleich mit der jeweiligen amtlichen Drohnenkarte** wurde aber für keinen der drei Anlagentypen bestätigt. `unknown` ist nicht `not_found`. Eine leere ED-269-Zonenliste belegt weder Anlagenfreiheit noch eine fehlende Anlage.

Die Quellen sind in der Länderregistry ausdrücklich `referenceOnly`, ohne Live-Statusschlüssel. `hasComparableOfficialAssetLayers=false`, die vergleichbaren Anlagentypen bleiben leer. Das bedeutet **kein eingerichteter verlässlicher Vergleich**, nicht „es gibt keine amtlichen Daten“. Ungeprüfte OSM-Objekte dürfen weiterhin als Recherchetreffer in der Quellenübersicht stehen, nicht als nachgewiesene Kartenlücken.

## Österreich

| Quelle | Zugang, Lizenz, Umfang | Vergleichsergebnis |
| --- | --- | --- |
| [BEV DLM-Bauten](https://www.bev.gv.at/Services/Produkte/Digitales-Landschaftsmodell/Bauten.html) | Landesweite Vektordaten, öffentlich angebotener GPKG-/SHP-Download. Die geprüften [Datensatzmetadaten, Stichtag 25.03.2025](https://data.bev.gv.at/geonetwork/srv/api/records/a1ba3e91-42a3-475a-915c-61c216705233) nennen ausdrücklich CC BY 4.0 und keine Zugangsbeschränkung. Die kostenpflichtigen Altprodukt-Preise auf der Produktseite sind kein Beleg gegen den offenen Download. | Nationaler Kandidat für Leitungen und Strommasten, **kein bestätigter Dronespace-Anlagenlayer**. Downloadlinks/Metadaten geprüft, kein vollständiger aktueller Datensatzimport und kein Nachweis der Kartenidentität. |
| [BEV DLM-Datenbeschreibung](https://www.bev.gv.at/dam/jcr:4ae9a9d6-82b9-4b9e-a9f4-cde85a84f2c8/Datenbeschreibung_gpkg_DLM_2000_BAUTEN.pdf) | `BAU_2700_STROMLEITUNG_L`, `BAU_2800_STROMMAST_P`; Lagebezug u. a. EPSG:31255, nicht WGS84. Produktangabe ±3 m Standardabweichung, Fortführung je Objektart jährlich/3-jährig. | Der Umfang einzelner Objektklassen, Erfassungsregeln und Objektalter müssen geprüft werden. Die aufgeführten Klassen bestätigen kein vollständiges nationales Windturbinenregister. „Bauten“ nicht mit dem separaten Gebäudeprodukt „Bauwerke“ verwechseln. |
| [Netz NÖ INSPIRE](https://geoportal.inspire.gv.at/metadatensuche/inspire/api/records/ab5bc2de-ec2d-400c-abd7-d326d6a97b0c) | Regionales Versorgungsnetz, beschränkter Zugang; vorhandene Registry dokumentiert Metadatenrevision 13.11.2025. | Keine nationale Vergleichsbasis. |
| [APG Netzkarte](https://www.apg.at/stromnetz/stromnetz-oesterreich) | Öffentliches Netzbild für 110/220/380 kV, kein bestätigter offener vollständiger Vektorfeed; vorhandene Registry dokumentiert PNG-Stand 03/2025. | Bild/Übertragungsnetz ersetzt weder Mastpunkte noch vollständige nationale Leitungsgeometrien. |
| [JAO Core Static Grid Model](https://www.jao.eu/static-grid-model) | Multinationales Netzmodell, keine bestätigte offene nationale Anlagengeometrie; vorhandene Registry führt Q1 2026. | Kein belastbarer Kartenabgleich. |

Der [öffentliche Dronespace-ED-269-Export](https://utm.dronespace.at/avm/utm/uas.geojson) war abrufbar (284 Features). Er enthält geografische UAS-Gebiete, nicht ein dokumentiertes Inventar der drei Anlagentypen. Eine Suche nach Windkraft/Stromleitung/Strommast ergab keine passenden Angaben; dieser Textbefund ist **kein Vollständigkeitsnachweis** und berechtigt nicht zu `not_found`. Auch eine Windpotenzialkarte oder regionale Windparkliste ist kein vollständiges Register einzelner gebauter Turbinen.

## Dänemark

| Quelle | Zugang, Lizenz, Umfang | Vergleichsergebnis |
| --- | --- | --- |
| [GeoDanmark Produkt und Qualität](https://dataforsyningen.dk/data/3563) / [Fildownload](https://datafordeler.dk/dataoversigt/geodanmark-vektor/geodanmark-vektor-fildownload) | Nationales amtliches topografisches Inventar. Objektliste enthält `Vindmoelle`, `Hoejspaendingsledning`, `Mast` sowie separat `Telemast`. [CC BY 4.0 mit Quellenverweis](https://www.geodanmark.dk/brugeradgang/vilkaar-for-data-anvendelse/). Aktueller Download erfordert registrierten Benutzer, IT-System und API-key/OAuth. | Gute nationale Kandidaten, aber ohne Zugang kein vollständiger Abruf bestätigt. Hochspannungsleitungen sind nicht automatisch mit allen OSM `power=line`, `minor_line`, Kabeln oder sämtlichen Mastarten vergleichbar. |
| [Dronezoner Infrastrukturdienst](https://services-eu1.arcgis.com/Zvx25KS6sGRl9LIx/arcgis/rest/services/DRONEZONER_Infrastruktur_WFL1/FeatureServer?f=pjson) | Öffentlicher Query-Dienst, `hasStaticData=true`; Beschreibung „Opdateret 2024 09 22“. Tatsächliche Layer: Straßen (4), Bahn (5), Windturbinen (2). Stromleitungen und Masten werden in der Beschreibung lediglich für später angekündigt. | **Nicht** als vorhandene Stromleitungs-/Mastabdeckung behandeln. |
| [Windturbines_DK Layer 2](https://services-eu1.arcgis.com/Zvx25KS6sGRl9LIx/arcgis/rest/services/DRONEZONER_Infrastruktur_WFL1/FeatureServer/2?f=pjson) | Punktgeometrien, `dataLastEditDate=1726999429437` (22.09.2024), leeres `copyrightText`; zugehöriges ArcGIS-Item hat leeres `licenseInfo`. Dienstlimit 2.000 Datensätze. | Kartenidentität belegt: Die [amtliche Webkarten-Konfiguration](https://trafikstyrelsen.maps.arcgis.com/sharing/rest/content/items/4d73b79535104a509575e50cd7b30244/data?f=pjson) verwendet exakt diesen Layer als „Windturbines DK“ (standardmäßig aus). **Aktuelle Vollständigkeit und Wiederverwendungsfreigabe nicht bestätigt.** Deshalb kein verlässlicher Negativabgleich gegen neue OSM-Anlagen. |
| [Energistyrelsen Register](https://ens.dk/en/analyses-and-statistics/overview-energy-sector) | Nationale stromerzeugende Windanlagen **>6 kW**, aktive/abgebaute Anlagen separat, Koordinaten gemischter Herkunft. Seite nennt monatliche Aktualisierung mit Verzögerung, verlinkt jedoch öffentliche Excel-Dateien mit Stand Januar 2022 und warnt vor unvollständigen/ungenauen Daten. Keine eindeutige Dateilizenz bestätigt. | Register nicht mit einem aktuellen vollständigen Drohnenkartenlayer gleichsetzen; kleine Anlagen, Stilllegungen und veraltete Meldungen verhindern pauschale Abwesenheitsbeweise. |
| [KDS Vindkraftanlæg](https://dataforsyningen.dk/data/3814) | In der vorhandenen Registry dokumentierter WMS-/GPKG-Kandidat mit Anmeldung/Token. | WMS-Bild bzw. punktueller GetFeatureInfo-Treffer ist keine vollständig abgerufene Vergleichsmenge. |

GeoDanmark nennt UTM32/ETRS89, DVR90 und undefinierte Z-Werte `-999`. Die allgemeine Z-Koordinate darf nicht ohne Fachnachweis als Anlagenhöhe über Grund übernommen werden. Jährliche Luftbilder bedeuten nicht jährliche Vollfortführung aller Anlagen: dokumentiert ist eine Gesamtfortführung jeweils einer Region pro Jahr, somit ein 5-Jahreszyklus landesweit.

Der separate [Trafikstyrelsen-Zonenexport](https://trafikstyrelsen.maps.arcgis.com/sharing/rest/content/items/980697acd04d4a9bb1fd34bbefab924a?f=pjson) war öffentlich und tagesaktuell; seine Freigabe „Data kan frit anvendes med kildeangivelse“ gilt für **dieses Zonenprodukt**, nicht automatisch für den alten Windturbinenlayer. Zonenaktualität und Anlagenaktualität sind getrennt.

## Bedingungen vor einer späteren Freischaltung

1. Wiederverwendung und tatsächlichen Zugang klären; keine fremden Zugangsdaten aus Kartenanwendungen übernehmen.
2. Nationale fachliche Erfassungskriterien, gültige Objektarten, Spannungsschwellen, Bau-/Stilllegungsstatus und Grenzen prüfen. Nicht dokumentierte OSM-Unterarten bleiben `unknown`.
3. Identität oder nachgewiesene Vergleichbarkeit zum amtlichen Anlagenlayer dokumentieren. Inventar-Abgleich und Aussage über eine rechtliche UAS-Zone getrennt halten.
4. Vollständigen räumlichen Abruf einschließlich Randpuffer/Paginierung, korrekter Projektion und belastbarem Datenstand bestätigen. Dienstfehler, Teilantworten, alte Daten und unbekannte Abdeckung liefern **niemals** `not_found`. Für ArcGIS insbesondere `exceededTransferLimit` und die 2.000er-Grenze beachten.
5. Positive Matches unterdrücken, Quellendubletten räumlich zusammenführen; nur verifizierte fehlende Anlagen über die bestehenden gemeinsamen Geozonenadapter darstellen. Keine deutschen §21h-Regeln oder erfundenen 100-m-Zonen im Ausland.

## Bestehende Sicherheits- und Zugriffspfade

- `server/germanEnergyInfrastructure.ts`: AT/DK haben keine integrierten Vergleichsfeeds. Ohne freigegebene `comparableOfficialAssetKinds` bleiben OSM-Treffer ausdrücklich `unknown`, auch bei erfolgreicher OSM-Abfrage.
- `shared/germanEnergyInfrastructure.ts`: Radar verlangt `not_found` **und** `available` für den anlagentypbezogenen Vergleichsdienst; fehlende Statusschlüssel lassen keine Treffer durch.
- `client/lib/energyInfrastructureZones.ts` und `web/src/lib/energyInfrastructureLayer.ts`: gemeinsame Geozonendarstellung, keine neue Pin-/Warnungsdarstellung. `matched`/`unknown` gelangen nicht in ausländische Ergänzungszonen.
- `server/proxy.ts`: authentifizierte Route `/api/proxy/german-energy-infrastructure`; Länderfreigabe vor Abfrage, Koordinaten/Land müssen übereinstimmen. Die vorhandenen nativen/Web-Karten beachten ebenfalls Länderzugriff, aktivierte Ebene und Mindestzoom.
- Keine neuen API-Routen, Datenimporte, Berechtigungen oder Änderung der Sperren. Offline-Regressionen prüfen AT/DK für alle drei Anlagentypen, Statusausfälle, ausgeblendete positive Matches sowie Quellendubletten im gemeinsamen Adapter. Externe Verfügbarkeit ist ein Recherchebefund, kein dauerhaftes Betriebsversprechen.
