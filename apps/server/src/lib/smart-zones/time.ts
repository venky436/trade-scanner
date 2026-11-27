// IST helpers. Candle times are epoch seconds of the candle OPEN.
const IST_SEC = 330 * 60;

/** "YYYY-MM-DD" in IST */
export function istDate(t: number): string {
  return new Date((t + IST_SEC) * 1000).toISOString().slice(0, 10);
}

/** Minutes since IST midnight (09:15 → 555). */
export function istMin(t: number): number {
  const d = new Date((t + IST_SEC) * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** hh:mm → minutes since midnight */
export const hm = (h: number, m: number) => h * 60 + m;

/** "HH:MM" in IST */
export function istHHMM(t: number): string {
  return new Date((t + IST_SEC) * 1000).toISOString().slice(11, 16);
}
