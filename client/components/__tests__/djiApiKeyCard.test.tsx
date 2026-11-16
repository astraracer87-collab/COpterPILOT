/**
 * Einstellungen „DJI-Flugprotokolle – API-Schlüssel“: maskierte Eingabe,
 * „Prüfen & speichern“ prüft per DJI-API und legt den Schlüssel NUR im
 * SecureStore ab (nie AsyncStorage), „Entfernen“ löscht ihn wieder.
 */
import React from "react";
import renderer, { act, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("@/lib/webBrowser", () => ({ openLink: jest.fn(async () => {}) }));

import { DjiApiKeyCard } from "../DjiApiKeyCard";
import {
  DJI_API_KEY_STORE_KEY,
  __setDjiSecureStoreForTests,
} from "@/lib/djiApiKeyStore";
import { DJI_KEYCHAINS_ENDPOINT } from "@/lib/djiKeychainApi";

const KEY = "abcDEF123456789xyz";

function textOf(tree: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n == null) return;
    if (typeof n === "string") return void out.push(n);
    if (Array.isArray(n)) return void n.forEach(walk);
    walk(n.children);
  };
  walk(tree.toJSON());
  return out.join(" ");
}

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => {});
}

describe("DjiApiKeyCard", () => {
  const store = new Map<string, string>();
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    __setDjiSecureStoreForTests(null); // echtes (gemocktes) expo-secure-store verwenden
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(
      async (k: string) => store.get(k) ?? null,
    );
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(
      async (k: string, v: string) => void store.set(k, v),
    );
    (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(
      async (k: string) => void store.delete(k),
    );
    fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        result: { code: 1, msg: "keychainsArray is empty" },
      }),
    }));
    (global as any).fetch = fetchMock;
    jest.spyOn(AsyncStorage, "setItem");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("Eingabe ist maskiert; Prüfen & speichern → DJI-Prüfaufruf und SecureStore, nie AsyncStorage", async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DjiApiKeyCard />);
    });
    await flush();
    const input = tree.root.findByProps({ testID: "input-dji-api-key" });
    expect(input.props.secureTextEntry).toBe(true);
    await act(async () => input.props.onChangeText(KEY));
    await act(async () =>
      tree.root.findByProps({ testID: "button-dji-key-save" }).props.onPress(),
    );
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DJI_KEYCHAINS_ENDPOINT);
    expect(init.headers["Api-Key"]).toBe(KEY);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      DJI_API_KEY_STORE_KEY,
      KEY,
    );
    for (const call of (AsyncStorage.setItem as jest.Mock).mock.calls) {
      expect(String(call[1])).not.toContain(KEY);
    }
    const txt = textOf(tree);
    expect(txt).toContain("6789xyz".slice(-4));
    expect(txt).not.toContain(KEY);
    expect(txt).toContain("geprüft und gespeichert");

    await act(async () =>
      tree.root
        .findByProps({ testID: "button-dji-key-remove" })
        .props.onPress(),
    );
    await flush();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(
      DJI_API_KEY_STORE_KEY,
    );
    expect(store.size).toBe(0);
    expect(
      tree.root.findAllByProps({ testID: "button-dji-key-remove" }),
    ).toHaveLength(0);
  });

  it("abgelehnter Schlüssel: deutsche Fehlermeldung, nichts gespeichert", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    }));
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DjiApiKeyCard />);
    });
    await act(async () =>
      tree.root
        .findByProps({ testID: "input-dji-api-key" })
        .props.onChangeText(KEY),
    );
    await act(async () =>
      tree.root.findByProps({ testID: "button-dji-key-save" }).props.onPress(),
    );
    await flush();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain("abgelehnt");
  });

  it("Hilfe zeigt die Schritte im DJI-Entwicklerportal", async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<DjiApiKeyCard />);
    });
    await act(async () =>
      tree.root.findByProps({ testID: "button-dji-key-help" }).props.onPress(),
    );
    const txt = textOf(tree);
    expect(txt).toContain("developer.dji.com");
    expect(txt).toContain("Open API");
  });
});
