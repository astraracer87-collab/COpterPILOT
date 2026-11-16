// Lokaler, optimistischer Zustand für Checklisten (Abhaken ohne Verzögerung).
//
// Hintergrund (Gerät: DJI RC Pro 2): Jedes Abhaken soll im selben Frame
// sichtbar sein. Deshalb
// - liegt der Zustand lokal im Screen (kein Speicherzugriff vor dem Umschalten),
// - ist `toggle` eine stabile Funktion (useCallback ohne Abhängigkeiten), damit
//   memoisierte Zeilen (React.memo) nur neu rendern, wenn sich ihr eigenes
//   `checked` ändert,
// - laufen Nebenwirkungen (Haptik) NICHT im setState-Updater (der darf in
//   React mehrfach laufen),
// - wird eine optionale Speicherung gebündelt: höchstens alle `debounceMs`
//   (Standard 500 ms) ein Schreibvorgang, plus sofortiges Nachschreiben beim
//   Verlassen des Screens (blur/beforeRemove), beim Unmount und wenn die App in
//   den Hintergrund geht. So geht kein Haken verloren, aber eine schnelle Folge
//   von Haken schreibt nicht jedes Mal die komplette Session-Liste neu.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type React from "react";
import { AppState, type AppStateStatus } from "react-native";
import { NavigationContext } from "@react-navigation/native";
import * as Haptics from "expo-haptics";

export interface ChecklistStateOptions {
  /** Gebündelte Speicherung des aktuellen Stands (IDs in Einfüge-Reihenfolge). */
  onPersist?: (ids: string[]) => void | Promise<void>;
  /** Mindestabstand zwischen zwei Speichervorgängen. Standard: 500 ms. */
  debounceMs?: number;
  /** Wird beim Abhaken (nicht beim Entfernen) aufgerufen, z. B. für Haptik. */
  onCheck?: (id: string) => void;
}

export interface ChecklistState {
  checked: ReadonlySet<string>;
  /** Stabil über alle Renders. */
  toggle: (id: string) => void;
  /** Stand komplett ersetzen (z. B. beim Laden eines gespeicherten Stands); speichert nicht. */
  replace: (ids: Iterable<string>) => void;
  /** Stand ergänzen (z. B. automatisch vorgehakte Punkte); speichert nicht. */
  add: (ids: Iterable<string>) => void;
  /** Ausstehende Speicherung sofort ausführen. */
  flush: () => void;
}

export const CHECKLIST_PERSIST_DEBOUNCE_MS = 500;

// Fallback, falls NavigationContext nicht verfügbar ist (z. B. Tests, die
// @react-navigation/native nur teilweise mocken).
type NavLike = { addListener?: (event: any, cb: () => void) => (() => void) | undefined } | undefined;
const NoNavigationContext = createContext<NavLike>(undefined);

export function useChecklistState(
  initial?: Iterable<string> | (() => Iterable<string>),
  options: ChecklistStateOptions = {},
): ChecklistState {
  const [checked, setChecked] = useState<Set<string>>(() => {
    const src = typeof initial === "function" ? initial() : initial;
    return new Set(src ?? []);
  });

  // Spiegel des aktuellen Stands: `toggle` bleibt stabil und kennt trotzdem den
  // Vorzustand (für onCheck), ohne Nebenwirkungen im Updater. Jede Änderung
  // läuft über toggle/replace/add, die den Spiegel selbst nachziehen.
  const checkedRef = useRef(checked);

  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const persist = optionsRef.current.onPersist;
    if (!persist) return;
    try {
      const res = persist(Array.from(checkedRef.current));
      if (res && typeof (res as Promise<void>).catch === "function") {
        (res as Promise<void>).catch(() => {});
      }
    } catch {
      // Speicherfehler dürfen die Bedienung nie blockieren.
    }
  }, []);

  const schedulePersist = useCallback(() => {
    if (!optionsRef.current.onPersist) return;
    dirtyRef.current = true;
    if (timerRef.current) return; // läuft bereits – Haken werden gebündelt
    const delay = optionsRef.current.debounceMs ?? CHECKLIST_PERSIST_DEBOUNCE_MS;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flush();
    }, delay);
  }, [flush]);

  const toggle = useCallback(
    (id: string) => {
      const prev = checkedRef.current;
      const next = new Set(prev);
      const nowChecked = !prev.has(id);
      if (nowChecked) next.add(id);
      else next.delete(id);
      // Ref sofort nachziehen: mehrere Taps vor dem nächsten Render bleiben korrekt.
      checkedRef.current = next;
      setChecked(next);
      if (nowChecked) {
        try {
          optionsRef.current.onCheck?.(id);
        } catch {}
      }
      schedulePersist();
    },
    [schedulePersist],
  );

  const replace = useCallback((ids: Iterable<string>) => {
    const next = new Set(ids);
    checkedRef.current = next;
    setChecked(next);
  }, []);

  const add = useCallback((ids: Iterable<string>) => {
    const next = new Set(checkedRef.current);
    for (const id of ids) next.add(id);
    checkedRef.current = next;
    setChecked(next);
  }, []);

  // App geht in den Hintergrund (z. B. Wechsel zu DJI Fly) → sofort sichern.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "background" || s === "inactive") flush();
    });
    return () => sub?.remove?.();
  }, [flush]);

  // Navigation weg vom Screen → sofort sichern (falls in einem Navigator).
  const navigation = useContext(
    ((NavigationContext as unknown) ?? NoNavigationContext) as React.Context<NavLike>,
  );
  useEffect(() => {
    if (!navigation || typeof navigation.addListener !== "function") return;
    const offBlur = navigation.addListener("blur", flush);
    const offRemove = navigation.addListener("beforeRemove", flush);
    return () => {
      offBlur?.();
      offRemove?.();
    };
  }, [navigation, flush]);

  // Unmount → ausstehende Haken schreiben.
  useEffect(() => () => flush(), [flush]);

  return { checked, toggle, replace, add, flush };
}

/** Leichte Haptik beim Abhaken – feuert asynchron und wirft nie. */
export function checklistHaptic(): void {
  try {
    void Promise.resolve(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => {});
  } catch {}
}
