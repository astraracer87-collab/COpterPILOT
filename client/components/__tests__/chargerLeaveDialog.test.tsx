/** Rückfrage beim Verlassen während eines Ladevorgangs („loggen“-Wortlaut, „Auswahl merken“). */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";

import { ChargerLeaveDialogView } from "@/components/charger/ChargerLeaveDialog";

jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("@/hooks/useCharger", () => ({
  useLeaveDialogOpen: () => false,
  answerLeaveDialog: jest.fn(),
}));

function texts(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAll((n) => n.type === "Text")
    .map((n) =>
      Array.isArray(n.props.children)
        ? n.props.children.join("")
        : String(n.props.children ?? ""),
    );
}

test("Texte und Antworten mit/ohne „Auswahl merken“", () => {
  const onAnswer = jest.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <ChargerLeaveDialogView visible onAnswer={onAnswer} />,
    );
  });
  const t = texts(tree);
  expect(t).toContain("Ladevorgang läuft – im Hintergrund weiter loggen?");
  expect(t).toContain("Im Hintergrund loggen");
  expect(t).toContain("Beenden");
  expect(t).toContain("Auswahl merken");
  const press = (id: string) =>
    tree.root
      .findAll(
        (n) => n.props.testID === id && typeof n.props.onPress === "function",
      )[0]
      .props.onPress();
  act(() => press("charger-leave-continue"));
  expect(onAnswer).toHaveBeenLastCalledWith("continue", false);
  const checkbox = tree.root.findAll(
    (n) => typeof n.props.onPress === "function" && n.props.testID == null,
  )[0];
  act(() => checkbox.props.onPress());
  act(() => press("charger-leave-stop"));
  expect(onAnswer).toHaveBeenLastCalledWith("stop", true);
});
