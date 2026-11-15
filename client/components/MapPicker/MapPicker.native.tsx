import { LEAFLET_CSS, LEAFLET_JS } from "@/lib/leafletBundle";
import { RC_LEAFLET_JS, RC_WEBVIEW_FILE_PROPS, useRcLeaflet } from "@/lib/leafletRc";
import { openLink } from "@/lib/webBrowser";
import React, { forwardRef, useImperativeHandle, useRef, useState, useMemo, useCallback, useEffect } from "react";
import { StyleSheet, View, Platform, useColorScheme, Pressable, Text, Linking } from "react-native";
import { Feather } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import * as WebBrowser from "@/lib/webBrowser";
import * as Location from "@/lib/location";
import type { Region } from "@/components/maps";
import {
  getAllLayerNames,
  getViewportCountries,
  getCountryGeozoneConfig,
  buildGeozoneCacheTileUrl,
  buildGeozoneTileUrls,
  getGeozoneTileAttribution,
  hasGeozoneTileOverlay,
  buildVectorGeozoneTileUrl,
  queryEd269CachedFeaturesWithStatus,
  GEOZONE_TILE_MIN_ZOOM,
  loadMapStyle,
  saveMapStyle,
  type GeozoneFeatureInfo,
  type MapStyleOption,
} from "@/lib/geozones";
import { getVectorMinZoom, loadsFullCountryVectorZones, isRasterTiledVectorCountry, GEOZONE_VECTOR_MAX_RADIUS_KM, GEOZONE_VECTOR_MAX_FEATURES } from "@/lib/geozoneZoom";
import { simplifyRingGroup, smoothRingGroup } from "@/lib/ringSimplify";
import { geozoneTruncationHint } from "../../../shared/checks/builders";
import { isZoneActiveInContext } from "@/lib/ed269";
import { collapseStackedTempZonesForMap } from "../../../shared/geozoneTemporary";
import { findNearbyCtrAirports, CTR_AIRPORTS } from "@/lib/ctrData";
import { getCtrBandRings, getCtrLegendEntries, getCtrProvisionalNote } from "@/lib/ctrAltitude";
import CtrInfoCard from "@/components/CtrInfoCard";
import { splitCountriesByAccess, countryName } from "../../../shared/countryEntitlements";
import { zoneMapColors } from "../../../shared/dipulLayerStyles";
import type {
  EnergyFacility100mPoint,
  GermanEnergyInfrastructureItem,
} from "../../../shared/germanEnergyInfrastructure";
import { useAuth } from "@/lib/auth";
import { supplementalInfrastructureAsGeozones, infrastructureMapGeometry } from "@/lib/energyInfrastructureZones";
import { useTiledGeozoneIsos } from "@/lib/geozoneTiles/useTiledGeozones";
import { isGeozoneSourceEnabled, usageIsoOf } from "@/lib/countryUsage";
import { useCountryUsageMap } from "@/lib/useCountryUsage";
import { DisabledCountryPopup, disabledCountryAt, tapToScreen, type DisabledCountryTap } from "@/components/maps/DisabledCountriesHint";

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Web-Mercator-Zoomstufe aus der Region-latitudeDelta ableiten.
function zoomFromRegion(latitudeDelta: number): number {
  if (!(latitudeDelta > 0)) return 12;
  const z = Math.round(Math.log2(360 / latitudeDelta));
  return Math.max(3, Math.min(19, z));
}

// Liefert die Ringe einer Geozone als Polygon-Gruppen ([Außenring, …Löcher]).
// Bevorzugt polygonGroups (erhält Donut-Löcher); fällt sonst auf die flache
// polygonRings-Liste zurück, wobei jeder Ring ein eigenes lochfreies Polygon wird.
function ringGroupsForZone(z: GeozoneFeatureInfo): [number, number][][][] {
  if (z.polygonGroups && z.polygonGroups.length > 0) return z.polygonGroups;
  return (z.polygonRings ?? []).map((ring) => [ring]);
}

type MapStyle = "standard" | "osm" | "satellite" | "hybrid" | "grayscale";

interface MapLocation {
  latitude: number;
  longitude: number;
}

interface MapPickerProps {
  initialRegion?: Region;
  selectedLocation?: MapLocation | null;
  locationName?: string;
  onMapPress?: (latitude: number, longitude: number) => void;
  onMapLongPress?: (latitude: number, longitude: number) => void;
  onRegionChangeComplete?: (region: Region) => void;
  style?: any;
  radiusMeters?: number;
  radiusStrokeColor?: string;
  radiusFillColor?: string;
  geozoneLayers?: string[];
  /** ISO des Landes, dessen WMS-Layer in `geozoneLayers` stecken — bestimmt
   *  den serverseitigen Cache-Endpoint (Standard: DE). */
  countryIso?: string;
  /** Wenn true und keine `geozoneLayers` übergeben sind, werden alle Länder-
   *  Geozonen (WMS DE/CH/LU/NL/FR + Vektor AT/BE/DK) des sichtbaren Bereichs als
   *  Overlay gerendert — für die Planungs-Karte, damit der Nutzer keine
   *  Vorauswahl treffen muss. */
  allCountriesGeozones?: boolean;
  showCenterPin?: boolean;
  hideMarker?: boolean;
  showMapStyleSwitcher?: boolean;
  /** Zeichnet die vorläufigen Innen-/Außenbereich-Höhenbänder (CTR) als
   *  konzentrische Ringe um nahe Flughafen-Referenzen. */
  showCtrBands?: boolean;
  /** MaStR/OSM-Windanlagen mit 100-m-Prüfkreis für Deutschland. */
  windFacilityPoints?: EnergyFacility100mPoint[];
  /** Nur nach erfolgreichem Abgleich bestätigte Zusatzanlagen. */
  energyInfrastructureItems?: GermanEnergyInfrastructureItem[];
  routeWaypoints?: MapLocation[];
  onWaypointPress?: (index: number) => void;
  onWaypointDragEnd?: (index: number, latitude: number, longitude: number) => void;
}

export interface MapPickerRef {
  animateToRegion: (region: Region, duration?: number) => void;
}

const MAP_STYLE_OPTIONS: { id: MapStyle; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "osm", label: "OSM" },
  { id: "satellite", label: "Satellit" },
  { id: "hybrid", label: "Hybrid" },
  { id: "grayscale", label: "Graustufen" },
];

// Roter Karten-Pin (entspricht dem nativen Standort-Marker). Kein Text.
const PIN_SVG =
  "<svg width='32' height='40' viewBox='0 0 24 30'><path d='M12 0C6.48 0 2 4.48 2 10c0 7 10 20 10 20s10-13 10-20C22 4.48 17.52 0 12 0z' fill='#FF3B30' stroke='#FFFFFF' stroke-width='1.5'/><circle cx='12' cy='10' r='3.5' fill='#FFFFFF'/></svg>";

