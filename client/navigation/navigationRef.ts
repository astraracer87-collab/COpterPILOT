import * as Navigation from "@react-navigation/native";
import type { NavigationContainerRefWithCurrent } from "@react-navigation/native";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

/** Globale Navigation – z. B. damit Links von überall die Seitenansicht öffnen. */
export const navigationRef: NavigationContainerRefWithCurrent<RootStackParamList> =
  typeof Navigation.createNavigationContainerRef === "function"
    ? Navigation.createNavigationContainerRef<RootStackParamList>()
    : // Testumgebungen mit unvollständigem Navigations-Mock
      ({ isReady: () => false, navigate: () => {}, current: null } as unknown as NavigationContainerRefWithCurrent<RootStackParamList>);
