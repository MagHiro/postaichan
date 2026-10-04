import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

test("categories can be hidden and deleted with products while preserving history", { skip: !process.env.DATABASE_URL }, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("begin");
  try {
    const actor = (await client.query("select id from public.profiles where role = 'admin' and active = true limit 1")).rows[0];
    assert.ok(actor, "An active administrator is required for this integration test");
    const name = `Category regression ${randomUUID()}`;
    const category = (await client.query("select * from public.create_category($1, null, 0, $2::uuid)", [name, actor.id])).rows[0];
    const product = (await client.query("select * from public.create_product_with_audit($1::uuid, 'Image regression', null, '/uploads/menu/regression.webp', 10000, 0, true, false, 0, $2::uuid)", [category.id, actor.id])).rows[0];
    assert.equal(product.image_path, "/uploads/menu/regression.webp");
    const hidden = (await client.query("select * from public.update_category($1::uuid, null, null, false, null, false, $2::uuid)", [category.id, actor.id])).rows[0];
    assert.equal(hidden.active, false);
    assert.equal((await client.query("select public.reactivate_category($1::uuid, $2::uuid) as ok", [category.id, actor.id])).rows[0].ok, true);
    assert.equal((await client.query("select public.deactivate_category($1::uuid, $2::uuid) as ok", [category.id, actor.id])).rows[0].ok, true);
    assert.equal((await client.query("select public.delete_category($1::uuid, $2::uuid) as ok", [category.id, actor.id])).rows[0].ok, true);
    assert.equal((await client.query("select public.delete_category($1::uuid, $2::uuid) as ok", [category.id, actor.id])).rows[0].ok, true);
    assert.equal((await client.query("select id from public.categories where id = $1 and deleted_at is null", [category.id])).rowCount, 0);
    assert.equal((await client.query("select public.reactivate_category($1::uuid, $2::uuid) as ok", [category.id, actor.id])).rows[0].ok, false);
    assert.equal((await client.query("select * from public.update_category($1::uuid, null, null, false, null, true, $2::uuid)", [category.id, actor.id])).rowCount, 0);
    assert.equal((await client.query("select id from public.products where id = $1 and category_id = $2", [product.id, category.id])).rowCount, 1);
    const recreated = (await client.query("select * from public.create_category($1, null, 0, $2::uuid)", [name, actor.id])).rows[0];
    assert.notEqual(recreated.id, category.id);
  } finally {
    await client.query("rollback");
    await client.end();
  }
});
