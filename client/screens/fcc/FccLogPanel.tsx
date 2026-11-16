import React, { useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { FccLog, LogEntry, LogLevel } from "@/lib/fcc/log";

function colorFor(level: LogLevel, theme: ReturnType<typeof useTheme>["theme"]): string {
  switch (level) {
    case "step":
      return theme.primary;
    case "ok":
      return theme.statusGo;
    case "warn":
      return theme.statusCaution;
    case "err":
      return theme.statusNoGo;
    case "detail":
      return theme.textTertiary;
    default:
      return theme.text;
  }
}

function prefixFor(level: LogLevel): string {
  switch (level) {
    case "step":
      return "▸ ";
    case "ok":
      return "✓ ";
    case "warn":
      return "! ";
    case "err":
      return "✗ ";
    case "detail":
      return "    ";
    default:
      return "  ";
  }
}

export default function FccLogPanel() {
  const { theme } = useTheme();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const tapTimes = useRef<number[]>([]);

  useEffect(() => FccLog.subscribe(setEntries), []);
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [entries]);

  const onTripleTap = () => {
    const now = Date.now();
    tapTimes.current = [...tapTimes.current, now].filter((t) => now - t < 900);
    if (tapTimes.current.length >= 3) {
      tapTimes.current = [];
      const v = !FccLog.isVerbose();
      FccLog.setVerbose(v);
      if (v) FccLog.step("Ausführliches Protokoll AN – zeigt die rohen DUML-Antwortrahmen");
      else FccLog.info("Ausführliches Protokoll aus");
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundDefault, borderColor: theme.border }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.textSecondary }]}>PROTOKOLL</Text>
        <Pressable
          onPress={() => FccLog.clear()}
          style={[styles.clearBtn, { backgroundColor: theme.backgroundTertiary, borderColor: theme.border }]}
        >
          <Text style={{ color: theme.text, fontSize: 13 }}>Leeren</Text>
        </Pressable>
      </View>
      <Pressable style={{ flex: 1 }} onPress={onTripleTap}>
        <ScrollView ref={scrollRef} style={{ flex: 1 }}>
          {entries.length === 0 ? (
            <Text style={{ color: theme.textTertiary, fontSize: 13, lineHeight: 20 }}>
              Noch keine Einträge.{"\n"}Der Ablauf links schreibt hier jeden Schritt mit.{"\n"}Dreimal tippen → ausführliche
              Ansicht.
            </Text>
          ) : (
            entries.map((e) => (
              <Text
                key={e.id}
                style={{
                  color: colorFor(e.level, theme),
                  fontSize: e.level === "detail" ? 11 : 13,
                  fontFamily: e.level === "detail" ? "monospace" : undefined,
                  fontWeight: e.level === "step" || e.level === "ok" ? "700" : "400",
                  paddingVertical: 2,
                }}
              >
                {prefixFor(e.level)}
                {e.text}
              </Text>
            ))
          )}
        </ScrollView>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 14 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  title: { flex: 1, fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  clearBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
});
