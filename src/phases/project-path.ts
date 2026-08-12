export function deriveProjectPath(provider: string, ticketId: string): string {
  if (provider === "github") {
    const segments = ticketId.split("/");
    return segments.slice(1, -1).join("/");
  }
  if (provider === "jira") {
    const key = ticketId.split("/")[1] ?? "";
    return key.replace(/-\d+$/, "");
  }
  return "";
}
