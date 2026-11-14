import React, { createContext, useContext, useEffect, useState } from "react";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";

// Zentrale Netzwerk-Status-Erkennung. Wird sowohl reaktiv (Banner via Hook) als
// auch synchron (Lib-Code: Offline-Fallback in geozones.ts / notams.ts) genutzt.
//
// "Offline" gilt bewusst strikt: nur wenn NetInfo eindeutig KEINE Verbindung
// (isConnected === false) oder KEINE echte Internet-Erreichbarkeit
// (isInternetReachable === false) meldet. Solange der Status unbekannt ist
// (null), behandeln wir die App als online, um Fehlalarme zu vermeiden.
function deriveOffline(state: NetInfoState): boolean {
  return state.isConnected === false || state.isInternetReachable === false;
}

// Modulweiter, immer aktueller Offline-Status. Wird von einem dauerhaften
// Listener gepflegt, damit auch Nicht-React-Code (Lib-Funktionen) ihn lesen kann.
let _isOffline = false;
let _started = false;

function ensureListener() {
  if (_started) return;
  _started = true;
  try {
    NetInfo.addEventListener((state) => {
      _isOffline = deriveOffline(state);
    });
    NetInfo.fetch()
      .then((state) => {
        _isOffline = deriveOffline(state);
      })
      .catch(() => undefined);
  } catch {
    // NetInfo nicht verfügbar (z. B. Web-Fallback) — App bleibt "online".
    _isOffline = false;
  }
}

// Synchroner Zugriff für Lib-Code. Liefert den zuletzt bekannten Status.
export function isOfflineNow(): boolean {
  ensureListener();
  return _isOffline;
}

interface NetworkContextValue {
  isOffline: boolean;
}

const NetworkContext = createContext<NetworkContextValue>({ isOffline: false });

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [isOffline, setIsOffline] = useState<boolean>(_isOffline);

  useEffect(() => {
    ensureListener();
    let cancelled = false;
    const apply = (state: NetInfoState) => {
      const off = deriveOffline(state);
      _isOffline = off;
      if (!cancelled) setIsOffline(off);
    };
    const unsub = NetInfo.addEventListener(apply);
    NetInfo.fetch().then(apply).catch(() => undefined);
    return () => {
      cancelled = true;
      try {
        unsub();
      } catch {
        // ignore
      }
    };
  }, []);

  return <NetworkContext.Provider value={{ isOffline }}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  return useContext(NetworkContext);
}
