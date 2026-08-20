import { assertEquals, assertFalse } from "@std/assert";
import {
  parseIssueUrl,
  parsePrUrl,
  parseRemoteSlug,
  parseTicketId,
  slugOf,
  ticketIdFor,
} from "./identity.ts";

Deno.test("parsePrUrl: valid PR URL returns parts", () => {
  assertEquals(parsePrUrl("https://github.com/foo/bar/pull/42"), {
    org: "foo",
    repo: "bar",
    number: 42,
  });
});

Deno.test("parsePrUrl: malformed URL returns null", () => {
  assertEquals(parsePrUrl("https://example.com/foo"), null);
  assertEquals(parsePrUrl("not a url"), null);
});

Deno.test("parseIssueUrl: valid issue URL returns parts", () => {
  assertEquals(
    parseIssueUrl("https://github.com/acme/widget/issues/7"),
    { org: "acme", repo: "widget", number: 7 },
  );
});

Deno.test("parseTicketId: valid github id returns parts", () => {
  assertEquals(parseTicketId("github/foo/bar/23"), {
    org: "foo",
    repo: "bar",
    number: 23,
  });
});

Deno.test("parseTicketId: too few segments returns null", () => {
  assertEquals(parseTicketId("github/foo"), null);
  assertEquals(parseTicketId("github/foo/bar"), null);
});

Deno.test("parseTicketId: non-github provider returns null", () => {
  assertEquals(parseTicketId("jira/PROJ-1"), null);
});

Deno.test("ticketIdFor round-trips with parseTicketId", () => {
  const parts = { org: "acme", repo: "core", number: 99 };
  assertEquals(parseTicketId(ticketIdFor(parts)), parts);
});

Deno.test("slugOf formats org/repo", () => {
  assertEquals(slugOf({ org: "foo", repo: "bar" }), "foo/bar");
});

Deno.test("parseRemoteSlug: equality check prevents prefix false-positive", () => {
  const slug = parseRemoteSlug("https://github.com/org/lazyboy-core.git");
  assertEquals(slug, "org/lazyboy-core");
  assertFalse(slug === "org/lazyboy");
});

Deno.test("parseRemoteSlug: SSH remote", () => {
  assertEquals(parseRemoteSlug("git@github.com:foo/bar.git"), "foo/bar");
});

Deno.test("parseRemoteSlug: invalid URL returns null", () => {
  assertEquals(parseRemoteSlug("not-a-remote"), null);
});
