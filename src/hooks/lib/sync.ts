/** Best-effort session sync to the local dashboard server. Never throws. */
export async function syncSession(sessionId: string, timeoutMs = 800): Promise<void> {
  if (!sessionId) return;
  const port = process.env['CTK_PORT'] ?? '3200';
  try {
    await fetch(`http://localhost:${port}/api/sessions/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    /* server down: the periodic sync will catch up */
  }
}
