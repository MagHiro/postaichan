import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { productModifiersSchema } from "@/lib/menu-schema";
import { readJsonBody, noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Product not found." }, { status: 400, headers: noStoreHeaders() });
  try {
    const result = await query(
      `select p.id as "productId",
              coalesce((select array_agg(pvg.group_id) from public.product_variant_groups pvg where pvg.product_id = p.id), '{}') as "variantGroupIds",
              coalesce((select array_agg(pag.group_id) from public.product_addon_groups pag where pag.product_id = p.id), '{}') as "addonGroupIds"
        from public.products p where p.id = $1 limit 1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) return NextResponse.json({ error: "Product not found." }, { status: 404, headers: noStoreHeaders() });
    return NextResponse.json(row, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_product_modifiers_read_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Opsi produk belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function PUT(request: Request, { params }: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Product not found." }, { status: 400, headers: noStoreHeaders() });
  const parsed = productModifiersSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Data opsi produk tidak valid." }, { status: 400, headers: noStoreHeaders() });
  try {
    const result = await query<{ set_product_modifier_groups: boolean }>(
      "select public.set_product_modifier_groups($1::uuid, $2::uuid[], $3::uuid[], $4::uuid) as set_product_modifier_groups",
      [id, parsed.data.variantGroupIds ?? [], parsed.data.addonGroupIds ?? [], auth.actorId],
    );
    if (result.rows[0]?.set_product_modifier_groups !== true) return NextResponse.json({ error: "Product not found." }, { status: 404, headers: noStoreHeaders() });
    return NextResponse.json({ updated: true }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message.split(":")[0] : "";
    if (message === "PRODUCT_NOT_FOUND") return NextResponse.json({ error: "Product not found." }, { status: 404, headers: noStoreHeaders() });
    if (message === "INVALID_MODIFIER") return NextResponse.json({ error: "Grup opsi tidak valid atau tidak aktif." }, { status: 400, headers: noStoreHeaders() });
    console.error("admin_product_modifiers_update_failed", message || "unknown");
    return NextResponse.json({ error: "Opsi produk belum tersimpan." }, { status: 503, headers: noStoreHeaders() });
  }
}
