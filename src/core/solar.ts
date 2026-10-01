/** NOAA 简化算法：计算北京（天安门）指定日期的日出 / 日落时间（北京时间，当天秒数）。 */
export function sunTimes(year: number, month: number, day: number, lat = 39.9042, lon = 116.3976, tz = 8) {
  const start = Date.UTC(year, 0, 1);
  const N = Math.floor((Date.UTC(year, month - 1, day) - start) / 864e5) + 1;
  const g = ((2 * Math.PI) / 365) * (N - 1);
  const eq =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const latR = (lat * Math.PI) / 180;
  const cosH = Math.cos((90.833 * Math.PI) / 180) / (Math.cos(latR) * Math.cos(decl)) - Math.tan(latR) * Math.tan(decl);
  const ha = (Math.acos(Math.max(-1, Math.min(1, cosH))) * 180) / Math.PI;
  const rise = 720 - 4 * (lon + ha) - eq + tz * 60;
  const set = 720 - 4 * (lon - ha) - eq + tz * 60;
  return { sunrise: rise * 60, sunset: set * 60 };
}

/** 月相 0..1（0 = 新月，0.5 = 满月） */
export function moonPhase(year: number, month: number, day: number) {
  const known = Date.UTC(2000, 0, 6, 18, 14);
  const syn = 29.530588853;
  const d = (Date.UTC(year, month - 1, day, 12) - known) / 864e5 - 8 / 24;
  return (((d / syn) % 1) + 1) % 1;
}
