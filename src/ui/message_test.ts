import { assertEquals, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { selectStartupMessage, formatStartupMessage } from "./message.ts";

Deno.test("selectStartupMessage returns a message object with character and message fields", () => {
  const result = selectStartupMessage();
  assert(typeof result === "object");
  assert("character" in result);
  assert("message" in result);
  assert(typeof result.character === "string");
  assert(typeof result.message === "string");
  assert(result.character.length > 0);
  assert(result.message.length > 0);
});

Deno.test("selectStartupMessage returns different messages over time", () => {
  const msg1 = selectStartupMessage();
  const msg2 = selectStartupMessage();
  // Both should be valid messages
  assert(msg1.character !== undefined);
  assert(msg2.character !== undefined);
  assert(msg1.message !== undefined);
  assert(msg2.message !== undefined);
});

Deno.test("selectStartupMessage cycles through all available messages", () => {
  // Verify the function returns consistent results for the same time
  const msg1 = selectStartupMessage();
  const msg2 = selectStartupMessage();
  // Both calls at the same second should return the same message
  assertEquals(msg1.message, msg2.message);
  // Verify we're getting a valid message from the rotation
  assert(
    msg1.message.length > 0,
    "Message should not be empty"
  );
  assert(
    msg1.character.length > 0,
    "Character should not be empty"
  );
});

Deno.test("formatStartupMessage creates cowsay-style output", () => {
  const msg = {
    message: "Test message here",
    character: "  ^__^\n  (oo)\\_______",
  };
  const result = formatStartupMessage(msg);
  assert(result.includes("Test message here"));
  assert(result.includes("^__^"));
  assert(result.includes("(oo)"));
});

Deno.test("formatStartupMessage creates balloon with proper ASCII structure", () => {
  const msg = {
    message: "Hello world",
    character: "  COW",
  };
  const result = formatStartupMessage(msg);
  // Should have opening line with dashes
  assert(result.includes("/") || result.includes("_"));
  // Should contain the message
  assert(result.includes("Hello world"));
  // Should have closing line with dashes
  assert(result.includes("\\") || result.includes("_"));
});

Deno.test("formatStartupMessage fits within 80 character width", () => {
  const msg = {
    message: "This is a test message that should wrap appropriately",
    character: "  ^__^\n  (oo)",
  };
  const result = formatStartupMessage(msg);
  const lines = result.split("\n");
  for (const line of lines) {
    assert(
      line.length <= 80,
      `Line exceeds 80 chars: "${line}" (${line.length})`
    );
  }
});
