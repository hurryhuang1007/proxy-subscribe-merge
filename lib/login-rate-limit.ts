type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function getMaxAttempts(): number {
  const n = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 5);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

function getWindowMs(): number {
  const n = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? 60_000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60_000;
}

/** Best-effort client IP for rate limiting (trust X-Forwarded-For only behind your reverse proxy). */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }
  return 'unknown';
}

export function checkLoginRateLimit(
  ip: string,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const max = getMaxAttempts();
  const windowMs = getWindowMs();
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(ip, bucket);
  }
  if (bucket.count >= max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  return { ok: true };
}
