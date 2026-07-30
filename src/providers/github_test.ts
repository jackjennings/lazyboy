import { assertEquals, assertRejects } from "@std/assert";
import { GitHubProvider } from "./github.ts";
import { compareSortKeys } from "./types.ts";

function fixedResolver(token: string, login: string) {
  return (_org: string) => ({ token, login });
}

Deno.test("fetchNew filters out known IDs", async () => {
  const provider = new GitHubProvider({
    repos: ["jackjennings/lazyboy"],
    accountResolver: fixedResolver("fake", "jackjennings"),
    _fetch: (_url, _token) =>
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
    accountResolver: fixedResolver("fake", "jackjennings"),
    _fetch: (_url, _token) =>
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
    accountResolver: fixedResolver("fake", "jackjennings"),
    _fetch: (_url, _token) =>
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

Deno.test("fetchNew passes org-resolved token and login to _fetch", async () => {
  const receivedArgs: Array<{ url: string; token: string }> = [];
  const provider = new GitHubProvider({
    repos: ["jackjennings/lazyboy", "workorg/app"],
    accountResolver: (org) => {
      if (org === "jackjennings") {
        return { token: "tok_personal", login: "jack" };
      }
      if (org === "workorg") return { token: "tok_work", login: "work-user" };
      return { token: "tok_default", login: "default" };
    },
    _fetch: (url, token) => {
      receivedArgs.push({ url, token });
      return Promise.resolve([]);
    },
  });
  await provider.fetchNew(new Set());
  assertEquals(receivedArgs.length, 2);
  assertEquals(receivedArgs[0].token, "tok_personal");
  assertEquals(receivedArgs[0].url.includes("assignee=jack"), true);
  assertEquals(receivedArgs[1].token, "tok_work");
  assertEquals(receivedArgs[1].url.includes("assignee=work-user"), true);
});

Deno.test("GitHubProvider.close calls _patch with correct API URL and body", async () => {
  let patchedUrl = "";
  let patchedBody: unknown;
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: fixedResolver("fake", "user"),
    _patch: async (url, body, _token) => {
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

Deno.test("GitHubProvider.close passes org-resolved token to _patch", async () => {
  let receivedToken = "";
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: (org) => ({
      token: org === "myorg" ? "tok_org" : "tok_default",
      login: "user",
    }),
    _patch: async (_url, _body, token) => {
      receivedToken = token;
      await Promise.resolve();
    },
  });
  await provider.close("https://github.com/myorg/myrepo/issues/42");
  assertEquals(receivedToken, "tok_org");
});

Deno.test("GitHubProvider.close throws on unrecognized URL", async () => {
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: fixedResolver("fake", "user"),
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
    accountResolver: fixedResolver("fake", "user"),
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
  assertEquals(GitHubProvider.toSortable("github/jackjennings/lazyboy/3"), [3]);
});

Deno.test("toSortable: github/org/repo/12 returns [12]", () => {
  assertEquals(GitHubProvider.toSortable("github/jackjennings/lazyboy/12"), [
    12,
  ]);
});

Deno.test("toSortable: issue 3 sorts before issue 12 via compareSortKeys", () => {
  assertEquals(
    compareSortKeys(
      GitHubProvider.toSortable("github/jackjennings/lazyboy/3"),
      GitHubProvider.toSortable("github/jackjennings/lazyboy/12"),
    ) < 0,
    true,
  );
});

Deno.test("GitHubProvider.isPRMerged: returns true for HTTP 204", async () => {
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: fixedResolver("fake", "user"),
    _mergeCheck: (_url, _token) => Promise.resolve({ status: 204 }),
  });
  assertEquals(
    await provider.isPRMerged("https://github.com/myorg/myrepo/pull/42"),
    true,
  );
});

Deno.test("GitHubProvider.isPRMerged: returns false for HTTP 404", async () => {
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: fixedResolver("fake", "user"),
    _mergeCheck: (_url, _token) => Promise.resolve({ status: 404 }),
  });
  assertEquals(
    await provider.isPRMerged("https://github.com/myorg/myrepo/pull/42"),
    false,
  );
});

Deno.test("GitHubProvider.isPRMerged: throws on unexpected status code", async () => {
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: fixedResolver("fake", "user"),
    _mergeCheck: (_url, _token) => Promise.resolve({ status: 500 }),
  });
  await assertRejects(
    () => provider.isPRMerged("https://github.com/myorg/myrepo/pull/42"),
    Error,
    "Unexpected GitHub API status",
  );
});

