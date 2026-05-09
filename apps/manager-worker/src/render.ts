/**
 * POST to `/api/creators/<creator_id>/render` — the SSE producer endpoint
 * shipped in C-13a. Inserts a `render_events` row + NOTIFY; the iframe at
 * `/o/<creator_id>` receives it via the long-lived SSE stream.
 *
 * MVP shape: just `{ message }`. When the auction layer (C-14) lands and
 * pre-gen ads (D-10) populates the `ads` table, this payload extends to
 * `{ asset_url, asset_type, duration_ms, zone, placement_id, brand_id }`
 * without changing transport.
 */

const MAX_MESSAGE_LEN = 280;

export async function postRender(
  apiBase: string,
  creatorId: string,
  message: string,
): Promise<{ ok: true; eventId: string } | { ok: false; error: string }> {
  const url = `${apiBase.replace(/\/+$/, "")}/api/creators/${encodeURIComponent(creatorId)}/render`;
  const body = JSON.stringify({ message: message.slice(0, MAX_MESSAGE_LEN) });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch (err) {
    return { ok: false, error: `fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }
  const json = (await res.json().catch(() => null)) as { event?: { id?: string } } | null;
  return { ok: true, eventId: json?.event?.id ?? "?" };
}
