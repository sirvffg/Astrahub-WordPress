// Route-scoped Vue components are destroyed when the user opens another Halo
// menu. Keep business state at module scope so a return to AstraHub can reuse
// the same refs without keeping hidden DOM/WebGL resources alive.
const sessionStates = new Map<string, unknown>();

export function useAstraHubSessionState<T>(scope: string, identity: string, factory: () => T): T {
  const key = `${scope}:${String(identity || "anonymous").trim() || "anonymous"}`;
  const existing = sessionStates.get(key) as T | undefined;
  if (existing) {
    return existing;
  }
  const created = factory();
  sessionStates.set(key, created);
  return created;
}

export function clearAstraHubSessionState(scope?: string) {
  const prefix = scope ? `${scope}:` : "";
  for (const key of sessionStates.keys()) {
    if (!prefix || key.startsWith(prefix)) {
      sessionStates.delete(key);
    }
  }
}
