import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { query } from "@/lib/db";
import { productMutationSchema } from "@/lib/menu-schema";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";
import { isMenuImagePath, removeMenuImage } from "@/lib/uploads/menu-storage";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

function adminFailure(auth: Awaited<ReturnType<typeof authorizeStaff>>) {
  return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
}

async function getProduct(id: string) {
  const result = await query("select p.id, p.name, p.description, p.image_path, p.price_idr, p.estimated_cost_idr, p.available, p.active, p.archived_at, p.category_id, p.stock_tracked, p.stock_quantity, c.name as category_name from public.products p join public.categories c on c.id = p.category_id where p.id = $1 limit 1", [id]);
  return result.rows[0];
}

async function cleanupIfUnreferenced(imagePath: string | null | undefined, exceptId?: string) {
  if (!imagePath || !isMenuImagePath(imagePath)) return;
  const result = await query("select id from public.products where image_path = $1 and ($2::uuid is null or id <> $2::uuid) limit 1", [imagePath, exceptId ?? null]);
  if (result.rowCount === 0) await removeMenuImage(imagePath);
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return adminFailure(auth);
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Product not found." }, { status: 400, headers: noStoreHeaders() });
  const parsed = productMutationSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Perubahan menu tidak valid." }, { status: 400, headers: noStoreHeaders() });
  const input = parsed.data;
  try {
    const current = await getProduct(id);
    if (!current || !current.active) return NextResponse.json({ error: "Product not found." }, { status: 404, headers: noStoreHeaders() });
    const result = await query(
      "select * from public.update_product_with_audit($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid)",
      [id, input.categoryId ?? current.category_id, input.name ?? current.name, input.description === undefined ? current.description : input.description, input.imagePath === undefined ? current.image_path : input.imagePath, input.priceIdr ?? current.price_idr, input.estimatedCostIdr ?? current.estimated_cost_idr, input.available ?? current.available, input.stockTracked ?? current.stock_tracked, input.stockQuantity ?? current.stock_quantity, "Perubahan stok dari pengelolaan menu", auth.actorId],
    );
    const row = result.rows[0];
    if (!row) return NextResponse.json({ error: "Product not found." }, { status: 404, headers: noStoreHeaders() });
    const nextPath = input.imagePath === undefined ? current.image_path : input.imagePath;
    if (current.image_path && current.image_path !== nextPath) await cleanupIfUnreferenced(current.image_path, id);
    return NextResponse.json({ product: row }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message.split(":")[0] : "";
    if (input.imagePath && input.imagePath !== undefined && isMenuImagePath(input.imagePath)) await cleanupIfUnreferenced(input.imagePath, id).catch(() => undefined);
    return NextResponse.json({ error: message === "CATEGORY_NOT_AVAILABLE" ? "Kategori tidak tersedia." : message === "STOCK_RESERVED" ? "Stok tidak boleh di bawah jumlah yang sedang dipesan." : "Perubahan menu belum tersimpan." }, { status: ["CATEGORY_NOT_AVAILABLE", "STOCK_RESERVED"].includes(message) ? 409 : 503, headers: noStoreHeaders() });
  }
}

export async function DELETE(request: Request, context: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return adminFailure(auth);
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Product not found." }, { status: 400, headers: noStoreHeaders() });
  try {
    const result = await query<{ archived: boolean }>("select public.archive_product($1::uuid, $2::uuid) as archived", [id, auth.actorId]);
    if (result.rows[0]?.archived !== true) return NextResponse.json({ error: "Product not found or already archived." }, { status: 409, headers: noStoreHeaders() });
    return NextResponse.json({ archived: true }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_menu_archive_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Menu belum berhasil dihapus dari menu." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request, context: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return adminFailure(auth);
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Product not found." }, { status: 400, headers: noStoreHeaders() });
  try {
    const result = await query<{ restored: boolean }>("select public.restore_product($1::uuid, $2::uuid) as restored", [id, auth.actorId]);
    if (result.rows[0]?.restored !== true) return NextResponse.json({ error: "Product is not archived or does not exist." }, { status: 409, headers: noStoreHeaders() });
    return NextResponse.json({ restored: true }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_menu_restore_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Menu belum berhasil dipulihkan." }, { status: 503, headers: noStoreHeaders() });
  }
}