const MAP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>${LEAFLET_CSS}</style>
<script>${LEAFLET_JS}</script>
<script>${RC_LEAFLET_JS}</script>
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #E8ECF2; }
  #map { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  .leaflet-container { outline: none; }
  .wpdot { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 11px; color: #fff; font-size: 11px; font-weight: 800; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
  .basemap-grayscale .leaflet-tile { filter: grayscale(1) contrast(1.04) brightness(1.03); }
  .ctrpin { background: rgba(20,30,48,0.85); color: #fff; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.6); white-space: nowrap; }
</style>
</head>
<body>
<div id="map"></div>
<script>
(function(){
  function post(o){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(m){ return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[m]; }); }

  var map = L.map("map", { zoomControl: false, attributionControl: true, zoomSnap: 1, fadeAnimation: false, maxZoom: 19, minZoom: 3 }).setView([51, 10], 6);
  window.__rcMap = map;

  // ---- Basis-Ebene (Standard / OSM / Satellit / Hybrid) ----
  var baseLayer = null, labelLayer = null, baseKey = "";
  function setBase(style, dark){
    var key = style + "|" + (dark ? 1 : 0);
    if (key === baseKey && baseLayer) return;
    baseKey = key;
    if (baseLayer) { map.removeLayer(baseLayer); baseLayer = null; }
    if (labelLayer) { map.removeLayer(labelLayer); labelLayer = null; }
    var url, labels = null;
    if (style === "satellite") {
      url = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
    } else if (style === "hybrid") {
      url = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
      labels = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
    } else if (style === "osm") {
      url = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    } else {
      url = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    }
    baseLayer = window.__rc.makeBase(style, url, {
      maxZoom: 19,
      keepBuffer: 1,
      updateWhenIdle: false,
      attribution: "&copy; OpenStreetMap-Mitwirkende",
      className: style === "grayscale" ? "basemap-grayscale" : "",
    });
    baseLayer.addTo(map);
    baseLayer.bringToBack();
    if (labels) {
      labelLayer = L.tileLayer(labels, { maxZoom: 19, keepBuffer: 1, updateWhenIdle: true, zIndex: 3 });
      labelLayer.addTo(map);
    }
  }

  // ---- Geozonen-Ebenen (serverseitig komponierte XYZ-Kacheln) ----
  // Inkrementelles Diffing pro Land-URL: beim Grenz-Panning ändert sich nur das
  // Länder-Set. Statt ALLE Ebenen abzureißen, behalten wir unveränderte
  // Länder-Kacheln bei und entfernen/ergänzen nur die Differenz.
  var geoLayers = {};  // url -> { layer, sig }
  function setGeo(arr){
    arr = arr || [];
    var next = {};
    for (var j = 0; j < arr.length; j++) next[arr[j].u] = arr[j];
    for (var url in geoLayers){
      if (!geoLayers.hasOwnProperty(url)) continue;
      if (!next[url] || geoLayers[url].sig !== JSON.stringify(next[url])){
        map.removeLayer(geoLayers[url].layer);
        delete geoLayers[url];
      }
    }
    for (var u in next){
      if (!next.hasOwnProperty(u) || geoLayers[u]) continue;
      var g = next[u];
      var tl = L.tileLayer(g.u, {
        opacity: g.p,
        minZoom: ` + String(GEOZONE_TILE_MIN_ZOOM) + `,
        maxZoom: 19,
        maxNativeZoom: g.mnz || 19,
        tileSize: 256,
        zIndex: 4,
        updateWhenIdle: true,
        keepBuffer: 1,
        attribution: g.a || ""
      });
      tl.addTo(map);
      geoLayers[u] = { layer: tl, sig: JSON.stringify(g) };
    }
  }

  // ---- Vektor-Geozonen (ED-269, z. B. AT/BE/DK) ----
  // Im Standortwähler reine Anzeige: nicht-interaktiv, damit ein Tap auf einer
  // Zone weiterhin den Standort auswählt (kein Popup-Abfangen).
  var vzLayer = L.layerGroup().addTo(map);
  var vzSig = "";
  var vzGen = 0;
  function setVz(arr){
    var sig = JSON.stringify(arr || []);
    if (sig === vzSig) return;
    vzSig = sig;
    vzLayer.clearLayers();
    if (!arr) return;
    // in Paketen zeichnen (je 150 Zonen, dazwischen abgeben): die Karte bleibt
    // bedienbar; ein neuer Stand bricht ein laufendes Zeichnen ab.
    var gen = ++vzGen, i0 = 0;
    function vzStep(){
    if (gen !== vzGen) return;
    var iEnd = Math.min(arr.length, i0 + 150);
    for (var i = i0; i < iEnd; i++){
      var z = arr[i];
      if (!z || !z.r) continue;
      for (var p=0; z.p && p<z.p.length; p++) {
        L.circleMarker(z.p[p], {radius:5,color:z.s,weight:2,fillColor:z.s,fillOpacity:0.4,interactive:false}).addTo(vzLayer);
      }
      for (var l=0; z.l && l<z.l.length; l++) {
        L.polyline(z.l[l], {color:z.s,weight:2,opacity:0.95,interactive:false}).addTo(vzLayer);
      }
      for (var k = 0; k < z.r.length; k++){
        var poly = z.r[k]; // [Aussenring, ...Loecher] -> Leaflet sticht Loecher aus
        if (poly && poly.length >= 1 && poly[0] && poly[0].length >= 3) {
          // z.i: zeitgesteuerte Zone, derzeit inaktiv -> abgeschwächt + fein gestrichelt.
          // z.t: temporäre Zone (Gültigkeitsfenster) -> kräftiger Strich-Punkt-Rand.
          L.polygon(poly, { color: z.s || "rgba(142,142,147,0.9)", opacity: z.i ? 0.45 : 0.95, weight: z.t && !z.i ? 3 : 2, dashArray: z.i ? "6 4" : (z.t ? "12 4 2 4" : null), fillColor: z.f || "rgba(142,142,147,0.18)", fillOpacity: z.i ? 0.3 : 1, interactive: false, smoothFactor: 0 }).addTo(vzLayer);
        }
      }
    }
    i0 = iEnd;
    if (i0 < arr.length) setTimeout(vzStep, 0);
    }
    vzStep();
  }

  // ---- Ausgewählter Standort (Pin) ----
  var selMarker = null;
  function setMarker(m){
    if (!m || m.length < 2) { if (selMarker) { map.removeLayer(selMarker); selMarker = null; } return; }
    if (selMarker) { selMarker.setLatLng([m[0], m[1]]); }
    else { selMarker = L.marker([m[0], m[1]], { interactive: false, icon: L.divIcon({ className: "", html: "` + PIN_SVG + `", iconSize: [32, 40], iconAnchor: [16, 38] }) }).addTo(map); }
  }

  // ---- Umkreis (weißer/schwarzer Halo + farbiger Ring) ----
  var radiusLayer = L.layerGroup().addTo(map);
  var radiusSig = "";
  function setRadius(rd){
    var sig = JSON.stringify(rd || null);
    if (sig === radiusSig) return;
    radiusSig = sig;
    radiusLayer.clearLayers();
    if (!rd || !rd.c || rd.c.length < 2 || !(rd.m > 0)) return;
    L.circle(rd.c, { radius: rd.m, color: rd.halo, weight: 6, opacity: 1, fill: false, interactive: false }).addTo(radiusLayer);
    L.circle(rd.c, { radius: rd.m, color: rd.s, weight: 3, opacity: 1, fillColor: rd.f, fillOpacity: 1, interactive: false }).addTo(radiusLayer);
  }

  // ---- Route (Polyline + ziehbare Wegpunkte) ----
  var routeLayer = L.layerGroup().addTo(map);
  var routeSig = "";
  function setRoute(rt){
    var sig = JSON.stringify(rt || null);
    if (sig === routeSig) return;
    routeSig = sig;
    routeLayer.clearLayers();
    if (!rt || !rt.pts || rt.pts.length === 0) return;
    if (rt.pts.length >= 2) {
      L.polyline(rt.pts, { color: "rgba(0,122,255,0.85)", weight: 3, interactive: false }).addTo(routeLayer);
    }
    for (var i = 0; i < rt.pts.length; i++){
      var p = rt.pts[i];
      var color = i === 0 ? "#34C759" : (i === rt.pts.length - 1 ? "#FF3B30" : "#007AFF");
      var html = "<div class='wpdot' style='background:" + color + "'>" + (i + 1) + "</div>";
      var mk = L.marker([p[0], p[1]], { draggable: !!rt.drag, icon: L.divIcon({ className: "", html: html, iconSize: [22, 22], iconAnchor: [11, 11] }) });
      mk.on("click", (function(idx){ return function(ev){ L.DomEvent.stopPropagation(ev); post({ type: "wpPress", i: idx }); }; })(i));
      if (rt.drag) mk.on("dragend", (function(idx){ return function(ev){ var ll = ev.target.getLatLng(); post({ type: "wpDrag", i: idx, lat: ll.lat, lon: ll.lng }); }; })(i));
      mk.addTo(routeLayer);
    }
  }

  // ---- CTR-Höhenband-Ringe (Innen-/Außenbereich, vorläufig) ----
  var ctrLayer = L.layerGroup().addTo(map);
  var ctrSig = "";
  function setCtr(arr){
    var sig = JSON.stringify(arr || []);
    if (sig === ctrSig) return;
    ctrSig = sig;
    ctrLayer.clearLayers();
    if (!arr) return;
    for (var i = 0; i < arr.length; i++){
      var a = arr[i];
      if (!a || a.lat == null || a.lon == null) continue;
      var onCtrTap = (function(icao){ return function(ev){ L.DomEvent.stopPropagation(ev); post({ type: "ctrPress", icao: icao }); }; })(a.icao);
      var rings = a.rings || [];
      for (var k = 0; k < rings.length; k++){
        var r = rings[k];
        if (!(r.radiusM > 0)) continue;
        L.circle([a.lat, a.lon], { radius: r.radiusM, color: r.strokeColor, weight: 1.5, opacity: r.strokeOpacity, fillColor: r.fillColor, fillOpacity: r.fillOpacity, interactive: true })
          .bindTooltip(esc(r.label) + " \u2014 vorl\u00e4ufig", { sticky: true })
          .on("click", onCtrTap)
          .addTo(ctrLayer);
      }
      L.marker([a.lat, a.lon], { icon: L.divIcon({ className: "", html: "<div class='ctrpin'>" + esc(a.icao) + "</div>", iconSize: [0, 0], iconAnchor: [0, 0] }) })
        .on("click", onCtrTap)
        .addTo(ctrLayer);
    }
  }

  // Wind-Prüfkreise und mit dem amtlichen Layer abgeglichene Ergänzungstreffer.
  var energyLayer = L.layerGroup().addTo(map);
  var energySig = "";
  function setEnergy(windBuffers, arr){
    var sig = JSON.stringify([windBuffers || [], arr || []]);
    if (sig === energySig) return;
    energySig = sig;
    energyLayer.clearLayers();
    for (var b = 0; windBuffers && b < windBuffers.length; b++){
      var buffer = windBuffers[b];
      if (!buffer || !Number.isFinite(buffer.latitude) || !Number.isFinite(buffer.longitude)) continue;
      var bufferDetails = "<b>" + esc(buffer.name || "Windkraftanlage") + "</b>" +
        "<br/>100-m-Prüfkreis" +
        "<br/>Quelle: " + esc(buffer.source || "unbekannt") +
        "<br/><span style='font-size:11px'>Näherung ab Anlagenpunkt; maßgeblich ist die Anlagenbegrenzung.</span>";
      L.circle([buffer.latitude, buffer.longitude], {
        radius: 100, color: "#D97706", weight: 2, opacity: 0.95,
        fillColor: "#F59E0B", fillOpacity: 0.16, interactive: true
      }).bindPopup(bufferDetails).addTo(energyLayer);
      L.circleMarker([buffer.latitude, buffer.longitude], {
        radius: 6, color: "#FFFFFF", weight: 2, fillColor: "#7B2CBF",
        fillOpacity: 1, interactive: true
      }).bindPopup(bufferDetails).addTo(energyLayer);
    }
    for (var i = 0; arr && i < arr.length; i++){
      var item = arr[i];
      if (!item || item.officialMatch !== "not_found" || !item.geometry) continue;
      var kind = item.kind === "wind_turbine" ? "Windkraftanlage" :
        item.kind === "power_line" ? "Stromleitung" : "Strommast";
      var details = "<b>" + esc(kind) + "</b>" +
        "<br/>Quelle: " + esc(item.source) +
        "<br/>Amtlicher Abgleich: Nicht gefunden";
      if (item.name) details += "<br/>" + esc(item.name);
      if (Number.isFinite(item.taggedHeightM)) details += "<br/>Höhe laut Quelle: " + esc(Math.round(item.taggedHeightM)) + " m";
      if (item.voltage) details += "<br/>Spannung: " + esc(item.voltage);
      if (item.geometry.type === "Point" && Array.isArray(item.geometry.coordinates) && item.geometry.coordinates.length >= 2){
        var lon = Number(item.geometry.coordinates[0]), lat = Number(item.geometry.coordinates[1]);
        if (Number.isFinite(lat) && Number.isFinite(lon)){
          L.circleMarker([lat, lon], {
            radius: 6, color: "#FFFFFF", weight: 1.5,
            fillColor: item.kind === "wind_turbine" ? "#7B2CBF" : "#C2410C",
            fillOpacity: 0.95
          }).bindPopup(details).addTo(energyLayer);
        }
      } else if (item.geometry.type === "LineString" && Array.isArray(item.geometry.coordinates)){
        var coords = item.geometry.coordinates
          .filter(function(p){ return Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])); })
          .map(function(p){ return [Number(p[1]), Number(p[0])]; });
        if (coords.length >= 2) {
          L.polyline(coords, { color: "#C2410C", weight: 4, opacity: 0.9, dashArray: "7 5" })
            .bindPopup(details).addTo(energyLayer);
        }
      }
    }
  }

  // ---- GPS-Standort des Geräts (blauer Punkt) ----
  var userMarker = null;
  function setUser(u){
    if (!u || u.length < 2) { if (userMarker) { map.removeLayer(userMarker); userMarker = null; } return; }
    if (userMarker) { userMarker.setLatLng([u[0], u[1]]); }
    else { userMarker = L.circleMarker([u[0], u[1]], { radius: 7, color: "#FFFFFF", weight: 2, fillColor: "#007AFF", fillOpacity: 1, interactive: false }).addTo(map); }
  }

  window.__setVz = function(arr){ try { setVz(arr || []); } catch (e) {} return true; };
  // ---- Zustand anwenden ----
  var lastFit = null;
  window.__apply = function(s){
    try {
      setBase(s.base, s.dark);
      setGeo(s.geo || []);
      // Vektorzonen kommen getrennt (window.__setVz), nur wenn sie sich ändern
      if (s.vz) setVz(s.vz);
      setMarker(s.marker);
      setRadius(s.radius);
      setRoute(s.route);
      setCtr(s.ctr || []);
      setEnergy(s.windBuffers || [], s.energy || []);
      setUser(s.user);
      if (s.fit !== lastFit) { lastFit = s.fit; map.setView(s.center, s.zoom, { animate: false }); }
    } catch (e) {}
  };
  window.__setView = function(lat, lon, zoom, animate){ try { map.setView([lat, lon], zoom, { animate: !!animate }); } catch (e) {} };

  // ---- Region/Interaktion zurückmelden ----
  function reportRegion(){
    try {
      var c = map.getCenter(), b = map.getBounds();
      post({ type: "region", lat: c.lat, lon: c.lng, latDelta: Math.abs(b.getNorth() - b.getSouth()), lonDelta: Math.abs(b.getEast() - b.getWest()), zoom: map.getZoom() });
    } catch (e) {}
  }
  map.on("moveend", reportRegion);
  map.on("zoomend", reportRegion);
  map.on("click", function(e){ post({ type: "mapPress", lat: e.latlng.lat, lon: e.latlng.lng }); });

  // Long-Press: contextmenu feuert in iOS WKWebView nicht zuverlaessig, daher
  // zusaetzlich eigene Touch-Erkennung. Beide Pfade ueber fireLongPress (debounced).
  var lastLp = 0;
  function fireLongPress(lat, lon){
    var now = Date.now();
    if (now - lastLp < 800) return;
    lastLp = now;
    post({ type: "longPress", lat: lat, lon: lon });
  }
  map.on("contextmenu", function(e){ fireLongPress(e.latlng.lat, e.latlng.lng); });

  (function(){
    var lpTimer = null, lpStart = null, lpMoved = false;
    var container = map.getContainer();
    function clearLp(){ if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } lpStart = null; lpMoved = false; }
    container.addEventListener("touchstart", function(ev){
      if (!ev.touches || ev.touches.length !== 1) { clearLp(); return; }
      if (ev.target && ev.target.closest && ev.target.closest(".leaflet-marker-icon")) { clearLp(); return; }
      var t = ev.touches[0];
      var rect = container.getBoundingClientRect();
      lpStart = { x: t.clientX, y: t.clientY, pt: L.point(t.clientX - rect.left, t.clientY - rect.top) };
      lpMoved = false;
      lpTimer = setTimeout(function(){
        if (lpStart && !lpMoved) {
          try { var ll = map.containerPointToLatLng(lpStart.pt); fireLongPress(ll.lat, ll.lng); } catch (e) {}
        }
        clearLp();
      }, 500);
    }, { passive: true });
    container.addEventListener("touchmove", function(ev){
      if (!lpStart || !ev.touches || !ev.touches.length) return;
      var t = ev.touches[0];
      if (Math.abs(t.clientX - lpStart.x) > 12 || Math.abs(t.clientY - lpStart.y) > 12) { lpMoved = true; clearLp(); }
    }, { passive: true });
    container.addEventListener("touchend", clearLp, { passive: true });
    container.addEventListener("touchcancel", clearLp, { passive: true });
  })();

  post({ type: "ready" });
})();
</script>
</body>
</html>`;

const MapPicker = forwardRef<MapPickerRef, MapPickerProps>(
  ({ initialRegion, selectedLocation, locationName, onMapPress, onMapLongPress, onRegionChangeComplete, style, radiusMeters, radiusStrokeColor, radiusFillColor, geozoneLayers, countryIso, allCountriesGeozones, showCenterPin, hideMarker, showMapStyleSwitcher = true, showCtrBands, windFacilityPoints = [], energyInfrastructureItems = [], routeWaypoints, onWaypointPress, onWaypointDragEnd }, ref) => {
    const webRef = useRef<WebView>(null);
    const colorScheme = useColorScheme();
    const isDark = colorScheme === "dark";
    const [ready, setReady] = useState(false);
    const [mapStyle, setMapStyle] = useState<MapStyle>("grayscale");
    const mapStyleChangedRef = useRef(false);
    const [legendOpen, setLegendOpen] = useState(true);
    const [selectedCtrIcao, setSelectedCtrIcao] = useState<string | null>(null);
    const [settledRegion, setSettledRegion] = useState<Region | null>(null);
    const settledRegionRef = useRef<Region | null>(null);
    settledRegionRef.current = settledRegion;
    const [pickerSize, setPickerSize] = useState({ width: 0, height: 0 });
    const pickerSizeRef = useRef(pickerSize);
    pickerSizeRef.current = pickerSize;
    const [disabledTap, setDisabledTap] = useState<DisabledCountryTap | null>(null);
    const [settledZoom, setSettledZoom] = useState<number | null>(null);
    const [deviceLocation, setDeviceLocation] = useState<[number, number] | null>(null);
    const ctrLegend = useMemo(() => getCtrLegendEntries(), []);

    const changeMapStyle = useCallback((next: MapStyle) => {
      mapStyleChangedRef.current = true;
      setMapStyle(next);
      void saveMapStyle(next === "hybrid" ? "satellite" : next as MapStyleOption);
    }, []);

    useEffect(() => {
      let active = true;
      loadMapStyle()
        .then((saved) => {
          if (active && !mapStyleChangedRef.current) setMapStyle(saved);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, []);

    const onCtrPress = useCallback((icao: string) => {
      setSelectedCtrIcao((prev) => (prev === icao ? null : icao));
    }, []);

    const selectedCtr = useMemo(
      () => (selectedCtrIcao ? CTR_AIRPORTS.find((a) => a.icao === selectedCtrIcao) ?? null : null),
      [selectedCtrIcao],
    );

    const runJs = useCallback((js: string) => {
      webRef.current?.injectJavaScript(`${js};true;`);
    }, []);

    const useViewportCountries = !!allCountriesGeozones && (!geozoneLayers || geozoneLayers.length === 0);

    // Sichtbarer Mittelpunkt/Zoom: nach der ersten Geste aus settledRegion,
    // davor aus initialRegion (damit das Overlay sofort beim Mount steht).
    const viewport = settledRegion ?? initialRegion ?? null;
    const viewZoom = settledZoom ?? (initialRegion ? zoomFromRegion(initialRegion.latitudeDelta) : 6);

    // RC: Länderkarten, Offline-Kacheln und Hindernisse
    useRcLeaflet(webRef, ready, viewport, viewZoom);

    const viewportCountries = useMemo(() => {
      if (!useViewportCountries || !viewport) return [] as string[];
      return getViewportCountries(viewport.latitude, viewport.longitude, viewport.latitudeDelta, viewport.longitudeDelta);
    }, [useViewportCountries, viewport?.latitude, viewport?.longitude, viewport?.latitudeDelta, viewport?.longitudeDelta]);

    // Länder-Freischaltung (Task #522): gesperrte Länder werden im Picker nicht
    // gerendert (kein Overlay), und ein Hinweis nennt sie. Quelle der Wahrheit
    // bleibt die Server-Prüfung; das hier steuert nur die Anzeige.
    const { entitlement } = useAuth();
    const candidateCountries = useMemo(
      () => (useViewportCountries ? viewportCountries : countryIso ? [countryIso] : []),
      [useViewportCountries, viewportCountries, countryIso],
    );
    // Länder-Nutzung „Aus“: kein Overlay, Hinweis mit „Land aktivieren (online)“
    const countryUsageMap = useCountryUsageMap();
    const { lockedSet, lockedNames } = useMemo(() => {
      const { locked } = splitCountriesByAccess(candidateCountries, entitlement);
      // LI folgt CH: ein Hinweis „Schweiz / Liechtenstein“
      const disabled = candidateCountries.filter((iso) => !isGeozoneSourceEnabled(iso));
      return {
        lockedSet: new Set([...locked, ...disabled]),
        lockedNames: locked.map((iso) => countryName(iso)),
        disabledIsos: [...new Set(disabled.map((iso) => usageIsoOf(iso)))],
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [candidateCountries, entitlement, countryUsageMap]);
    const visibleViewportCountries = useMemo(
      () => viewportCountries.filter((iso) => !lockedSet.has(iso)),
      [viewportCountries, lockedSet],
    );
    // RC-Version: keine serverseitigen Anlagen-Kacheln. Leitungen, Windräder und
    // Masten zeigt die Hindernis-Ebene (leafletRc.ts).

    // Deckkraft des WMS-Overlays je nach Basiskarte: über Standard kräftiger,
    // über OSM/Satellit/Hybrid leicht reduziert, damit der Untergrund durchscheint.
    const geoOpacity = mapStyle === "standard" ? 0.92 : isDark ? 0.6 : 0.85;

    // WMS-Kachel-Ebenen (eine pro Land — bündelt alle Layer; das WMS scheitert
    // ab ~28 Layern, deshalb serverseitig zu EINER Kachel kombiniert).
    // Länder mit Offline-Kachelspeicher (DE/FR/CZ): ab ihrer Vektor-Schwelle
    // Polygone aus dem Speicher statt WMS-Bild.
    const tiledIsos = useTiledGeozoneIsos();
    const tiledVectorKey = useMemo(
      () => [...tiledIsos].filter((iso) => viewZoom >= getVectorMinZoom(iso)).sort().join(","),
      [tiledIsos, viewZoom],
    );
    const geoTiles = useMemo(() => {
      const tiledNow = new Set(tiledVectorKey ? tiledVectorKey.split(",") : []);
      const wmsMnz = (iso?: string) => getCountryGeozoneConfig(iso).wmsMaxNativeZoom;
      if (useViewportCountries) {
        const wmsT = visibleViewportCountries
          .filter((iso) => !tiledNow.has(iso))
          .map((iso) => getCountryGeozoneConfig(iso))
          .filter((cfg) => hasGeozoneTileOverlay(cfg.iso))
          .map((cfg) => {
            const enabled = cfg.layers.filter((l) => l.defaultEnabled).map((l) => l.wmsLayer);
            const layerSet = enabled.length > 0 ? enabled : ([cfg.layers[0]?.wmsLayer].filter(Boolean) as string[]);
            return buildGeozoneTileUrls(layerSet, cfg.iso).map((u) => ({ u, p: geoOpacity, mnz: cfg.wmsMaxNativeZoom, a: getGeozoneTileAttribution(cfg.iso) }));
          })
          .flat()
          .filter((t) => !!t.u);
        // Vektor-Länder ohne WMS, die der Server zu PNG-Kacheln rasterisiert
        // (z. B. Belgien) — als reguläre Kachel-Ebene einbinden statt Vektor.
        const vecT = visibleViewportCountries
          .filter((iso) => isRasterTiledVectorCountry(iso))
          .map((iso) => ({ u: buildVectorGeozoneTileUrl(iso), p: geoOpacity, mnz: wmsMnz(iso) }))
          .filter((t) => !!t.u);
        return [...wmsT, ...vecT];
      }
      // Einzelland-Modus: gesperrtes Land bekommt kein Overlay.
      if (countryIso && lockedSet.has(countryIso)) return [];
      if (countryIso && tiledNow.has(getCountryGeozoneConfig(countryIso).iso)) return [];
      // Raster-Vektor-Land (z. B. Belgien): serverseitige PNG-Kachel.
      if (countryIso && isRasterTiledVectorCountry(countryIso)) {
        return [{ u: buildVectorGeozoneTileUrl(countryIso), p: geoOpacity, mnz: wmsMnz(countryIso) }];
      }
      if (geozoneLayers && geozoneLayers.length > 0) {
        return buildGeozoneTileUrls(geozoneLayers, countryIso).map((u) => ({ u, p: geoOpacity, mnz: wmsMnz(countryIso), a: getGeozoneTileAttribution(countryIso) }));
      }
      // Fallback: alle Layer des (Standard-)Landes in EINER Kachel (z. B. Wetter-Picker).
      return buildGeozoneTileUrls(getAllLayerNames(), countryIso).map((u) => ({ u, p: geoOpacity, mnz: wmsMnz(countryIso), a: getGeozoneTileAttribution(countryIso) }));
    }, [useViewportCountries, visibleViewportCountries, geozoneLayers, countryIso, geoOpacity, lockedSet, tiledVectorKey]);

    // Vektor-Länder (ED-269: AT/BE/DK …; Kachelspeicher: DE/FR/CZ), die im Overlay-Set liegen.
    const vectorCountries = useMemo(() => {
      const isVector = (iso: string) => getCountryGeozoneConfig(iso).featureInfoType === "ed269-cached" || tiledIsos.has(iso);
      if (useViewportCountries) {
        return visibleViewportCountries.filter(isVector);
      }
      if (countryIso && lockedSet.has(countryIso)) return [];
      if (geozoneLayers && geozoneLayers.length > 0) {
        const cfg = getCountryGeozoneConfig(countryIso);
        return isVector(cfg.iso) ? [cfg.iso] : [];
      }
      return [] as string[];
    }, [useViewportCountries, visibleViewportCountries, geozoneLayers, countryIso, lockedSet, tiledIsos]);

    // Pro-Land geladene Vektor-Zonen (ED-269). Lade-Effekt füllt die Ref und
    // erhöht den Versions-Zähler, damit das stateJson neu berechnet wird.
    const vzByIsoRef = useRef<Record<string, GeozoneFeatureInfo[]>>({});
    // Länder mit gekürzter Zonenliste (B7/S7: Hinweis statt stiller Kürzung).
    const vzTruncatedRef = useRef<Set<string>>(new Set());
    const [vzVersion, setVzVersion] = useState(0);

    useEffect(() => {
      if (!viewport) return;
      let cancelled = false;
      const active = vectorCountries.filter((iso) => viewZoom >= getVectorMinZoom(iso));

      // Zonen von Ländern entfernen, die nicht mehr aktiv sind.
      let changed = false;
      for (const iso of Object.keys(vzByIsoRef.current)) {
        if (!active.includes(iso)) {
          delete vzByIsoRef.current[iso];
          vzTruncatedRef.current.delete(iso);
          changed = true;
        }
      }
      if (changed) setVzVersion((v) => v + 1);
      if (active.length === 0) return;

      const halfLatKm = (viewport.latitudeDelta / 2) * 111;
      const radiusKm = Math.min(GEOZONE_VECTOR_MAX_RADIUS_KM, Math.max(5, halfLatKm));

      (async () => {
        for (const iso of active) {
          try {
            const r = await queryEd269CachedFeaturesWithStatus(
              viewport.latitude,
              viewport.longitude,
              radiusKm,
              iso,
              GEOZONE_VECTOR_MAX_FEATURES,
              loadsFullCountryVectorZones(iso),
              undefined,
              iso === "DE" && !useViewportCountries && geozoneLayers?.length ? { layers: geozoneLayers } : undefined,
            );
            if (cancelled) return;
            vzByIsoRef.current[iso] = r.zones;
            if (r.truncated) vzTruncatedRef.current.add(iso);
            else vzTruncatedRef.current.delete(iso);
            setVzVersion((v) => v + 1);
          } catch {
            // Vorherige Zonen dieses Landes beibehalten (kein Flackern bei Fehlern).
          }
        }
      })();

      return () => { cancelled = true; };
    }, [vectorCountries, viewport?.latitude, viewport?.longitude, viewport?.latitudeDelta, viewZoom]);

    const vzTruncated = useMemo(() => {
      void vzVersion;
      return vectorCountries.some((iso) => vzTruncatedRef.current.has(iso));
    }, [vzVersion, vectorCountries]);

    const vzPolys = useMemo(() => {
      void vzVersion;
      const out: { r: [number, number][][][]; p?: [number, number][]; l?: [number, number][][]; s: string; f: string; i?: 1; t?: 1 }[] = [];
      const nowDate = new Date();
      for (const iso of vectorCountries) {
        // Raster-Kachel-Land (z. B. Belgien): dauerhafte Zonen zeichnet die
        // serverseitige PNG-Kachel; hier nur temporäre Zonen als Vektor.
        const tiled = isRasterTiledVectorCountry(iso);
        // Gleiche Geometrie mehrerer temporärer Zonen (ES-NOTAM, mehrere
        // Zeiträume) nicht stapeln: aktive zeichnen, sonst eine abgeschwächt.
        const zones = collapseStackedTempZonesForMap(
          vzByIsoRef.current[iso] || [],
          (z) => z.validStartTs != null || z.validEndTs != null,
          (z) => isZoneActiveInContext(z, { kind: "now", now: nowDate }),
        );
        for (const z of zones) {
          // Kanonische Regel (shared ed269IsTemporary): temporär, sobald EIN
          // Zeitstempel gesetzt ist (Start ODER Ende) — muss zur serverseitigen
          // Kachel-Aussparung passen, sonst fehlen Teil-Gültigkeits-Zonen ganz.
          const isTemp = z.validStartTs != null || z.validEndTs != null;
          if (tiled && !isTemp) continue;
          const polys: [number, number][][][] = [];
          for (const group of ringGroupsForZone(z)) {
            // Wie die übrigen nativen Vektor-Pfade (TrafficMapView etc.) runde
            // Konturen glätten, damit AT-Zonen im Picker nicht eckig wirken.
            const poly = smoothRingGroup(simplifyRingGroup(group));
            if (poly.length > 0) polys.push(poly);
          }
          if (polys.length === 0) continue;
          out.push({
            r: polys,
            // Farbe nach Einstufung (Policy-Tabelle), auch für temporäre Zonen.
            s: zoneMapColors(z).stroke,
            f: zoneMapColors(z).fill,
            ...(isTemp ? { t: 1 as const } : {}),
            // Zeitgesteuerte Zone (Fenster/Schedule), die jetzt nicht aktiv ist
            // (Karten-Zeitbezug: jetzt).
            ...(isZoneActiveInContext(z, { kind: "now", now: nowDate }) ? {} : { i: 1 as const }),
          });
        }
      }
      if (countryIso !== "DE" && !lockedSet.has(countryIso ?? "")) {
        for (const zone of supplementalInfrastructureAsGeozones(countryIso, energyInfrastructureItems)) {
          const shape = infrastructureMapGeometry(zone.infrastructureGeometry);
          out.push({ r: shape.polygons, p: shape.points, l: shape.lines,
            s: zone.strokeColor!, f: zone.fillColor! });
        }
      }
      return out;
    }, [vectorCountries, vzVersion, countryIso, energyInfrastructureItems, lockedSet]);

    // Vorläufige CTR-Innen-/Außenbereich-Bänder um nahe Flughafen-Referenzen.
    const ctrBandAirports = useMemo(() => {
      if (!showCtrBands) return [] as { icao: string; name: string; lat: number; lon: number; provisional: boolean; maxHeightAglM: number; rings: { radiusM: number; strokeColor: string; fillColor: string; fillOpacity: number; strokeOpacity: number; label: string }[] }[];
      const center = selectedLocation
        ? { lat: selectedLocation.latitude, lon: selectedLocation.longitude }
        : viewport
          ? { lat: viewport.latitude, lon: viewport.longitude }
          : null;
      if (!center) return [];
      return findNearbyCtrAirports(center.lat, center.lon, 30)
        .filter((a) => !!a.avInfo)
        .slice(0, 4)
        .map((a) => {
          const rings = getCtrBandRings(a.avInfo!.heightSteps).map((r) => ({
            radiusM: r.radiusM,
            strokeColor: r.strokeColor,
            fillColor: r.fillColor,
            fillOpacity: r.fillOpacity,
            strokeOpacity: r.strokeOpacity,
            label: r.label,
          }));
          const maxHeightAglM = getCtrBandRings(a.avInfo!.heightSteps).reduce((m, r) => Math.max(m, r.maxHeightAglM), 0);
          return { icao: a.icao, name: a.name, lat: a.lat, lon: a.lon, provisional: a.avInfo!.geometryPerAip, maxHeightAglM, rings };
        });
    }, [showCtrBands, selectedLocation, viewport?.latitude, viewport?.longitude]);

    const showSelectedMarker = !hideMarker && !!selectedLocation && (!routeWaypoints || routeWaypoints.length === 0);

    const stateJson = useMemo(() => {
      const center: [number, number] = initialRegion
        ? [initialRegion.latitude, initialRegion.longitude]
        : [51, 10];
      const zoom = initialRegion ? zoomFromRegion(initialRegion.latitudeDelta) : 6;
      const state = {
        fit: 0,
        center,
        zoom,
        base: mapStyle,
        dark: isDark,
        geo: geoTiles,
        // vz getrennt per window.__setVz (nicht bei jedem Tipp/Positions-Update neu serialisieren)
        marker: showSelectedMarker && selectedLocation ? [selectedLocation.latitude, selectedLocation.longitude] : null,
        radius: selectedLocation && radiusMeters
          ? {
              c: [selectedLocation.latitude, selectedLocation.longitude] as [number, number],
              m: radiusMeters,
              s: radiusStrokeColor ?? "rgba(0, 122, 255, 1)",
              f: radiusFillColor ?? "rgba(0, 122, 255, 0.18)",
              halo: isDark ? "rgba(0, 0, 0, 0.9)" : "rgba(255, 255, 255, 0.95)",
            }
          : null,
        route: routeWaypoints && routeWaypoints.length > 0
          ? { pts: routeWaypoints.map((w) => [w.latitude, w.longitude] as [number, number]), drag: !!onWaypointDragEnd }
          : null,
        ctr: ctrBandAirports.map((a) => ({ icao: a.icao, name: a.name, lat: a.lat, lon: a.lon, rings: a.rings })),
        // Deutsche Anlagen werden als reguläre Zonenfläche in der Kachelebene
        // gezeigt, nicht zusätzlich als farbige Objekt-Pins.
        windBuffers: [],
        energy: [],
        user: deviceLocation,
      };
      return JSON.stringify(state);
    }, [initialRegion, mapStyle, isDark, geoTiles, showSelectedMarker, selectedLocation, radiusMeters, radiusStrokeColor, radiusFillColor, routeWaypoints, onWaypointDragEnd, ctrBandAirports, windFacilityPoints, energyInfrastructureItems, deviceLocation]);

    useEffect(() => {
      if (!ready) return;
      runJs(`window.__apply(${stateJson})`);
    }, [stateJson, ready, runJs]);

    // Vektorzonen nur bei Inhaltsänderung serialisieren und senden.
    const vzJson = useMemo(() => JSON.stringify(vzPolys), [vzPolys]);
    useEffect(() => {
      if (!ready) return;
      runJs(`window.__setVz(${vzJson})`);
    }, [vzJson, ready, runJs]);

    const pendingViewRef = useRef<string | null>(null);
    useImperativeHandle(ref, () => ({
      animateToRegion: (region: Region) => {
        const z = zoomFromRegion(region.latitudeDelta);
        const js = `window.__setView(${region.latitude},${region.longitude},${z},true)`;
        if (ready) runJs(js);
        else pendingViewRef.current = js;
      },
    }), [ready, runJs]);

    useEffect(() => {
      if (ready && pendingViewRef.current) {
        runJs(pendingViewRef.current);
        pendingViewRef.current = null;
      }
    }, [ready, runJs]);

    // GPS-Standort (showsUserLocation-Ersatz): nur anzeigen, wenn die Berechtigung
    // bereits erteilt ist — kein eigener Prompt aus dem Picker heraus.
    useEffect(() => {
      let sub: Location.LocationSubscription | null = null;
      let cancelled = false;
      (async () => {
        try {
          const perm = await Location.getForegroundPermissionsAsync();
          if (cancelled || !perm.granted) return;
          sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, distanceInterval: 25 },
            (loc) => setDeviceLocation([loc.coords.latitude, loc.coords.longitude]),
          );
        } catch {
          // Standort optional — bei Fehler einfach kein blauer Punkt.
        }
      })();
      return () => { cancelled = true; if (sub) sub.remove(); };
    }, []);

    const onMessage = useCallback((e: any) => {
      let msg: any;
      try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
      if (!msg || typeof msg.type !== "string") return;
      if (msg.type === "ready") { setReady(true); return; }
      if (msg.type === "region") {
        if (!isFinite(msg.lat) || !isFinite(msg.lon) || !(msg.latDelta > 0) || !(msg.lonDelta > 0)) return;
        const r: Region = { latitude: msg.lat, longitude: msg.lon, latitudeDelta: msg.latDelta, longitudeDelta: msg.lonDelta };
        setSettledRegion(r);
        setDisabledTap(null);
        setSettledZoom(typeof msg.zoom === "number" ? msg.zoom : zoomFromRegion(r.latitudeDelta));
        if (onRegionChangeComplete) onRegionChangeComplete(r);
        return;
      }
      if (msg.type === "mapPress") {
        if (!isFinite(msg.lat) || !isFinite(msg.lon)) return;
        const offIso = disabledCountryAt(msg.lat, msg.lon);
        const reg = settledRegionRef.current;
        setDisabledTap(offIso && reg ? { iso: offIso, ...tapToScreen(msg.lat, msg.lon, reg, pickerSizeRef.current) } : null);
        if (onMapPress) onMapPress(msg.lat, msg.lon);
        return;
      }
      if (msg.type === "longPress") { if (onMapLongPress && isFinite(msg.lat) && isFinite(msg.lon)) onMapLongPress(msg.lat, msg.lon); return; }
      if (msg.type === "ctrPress") { if (msg.icao) onCtrPress(msg.icao); return; }
      if (msg.type === "wpPress") { if (typeof msg.i === "number") onWaypointPress?.(msg.i); return; }
      if (msg.type === "wpDrag") { if (typeof msg.i === "number" && isFinite(msg.lat) && isFinite(msg.lon)) onWaypointDragEnd?.(msg.i, msg.lat, msg.lon); return; }
    }, [onRegionChangeComplete, onMapPress, onMapLongPress, onCtrPress, onWaypointPress, onWaypointDragEnd]);

    return (
      <View style={[styles.map, style]} onLayout={(e) => setPickerSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
        <WebView
          ref={webRef}
          source={{ html: MAP_HTML, baseUrl: "file:///" }}
          originWhitelist={["*"]}
          {...RC_WEBVIEW_FILE_PROPS}
          style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "#1A1F2E" : "#E8ECF2" }]}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={(req) => {
            const u = req?.url || "";
            if (/^(https?|mailto|tel):/i.test(u)) {
              if (/^https?:/i.test(u)) {
                WebBrowser.openBrowserAsync(u).catch(() => {});
              } else {
                openLink(u).catch(() => {});
              }
              return false;
            }
            return true;
          }}
          javaScriptEnabled
          domStorageEnabled
          scrollEnabled={false}
          overScrollMode="never"
          androidLayerType="hardware"
          setSupportMultipleWindows={false}
          automaticallyAdjustContentInsets={false}
          bounces={false}
          allowsInlineMediaPlayback
        />
        {showCenterPin ? (
          <View style={styles.centerPin} pointerEvents="none">
            <Feather name="map-pin" size={32} color="#FF3B30" />
          </View>
        ) : null}
        {lockedNames.length > 0 ? (
          <View
            style={lockedHintStyles.container}
            pointerEvents="none"
            testID="hint-locked-countries"
          >
            <Feather name="lock" size={13} color="#FFFFFF" />
            <Text style={lockedHintStyles.text}>
              {lockedNames.length === 1
                ? `${lockedNames[0]}: Land freischalten`
                : `Land freischalten: ${lockedNames.join(", ")}`}
            </Text>
          </View>
        ) : null}
        {/* Deaktivierte Länder: nur Popup nach Tipp ins Land, kein Dauer-Banner */}
        <DisabledCountryPopup tap={disabledTap} mapSize={pickerSize} onClose={() => setDisabledTap(null)} />
        {vzTruncated ? (
          <View
            style={[lockedHintStyles.container, { top: lockedNames.length > 0 ? 56 : 16 }]}
            pointerEvents="none"
            testID="hint-geozones-truncated"
          >
            <Feather name="zoom-in" size={13} color="#FFFFFF" />
            <Text style={lockedHintStyles.text}>{geozoneTruncationHint(GEOZONE_VECTOR_MAX_FEATURES)}</Text>
          </View>
        ) : null}
        {showMapStyleSwitcher ? (
          <View style={switchStyles.container}>
            {MAP_STYLE_OPTIONS.map((opt) => (
              <Pressable
                key={opt.id}
                style={[
                  switchStyles.segment,
                  mapStyle === opt.id ? switchStyles.segmentActive : undefined,
                ]}
                onPress={() => changeMapStyle(opt.id)}
              >
                <Text style={[
                  switchStyles.segmentLabel,
                  mapStyle === opt.id ? switchStyles.segmentLabelActive : undefined,
                ]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {showCtrBands && ctrBandAirports.length > 0 ? (
          <View style={legendStyles.container} pointerEvents="box-none">
            <Pressable
              style={legendStyles.header}
              onPress={() => setLegendOpen((v) => !v)}
              testID="button-ctr-legend-toggle"
            >
              <Feather
                name={legendOpen ? "chevron-down" : "chevron-up"}
                size={14}
                color="#FFFFFF"
              />
              <Text style={legendStyles.title}>{"CTR-H\u00f6henb\u00e4nder"}</Text>
            </Pressable>
            {legendOpen ? (
              <View style={legendStyles.body}>
                {ctrLegend.map((entry) => (
                  <View key={entry.label} style={legendStyles.row}>
                    <View
                      style={[
                        legendStyles.swatch,
                        {
                          borderColor: entry.strokeColor,
                          backgroundColor: hexToRgba(
                            entry.fillColor,
                            Math.max(entry.fillOpacity, 0.5),
                          ),
                        },
                      ]}
                    />
                    <Text style={legendStyles.label}>{entry.label}</Text>
                  </View>
                ))}
                <Text style={legendStyles.note}>{getCtrProvisionalNote()}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {selectedCtr ? (
          <CtrInfoCard ctr={selectedCtr} onClose={() => setSelectedCtrIcao(null)} />
        ) : null}
      </View>
    );
  }
);

MapPicker.displayName = "MapPicker";

const styles = StyleSheet.create({
  map: {
    flex: 1,
    overflow: "hidden",
  },
  centerPin: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginLeft: -16,
    marginTop: -32,
    zIndex: 10,
  },
});

const lockedHintStyles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 16,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(20, 30, 48, 0.92)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  text: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
});

const legendStyles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 10,
    right: 10,
    maxWidth: 220,
    backgroundColor: "rgba(20, 30, 48, 0.85)",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.25)",
    overflow: "hidden",
    zIndex: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  body: {
    paddingHorizontal: 10,
    paddingBottom: 9,
    gap: 5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 3,
    borderWidth: 1.5,
  },
  label: {
    color: "rgba(255, 255, 255, 0.92)",
    fontSize: 11,
    flexShrink: 1,
  },
  note: {
    color: "rgba(255, 255, 255, 0.65)",
    fontSize: 10,
    fontStyle: "italic",
    marginTop: 3,
  },
});

const switchStyles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 10,
    alignSelf: "center",
    flexDirection: "row",
    backgroundColor: "rgba(20, 30, 48, 0.82)",
    borderRadius: 20,
    padding: 3,
    zIndex: 15,
  },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 17,
  },
  segmentActive: {
    backgroundColor: "rgba(255, 255, 255, 0.22)",
  },
  segmentLabel: {
    color: "rgba(255, 255, 255, 0.55)",
    fontSize: 12,
    fontWeight: "600",
  },
  segmentLabelActive: {
    color: "#FFFFFF",
  },
});

export default MapPicker;
