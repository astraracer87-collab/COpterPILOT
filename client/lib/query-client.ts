import { QueryClient, QueryFunction } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Gets the base URL for the Express API server (e.g., "http://localhost:3000")
 *
 * Resolution order:
 * 1. EXPO_PUBLIC_DOMAIN env var (preferred, baked into bundle at build time)
 * 2. Expo manifest hostUri (dev server / Expo Go fallback)
 * Never throws — falls back to empty origin so fetch produces a clear network
 * error in the catch handler instead of a silent throw before any request.
 */
export function getApiUrl(): string {
  const envHost = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  if (envHost) {
    let clean = envHost.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    // Replit dev/app domains route external HTTPS to the internal Express port
    // automatically. The Expo workflow appends ":5000" so the bundler can reach
    // it locally, but mobile devices must hit the bare HTTPS host — otherwise
    // every API call fails with a network error.
    const expoWebDevBackend =
      Platform.OS === "web" && __DEV__ && /\.replit\.dev:5000$/i.test(clean);
    if (/\.replit\.(dev|app)(:\d+)?$/i.test(clean) && !expoWebDevBackend) {
      clean = clean.replace(/:\d+$/, "");
    }
    try {
      return new URL(`https://${clean}`).href;
    } catch {
      // fall through
    }
  }

  const manifest: any = Constants.expoConfig ?? (Constants as any).manifest ?? {};
  const hostUri: string | undefined =
    manifest?.hostUri ||
    (Constants as any).expoGoConfig?.debuggerHost ||
    manifest?.debuggerHost;
  if (hostUri) {
    const host = hostUri.split("/")[0].split(":")[0];
    if (host) {
      return `http://${host}:5000/`;
    }
  }

  console.warn("[getApiUrl] no EXPO_PUBLIC_DOMAIN and no Expo manifest host — returning relative origin");
  return "";
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
