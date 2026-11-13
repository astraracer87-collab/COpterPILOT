import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  Pressable,
  Modal,
  Alert,
  ActivityIndicator,
  Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { glossaryEntries, type GlossaryEntry } from "@/lib/glossary";
import { apiRequest } from "@/lib/query-client";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

type UserGlossaryEntry = {
  id: string;
  term: string;
  definition: string;
  createdAt?: string;
  updatedAt?: string;
};

type DisplayEntry = GlossaryEntry & { id?: string; isCustom?: boolean };

const GLOSSARY_KEY = ["/api/user-glossary"] as const;

export default function GlossaryScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [expandedTerm, setExpandedTerm] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTerm, setFormTerm] = useState("");
  const [formDefinition, setFormDefinition] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const userQuery = useQuery<UserGlossaryEntry[]>({ queryKey: GLOSSARY_KEY });

  const createMutation = useMutation({
    mutationFn: async (data: { term: string; definition: string }) => {
      const res = await apiRequest("POST", "/api/user-glossary", data);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: GLOSSARY_KEY }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; term: string; definition: string }) => {
      const res = await apiRequest("PUT", `/api/user-glossary/${id}`, data);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: GLOSSARY_KEY }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/user-glossary/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: GLOSSARY_KEY }),
  });

  const combined: DisplayEntry[] = useMemo(() => {
    const userEntries: DisplayEntry[] = (userQuery.data ?? []).map((e) => ({
      id: e.id,
      term: e.term,
      definition: e.definition,
      isCustom: true,
    }));
    const merged = [...userEntries, ...glossaryEntries];
    return merged.sort((a, b) => a.term.localeCompare(b.term, "de", { sensitivity: "base" }));
  }, [userQuery.data]);

  const filtered = useMemo(() => {
    if (!search.trim()) return combined;
    const q = search.toLowerCase();
    return combined.filter(
      (e) => e.term.toLowerCase().includes(q) || e.definition.toLowerCase().includes(q),
    );
  }, [search, combined]);

  const toggleExpand = (key: string) => {
    setExpandedTerm((prev) => (prev === key ? null : key));
  };

  const openCreate = () => {
    setEditingId(null);
    setFormTerm("");
    setFormDefinition("");
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (entry: DisplayEntry) => {
    if (!entry.isCustom || !entry.id) return;
    setEditingId(entry.id);
    setFormTerm(entry.term);
    setFormDefinition(entry.definition);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = async () => {
    const term = formTerm.trim();
    const definition = formDefinition.trim();
    if (!term || !definition) {
      setFormError("Bitte Begriff und Definition eingeben.");
      return;
    }
    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, term, definition });
      } else {
        await createMutation.mutateAsync({ term, definition });
      }
      setModalOpen(false);
    } catch (err: any) {
      setFormError(err?.message ?? "Speichern fehlgeschlagen");
    }
  };

  const handleDelete = (entry: DisplayEntry) => {
    if (!entry.id) return;
    Alert.alert(
      "Eintrag löschen?",
      `„${entry.term}" wird endgültig entfernt.`,
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Löschen",
          style: "destructive",
          onPress: () => deleteMutation.mutate(entry.id!),
        },
      ],
    );
  };

  const renderItem = ({ item, index }: { item: DisplayEntry; index: number }) => {
    const itemKey = item.id ?? item.term;
    const isExpanded = expandedTerm === itemKey;
    const firstLetter = item.term.charAt(0).toUpperCase();
    const showLetter =
      index === 0 || filtered[index - 1].term.charAt(0).toUpperCase() !== firstLetter;

    return (
      <View>
        {showLetter ? (
          <View style={[styles.letterHeader, { borderBottomColor: theme.border }]}>
            <Text style={[styles.letterText, { color: theme.primary }]}>{firstLetter}</Text>
          </View>
        ) : null}
        <Pressable
          onPress={() => toggleExpand(itemKey)}
          style={[
            styles.card,
            {
              backgroundColor: theme.card,
              borderColor: isExpanded ? theme.primary + "40" : theme.border,
            },
          ]}
          testID={`glossary-item-${itemKey}`}
        >
          <View style={styles.cardHeader}>
            <View style={styles.termRow}>
              <Text style={[styles.term, { color: theme.text }]}>{item.term}</Text>
              {item.isCustom ? (
                <View style={[styles.badge, { backgroundColor: theme.primary + "1A" }]}>
                  <Feather name="user" size={10} color={theme.primary} />
                  <Text style={[styles.badgeText, { color: theme.primary }]}>Eigen</Text>
                </View>
              ) : null}
            </View>
            <Feather
              name={isExpanded ? "chevron-up" : "chevron-down"}
              size={16}
              color={theme.textSecondary}
            />
          </View>
          {isExpanded ? (
            <>
              <Text style={[styles.definition, { color: theme.textSecondary }]}>
                {item.definition}
              </Text>
              {item.link ? (
                <Pressable
                  onPress={() => { Linking.openURL(item.link!.url).catch(() => {}); }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}
                >
                  <Feather name="external-link" size={13} color={theme.primary} />
                  <Text style={{ color: theme.primary, fontWeight: "600", fontSize: 13 }}>{item.link.label}</Text>
                </Pressable>
              ) : null}
              {item.isCustom ? (
                <View style={styles.actionRow}>
                  <Pressable
                    onPress={() => openEdit(item)}
                    style={[styles.actionBtn, { borderColor: theme.border }]}
                    testID={`glossary-edit-${item.id}`}
                  >
                    <Feather name="edit-2" size={13} color={theme.primary} />
                    <Text style={[styles.actionText, { color: theme.primary }]}>Bearbeiten</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleDelete(item)}
                    style={[styles.actionBtn, { borderColor: theme.border }]}
                    testID={`glossary-delete-${item.id}`}
                  >
                    <Feather name="trash-2" size={13} color="#D14343" />
                    <Text style={[styles.actionText, { color: "#D14343" }]}>Löschen</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : null}
        </Pressable>
      </View>
    );
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

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
          placeholder="Begriff suchen..."
          placeholderTextColor={theme.textTertiary}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          clearButtonMode="while-editing"
          testID="input-glossary-search"
        />
        {search.length > 0 ? (
          <Pressable onPress={() => setSearch("")} hitSlop={8}>
            <Feather name="x-circle" size={16} color={theme.textTertiary} />
          </Pressable>
        ) : null}
      </View>
      <Text style={[styles.sourceText, { color: theme.textTertiary }]}>
        Quelle: dipul.de — Digitale Plattform Unbemannte Luftfahrt
      </Text>
      <FlatList
        data={filtered}
        renderItem={renderItem}
        keyExtractor={(item) => item.id ?? item.term}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
        scrollIndicatorInsets={{ bottom: insets.bottom }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Feather name="search" size={32} color={theme.textTertiary} />
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              Kein Begriff gefunden
            </Text>
          </View>
        }
      />

      <Pressable
        onPress={openCreate}
        style={[
          styles.fab,
          {
            backgroundColor: theme.primary,
            bottom: insets.bottom + Spacing.lg,
          },
        ]}
        testID="button-glossary-add"
      >
        <Feather name="plus" size={22} color="#FFFFFF" />
      </Pressable>

      <Modal
        visible={modalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: theme.background }]}>
            <KeyboardAwareScrollViewCompat
              contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 24 }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>
                  {editingId ? "Eintrag bearbeiten" : "Neuer Glossar-Eintrag"}
                </Text>
                <Pressable onPress={() => setModalOpen(false)} hitSlop={8} testID="button-glossary-close">
                  <Feather name="x" size={22} color={theme.textSecondary} />
                </Pressable>
              </View>

              <Text style={[styles.label, { color: theme.textSecondary }]}>Begriff</Text>
              <TextInput
                value={formTerm}
                onChangeText={setFormTerm}
                placeholder="z. B. RID"
                placeholderTextColor={theme.textTertiary}
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: theme.card, borderColor: theme.border },
                ]}
                testID="input-glossary-term"
              />

              <Text style={[styles.label, { color: theme.textSecondary }]}>Definition</Text>
              <TextInput
                value={formDefinition}
                onChangeText={setFormDefinition}
                placeholder="Erklärung..."
                placeholderTextColor={theme.textTertiary}
                multiline
                style={[
                  styles.input,
                  styles.inputMultiline,
                  { color: theme.text, backgroundColor: theme.card, borderColor: theme.border },
                ]}
                testID="input-glossary-definition"
              />

              {formError ? (
                <Text style={styles.errorText}>{formError}</Text>
              ) : null}

              <Pressable
                onPress={handleSave}
                disabled={isSaving}
                style={[styles.saveBtn, { backgroundColor: theme.primary, opacity: isSaving ? 0.6 : 1 }]}
                testID="button-glossary-save"
              >
                {isSaving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveBtnText}>{editingId ? "Speichern" : "Anlegen"}</Text>
                )}
              </Pressable>
            </KeyboardAwareScrollViewCompat>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16 },
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
  sourceText: { fontSize: 10, textAlign: "center", marginTop: 6, marginBottom: 4 },
  list: { paddingBottom: 40 },
  letterHeader: {
    paddingTop: 14,
    paddingBottom: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    marginBottom: 4,
  },
  letterText: { fontSize: 18, fontWeight: "800" },
  card: { borderWidth: 1, borderRadius: 10, padding: 12, marginVertical: 3 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  termRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  term: { fontSize: 14, fontWeight: "700" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: { fontSize: 10, fontWeight: "700" },
  definition: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  actionText: { fontSize: 12, fontWeight: "600" },
  emptyWrap: { alignItems: "center", justifyContent: "center", paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15 },
  fab: {
    position: "absolute",
    right: 20,
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "92%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  label: { fontSize: 12, fontWeight: "600", marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  inputMultiline: { minHeight: 120, textAlignVertical: "top" },
  errorText: { color: "#D14343", fontSize: 13, marginTop: 12 },
  saveBtn: {
    marginTop: 20,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
});
