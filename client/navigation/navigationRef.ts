import { createNavigationContainerRef } from "@react-navigation/native";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

/** Globale Navigation – z. B. damit Links von überall die Seitenansicht öffnen. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
