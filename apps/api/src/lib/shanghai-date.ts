/**
 * Return the UTC instant for 00:00:00 of the current Asia/Shanghai (UTC+8) day.
 *
 * Used by daily-limit reset: any users.dailySubmissionResetAt strictly before
 * this instant means the user is on a new day and the count should reset.
 */
export function startOfTodayShanghai(now: Date = new Date()): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA gives "YYYY-MM-DD"
  const ymd = fmt.format(now); // e.g. "2026-06-08"
  return new Date(`${ymd}T00:00:00+08:00`);
}
