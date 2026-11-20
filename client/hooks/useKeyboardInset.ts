import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Höhe der eingeblendeten Bildschirmtastatur (0 = keine). Für Modals: deren
 * Fenster wird von Android nicht verkleinert, der Inhalt muss selbst ausweichen.
 */
export function useKeyboardInset(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => setHeight(e?.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
