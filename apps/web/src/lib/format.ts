/** "Mon, Oct 5, 10:12 AM CDT" in a given time zone. */
export function formatDateTime(date: Date | string | null | undefined, timeZone?: string): string {
  if (!date) return "–";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone, timeZoneName: "short" }).format(new Date(date));
}

/** "Oct 5, 2026" in a given time zone. */
export function formatDate(date: Date | string | null | undefined, timeZone?: string): string {
  if (!date) return "–";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone }).format(new Date(date));
}

/** "in 3 hours", "2 days ago". */
export function relativeTime(date: Date | string, now = new Date()): string {
  const diff = new Date(date).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const [value, unit] = abs < 3_600_000 ? [Math.round(abs / 60_000), "minute"] : abs < 86_400_000 ? [Math.round(abs / 3_600_000), "hour"] : [Math.round(abs / 86_400_000), "day"];
  const label = `${value} ${unit}${value === 1 ? "" : "s"}`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

export const formatPhone = (e164: string | null | undefined) => (e164 ? e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") : "–");
