import { openLink } from "@/lib/webBrowser";
import React, { useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  Pressable,
  Modal,
  ActivityIndicator,
  ScrollView,
  Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import {
  loadEasaRules,
  childrenOf,
  searchTopics,
  typeLabel,
  typeColor,
  type EasaNode,
} from "@/lib/easaRules";

const RULES_KEY = ["easa-rules"] as const;

export default function EasaRulesScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const [search, setSearch] = useState("");
  // Pfad der aufgeklappten Überschriften (Drilldown durch die Dokumentstruktur).
  const [path, setPath] = useState<EasaNode[]>([]);
  const [selected, setSelected] = useState<EasaNode | null>(null);

  const query = useQuery({ queryKey: RULES_KEY, queryFn: loadEasaRules, staleTime: Infinity });

  const nodes = query.data?.nodes ?? [];
  const currentParentId = path.length > 0 ? path[path.length - 1].id : null;

  const browseItems = useMemo(
    () => childrenOf(nodes, currentParentId),
    [nodes, currentParentId],
  );

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    return searchTopics(nodes, search).slice(0, 200);
  }, [nodes, search]);

  const isSearching = search.trim().length > 0;

  const openNode = useCallback((node: EasaNode) => {
    if (node.kind === "heading") {
      setPath((p) => [...p, node]);
    } else {
      setSelected(node);
    }
  }, []);

  const goUp = useCallback(() => setPath((p) => p.slice(0, -1)), []);
  const goRoot = useCallback(() => setPath([]), []);

  const renderItem = useCallback(
    ({ item }: { item: EasaNode }) => {
      const isHeading = item.kind === "heading";
      const showType = !isHeading && item.type;
      return (
        <Pressable
          onPress={() => openNode(item)}
          style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
          testID={`easa-item-${item.id}`}
        >
          <View style={styles.cardMain}>
            <View style={styles.titleRow}>
              {item.code ? (
                <Text style={[styles.code, { color: theme.primary }]} numberOfLines={1}>
                  {item.code}
                </Text>
              ) : null}
              {showType ? (
                <View style={[styles.typeBadge, { backgroundColor: typeColor(item.type) + "1A" }]}>
                  <Text style={[styles.typeBadgeText, { color: typeColor(item.type) }]}>
                    {item.type}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              style={[
                styles.title,
                { color: theme.text, fontWeight: isHeading ? "700" : "600" },
              ]}
            >
              {item.title}
            </Text>
            {item.source ? (
              <Text style={[styles.source, { color: theme.textTertiary }]} numberOfLines={1}>
                {item.source}
              </Text>
            ) : null}
          </View>
          <Feather
            name={isHeading ? "chevron-right" : "file-text"}
            size={18}
            color={theme.textTertiary}
          />
        </Pressable>
      );
    },
    [theme, openNode],
  );

  if (query.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background, paddingTop: headerHeight }]}>
        <ActivityIndicator color={theme.primary} />
        <Text style={[styles.centerText, { color: theme.textSecondary }]}>
          Regelwerk wird geladen…
        </Text>
      </View>
    );
  }

  if (query.isError || !query.data) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background, paddingTop: headerHeight }]}>
        <Feather name="wifi-off" size={32} color={theme.textTertiary} />
        <Text style={[styles.centerText, { color: theme.textSecondary }]}>
          Regelwerk konnte nicht geladen werden. Bitte mit Internetverbindung erneut öffnen.
        </Text>
        <Pressable
          onPress={() => query.refetch()}
          style={[styles.retryBtn, { backgroundColor: theme.primary }]}
          testID="button-easa-retry"
        >
          <Text style={styles.retryText}>Erneut versuchen</Text>
        </Pressable>
      </View>
    );
  }

  const data = isSearching ? searchResults : browseItems;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.background, paddingTop: headerHeight + Spacing.sm },
      ]}
    >
      <View style={[styles.searchBox, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Feather name="search" size={16} color={theme.textTertiary} />
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          placeholder="Regelwerk durchsuchen…"
          placeholderTextColor={theme.textTertiary}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          clearButtonMode="while-editing"
          testID="input-easa-search"
        />
        {search.length > 0 ? (
          <Pressable onPress={() => setSearch("")} hitSlop={8} testID="button-easa-clear-search">
            <Feather name="x-circle" size={16} color={theme.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      <Text style={[styles.sourceLine, { color: theme.textTertiary }]}>
        {query.data.title} — Revision {query.data.revision}. Amtlicher Text in englischer Sprache (EASA).
      </Text>

      {!isSearching && path.length > 0 ? (
        <View style={styles.breadcrumb}>
          <Pressable onPress={goRoot} hitSlop={6} testID="button-easa-breadcrumb-root">
            <Feather name="home" size={15} color={theme.primary} />
          </Pressable>
          <Feather name="chevron-right" size={13} color={theme.textTertiary} />
          <Pressable onPress={goUp} hitSlop={6} style={styles.breadcrumbCurrent} testID="button-easa-breadcrumb-up">
            <Feather name="corner-left-up" size={14} color={theme.primary} />
            <Text style={[styles.breadcrumbText, { color: theme.primary }]} numberOfLines={1}>
              {path[path.length - 1].title}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={data}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Feather name="search" size={32} color={theme.textTertiary} />
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              {isSearching ? "Kein Treffer gefunden" : "Keine Einträge"}
            </Text>
          </View>
        }
      />

      <DetailModal node={selected} doc={query.data.sourceUrl} onClose={() => setSelected(null)} />
    </View>
  );
}

function DetailModal({
  node,
  doc,
  onClose,
}: {
  node: EasaNode | null;
  doc: string;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const tLabel = typeLabel(node?.type);

  return (
    <Modal
      visible={node != null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.modalContainer, { backgroundColor: theme.background, paddingTop: insets.top + Spacing.sm }]}>
        <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
          <Text style={[styles.modalTitle, { color: theme.text }]} numberOfLines={2}>
            {node?.title ?? ""}
          </Text>
          <Pressable onPress={onClose} hitSlop={10} testID="button-easa-detail-close">
            <Feather name="x" size={24} color={theme.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.metaRow}>
            {node?.code ? (
              <View style={[styles.metaChip, { backgroundColor: theme.primary + "1A" }]}>
                <Text style={[styles.metaChipText, { color: theme.primary }]}>{node.code}</Text>
              </View>
            ) : null}
            {node?.type ? (
              <View style={[styles.metaChip, { backgroundColor: typeColor(node.type) + "1A" }]}>
                <Text style={[styles.metaChipText, { color: typeColor(node.type) }]}>
                  {node.type}
                </Text>
              </View>
            ) : null}
          </View>

          {tLabel ? (
            <Text style={[styles.detailMeta, { color: theme.textSecondary }]}>{tLabel}</Text>
          ) : null}
          {node?.source ? (
            <Text style={[styles.detailMeta, { color: theme.textSecondary }]}>
              Quelle: {node.source}
            </Text>
          ) : null}
          {node?.applicabilityDate ? (
            <Text style={[styles.detailMeta, { color: theme.textSecondary }]}>
              Anwendbar ab: {node.applicabilityDate}
            </Text>
          ) : null}

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          {(node?.body ?? []).length > 0 ? (
            (node?.body ?? []).map((p, i) => (
              <Text key={i} style={[styles.bodyPara, { color: theme.text }]}>
                {p}
              </Text>
            ))
          ) : (
            <Text style={[styles.detailMeta, { color: theme.textTertiary }]}>
              Für diesen Abschnitt liegt kein Fließtext vor.
            </Text>
          )}

          <Pressable
            onPress={() => {
              openLink(doc).catch(() => {});
            }}
            style={[styles.docLink, { borderColor: theme.border }]}
            testID="button-easa-source-link"
          >
            <Feather name="external-link" size={14} color={theme.primary} />
            <Text style={[styles.docLinkText, { color: theme.primary }]}>
              EASA Easy Access Rules (Originaldokument)
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 32 },
  centerText: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  retryBtn: { marginTop: 4, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10 },
  retryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },
  sourceLine: { fontSize: 10, textAlign: "center", marginTop: 6, marginBottom: 2, lineHeight: 14 },
  breadcrumb: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  breadcrumbCurrent: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  breadcrumbText: { flex: 1, fontSize: 13, fontWeight: "600" },
  list: { paddingTop: 4 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginVertical: 3,
  },
  cardMain: { flex: 1, gap: 3 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  code: { fontSize: 12, fontWeight: "700", flexShrink: 1 },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  typeBadgeText: { fontSize: 10, fontWeight: "800" },
  title: { fontSize: 14, lineHeight: 19 },
  source: { fontSize: 11, marginTop: 1 },
  emptyWrap: { alignItems: "center", justifyContent: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15 },
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
  },
  modalTitle: { flex: 1, fontSize: 18, fontWeight: "700", lineHeight: 24 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metaChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  metaChipText: { fontSize: 12, fontWeight: "700" },
  detailMeta: { fontSize: 13, marginTop: 8, lineHeight: 18 },
  divider: { height: 1, marginVertical: 16 },
  bodyPara: { fontSize: 15, lineHeight: 23, marginBottom: 12 },
  docLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  docLinkText: { fontSize: 13, fontWeight: "600" },
});
