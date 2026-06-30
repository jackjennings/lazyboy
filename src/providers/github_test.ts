import { assertEquals, assertRejects } from "@std/assert";
import { GitHubProvider } from "./github.ts";
import { compareSortKeys } from "./types.ts";

Deno.test("fetchNew filters out known IDs", async () => {
  const provider = new GitHubProvider({
    repos: ["jackjennings/lazyboy"],
    token: "fake",
    login: "jackjennings",
    _fetch: (_url: string) =>
      Promise.resolve([
        {
          number: 1,
          title: "One",
          body: "desc",
          html_url: "https://github.com/jackjennings/lazyboy/issues/1",
        },
        {
          number: 2,
          title: "Two",
          body: "desc2",
          html_url: "https://github.com/jackjennings/lazyboy/issues/2",
        },
      ]),
  });
  const items = await provider.fetchNew(
    new Set(["github/jackjennings/lazyboy/1"]),
  );
  assertEquals(items.length, 1);
  assertEquals(items[0].id, "github/jackjennings/lazyboy/2");
  assertEquals(items[0].provider, "github");
  assertEquals(items[0].title, "Two");
});

Deno.test("fetchNew does not re-create an issue tracked under its legacy gh-<n> id", async () => {
  const provider = new GitHubProvider({
    repos: ["jackjennings/lazyboy"],
    token: "fake",
    login: "jackjennings",
    _fetch: (_url: string) =>
      Promise.resolve([
        {
          number: 18,
          title: "Retry subcommand",
          body: "desc",
          html_url: "https://github.com/jackjennings/lazyboy/issues/18",
        },
      ]),
  });
  const items = await provider.fetchNew(new Set(["gh-18"]));
  assertEquals(items.length, 0);
});

Deno.test("fetchNew returns all when knownIds is empty", async () => {
  const provider = new GitHubProvider({
    repos: ["jackjennings/lazyboy"],
    token: "fake",
    login: "jackjennings",
    _fetch: (_url: string) =>
      Promise.resolve([
        {
          number: 1,
          title: "One",
          body: "desc",
          html_url: "https://github.com/jackjennings/lazyboy/issues/1",
        },
      ]),
  });
  const items = await provider.fetchNew(new Set());
  assertEquals(items.length, 1);
  assertEquals(items[0].id, "github/jackjennings/lazyboy/1");
});

Deno.test("GitHubProvider.close calls _patch with correct API URL and body", async () => {
  let patchedUrl = "";
  let patchedBody: unknown;
  const provider = new GitHubProvider({
    repos: [],
    token: "fake",
    login: "user",
    _patch: async (url, body) => {
      patchedUrl = url;
      patchedBody = body;
      await Promise.resolve();
    },
  });
  await provider.close("https://github.com/myorg/myrepo/issues/42");
  assertEquals(
    patchedUrl,
    "https://api.github.com/repos/myorg/myrepo/issues/42",
  );
  assertEquals(patchedBody, { state: "closed", state_reason: "completed" });
});

Deno.test("GitHubProvider.close throws on unrecognized URL", async () => {
  const provider = new GitHubProvider({
    repos: [],
    token: "fake",
    login: "user",
    _patch: async () => {},
  });
  await assertRejects(
    () => provider.close("https://example.com/not-a-github-issue"),
    Error,
  );
});

Deno.test("GitHubProvider.close propagates _patch error", async () => {
  const provider = new GitHubProvider({
    repos: [],
    token: "fake",
    login: "user",
    _patch: async () => {
      return await Promise.reject(new Error("network failure"));
    },
  });
  await assertRejects(
    () => provider.close("https://github.com/myorg/myrepo/issues/42"),
    Error,
    "network failure",
  );
});

Deno.test("toSortable: github/org/repo/3 returns [3]", () => {
  const provider = new GitHubProvider({ repos: [], token: "", login: "" });
  assertEquals(provider.toSortable("github/jackjennings/lazyboy/3"), [3]);
});

Deno.test("toSortable: github/org/repo/12 returns [12]", () => {
  const provider = new GitHubProvider({ repos: [], token: "", login: "" });
  assertEquals(provider.toSortable("github/jackjennings/lazyboy/12"), [12]);
});

Deno.test("toSortable: issue 3 sorts before issue 12 via compareSortKeys", () => {
  const provider = new GitHubProvider({ repos: [], token: "", login: "" });
  assertEquals(
    compareSortKeys(
      provider.toSortable("github/jackjennings/lazyboy/3"),
      provider.toSortable("github/jackjennings/lazyboy/12"),
    ) < 0,
    true,
  );
});

Deno.test("toSortable: non-numeric suffix falls back to [id]", () => {
  const provider = new GitHubProvider({ repos: [], token: "", login: "" });
  assertEquals(
    provider.toSortable("github/jackjennings/lazyboy/abc"),
    ["github/jackjennings/lazyboy/abc"],
  );
});
