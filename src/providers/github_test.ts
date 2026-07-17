import { assertEquals } from "@std/assert";
import { GitHubProvider } from "./github.ts";

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
