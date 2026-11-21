import { openLink } from "@/lib/webBrowser";
import React, { useMemo } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from "react-native";
import MapView, { Marker, Polyline } from "@/components/maps";
import { Feather } from "@expo/vector-icons";
import { Card } from "@/components/Card";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { find21hRuleForLayer } from "@/lib/storage";
import { useGermanEnergyInfrastructure } from "@/lib/useGermanEnergyInfrastructure";
import type {
  GermanEnergyInfrastructureItem,
  InfrastructureSourceStatus,
} from "../../shared/germanEnergyInfrastructure";
import {
  getEnergyInfrastructureCountry,
  hasIncompleteEnergyInfrastructureSources,
} from "../../shared/germanEnergyInfrastructure";

type Props = {
  countryIso: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
};

function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function safeWebsiteHref(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function openPublicLink(url: string): void {
  void openLink(url).catch(() =>
    Alert.alert("Link konnte nicht geöffnet werden", "Öffne die Kontaktdaten bitte manuell."),
  );
}

function sourceStatusLabel(source: InfrastructureSourceStatus): string {
  switch (source.status) {
    case "available": return "geladen";
    case "stale": return "älterer Cache";
    case "partial": return "teilweise";
    default: return "nicht erreichbar";
  }
}

function itemKindLabel(item: GermanEnergyInfrastructureItem): string {
  switch (item.kind) {
    case "wind_turbine": return "Windkraftanlage";
    case "power_line": return "Stromleitung";
    case "power_mast": return "Strommast";
  }
}

function matchLabel(
  item: GermanEnergyInfrastructureItem,
  country: NonNullable<ReturnType<typeof getEnergyInfrastructureCountry>>,
): string {
  if (item.source === "RIVM" || item.source === "BFE" || item.source === "ACT" ||
    item.source === "IGN" || item.source === "NGI") {
    return "Amtlicher Anlagendatensatz; Flugbeschränkung nicht abgeglichen";
  }
  const source = country.assetComparisonSourceByKind?.[item.kind] ??
    country.officialGeozoneSource.label;
  if (item.officialMatch === "not_found") return `Nicht in ${source} bestätigt – Zusatzdaten`;
  if (item.officialMatch === "unknown") {
    return country.comparableOfficialAssetKinds.includes(item.kind)
      ? `Kein sicherer Abgleich mit ${source} möglich`
      : "Für diesen Anlagentyp ist kein amtlicher Vergleichsdatensatz eingebunden";
  }
  return item.kind === "power_mast"
    ? `${source}-Stromleitung in der Nähe`
    : `${source}-Treffer in der Nähe`;
}

type MapCoordinate = { latitude: number; longitude: number };

function pointCoordinate(item: GermanEnergyInfrastructureItem): MapCoordinate | null {
  if (item.geometry.type !== "Point" || !Array.isArray(item.geometry.coordinates)) return null;
  const [longitude, latitude] = item.geometry.coordinates;
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude: Number(latitude), longitude: Number(longitude) }
    : null;
}

function lineCoordinateParts(item: GermanEnergyInfrastructureItem): MapCoordinate[][] {
  if (!["LineString", "MultiLineString"].includes(item.geometry.type) ||
    !Array.isArray(item.geometry.coordinates)) return [];
  const lines = item.geometry.type === "LineString"
    ? [item.geometry.coordinates]
    : item.geometry.coordinates;
  return lines
    .filter(Array.isArray)
    .map((line) => line
      .filter((position): position is [number, number] =>
        Array.isArray(position) &&
        Number.isFinite(position[0]) &&
        Number.isFinite(position[1]),
      )
      .map(([longitude, latitude]) => ({ latitude, longitude })))
    .filter((line) => line.length > 1);
}

/** Max. native Punkt-Marker auf der Karte (RC Pro 2: wenig RAM) – die nächsten zuerst. */
export const MAX_ENERGY_MAP_MARKERS = 150;