Deno.test("GitHubProvider.isPRMerged: throws on unrecognized PR URL", async () => {
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: fixedResolver("fake", "user"),
    _mergeCheck: (_url, _token) => Promise.resolve({ status: 204 }),
  });
  await assertRejects(
    () => provider.isPRMerged("https://example.com/not-a-pr"),
    Error,
    "Cannot parse PR URL",
  );
});

Deno.test("GitHubProvider.isPRMerged: calls the correct merge-check endpoint", async () => {
  let calledUrl = "";
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: fixedResolver("fake", "user"),
    _mergeCheck: (url, _token) => {
      calledUrl = url;
      return Promise.resolve({ status: 204 });
    },
  });
  await provider.isPRMerged("https://github.com/myorg/myrepo/pull/42");
  assertEquals(
    calledUrl,
    "https://api.github.com/repos/myorg/myrepo/pulls/42/merge",
  );
});

Deno.test("GitHubProvider.prState: returns merged when the PR is merged", async () => {
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: fixedResolver("fake", "user"),
    _prFetch: (_url, _token) =>
      Promise.resolve({ merged: true, state: "closed" }),
  });
  assertEquals(
    await provider.prState("https://github.com/myorg/myrepo/pull/42"),
    "merged",
  );
});

Deno.test("GitHubProvider.prState: returns closed when the PR is closed unmerged", async () => {
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: fixedResolver("fake", "user"),
    _prFetch: (_url, _token) =>
      Promise.resolve({ merged: false, state: "closed" }),
  });
  assertEquals(
    await provider.prState("https://github.com/myorg/myrepo/pull/42"),
    "closed",
  );
});

Deno.test("GitHubProvider.prState: returns open when the PR is still open", async () => {
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: fixedResolver("fake", "user"),
    _prFetch: (_url, _token) =>
      Promise.resolve({ merged: false, state: "open" }),
  });
  assertEquals(
    await provider.prState("https://github.com/myorg/myrepo/pull/42"),
    "open",
  );
});

Deno.test("GitHubProvider.prState: calls the correct pulls endpoint", async () => {
  let calledUrl = "";
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: fixedResolver("fake", "user"),
    _prFetch: (url, _token) => {
      calledUrl = url;
      return Promise.resolve({ merged: true, state: "closed" });
    },
  });
  await provider.prState("https://github.com/myorg/myrepo/pull/42");
  assertEquals(calledUrl, "https://api.github.com/repos/myorg/myrepo/pulls/42");
});

Deno.test("GitHubProvider.prState: throws on unrecognized PR URL", async () => {
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: fixedResolver("fake", "user"),
    _prFetch: (_url, _token) =>
      Promise.resolve({ merged: false, state: "open" }),
  });
  await assertRejects(
    () => provider.prState("https://example.com/not-a-pr"),
    Error,
    "Cannot parse PR URL",
  );
});

Deno.test("GitHubProvider.isPRMerged: passes org-resolved token to _mergeCheck", async () => {
  let receivedToken = "";
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: (org) => ({
      token: org === "myorg" ? "tok_org" : "tok_default",
      login: "user",
    }),
    _mergeCheck: (_url, token) => {
      receivedToken = token;
      return Promise.resolve({ status: 204 });
    },
  });
  await provider.isPRMerged("https://github.com/myorg/myrepo/pull/42");
  assertEquals(receivedToken, "tok_org");
});

Deno.test("toSortable: non-numeric suffix falls back to [id]", () => {
  assertEquals(
    GitHubProvider.toSortable("github/jackjennings/lazyboy/abc"),
    ["github/jackjennings/lazyboy/abc"],
  );
});

Deno.test("GitHubProvider.clone: calls _clone with slug, destDir, cwd, and resolved token", async () => {
  let captured:
    | { slug: string; destDir: string; cwd: string; token: string }
    | undefined;
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: (org) => ({
      token: org === "myorg" ? "tok_org" : "tok_default",
      login: "user",
    }),
    _clone: (slug, destDir, cwd, token) => {
      captured = { slug, destDir, cwd, token };
      return Promise.resolve();
    },
  });
  await provider.clone("myorg/myrepo", "myrepo", "/tmp/org");
  assertEquals(captured, {
    slug: "myorg/myrepo",
    destDir: "myrepo",
    cwd: "/tmp/org",
    token: "tok_org",
  });
});

Deno.test("GitHubProvider.clone: propagates _clone error", async () => {
  const provider = new GitHubProvider({
    repos: [],
    accountResolver: fixedResolver("fake", "user"),
    _clone: () => Promise.reject(new Error("clone failed")),
  });
  await assertRejects(
    () => provider.clone("myorg/myrepo", "myrepo", "/tmp"),
    Error,
    "clone failed",
  );
});
