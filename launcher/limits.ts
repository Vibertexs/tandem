// Spotting a usage limit in Claude's output, and when it resets.
export const isRateLimit = (out: string) => /rate.?limit|usage limit|limit reached|hit your limit|try again later/i.test(out);

const FALLBACK_MS = 30 * 60_000;
const MAX_MS = 6 * 3600_000; // never wait longer than a 5-hour window (plus slack)

// When the limit resets. Understands "...limit reached|1729800000" (epoch seconds) and
// "resets 3pm" / "resets 3:30 pm" (the next such time, local). Otherwise 30 minutes from now.
export function resetTime(out: string, now = new Date()): Date {
  const clamp = (d: Date) => new Date(Math.min(Math.max(d.getTime(), now.getTime() + 60_000), now.getTime() + MAX_MS));
  const epoch = /limit[^|\n]*\|(\d{10})\b/i.exec(out);
  if (epoch) return clamp(new Date(Number(epoch[1]) * 1000));
  const clock = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(out);
  if (clock) {
    let h = Number(clock[1]) % 12;
    if (clock[3].toLowerCase() === 'pm') h += 12;
    const d = new Date(now);
    d.setHours(h, Number(clock[2] ?? 0), 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return clamp(d);
  }
  return new Date(now.getTime() + FALLBACK_MS);
}
