// A cancelled camera request can leave its GPU worker finishing in the background.
// A captured still is worth waiting for; only this user-initiated request retries.
export async function requestLensSegmentation(apiFetch, body, {
  isCurrent = () => true, onBusy = () => {}, attempts = 25,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!isCurrent()) throw new DOMException('Capture cancelled', 'AbortError');
    const response = await apiFetch('/api/live-segment', { method: 'POST', body });
    const data = await response.json().catch(() => ({}));
    if (!isCurrent()) throw new DOMException('Capture cancelled', 'AbortError');
    if (response.ok) return data;
    if (response.status !== 503 || attempt === attempts - 1)
      throw new Error(data.detail || 'Could not scan this photo');
    onBusy(attempt + 1);
    await pause(1200);
  }
}
