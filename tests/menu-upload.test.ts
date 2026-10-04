import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import pg from "pg";

// Run against a local dev server with ALLOW_DEV_STAFF_BYPASS=true.
const origin = process.env.MENU_TEST_ORIGIN;
test("uploads persist in PostgreSQL and are served without writing public files", { skip: !origin || !process.env.DATABASE_URL }, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const input = await sharp({ create: { width: 16, height: 12, channels: 3, background: "#fdbd2c" } })[format]().toBuffer();
      const form = new FormData();
      form.append("image", new File([new Uint8Array(input)], `image.${format}`, { type: `image/${format}` }));
      const upload = await fetch(`${origin}/api/admin/menu/upload`, { method: "POST", body: form });
      const payload = await upload.json();
      assert.equal(upload.status, 201, JSON.stringify(payload));
      const imagePath = payload.imagePath as string;
      try {
        const stored = (await client.query("select data from public.menu_images where image_path = $1", [imagePath])).rows[0];
        assert.ok(stored, "The image must be persisted in PostgreSQL");
        await assert.rejects(access(path.join(process.cwd(), "public", imagePath)), { code: "ENOENT" });
        const image = await fetch(`${origin}${imagePath}`);
        assert.equal(image.status, 200);
        assert.equal(image.headers.get("content-type"), "image/webp");
        assert.match(image.headers.get("cache-control") ?? "", /immutable/);
        const bytes = Buffer.from(await image.arrayBuffer());
        assert.deepEqual(bytes, stored.data);
        const metadata = await sharp(bytes).metadata();
        assert.equal(metadata.format, "webp");
        assert.equal(metadata.width, 16);
      } finally {
        const cleanup = await fetch(`${origin}/api/admin/menu/upload`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ imagePath }) });
        assert.equal(cleanup.status, 200);
      }
      assert.equal((await fetch(`${origin}${imagePath}`)).status, 404);
      assert.equal((await client.query("select image_path from public.menu_images where image_path = $1", [imagePath])).rowCount, 0);
    }
    const invalid = new FormData();
    invalid.append("image", new File(["broken"], "bad.png", { type: "image/png" }));
    assert.equal((await fetch(`${origin}/api/admin/menu/upload`, { method: "POST", body: invalid })).status, 400);
    assert.equal((await fetch(`${origin}/uploads/menu/invalid.txt`)).status, 404);
  } finally {
    await client.end();
  }
});
