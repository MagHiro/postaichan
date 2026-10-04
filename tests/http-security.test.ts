import test from "node:test";
import assert from "node:assert/strict";
import { readJsonBody } from "../lib/security/http.ts";

test("bounded JSON reader distinguishes malformed JSON, invalid UTF-8, and oversized bodies", async () => {
  const malformed = await readJsonBody(new Request("https://postaichan.example/api", { method: "POST", body: "{" }));
  assert.ok(malformed instanceof Response);
  assert.equal(malformed.status, 400);

  const invalidUtf8 = await readJsonBody(new Request("https://postaichan.example/api", {
    method: "POST",
    body: new Uint8Array([0xc3, 0x28]),
    headers: { "content-type": "application/json" },
  }));
  assert.ok(invalidUtf8 instanceof Response);
  assert.equal(invalidUtf8.status, 400);

  const oversized = await readJsonBody(new Request("https://postaichan.example/api", {
    method: "POST",
    body: JSON.stringify({ large: "x".repeat(128 * 1024) }),
  }));
  assert.ok(oversized instanceof Response);
  assert.equal(oversized.status, 413);
});
