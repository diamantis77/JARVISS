export function athensDayStartUtc(now = new Date()) {
  const dateParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => Number(dateParts.find((item) => item.type === name)?.value);
  const utcMidnight = Date.UTC(part("year"), part("month") - 1, part("day"));
  const localHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", hourCycle: "h23" }).format(new Date(utcMidnight)));
  return new Date(utcMidnight - localHour * 60 * 60_000).toISOString();
}