export function GermanEnergyInfrastructurePanel({ countryIso, latitude, longitude, radiusKm }: Props) {
  const { theme } = useTheme();
  const searchRadiusKm = Math.min(5, Math.max(0.5, radiusKm));
  const { data, isLoading, error } = useGermanEnergyInfrastructure(
    latitude,
    longitude,
    searchRadiusKm,
    countryIso,
  );
  const country = data?.country ?? getEnergyInfrastructureCountry(countryIso);
  const officialSourceLabel =
    country?.assetComparisonSourceLabel ??
    country?.officialGeozoneSource.label ??
    "amtliche Geozonen";
  const rule = countryIso === "DE"
    ? find21hRuleForLayer("Windkraftanlagen") ?? find21hRuleForLayer("Stromleitungen")
    : null;
  const visibleItems = data?.features.slice(0, 10) ?? [];
  // Karte: Leitungen vollständig, Punkt-Marker (Windräder, Masten) auf die
  // nächsten MAX_ENERGY_MAP_MARKERS begrenzt – Tausende native Marker bringen
  // die RC an die Speichergrenze.
  const { mapFeatures, hiddenMarkerCount } = useMemo(() => {
    const features = data?.features ?? [];
    const lines = features.filter((f) => f.kind === "power_line");
    const points = features
      .filter((f) => f.kind !== "power_line" && pointCoordinate(f) != null)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
    return {
      mapFeatures: [...lines, ...points.slice(0, MAX_ENERGY_MAP_MARKERS)],
      hiddenMarkerCount: Math.max(0, points.length - MAX_ENERGY_MAP_MARKERS),
    };
  }, [data]);
  const foundCount =
    (data?.counts.windTurbines ?? 0) +
    (data?.counts.powerLines ?? 0) +
    (data?.counts.powerMasts ?? 0);
  const omittedCount = Math.max(0, foundCount - visibleItems.length);
  const sourcesIncomplete = data
    ? !!error || hasIncompleteEnergyInfrastructureSources(data)
    : false;

  return (
    <Card
      style={[
        styles.card,
        { borderColor: theme.statusCaution, backgroundColor: theme.statusCautionBackground },
      ]}
      testID="german-energy-infrastructure"
    >
      <View style={styles.titleRow}>
        <Feather name="zap" size={17} color={theme.statusCaution} />
        <ThemedText style={[styles.title, { color: theme.text }]}>
          Zusätzliche Anlagen in {data?.country.name ?? countryIso}
        </ThemedText>
      </View>
      <ThemedText style={[styles.summary, { color: theme.textSecondary }]}>
        Öffentliche Anlagenregister und ergänzende Kartendaten für
        Windkraftanlagen, Stromleitungen und Masten im Umkreis von{" "}
        {searchRadiusKm.toFixed(searchRadiusKm % 1 ? 1 : 0)} km. Quellen:{" "}
        {data?.country.dataSources
          .filter((source) => !source.referenceOnly)
          .map((source) => source.label)
          .join(" und ") ?? "OpenStreetMap"}
        .
      </ThemedText>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={theme.primary} />
          <ThemedText style={[styles.muted, { color: theme.textSecondary }]}>
            Anlagenquellen und {officialSourceLabel} werden abgefragt …
          </ThemedText>
        </View>
      ) : error && !data ? (
        <ThemedText style={[styles.warning, { color: theme.statusCaution }]}>
          Zusatzdaten konnten nicht geladen werden. Daraus lässt sich nicht schließen, dass keine Anlagen vorhanden sind.
        </ThemedText>
      ) : data ? (
        <>
          {error ? (
            <ThemedText style={[styles.warning, { color: theme.statusCaution }]}>
              Die Zusatzquellen konnten nicht aktualisiert werden. Zuletzt geladene Treffer bleiben sichtbar; fehlende Treffer sind nicht verlässlich.
            </ThemedText>
          ) : null}
          <View style={styles.counts}>
            <ThemedText style={[styles.countText, { color: theme.text }]}>
            Windanlagen-Treffer: {data.counts.windTurbines}
            </ThemedText>
            <ThemedText style={[styles.countText, { color: theme.text }]}>
              Stromleitungs-Treffer: {data.counts.powerLines} · Mastpunkte: {data.counts.powerMasts}
            </ThemedText>
          </View>

          {sourcesIncomplete ? (
            <ThemedText style={[styles.warning, { color: theme.statusCaution }]}>
              Teilergebnis: Mindestens eine Zusatzquelle ist veraltet, unvollständig oder nicht erreichbar. Ein Null-Ergebnis belegt keine Anlagenfreiheit.
            </ThemedText>
          ) : null}

          {foundCount === 0 ? (
            <ThemedText style={[styles.muted, { color: theme.textSecondary }]}>
              In den abgefragten Zusatzdaten gibt es derzeit keinen Treffer. Das ist keine Garantie für Anlagenfreiheit.
            </ThemedText>
          ) : (
            <>
              <View style={styles.mapFrame}>
                <MapView
                  style={styles.map}
                  initialRegion={{
                    latitude,
                    longitude,
                    latitudeDelta: Math.max(0.02, (searchRadiusKm * 2) / 111.32),
                    longitudeDelta: Math.max(
                      0.02,
                      (searchRadiusKm * 2) /
                        (111.32 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01)),
                    ),
                  }}
                  showsCompass
                  showsScale
                  toolbarEnabled={false}
                  testID="energy-infrastructure-map"
                >
                  <Marker
                    coordinate={{ latitude, longitude }}
                    title="Geplanter Startort"
                    pinColor="#2E9B5F"
                  />
                  {mapFeatures.map((item) => {
                    if (item.kind === "power_line") {
                      return lineCoordinateParts(item).map((coordinates, index) => (
                        <Polyline
                          key={`${item.id}:${index}`}
                          coordinates={coordinates}
                          strokeColor="#D97706"
                          strokeWidth={4}
                          tappable
                          onPress={() => Alert.alert(item.name, `${item.source} · ${matchLabel(item, data.country)}`)}
                        />
                      ));
                    }
                    const coordinate = pointCoordinate(item);
                    return coordinate ? (
                      <Marker
                        key={item.id}
                        coordinate={coordinate}
                        title={item.name}
                        description={`${item.source} · ${matchLabel(item, data.country)} · ${formatDistance(item.distanceMeters)} vom Start · Betreiber: ${item.operatorName || "nicht angegeben"}${countryIso === "DE" ? " · § 21h Abs. 3 Nr. 3: innerhalb 100 m nur mit ausdrücklicher Zustimmung" : ""}`}
                        pinColor={item.source === "MaStR" ? "#7652A8" : item.source === "OpenStreetMap" ? "#2878B5" : "#167A72"}
                      />
                    ) : null;
                  })}
                </MapView>
              </View>
              {hiddenMarkerCount > 0 ? (
                <ThemedText style={[styles.muted, { color: theme.textSecondary }]}>
                  Karte zeigt die nächsten {MAX_ENERGY_MAP_MARKERS} Anlagen-Punkte; {hiddenMarkerCount} weiter entfernte sind ausgeblendet.
                </ThemedText>
              ) : null}
              <View style={styles.items}>
                {visibleItems.map((item) => {
                const caution = item.distanceMeters < 100 || item.officialMatch !== "matched";
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.item,
                      { borderColor: theme.border, backgroundColor: theme.background },
                    ]}
                  >
                    <View style={styles.itemHeader}>
                      <View style={styles.itemMain}>
                        <ThemedText style={[styles.itemName, { color: theme.text }]}>
                          {item.name}
                        </ThemedText>
                        <ThemedText style={[styles.muted, { color: theme.textSecondary }]}>
                          {itemKindLabel(item)} · {formatDistance(item.distanceMeters)} vom Start
                        </ThemedText>
                        <ThemedText style={[styles.detail, { color: theme.textSecondary }]}>
                          Betreiber: {item.operatorName || item.operatorMastrNumber || "nicht angegeben"}
                        </ThemedText>
                        {item.operatorMastrNumber ? (
                          <ThemedText style={[styles.detail, { color: theme.textSecondary }]}>
                            MaStR-Nr.: {item.operatorMastrNumber}
                          </ThemedText>
                        ) : null}
                      </View>
                      <ThemedText
                        style={[
                          styles.sourceBadge,
                          {
                            color: item.source === "MaStR" ? "#0055A4" : item.source === "OpenStreetMap" ? "#5B4B8A" : "#167A72",
                            backgroundColor: item.source === "MaStR" ? "#DCEBFA" : item.source === "OpenStreetMap" ? "#ECE7F7" : "#DFF2EE",
                          },
                        ]}
                      >
                        {item.source}
                      </ThemedText>
                    </View>

                    {item.estimatedTipHeightM != null ? (
                      <ThemedText style={[styles.detail, { color: theme.textSecondary }]}>
                        Geschätzte Gesamthöhe ≈ {Math.round(item.estimatedTipHeightM)} m
                        {item.hubHeightM != null && item.rotorDiameterM != null
                          ? ` (Nabenhöhe ${Math.round(item.hubHeightM)} m + halber Rotordurchmesser)`
                          : ""}
                      </ThemedText>
                    ) : null}
                    {item.taggedHeightM != null ? (
                      <ThemedText style={[styles.detail, { color: theme.textSecondary }]}>
                        In {item.source} eingetragene Höhe: {Math.round(item.taggedHeightM)} m
                      </ThemedText>
                    ) : null}
                    {item.voltage ? (
                      <ThemedText style={[styles.detail, { color: theme.textSecondary }]}>
                        Spannung laut {item.source}: {item.voltage}
                      </ThemedText>
                    ) : null}
                    {item.operatorProfileUrl ? (
                      <Pressable onPress={() => openPublicLink(item.operatorProfileUrl!)}>
                        <ThemedText style={[styles.detail, { color: "#1473B8" }]}>
                          Betreiberprofil im MaStR öffnen
                        </ThemedText>
                      </Pressable>
                    ) : null}
                    {item.sourceRecordUrl ? (
                      <Pressable onPress={() => openPublicLink(item.sourceRecordUrl!)}>
                        <ThemedText style={[styles.detail, { color: "#1473B8" }]}>
                          Anlageneintrag im MaStR öffnen
                        </ThemedText>
                      </Pressable>
                    ) : null}
                    {item.operatorContact?.phone ? (
                      <Pressable
                        onPress={() =>
                          openPublicLink(`tel:${item.operatorContact!.phone!.replace(/[^\d+*#,;]/g, "")}`)
                        }
                      >
                        <ThemedText style={[styles.detail, { color: "#1473B8" }]}>
                          Anrufen: {item.operatorContact.phone}
                        </ThemedText>
                      </Pressable>
                    ) : null}
                    {item.operatorContact?.email ? (
                      <Pressable
                        onPress={() =>
                          openPublicLink(`mailto:${item.operatorContact!.email!.replace(/^mailto:/i, "")}`)
                        }
                      >
                        <ThemedText style={[styles.detail, { color: "#1473B8" }]}>
                          E-Mail: {item.operatorContact.email.replace(/^mailto:/i, "")}
                        </ThemedText>
                      </Pressable>
                    ) : null}
                    {item.operatorContact?.website && safeWebsiteHref(item.operatorContact.website) ? (
                      <Pressable onPress={() => openPublicLink(safeWebsiteHref(item.operatorContact!.website)!)}
                      >
                        <ThemedText style={[styles.detail, { color: "#1473B8" }]}>
                          Website öffnen
                        </ThemedText>
                      </Pressable>
                    ) : null}
                    {!item.operatorProfileUrl && !item.sourceRecordUrl &&
                    !item.operatorContact?.email && !item.operatorContact?.phone &&
                    !item.operatorContact?.website ? (
                      <ThemedText style={[styles.detail, { color: theme.textSecondary }]}>
                        Keine öffentlichen Kontaktdaten in dieser Quelle hinterlegt.
                      </ThemedText>
                    ) : null}
                    <ThemedText
                      style={[
                        styles.match,
                        { color: caution ? theme.statusCaution : theme.textSecondary },
                      ]}
                    >
                      {matchLabel(item, data.country)}
                    </ThemedText>
                    {item.distanceMeters < 100 ? (
                      <ThemedText style={[styles.detail, { color: theme.statusCaution }]}>
                        {countryIso === "DE"
                          ? "Unter 100 m laut Kartendistanz: Falls die Anlage unter § 21h Abs. 3 Nr. 3 fällt, ist ausdrückliche Zustimmung der zuständigen Stelle oder des Betreibers nötig. Die gesetzliche Distanz gilt ab der Anlagenbegrenzung."
                          : "Unter 100 m zum Startpunkt: genaue Anlagenbegrenzung und örtliche Voraussetzungen prüfen."}
                      </ThemedText>
                    ) : null}
                  </View>
                );
                })}
              </View>
            </>
          )}

          {omittedCount > 0 ? (
            <ThemedText style={[styles.muted, { color: theme.textSecondary }]}>
              Weitere {omittedCount} Treffer sind in der Kurzliste nicht aufgeführt.
            </ThemedText>
          ) : null}

          {rule ? (
            <View style={[styles.ruleBox, { borderColor: theme.border }]}>
              <ThemedText style={[styles.ruleTitle, { color: theme.text }]}>
                {rule.paragraph}
              </ThemedText>
              <ThemedText style={[styles.detail, { color: theme.textSecondary }]}>
                {rule.tatbestand}
              </ThemedText>
              {rule.auflagen.map((condition, index) => (
                <ThemedText key={`${index}-${condition}`} style={[styles.detail, { color: theme.textSecondary }]}>
                  • {condition}
                </ThemedText>
              ))}
            </View>
          ) : null}

          {countryIso === "DE" ? (
            <ThemedText style={[styles.sourceStatus, { color: theme.textSecondary }]}>
              {data.country.officialGeozoneSource.label}-Abgleich: Wind {sourceStatusLabel(data.sources.officialWind)} · Strom {sourceStatusLabel(data.sources.officialPower)}
            </ThemedText>
          ) : (
            <ThemedText style={[styles.sourceStatus, { color: theme.textSecondary }]}>
              {data.country.comparisonNote}
            </ThemedText>
          )}
          {data.country.dataSources.map((source) => {
            const status = source.referenceOnly
              ? null
              : data.sources[source.statusKey ?? (source.id === "mastr" ? "mastr" : "openStreetMap")];
            return (
              <View key={source.id}>
                <ThemedText style={[styles.sourceStatus, { color: theme.textSecondary }]}>
                  {source.label}: {status ? sourceStatusLabel(status) : "nicht eingebunden"}
                  {status?.updatedAt ? ` · Stand ${new Date(status.updatedAt).toLocaleDateString("de-DE")}` : ""}
                  {" · "}{source.license} · {source.updateStatus}
                </ThemedText>
                <ThemedText style={[styles.sourceStatus, { color: theme.textSecondary }]}>
                  {source.coverage}
                </ThemedText>
              </View>
            );
          })}
          <ThemedText style={[styles.sourceStatus, { color: theme.textSecondary }]}>
            Kontaktangaben erscheinen nur, wenn die jeweilige Quelle sie öffentlich bereitstellt. Natürliche Personen können im MaStR maskiert und nur über ihre ABR-Nummer auffindbar sein.
          </ThemedText>
        </>
      ) : null}

      <ThemedText style={[styles.disclaimer, { color: theme.textSecondary }]}>
        Amtliche Anlagendatensätze und OSM-Ergänzungen sind keine Geozonenerfassung. Ein fehlender Treffer bedeutet nicht, dass keine Anlage oder Einschränkung besteht. Abstände ersetzen nicht die Prüfung der offiziellen Karte.
      </ThemedText>
      <View style={styles.links}>
        {data?.country.dataSources.map((source) => (
          <Pressable key={source.id} onPress={() => openLink(source.url).catch(() => {})}>
            <ThemedText style={[styles.link, { color: theme.primary }]}>{source.label} · {source.license}</ThemedText>
          </Pressable>
        ))}
        <Pressable onPress={() => openLink(data?.country.officialGeozoneSource.url ?? "https://www.dipul.de/").catch(() => {})}>
          <ThemedText style={[styles.link, { color: theme.primary }]}>{data?.country.officialGeozoneSource.label ?? "Amtliche Geozonenkarte"}</ThemedText>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    gap: 7,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
  },
  summary: {
    fontSize: 12,
  },
  loading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
  },
  counts: {
    gap: 2,
    marginVertical: 2,
  },
  countText: {
    fontSize: 12,
    fontWeight: "600",
  },
  items: {
    gap: 7,
  },
  mapFrame: {
    height: 200,
    borderRadius: 8,
    overflow: "hidden",
    marginVertical: 2,
  },
  map: {
    width: "100%",
    height: "100%",
  },
  item: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 9,
    gap: 3,
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  itemMain: {
    flex: 1,
  },
  itemName: {
    fontSize: 13,
    fontWeight: "700",
  },
  sourceBadge: {
    overflow: "hidden",
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 10,
    fontWeight: "700",
  },
  detail: {
    fontSize: 11,
    lineHeight: 15,
  },
  match: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  muted: {
    fontSize: 11,
    lineHeight: 15,
  },
  warning: {
    fontSize: 12,
    lineHeight: 17,
  },
  ruleBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 8,
    gap: 3,
    marginTop: 2,
  },
  ruleTitle: {
    fontSize: 11,
    fontWeight: "700",
  },
  sourceStatus: {
    fontSize: 10,
    lineHeight: 14,
  },
  disclaimer: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  links: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 2,
  },
  link: {
    fontSize: 10,
    fontWeight: "600",
  },
});
