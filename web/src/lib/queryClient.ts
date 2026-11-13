import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      msg = data.error || data.message || msg;
    } catch {
      try {
        msg = (await res.text()) || msg;
      } catch {}
    }
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown
): Promise<Response> {
  const res = await fetch(route, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });
  await throwIfResNotOk(res);
  return res;
}

export async function apiJson<T = unknown>(
  method: string,
  route: string,
  data?: unknown
): Promise<T> {
  const res = await apiRequest(method, route, data);
  return res.json();
}

const defaultFetcher: QueryFunction = async ({ queryKey }) => {
  const path = queryKey.join("/") as string;
  const res = await fetch(path, { credentials: "include" });
  await throwIfResNotOk(res);
  return res.json();
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: defaultFetcher,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status;
        if (status === 401 || status === 403 || status === 404) return false;
        return failureCount < 1;
      },
    },
    mutations: { retry: false },
  },
});
