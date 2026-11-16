/**
 * Rückfrage „Ladevorgang läuft – im Hintergrund weiter loggen?“ mit
 * „Im Hintergrund loggen“ / „Beenden“ und „Auswahl merken“ (setzt die
 * Einstellung „Ladegerät im Hintergrund loggen“).
 */
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import Checkbox from "@/components/Checkbox";
import { useTheme } from "@/hooks/useTheme";
import { BorderRadius, Spacing, Typography } from "@/constants/theme";
import { answerLeaveDialog, useLeaveDialogOpen } from "@/hooks/useCharger";
import {
  LEAVE_DIALOG_CONTINUE,
  LEAVE_DIALOG_REMEMBER,
  LEAVE_DIALOG_STOP,
  LEAVE_DIALOG_TITLE,
} from "@/lib/charger/chargerBackground";

export function ChargerLeaveDialogView({
  visible,
  onAnswer,
}: {
  visible: boolean;
  onAnswer: (choice: "continue" | "stop", remember: boolean) => void;
}) {
  const { theme } = useTheme();
  const [remember, setRemember] = useState(false);
  const answer = (choice: "continue" | "stop") => {
    const r = remember;
    setRemember(false); // nächstes Öffnen wieder ohne Haken
    onAnswer(choice, r);
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => answer("continue")}
      supportedOrientations={["landscape", "portrait"]}
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.box,
            {
              backgroundColor: theme.backgroundDefault,
              borderColor: theme.border,
            },
          ]}
          testID="charger-leave-dialog"
        >
          <ThemedText style={styles.title}>{LEAVE_DIALOG_TITLE}</ThemedText>
          <ThemedText style={[styles.text, { color: theme.textSecondary }]}>
            Im Hintergrund bleibt die Verbindung zum Ladegerät bestehen (stille
            Daueranzeige). Beenden speichert den Ladevorgang bis jetzt.
          </ThemedText>
          <Checkbox
            checked={remember}
            onPress={() => setRemember((r) => !r)}
            label={LEAVE_DIALOG_REMEMBER}
          />
          <View style={styles.buttons}>
            <Pressable
              testID="charger-leave-stop"
              onPress={() => answer("stop")}
              style={({ pressed }) => [
                styles.btn,
                {
                  backgroundColor: theme.backgroundSecondary,
                  borderColor: theme.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <ThemedText style={styles.btnText}>
                {LEAVE_DIALOG_STOP}
              </ThemedText>
            </Pressable>
            <Pressable
              testID="charger-leave-continue"
              onPress={() => answer("continue")}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: theme.primary, borderColor: theme.primary },
                pressed && styles.pressed,
              ]}
            >
              <ThemedText style={[styles.btnText, { color: "#FFFFFF" }]}>
                {LEAVE_DIALOG_CONTINUE}
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function ChargerLeaveDialog() {
  const open = useLeaveDialogOpen();
  return (
    <ChargerLeaveDialogView
      visible={open}
      onAnswer={(c, r) => void answerLeaveDialog(c, r)}
    />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.lg,
  },
  box: {
    width: "100%",
    maxWidth: 520,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  title: { ...Typography.h4 },
  text: { ...Typography.small },
  buttons: {
    flexDirection: "row",
    gap: Spacing.md,
    justifyContent: "flex-end",
  },
  btn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
  },
  btnText: { ...Typography.body, fontWeight: "600" },
  pressed: { opacity: 0.75 },
});
