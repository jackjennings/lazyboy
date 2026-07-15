export function compactTimestamp(now: Temporal.ZonedDateTime): string {
  const dt = now.toPlainDateTime();
  return (
    String(dt.year) +
    String(dt.month).padStart(2, "0") +
    String(dt.day).padStart(2, "0") +
    "T" +
    String(dt.hour).padStart(2, "0") +
    String(dt.minute).padStart(2, "0") +
    String(dt.second).padStart(2, "0")
  );
}
