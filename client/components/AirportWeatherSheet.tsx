import React, { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet, Platform } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  fetchAirportWeather,
  decodeMetar,
  decodeTaf,
  formatObservedTime,
  type AirportWeather,
  type KlartextRow,
  type TafKlartext,
} from "@/lib/aviationWeather";
import { useShowDataSources } from "@/lib/dataSource";

type ViewMode = "klartext" | "raw";

// Auswahl bleibt während der Sitzung erhalten (modulweite Variable).
let sessionMode: ViewMode = "klartext";

interface AirportWeatherSheetProps {
  icao: string;
  name: string;
  onClose: () => void;
  bottomInset?: number;
  /** Bereits vom Karten-Marker bekannte rohe METAR – wird sofort gerendert. */
  initialMetarRaw?: string | null;
  /** Beobachtungszeit der vorab bekannten METAR. */
  initialObservedAt?: string | null;
}

export default function AirportWeatherSheet({
  icao,
  name,
  onClose,
  bottomInset = 0,
  initialMetarRaw = null,
  initialObservedAt = null,
}: AirportWeatherSheetProps) {
  const isAdmin = useShowDataSources();
  const [mode, setModeState] = useState<ViewMode>(sessionMode);
  // Liegt bereits eine METAR vom Marker vor, rendern wir sie sofort (kein
  // Spinner) und laden nur die fehlende TAF im Hintergrund nach.
  const hasInitialMetar = !!initialMetarRaw;
  const [loading, setLoading] = useState(!hasInitialMetar);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AirportWeather | null>(
    hasInitialMetar
      ? { icao, metarRaw: initialMetarRaw, tafRaw: null, observedAt: initialObservedAt, issuedAt: null }
      : null,
  );

  const setMode = (m: ViewMode) => {
    sessionMode = m;
    setModeState(m);
  };

  useEffect(() => {
    let cancelled = false;
    const seedMetar = hasInitialMetar;
    setError(null);
    if (seedMetar) {
      // Sofort vorhandene METAR zeigen; TAF lädt unaufdringlich im Hintergrund.
      setData({ icao, metarRaw: initialMetarRaw, tafRaw: null, observedAt: initialObservedAt, issuedAt: null });
      setLoading(false);
    } else {
      setLoading(true);
      setData(null);
    }
    fetchAirportWeather(icao)
      .then((w) => {
        if (cancelled) return;
        // Vorhandene METAR nicht durch eine leere Live-Antwort überschreiben.
        setData((prev) =>
          seedMetar && !w.metarRaw && prev
            ? { ...prev, tafRaw: w.tafRaw, issuedAt: w.issuedAt }
            : w,
        );
      })
      .catch((e) => {
        // Bei vorhandener METAR den Hintergrund-Fehler ignorieren (METAR bleibt
        // sichtbar); sonst Fehlermeldung statt endlosem Spinner.
        if (!cancelled && !seedMetar) setError(e instanceof Error ? e.message : "Unbekannter Fehler");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [icao, hasInitialMetar, initialMetarRaw, initialObservedAt]);

  return (
    <View
      style={[styles.overlay, bottomInset > 0 ? { paddingBottom: 16 + bottomInset } : null]}
      pointerEvents="box-none"
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{name}</Text>
            <Text style={styles.sub}>{icao} · Flugwetter</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12} testID="airport-weather-close">
            <Feather name="x" size={18} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>

        <View style={styles.toggle}>
          <Pressable
            style={[styles.toggleBtn, mode === "klartext" ? styles.toggleActive : null]}
            onPress={() => setMode("klartext")}
            testID="airport-weather-toggle-klartext"
          >
            <Text style={[styles.toggleText, mode === "klartext" ? styles.toggleTextActive : null]}>Klartext</Text>
          </Pressable>
          <Pressable
            style={[styles.toggleBtn, mode === "raw" ? styles.toggleActive : null]}
            onPress={() => setMode("raw")}
            testID="airport-weather-toggle-raw"
          >
            <Text style={[styles.toggleText, mode === "raw" ? styles.toggleTextActive : null]}>Roh</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#4A90D9" />
            <Text style={styles.muted}>Wetter wird geladen…</Text>
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Feather name="alert-triangle" size={20} color="#FF9500" />
            <Text style={styles.muted}>{error}</Text>
          </View>
        ) : (
          <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
            <Section
              title="METAR (aktuell)"
              subtitle={formatObservedTime(data?.observedAt ?? null)}
              emptyText="Keine aktuelle METAR verfügbar"
            >
              {mode === "raw"
                ? renderRaw(data?.metarRaw ?? null)
                : renderMetarKlartext(data?.metarRaw ?? null)}
            </Section>

            <Section
              title="TAF (Vorhersage)"
              subtitle={null}
              emptyText={loading ? "TAF wird geladen…" : "Keine aktuelle TAF verfügbar"}
            >
              {mode === "raw"
                ? renderRaw(data?.tafRaw ?? null)
                : renderTafKlartext(data?.tafRaw ?? null)}
            </Section>

            {isAdmin ? (
              <Text style={styles.source}>Quelle: NOAA / aviationweather.gov</Text>
            ) : null}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function Section({
  title,
  subtitle,
  emptyText,
  children,
}: {
  title: string;
  subtitle: string | null;
  emptyText: string;
  children: React.ReactNode | null;
}) {
  const hasContent = children !== null && children !== undefined;
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionTime}>{subtitle}</Text> : null}
      </View>
      {hasContent ? children : <Text style={styles.muted}>{emptyText}</Text>}
    </View>
  );
}

function renderRaw(raw: string | null): React.ReactNode | null {
  if (!raw) return null;
  return <Text style={styles.raw}>{raw}</Text>;
}

function renderRows(rows: KlartextRow[]): React.ReactNode {
  return (
    <View style={styles.rows}>
      {rows.map((r, i) => (
        <View key={i} style={styles.row}>
          <Text style={styles.rowKey}>{r.label}</Text>
          <Text style={styles.rowVal}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

function renderMetarKlartext(raw: string | null): React.ReactNode | null {
  if (!raw) return null;
  try {
    const rows = decodeMetar(raw);
    if (rows.length === 0) return renderRaw(raw);
    return renderRows(rows);
  } catch {
    return renderRaw(raw);
  }
}

function renderTafKlartext(raw: string | null): React.ReactNode | null {
  if (!raw) return null;
  let taf: TafKlartext;
  try {
    taf = decodeTaf(raw);
  } catch {
    return renderRaw(raw);
  }
  return (
    <View>
      <View style={styles.row}>
        <Text style={styles.rowKey}>Gültig</Text>
        <Text style={styles.rowVal}>{taf.validity}</Text>
      </View>
      {taf.base.length > 0 ? renderRows(taf.base) : null}
      {taf.trends.map((tr, i) => (
        <View key={i} style={styles.trend}>
          <Text style={styles.trendHead}>{tr.heading}</Text>
          {renderRows(tr.rows)}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 16,
    paddingHorizontal: 12,
    zIndex: 300,
  } as any,
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  } as any,
  card: {
    width: "100%",
    maxWidth: 360,
    maxHeight: 420,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "rgba(20,30,48,0.97)",
    borderWidth: 1.5,
    borderColor: "rgba(74,144,217,0.55)",
    ...(Platform.OS === "ios" ? { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8 } : { elevation: 8 }),
  } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  } as any,
  title: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  sub: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 1,
  },
  toggle: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    padding: 3,
    marginBottom: 10,
  } as any,
  toggleBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: "center",
  } as any,
  toggleActive: {
    backgroundColor: "#4A90D9",
  },
  toggleText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "700",
  },
  toggleTextActive: {
    color: "#FFFFFF",
  },
  body: {
    flexGrow: 0,
  } as any,
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    gap: 8,
  } as any,
  muted: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
  },
  section: {
    marginBottom: 12,
  } as any,
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 5,
  } as any,
  sectionTitle: {
    color: "#4A90D9",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  sectionTime: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontWeight: "600",
  },
  rows: {
    gap: 4,
  } as any,
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  } as any,
  rowKey: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontWeight: "600",
    width: 100,
  },
  rowVal: {
    color: "#E8ECF2",
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
    lineHeight: 16,
  },
  raw: {
    color: "#C8D0E0",
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 18,
  },
  trend: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
  } as any,
  trendHead: {
    color: "#9CC4F0",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 3,
  },
  source: {
    color: "rgba(255,255,255,0.4)",
    fontSize: 10,
    fontWeight: "500",
    textAlign: "center",
    marginTop: 2,
  },
});
