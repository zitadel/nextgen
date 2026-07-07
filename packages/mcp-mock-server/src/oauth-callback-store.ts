type CallbackEntry = {
  code: string;
  receivedAt: number;
};

const callbacks = new Map<string, CallbackEntry>();

export function storeOAuthCallback(state: string, code: string): void {
  callbacks.set(state, { code, receivedAt: Date.now() });
}

export function takeOAuthCallback(state: string): string | undefined {
  const entry = callbacks.get(state);
  if (!entry) {
    return undefined;
  }
  callbacks.delete(state);
  return entry.code;
}

export function clearOAuthCallbacks(): void {
  callbacks.clear();
}

export async function waitForOAuthCallbackFromStore(
  state: string,
  timeoutMs: number,
  pollIntervalMs = 250,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const code = takeOAuthCallback(state);
    if (code) {
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for OAuth callback state=${state}`);
}
