import React, { useMemo } from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Card } from "@/components/Card";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useShowDataSources } from "@/lib/dataSource";
import { weatherSourceLabel } from "@/lib/sourceAttribution";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import { HourlyForecastSlot } from "@/lib/weather";
import { DroneProfile } from "@/lib/storage";
import { calculateSolarTimes, isTimeDuringDaylight, isTimeDuringCivilTwilight } from "@/lib/solar";

export interface HourlyForecastTableProps {
  hourlySlots: HourlyForecastSlot[];
  hourlySource?: "dipul" | "brightsky" | "openmeteo" | null;
  latitude: number;
  longitude: number;
  maxAltitude: number;
  drone?: DroneProfile | null;
  title?: string;
  subtitle?: string;
  highlightStart?: Date | null;
  highlightEnd?: Date | null;
  cardStyle?: any;
}

export default function HourlyForecastTable({
  hourlySlots,
  hourlySource,
  latitude,
  longitude,
  maxAltitude,
  drone,
  title = "Stundenweise Prognose",
  subtitle,
  highlightStart,
  highlightEnd,
  cardStyle,
}: HourlyForecastTableProps) {
  const { theme } = useTheme();
  const isAdmin = useShowDataSources();
  const wsLabel = weatherSourceLabel(hourlySource, isAdmin);

  const hourlySolarIcons = useMemo(() => {
    if (hourlySlots.length === 0) return [];
    return hourlySlots.map((s) => {
      const t = new Date(s.timestamp);
      const solar = calculateSolarTimes(latitude, longitude, t);
      const day = isTimeDuringDaylight(t, solar);
      const twi = isTimeDuringCivilTwilight(t, solar);
      const morningTwi = twi && solar.sunrise && t < solar.sunrise;
      return {
        icon: day ? "sun" : twi ? (morningTwi ? "sunrise" : "sunset") : "moon",
        color: day ? "#FFB820" : twi ? "#FF8C00" : "#6B7FA0",
        bg: day
          ? "rgba(255,184,32,0.12)"
          : twi
          ? "rgba(255,140,0,0.12)"
          : "rgba(107,127,160,0.08)",
      } as const;
    });
  }, [hourlySlots, latitude, longitude]);

  const hourlyRowConfigs = useMemo(() => {
    if (hourlySlots.length === 0) return [];
    const hasAltWind = hourlySlots.some((s) => s.windAtAltitude && s.windAtAltitude.length > 0);
    const hasPressure = hourlySlots.some((s) => s.pressure);
    // Farbschwellen folgen dem Drohnen-Limit (m/s); Fallback wie bisher.
    const windLimit = drone?.limits?.maxWind ?? 10;
    const gustLimit = drone?.limits?.maxGusts ?? 12;
    const rows: { label: string; values: string[]; levels: ("ok" | "warn" | "crit")[] }[] = [
      { label: "Temp", values: hourlySlots.map((s) => `${s.temperature.toFixed(0)}\u00B0`), levels: hourlySlots.map((s) => (s.temperature < -5 ? "crit" : s.temperature < 0 ? "warn" : "ok")) },
      { label: "Feuchte", values: hourlySlots.map((s) => `${s.humidity.toFixed(0)}%`), levels: hourlySlots.map((s) => (s.humidity > 90 ? "warn" : "ok")) },
      { label: "Wind 10m", values: hourlySlots.map((s) => s.windSpeed.toFixed(1)), levels: hourlySlots.map((s) => (s.windSpeed > windLimit ? "crit" : s.windSpeed > windLimit * 0.75 ? "warn" : "ok")) },
      { label: "B\u00F6en 10m", values: hourlySlots.map((s) => (s.windGust != null ? s.windGust.toFixed(1) : "-")), levels: hourlySlots.map((s) => ((s.windGust ?? 0) > gustLimit ? "crit" : (s.windGust ?? 0) > gustLimit * 0.75 ? "warn" : "ok")) },
    ];
    const relevantAltHeights = [50, 100, 150, 200, 250].filter((h) => h <= maxAltitude + 50);
    if (hasAltWind && relevantAltHeights.length > 0) {
      relevantAltHeights.forEach((h) => {
        const isFlightLevel = h <= maxAltitude && h >= maxAltitude - 50;
        rows.push({
          label: isFlightLevel ? `Wind ${h}m \u2708` : `Wind ${h}m`,
          values: hourlySlots.map((s) => {
            const w = s.windAtAltitude?.find((a) => a.height === h);
            return w ? w.speed.toFixed(1) : "-";
          }),
          levels: hourlySlots.map((s) => {
            const w = s.windAtAltitude?.find((a) => a.height === h);
            if (!w) return "ok";
            return w.speed > windLimit ? "crit" : w.speed > windLimit * 0.75 ? "warn" : "ok";
          }),
        });
      });
    }
    const hasAltTemp = hourlySlots.some((s) => s.temperatureAtAltitude && s.temperatureAtAltitude.length > 1);
    if (hasAltTemp && relevantAltHeights.length > 0) {
      relevantAltHeights.forEach((h) => {
        const isFlightLevel = h <= maxAltitude && h >= maxAltitude - 50;
        rows.push({
          label: isFlightLevel ? `Temp ${h}m \u2708` : `Temp ${h}m`,
          values: hourlySlots.map((s) => {
            const t = s.temperatureAtAltitude?.find((a) => a.height === h);
            return t ? `${t.value.toFixed(0)}\u00B0` : "-";
          }),
          levels: hourlySlots.map((s) => {
            const t = s.temperatureAtAltitude?.find((a) => a.height === h);
            if (!t) return "ok";
            return t.value < -5 ? "crit" : t.value < 0 ? "warn" : "ok";
          }),
        });
      });
    }
    const rainLimit = drone?.limits?.maxRain ?? 0.5;
    rows.push(
      { label: "Regen mm/h", values: hourlySlots.map((s) => (s.rain === 0 ? "0,0" : s.rain < 0.1 ? s.rain.toFixed(2).replace(".", ",") : s.rain.toFixed(1).replace(".", ","))), levels: hourlySlots.map((s) => (s.rain > rainLimit ? "crit" : s.rain > 0 ? "warn" : "ok")) },
      { label: "Wolken", values: hourlySlots.map((s) => `${Math.round(s.cloudCover)}%`), levels: hourlySlots.map((s) => (s.cloudCover > 80 ? "warn" : "ok")) },
    );
    if (hasPressure) {
      rows.push({ label: "QNH hPa", values: hourlySlots.map((s) => (s.pressure ? `${s.pressure}` : "-")), levels: hourlySlots.map(() => "ok") });
    }
    return rows;
  }, [hourlySlots, maxAltitude, drone]);

  const highlightFlags = useMemo(() => {
    if (!highlightStart || !highlightEnd) return hourlySlots.map(() => false);
    const startMs = highlightStart.getTime();
    const endMs = highlightEnd.getTime();
    return hourlySlots.map((s) => {
      const ts = new Date(s.timestamp).getTime();
      const slotEnd = ts + 3600000;
      return slotEnd > startMs && ts < endMs;
    });
  }, [hourlySlots, highlightStart, highlightEnd]);

  const highlightBg = theme.primary + "22";

  if (hourlySlots.length === 0) return null;

  const renderRowValues = (values: string[], levels: ("ok" | "warn" | "crit")[]) => (
    <View style={styles.hourlyDataRow}>
      {values.map((v, i) => {
        const lvl = levels[i];
        const isHi = highlightFlags[i];
        const lvlStyle = lvl === "crit"
          ? { color: theme.statusNoGo, fontWeight: "800" as const, backgroundColor: theme.statusNoGoBackground }
          : lvl === "warn"
          ? { color: theme.statusCaution, fontWeight: "700" as const, backgroundColor: theme.statusCautionBackground }
          : undefined;
        const hiStyle = isHi && !lvlStyle ? { backgroundColor: highlightBg } : undefined;
        const hiBorder = isHi ? { borderTopWidth: 1, borderTopColor: theme.primary } : undefined;
        return (
          <ThemedText
            key={i}
            style={[styles.hourlyCell, styles.hourlyValCol, lvlStyle, hiStyle]}
          >
            {v}
          </ThemedText>
        );
      })}
    </View>
  );

  return (
    <Card style={[styles.hourlyCard, cardStyle]}>
      <View style={styles.weatherHeader}>
        <View>
          <ThemedText style={styles.weatherTitle}>{title}</ThemedText>
          {subtitle ? (
            <ThemedText style={[styles.weatherSourceLabel, { color: theme.textTertiary }]}>
              {subtitle}
              {wsLabel ? ` | ${wsLabel}` : ""}
            </ThemedText>
          ) : wsLabel ? (
            <ThemedText style={[styles.weatherSourceLabel, { color: theme.textTertiary }]}>
              {wsLabel}
            </ThemedText>
          ) : null}
        </View>
      </View>

      <View style={styles.hourlyTableContainer}>
        <View style={styles.hourlyLabelsCol}>
          <View style={[styles.hourlyHeaderRow, { borderBottomColor: theme.border }]}>
            <ThemedText style={[styles.hourlyHeaderCell, styles.hourlyLabelCol, { color: theme.textTertiary }]}>{""}</ThemedText>
          </View>
          {hourlySolarIcons.length > 0
            ? (() => {
                const nowSolar = calculateSolarTimes(latitude, longitude, new Date(hourlySlots[0].timestamp));
                const fmt = (d: Date | null) => (d ? d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0") : "--:--");
                return (
                  <View style={[styles.hourlyLabelRow, { borderBottomWidth: 1, borderBottomColor: theme.border, height: 34, paddingVertical: 0 }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 4, gap: 3 }}>
                      <Feather name="sun" size={11} color="#FFB820" />
                      <ThemedText style={[styles.hourlyCell, styles.hourlyLabelCol, { color: theme.textSecondary, fontWeight: "600" }]}>Tag/Nacht</ThemedText>
                    </View>
                    <ThemedText style={{ fontSize: 9, color: theme.textTertiary, paddingLeft: 18 }} numberOfLines={1}>
                      {"\u2197"}{fmt(nowSolar.sunrise)} {"\u2198"}{fmt(nowSolar.sunset)}
                    </ThemedText>
                  </View>
                );
              })()
            : null}
          {hourlyRowConfigs.map((row) => (
            <View key={row.label} style={styles.hourlyLabelRow}>
              <ThemedText style={[styles.hourlyCell, styles.hourlyLabelCol, { color: theme.textSecondary, fontWeight: "600" }]}>{row.label}</ThemedText>
            </View>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hourlyScrollView}>
          <View>
            <View style={[styles.hourlyHeaderRow, { borderBottomColor: theme.border }]}>
              {hourlySlots.map((slot, i) => {
                const isHi = highlightFlags[i];
                return (
                  <View
                    key={`${slot.timestamp}_${i}`}
                    style={[styles.hourlyValCol, isHi ? { backgroundColor: highlightBg } : null]}
                  >
                    <ThemedText style={[styles.hourlyHeaderCell, { color: isHi ? theme.primary : theme.text, fontWeight: "700" }]}>
                      {slot.hour}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
            {hourlySolarIcons.length > 0 ? (
              <View style={[styles.hourlyDataRow, { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
                {hourlySolarIcons.map((s, i) => {
                  const isHi = highlightFlags[i];
                  return (
                    <View
                      key={i}
                      style={[styles.hourlyValCol, { height: 34, justifyContent: "center", alignItems: "center", backgroundColor: isHi ? highlightBg : s.bg }]}
                    >
                      <Feather name={s.icon as any} size={14} color={s.color} />
                    </View>
                  );
                })}
              </View>
            ) : null}
            {hourlyRowConfigs.map((row) => (
              <React.Fragment key={row.label}>{renderRowValues(row.values, row.levels)}</React.Fragment>
            ))}
          </View>
        </ScrollView>
      </View>

      <View style={[styles.hourlyLegend, { borderTopColor: theme.border }]}>
        <ThemedText style={[styles.hourlyLegendText, { color: theme.textTertiary }]}>
          Wind in m/s | Regen in mm/h | QNH in hPa
        </ThemedText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  hourlyCard: {
    padding: Spacing.lg,
    marginTop: Spacing.md,
  },
  weatherHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  weatherTitle: {
    ...Typography.h4,
  },
  weatherSourceLabel: {
    ...Typography.caption,
    fontSize: 10,
    marginTop: 2,
  },
  hourlyTableContainer: {
    flexDirection: "row",
    marginTop: Spacing.sm,
  },
  hourlyLabelsCol: {
    zIndex: 1,
  },
  hourlyLabelRow: {
    paddingVertical: 5,
    paddingHorizontal: 2,
    justifyContent: "center",
  },
  hourlyScrollView: {
    flex: 1,
  },
  hourlyHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingBottom: Spacing.xs,
    marginBottom: 2,
  },
  hourlyHeaderCell: {
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  hourlyLabelCol: {
    width: 86,
    textAlign: "left",
    paddingLeft: 4,
  },
  hourlyValCol: {
    width: 52,
    textAlign: "center",
  },
  hourlyDataRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 2,
  },
  hourlyCell: {
    fontSize: 12,
    textAlign: "center",
  },
  hourlyLegend: {
    borderTopWidth: 1,
    marginTop: Spacing.sm,
    paddingTop: Spacing.xs,
  },
  hourlyLegendText: {
    fontSize: 9,
    textAlign: "center",
  },
});
