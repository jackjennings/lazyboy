import { assertEquals } from "jsr:@std/assert";
import { GitHubProvider } from "./github.ts";

Deno.test("fetchNew filters out known IDs", async () => {
  const provider = new GitHubProvider({
    repos: ["jackjennings/lazyboy"],
    token: "fake",
    login: "jackjennings",
    _fetch: async (_url: string) => [
      {
        number: 1,
        title: "One",
        body: "desc",
        html_url: "https://github.com/x/y/issues/1",
      },
      {
        number: 2,
        title: "Two",
        body: "desc2",
        html_url: "https://github.com/x/y/issues/2",
      },
    ],
  });
  const items = await provider.fetchNew(new Set(["gh-1"]));
  assertEquals(items.length, 1);
  assertEquals(items[0].id, "gh-2");
  assertEquals(items[0].provider, "github");
  assertEquals(items[0].title, "Two");
});

Deno.test("fetchNew returns all when knownIds is empty", async () => {
  const provider = new GitHubProvider({
    repos: ["jackjennings/lazyboy"],
    token: "fake",
    login: "jackjennings",
    _fetch: async (_url: string) => [
      {
        number: 1,
        title: "One",
        body: "desc",
        html_url: "https://github.com/x/y/issues/1",
      },
    ],
  });
  const items = await provider.fetchNew(new Set());
  assertEquals(items.length, 1);
  assertEquals(items[0].id, "gh-1");
});
