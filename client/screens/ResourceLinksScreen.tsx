import { openLink } from "@/lib/webBrowser";
import React, { useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
  Platform,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "@/lib/webBrowser";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Card } from "@/components/Card";
import { useTheme } from "@/hooks/useTheme";
import { Spacing, Typography, BorderRadius } from "@/constants/theme";
import {
  resourceCategories,
  getLinksByCategory,
  ResourceLink,
  ResourceCategory,
} from "@/lib/resourceLinks";
import { apiRequest } from "@/lib/query-client";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";

const CATEGORY_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  "Luftraum & NOTAMs": "alert-circle",
  Naturschutz: "shield",
  Wetter: "cloud",
  Karten: "map",
  Drohnenrecht: "file-text",
};

const RESOURCES_KEY = ["/api/user-resources"] as const;

type UserResourceLink = {
  id: string;
  title: string;
  url: string;
  description: string;
  category: string;
  icon: string;
};

type DisplayLink = ResourceLink & { id?: string; isCustom?: boolean };

export default function ResourceLinksScreen() {
  const { theme } = useTheme();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  // Modal-Fenster wird unter Android nicht verkleinert → selbst ausweichen
  const kbInset = useKeyboardInset();
  const queryClient = useQueryClient();

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(resourceCategories),
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState<string>(resourceCategories[0]);
  const [formError, setFormError] = useState<string | null>(null);

  const userQuery = useQuery<UserResourceLink[]>({ queryKey: RESOURCES_KEY });

  const createMutation = useMutation({
    mutationFn: async (data: Omit<UserResourceLink, "id">) => {
      const res = await apiRequest("POST", "/api/user-resources", data);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RESOURCES_KEY }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: UserResourceLink) => {
      const res = await apiRequest("PUT", `/api/user-resources/${id}`, data);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RESOURCES_KEY }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/user-resources/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RESOURCES_KEY }),
  });

  const userLinks: DisplayLink[] = useMemo(
    () =>
      (userQuery.data ?? []).map((u) => ({
        id: u.id,
        title: u.title,
        url: u.url,
        description: u.description ?? "",
        category: u.category as ResourceCategory,
        icon: u.icon || "link",
        isCustom: true,
      })),
    [userQuery.data],
  );

  const allCategories = useMemo(() => {
    const set = new Set<string>(resourceCategories);
    userLinks.forEach((l) => set.add(l.category));
    return Array.from(set);
  }, [userLinks]);

  const linksByCategory = useMemo(() => {
    const map = new Map<string, DisplayLink[]>();
    allCategories.forEach((cat) => {
      const isStandard = (resourceCategories as readonly string[]).includes(cat);
      const standard: DisplayLink[] = isStandard
        ? getLinksByCategory(cat as ResourceCategory).map((l) => ({ ...l, isCustom: false }))
        : [];
      const custom = userLinks.filter((l) => l.category === cat);
      map.set(cat, [...custom, ...standard]);
    });
    return map;
  }, [allCategories, userLinks]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const openLink = async (url: string) => {
    try {
      if (Platform.OS === "web") {
        openLink(url);
      } else {
        await WebBrowser.openBrowserAsync(url);
      }
    } catch {
      openLink(url);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setFormTitle("");
    setFormUrl("");
    setFormDescription("");
    setFormCategory(resourceCategories[0]);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (link: DisplayLink) => {
    if (!link.isCustom || !link.id) return;
    setEditingId(link.id);
    setFormTitle(link.title);
    setFormUrl(link.url);
    setFormDescription(link.description);
    setFormCategory(link.category);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = async () => {
    const title = formTitle.trim();
    const url = formUrl.trim();
    const category = formCategory.trim();
    if (!title || !url || !category) {
      setFormError("Bitte Titel, URL und Kategorie ausfüllen.");
      return;
    }
    try {
      const payload = {
        title,
        url,
        description: formDescription.trim(),
        category,
        icon: "link",
      };
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, ...payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      setExpandedCategories((prev) => new Set(prev).add(category));
      setModalOpen(false);
    } catch (err: any) {
      setFormError(err?.message ?? "Speichern fehlgeschlagen");
    }
  };

  const handleDelete = (link: DisplayLink) => {
    if (!link.id) return;
    Alert.alert(
      "Link löschen?",
      `„${link.title}" wird endgültig entfernt.`,
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Löschen", style: "destructive", onPress: () => deleteMutation.mutate(link.id!) },
      ],
    );
  };

  const renderLink = (link: DisplayLink) => (
    <View key={(link.id ?? link.url)} style={[styles.linkItem, { borderBottomColor: theme.border }]}>
      <Pressable
        onPress={() => openLink(link.url)}
        style={styles.linkMain}
        testID={`resource-open-${link.id ?? link.url}`}
      >
        <View style={[styles.linkIcon, { backgroundColor: theme.primary + "12" }]}>
          <Feather
            name={(link.icon as keyof typeof Feather.glyphMap) || "link"}
            size={18}
            color={theme.primary}
          />
        </View>
        <View style={styles.linkContent}>
          <View style={styles.linkTitleRow}>
            <ThemedText style={styles.linkTitle}>{link.title}</ThemedText>
            {link.isCustom ? (
              <View style={[styles.customBadge, { backgroundColor: theme.primary + "1A" }]}>
                <Feather name="user" size={10} color={theme.primary} />
                <ThemedText style={[styles.customBadgeText, { color: theme.primary }]}>
                  Eigen
                </ThemedText>
              </View>
            ) : null}
          </View>
          {link.description ? (
            <ThemedText style={[styles.linkDescription, { color: theme.textSecondary }]}>
              {link.description}
            </ThemedText>
          ) : null}
        </View>
        <Feather name="external-link" size={16} color={theme.textTertiary} />
      </Pressable>
      {link.isCustom ? (
        <View style={styles.linkActions}>
          <Pressable
            onPress={() => openEdit(link)}
            hitSlop={6}
            style={styles.linkActionBtn}
            testID={`resource-edit-${link.id}`}
          >
            <Feather name="edit-2" size={14} color={theme.primary} />
          </Pressable>
          <Pressable
            onPress={() => handleDelete(link)}
            hitSlop={6}
            style={styles.linkActionBtn}
            testID={`resource-delete-${link.id}`}
          >
            <Feather name="trash-2" size={14} color="#D14343" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: headerHeight + Spacing.lg,
          paddingBottom: insets.bottom + 100,
          paddingHorizontal: Spacing.lg,
        }}
      >
        <Animated.View entering={FadeInDown.duration(300)}>
          <ThemedText style={[styles.headerNote, { color: theme.textSecondary }]}>
            Kuratierte Sammlung externer Ressourcen plus deine eigenen Links.
          </ThemedText>
        </Animated.View>

        {allCategories.map((category, catIndex) => {
          const links = linksByCategory.get(category) ?? [];
          if (links.length === 0) return null;
          const isExpanded = expandedCategories.has(category);
          const catIcon = CATEGORY_ICONS[category] || "folder";

          return (
            <Animated.View
              key={category}
              entering={FadeInDown.delay(catIndex * 60).duration(300)}
            >
              <Card style={styles.categoryCard}>
                <Pressable
                  onPress={() => toggleCategory(category)}
                  style={styles.categoryHeader}
                  testID={`resource-category-${category}`}
                >
                  <Feather name={catIcon} size={20} color={theme.primary} />
                  <ThemedText style={styles.categoryTitle}>{category}</ThemedText>
                  <View style={styles.badgeContainer}>
                    <ThemedText style={[styles.badge, { color: theme.textTertiary }]}>
                      {links.length}
                    </ThemedText>
                  </View>
                  <Feather
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={20}
                    color={theme.textTertiary}
                  />
                </Pressable>
                {isExpanded ? <View style={styles.linksList}>{links.map(renderLink)}</View> : null}
              </Card>
            </Animated.View>
          );
        })}
      </ScrollView>

      <Pressable
        onPress={openCreate}
        style={[
          styles.fab,
          { backgroundColor: theme.primary, bottom: insets.bottom + Spacing.lg },
        ]}
        testID="button-resource-add"
      >
        <Feather name="plus" size={22} color="#FFFFFF" />
      </Pressable>

      <Modal
        visible={modalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={[styles.modalBackdrop, kbInset > 0 && { paddingBottom: kbInset }]}>
          <View style={[styles.modalSheet, { backgroundColor: theme.background }]}>
            <KeyboardAwareScrollViewCompat
              contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 24 }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.modalHeader}>
                <ThemedText style={styles.modalTitle}>
                  {editingId ? "Link bearbeiten" : "Neuer Link"}
                </ThemedText>
                <Pressable onPress={() => setModalOpen(false)} hitSlop={8} testID="button-resource-close">
                  <Feather name="x" size={22} color={theme.textSecondary} />
                </Pressable>
              </View>

              <ThemedText style={[styles.label, { color: theme.textSecondary }]}>Titel</ThemedText>
              <TextInput disableFullscreenUI
                value={formTitle}
                onChangeText={setFormTitle}
                placeholder="z. B. Mein Vereins-Wiki"
                placeholderTextColor={theme.textTertiary}
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: theme.card, borderColor: theme.border },
                ]}
                testID="input-resource-title"
              />

              <ThemedText style={[styles.label, { color: theme.textSecondary }]}>URL</ThemedText>
              <TextInput disableFullscreenUI
                value={formUrl}
                onChangeText={setFormUrl}
                placeholder="https://..."
                placeholderTextColor={theme.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: theme.card, borderColor: theme.border },
                ]}
                testID="input-resource-url"
              />

              <ThemedText style={[styles.label, { color: theme.textSecondary }]}>
                Beschreibung (optional)
              </ThemedText>
              <TextInput disableFullscreenUI
                value={formDescription}
                onChangeText={setFormDescription}
                placeholder="Kurze Notiz..."
                placeholderTextColor={theme.textTertiary}
                multiline
                style={[
                  styles.input,
                  styles.inputMultiline,
                  { color: theme.text, backgroundColor: theme.card, borderColor: theme.border },
                ]}
                testID="input-resource-description"
              />

              <ThemedText style={[styles.label, { color: theme.textSecondary }]}>Kategorie</ThemedText>
              <View style={styles.categoryChips}>
                {allCategories.map((cat) => {
                  const active = cat === formCategory;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => setFormCategory(cat)}
                      style={[
                        styles.chip,
                        {
                          borderColor: active ? theme.primary : theme.border,
                          backgroundColor: active ? theme.primary + "1A" : "transparent",
                        },
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.chipText,
                          { color: active ? theme.primary : theme.textSecondary },
                        ]}
                      >
                        {cat}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput disableFullscreenUI
                value={formCategory}
                onChangeText={setFormCategory}
                placeholder="Eigene Kategorie eingeben"
                placeholderTextColor={theme.textTertiary}
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: theme.card, borderColor: theme.border, marginTop: 8 },
                ]}
                testID="input-resource-category"
              />

              {formError ? <ThemedText style={styles.errorText}>{formError}</ThemedText> : null}

              <Pressable
                onPress={handleSave}
                disabled={isSaving}
                style={[
                  styles.saveBtn,
                  { backgroundColor: theme.primary, opacity: isSaving ? 0.6 : 1 },
                ]}
                testID="button-resource-save"
              >
                {isSaving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <ThemedText style={styles.saveBtnText}>
                    {editingId ? "Speichern" : "Anlegen"}
                  </ThemedText>
                )}
              </Pressable>
            </KeyboardAwareScrollViewCompat>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerNote: {
    ...Typography.body,
    textAlign: "center",
    marginBottom: Spacing.xl,
    lineHeight: 22,
  },
  categoryCard: { marginBottom: Spacing.md, overflow: "hidden" },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  categoryTitle: { ...Typography.callout, fontWeight: "700", flex: 1 },
  badgeContainer: { marginRight: Spacing.xs },
  badge: { ...Typography.caption },
  linksList: { paddingBottom: Spacing.sm },
  linkItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  linkMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.md },
  linkIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  linkContent: { flex: 1 },
  linkTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  linkTitle: { ...Typography.body, fontWeight: "600" },
  customBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  customBadgeText: { fontSize: 10, fontWeight: "700" },
  linkDescription: { ...Typography.caption, marginTop: 2, lineHeight: 18 },
  linkActions: { flexDirection: "row", gap: 6, marginLeft: 6 },
  linkActionBtn: { padding: 6 },
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
  inputMultiline: { minHeight: 80, textAlignVertical: "top" },
  categoryChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  chipText: { fontSize: 12, fontWeight: "600" },
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
