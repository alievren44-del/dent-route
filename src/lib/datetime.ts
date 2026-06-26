/**
 * Timezone-safe datetime helpers for the Capacitor/React saha app (device-local).
 *
 * All functions use LOCAL date getters — never UTC — so the calendar day the
 * user sees on their device matches exactly what is stored in the database.
 *
 * Preferred over `new Date(iso).toISOString()` constructions scattered across
 * components; those can silently produce the wrong calendar day when the
 * device is in UTC+3 and the input is a bare date string.
 */

/**
 * Returns a 'YYYY-MM-DD' string derived from LOCAL date getters.
 * Accepts either an existing Date or an ISO string.
 *
 * @example localDayKey('2026-06-26T22:00:00Z') // 'UTC midnight on 27th → local 01:00' → '2026-06-27' on TR device
 */
export function localDayKey(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns a human-readable Turkish label for an ISO date string.
 * 'Bugün' / 'Yarın' / 'Dün' / full weekday+date otherwise.
 * Uses LOCAL getters so the label matches the device calendar.
 */
export function localDayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Bugün';
  if (diffDays === 1) return 'Yarın';
  if (diffDays === -1) return 'Dün';
  return d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Constructs a LOCAL Date from a 'YYYY-MM-DD' date string and an optional
 * 'HH:mm' time string, then returns its ISO string (UTC representation).
 *
 * When `timeStr` is omitted, defaults to '09:00' (business-hours default).
 * Using `new Date(year, month-1, day, h, m)` (local constructor) guarantees
 * the chosen calendar day is preserved regardless of device timezone.
 *
 * @example buildDueAt('2026-06-27')           // '2026-06-27T06:00:00.000Z' on UTC+3
 * @example buildDueAt('2026-06-27', '14:30')  // '2026-06-27T11:30:00.000Z' on UTC+3
 */
export function buildDueAt(dateStr: string, timeStr?: string): string {
  const [hStr, mStr] = (timeStr ?? '09:00').split(':');
  const h = parseInt(hStr ?? '9', 10);
  const m = parseInt(mStr ?? '0', 10);
  const [yStr, moStr, dStr] = dateStr.split('-');
  const dt = new Date(
    parseInt(yStr ?? '2000', 10),
    parseInt(moStr ?? '1', 10) - 1,
    parseInt(dStr ?? '1', 10),
    isNaN(h) ? 9 : h,
    isNaN(m) ? 0 : m,
    0,
    0,
  );
  return dt.toISOString();
}

/**
 * Returns true when the given date+time is strictly in the past.
 * A 60-second tolerance is applied so the user can hit "Kaydet" immediately
 * after entering a time without a spurious "past date" error.
 *
 * When no time is given, the guard checks against END of day (23:59) so that
 * picking *today* without a time is never rejected — time stays optional
 * ("saat zorunlu olmamalı"). Storage still defaults to 09:00 via buildDueAt.
 */
export function isPastDay(dateStr: string, timeStr?: string): boolean {
  if (!dateStr) return false;
  const guardTime = timeStr && timeStr.trim() ? timeStr : '23:59';
  return new Date(buildDueAt(dateStr, guardTime)).getTime() < Date.now() - 60_000;
}
