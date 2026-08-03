import { assertEquals, assertRejects } from "@std/assert";
import { TodoTxtProvider } from "./todo-txt.ts";

const FILE = "/tmp/test-todo.txt";

async function computeHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 8);
}

Deno.test("fetchNew returns work items for non-completed tasks", async () => {
  const provider = new TodoTxtProvider({
    file: FILE,
    _readTextFile: () => Promise.resolve("Buy groceries\nPay rent\n"),
  });
  const items = await provider.fetchNew(new Set());
  assertEquals(items.length, 2);
  const hash0 = await computeHash("Buy groceries");
  assertEquals(items[0].id, `todo-txt/${hash0}`);
  assertEquals(items[0].provider, "todo-txt");
  assertEquals(items[0].title, "Buy groceries");
  assertEquals(items[0].description, "Buy groceries");
  assertEquals(items[0].url, `todo-txt://${FILE}#${hash0}`);
});

Deno.test("fetchNew skips known IDs", async () => {
  const provider = new TodoTxtProvider({
    file: FILE,
    _readTextFile: () => Promise.resolve("Buy groceries\nPay rent\n"),
  });
  const hash = await computeHash("Buy groceries");
  const items = await provider.fetchNew(new Set([`todo-txt/${hash}`]));
  assertEquals(items.length, 1);
  assertEquals(items[0].title, "Pay rent");
});

Deno.test("fetchNew skips completed lines", async () => {
  const provider = new TodoTxtProvider({
    file: FILE,
    _readTextFile: () =>
      Promise.resolve("x 2024-01-01 Buy groceries\nPay rent"),
  });
  const items = await provider.fetchNew(new Set());
  assertEquals(items.length, 1);
  assertEquals(items[0].title, "Pay rent");
});

Deno.test("fetchNew returns [] when file does not exist", async () => {
  const provider = new TodoTxtProvider({
    file: FILE,
    _readTextFile: () => Promise.reject(new Deno.errors.NotFound("missing")),
  });
  const items = await provider.fetchNew(new Set());
  assertEquals(items, []);
});

Deno.test("fetchNew skips blank lines", async () => {
  const provider = new TodoTxtProvider({
    file: FILE,
    _readTextFile: () => Promise.resolve("Buy groceries\n\nPay rent"),
  });
  const items = await provider.fetchNew(new Set());
  assertEquals(items.length, 2);
});

Deno.test("fetchNew title strips priority, tags, contexts, and key:value tokens", async () => {
  const provider = new TodoTxtProvider({
    file: FILE,
    _readTextFile: () =>
      Promise.resolve("(A) Buy groceries +shopping @store due:2024-01-01"),
  });
  const items = await provider.fetchNew(new Set());
  assertEquals(items.length, 1);
  assertEquals(items[0].title, "Buy groceries");
  assertEquals(
    items[0].description,
    "(A) Buy groceries +shopping @store due:2024-01-01",
  );
});

Deno.test("fetchNew description is the raw untrimmed line", async () => {
  const line = "  Buy groceries  ";
  const provider = new TodoTxtProvider({
    file: FILE,
    _readTextFile: () => Promise.resolve(line),
  });
  const items = await provider.fetchNew(new Set());
  assertEquals(items.length, 1);
  assertEquals(items[0].description, line);
});

Deno.test("fetchNew deduplicates identical task lines within a single call", async () => {
  const provider = new TodoTxtProvider({
    file: FILE,
    _readTextFile: () => Promise.resolve("Buy groceries\nBuy groceries"),
  });
  const items = await provider.fetchNew(new Set());
  assertEquals(items.length, 1);
});

Deno.test("close prepends x YYYY-MM-DD to the matching line", async () => {
  const hash = await computeHash("Buy groceries");
  const written: string[] = [];
  const provider = new TodoTxtProvider({
    file: FILE,
    _readTextFile: () => Promise.resolve("Buy groceries\nPay rent"),
    _writeTextFile: (_, content) => {
      written.push(content);
      return Promise.resolve();
    },
  });
  await provider.close(`todo-txt://${FILE}#${hash}`);
  assertEquals(written.length, 1);
  const lines = written[0].split("\n");
  assertEquals(lines[1], "Pay rent");
  assertEquals(/^x \d{4}-\d{2}-\d{2} Buy groceries$/.test(lines[0]), true);
});

Deno.test("close returns without error when hash not found", async () => {
  const written: string[] = [];
  const provider = new TodoTxtProvider({
    file: FILE,
    _readTextFile: () => Promise.resolve("Buy groceries"),
    _writeTextFile: (_, content) => {
      written.push(content);
      return Promise.resolve();
    },
  });
  await provider.close(`todo-txt://${FILE}#00000000`);
  assertEquals(written.length, 0);
});

Deno.test("close leaves file unchanged when matching line is already completed", async () => {
  const hash = await computeHash("Buy groceries");
  const written: string[] = [];
  const provider = new TodoTxtProvider({
    file: FILE,
    _readTextFile: () =>
      Promise.resolve("x 2024-01-01 Buy groceries\nPay rent"),
    _writeTextFile: (_, content) => {
      written.push(content);
      return Promise.resolve();
    },
  });
  await provider.close(`todo-txt://${FILE}#${hash}`);
  assertEquals(written.length, 0);
});

Deno.test("close throws on malformed URL", async () => {
  const provider = new TodoTxtProvider({
    file: FILE,
    _readTextFile: () => Promise.resolve(""),
  });
  await assertRejects(
    () => provider.close("https://example.com/not-todo-txt"),
    Error,
    "Cannot parse todo-txt URL",
  );
});

Deno.test("toSortable returns [id]", () => {
  const id = "todo-txt/a1b2c3d4";
  assertEquals(TodoTxtProvider.toSortable(id), [id]);
});
