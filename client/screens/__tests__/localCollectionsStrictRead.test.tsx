/**
 * Lokale Nutzer-Sammlungen (Glossar/Ressourcen, localCollections.ts): ein
 * beschädigter/unlesbarer Wert darf bei POST/PUT/DELETE nicht durch eine leere
 * Liste ersetzt werden (sonst sind alle eigenen Einträge weg).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { handleLocalCollection, LOCAL_COLLECTIONS } from "@/lib/localCollections";

const ROUTE = "/api/user-glossary";
const KEY = LOCAL_COLLECTIONS[ROUTE].storageKey;

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("localCollections: strikte Lesung auf Schreibpfaden", () => {
  it("normaler Ablauf: anlegen, ändern, löschen", async () => {
    const created = (await handleLocalCollection("POST", ROUTE, { term: "VLOS", definition: "Sichtflug" })) as { id: string };
    await handleLocalCollection("PUT", `${ROUTE}/${created.id}`, { definition: "Sichtweite" });
    const list = (await handleLocalCollection("GET", ROUTE)) as { definition: string }[];
    expect(list).toHaveLength(1);
    expect(list[0].definition).toBe("Sichtweite");
    await handleLocalCollection("DELETE", `${ROUTE}/${created.id}`);
    expect(await handleLocalCollection("GET", ROUTE)).toEqual([]);
  });

  it("beschädigter Wert: GET tolerant, POST/DELETE brechen ab und lassen die Daten stehen", async () => {
    await AsyncStorage.setItem(KEY, "{kaputt");
    expect(await handleLocalCollection("GET", ROUTE)).toEqual([]);
    await expect(handleLocalCollection("POST", ROUTE, { term: "x", definition: "y" })).rejects.toThrow();
    await expect(handleLocalCollection("DELETE", `${ROUTE}/abc`)).rejects.toThrow();
    expect(await AsyncStorage.getItem(KEY)).toBe("{kaputt");
  });

  it("Lesefehler beim Schreiben: kein Überschreiben", async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify([{ id: "a", term: "t", definition: "d" }]));
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error("io")));
    await expect(handleLocalCollection("POST", ROUTE, { term: "x", definition: "y" })).rejects.toThrow();
    expect(JSON.parse((await AsyncStorage.getItem(KEY)) as string)).toHaveLength(1);
  });
});
