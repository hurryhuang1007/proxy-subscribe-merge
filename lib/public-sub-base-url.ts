/** Normalize PUBLIC_SUB_BASE_URL to a full `/sub` endpoint URL. */
function normalizeSubBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, '');
  if (/\/sub$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/sub`;
}

/**
 * Base URL for `/sub` embedded in Clash proxy-provider links.
 * Uses PUBLIC_SUB_BASE_URL when set (e.g. reverse proxy or public hostname differs from request Host).
 */
export function resolveSubBaseUrl(requestUrl: URL): string {
  const configured = process.env.PUBLIC_SUB_BASE_URL?.trim();
  if (configured) {
    return normalizeSubBaseUrl(configured);
  }
  return `${requestUrl.origin}/sub`;
}
