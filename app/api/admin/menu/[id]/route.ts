import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { productMutationSchema } from "@/lib/menu-schema";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";
import { isMenuImagePath, removeMenuImage } from "@/lib/uploads/menu-storage";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

function adminFailure(auth: Awaited<ReturnType<typeof authorizeStaff>>) {
  return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
}

async function getProduct(supabase: ReturnType<typeof createAdminClient>, id: string) {
  return supabase.from("products").select("id, name, description, image_path, price_idr, estimated_cost_idr, available, active, archived_at, category_id, stock_tracked, stock_quantity, categories(name)").eq("id", id).maybeSingle();
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return adminFailure(auth);
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Product not found." }, { status: 400, headers: noStoreHeaders() });
  const parsed = productMutationSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Perubahan menu tidak valid." }, { status: 400, headers: noStoreHeaders() });
  const supabase = createAdminClient();
  const input = parsed.data;
  try {
    const { data: current, error: currentError } = await getProduct(supabase, id);
    if (currentError) throw currentError;
    if (!current || !current.active) return NextResponse.json({ error: "Product not found." }, { status: 404, headers: noStoreHeaders() });
    const { data: updated, error } = await supabase.rpc("update_product_with_audit", {
      p_product_id: id,
      p_category_id: input.categoryId ?? current.category_id,
      p_name: input.name ?? current.name,
      p_description: input.description === undefined ? current.description : input.description,
      p_image_path: input.imagePath === undefined ? current.image_path : input.imagePath,
      p_price_idr: input.priceIdr ?? current.price_idr,
      p_estimated_cost_idr: input.estimatedCostIdr ?? current.estimated_cost_idr,
      p_available: input.available ?? current.available,
      p_stock_tracked: input.stockTracked ?? current.stock_tracked,
      p_stock_quantity: input.stockQuantity ?? current.stock_quantity,
      p_reason: "Perubahan stok dari pengelolaan menu",
      p_actor_id: auth.actorId,
    });
    if (error) {
      const message = String(error.message || "").split(":")[0];
      if (input.imagePath && input.imagePath !== current.image_path && isMenuImagePath(input.imagePath)) {
        const { data: references } = await supabase.from("products").select("id").eq("image_path", input.imagePath).limit(1);
        if (!references?.length) await removeMenuImage(input.imagePath);
      }
      return NextResponse.json({ error: message === "CATEGORY_NOT_AVAILABLE" ? "Kategori tidak tersedia." : message === "STOCK_RESERVED" ? "Stok tidak boleh di bawah jumlah yang sedang dipesan." : "Perubahan menu belum tersimpan." }, { status: ["CATEGORY_NOT_AVAILABLE", "STOCK_RESERVED"].includes(message) ? 409 : 503, headers: noStoreHeaders() });
    }
    const row = Array.isArray(updated) ? updated[0] : updated;
    if (!row) {
      if (input.imagePath && input.imagePath !== current.image_path && isMenuImagePath(input.imagePath)) {
        const { data: references } = await supabase.from("products").select("id").eq("image_path", input.imagePath).limit(1);
        if (!references?.length) await removeMenuImage(input.imagePath);
      }
      return NextResponse.json({ error: "Product not found." }, { status: 404, headers: noStoreHeaders() });
    }
    const nextPath = input.imagePath === undefined ? current.image_path : input.imagePath;
    if (current.image_path && current.image_path !== nextPath && isMenuImagePath(current.image_path)) {
      const { data: stillReferenced, error: referenceError } = await supabase.from("products").select("id").eq("image_path", current.image_path).neq("id", id).limit(1);
      if (!referenceError && !(stillReferenced?.length)) await removeMenuImage(current.image_path);
    }
    return NextResponse.json({ product: row }, { headers: noStoreHeaders() });
  } catch (error) {
    if (input.imagePath && isMenuImagePath(input.imagePath)) {
      const { data: references } = await supabase.from("products").select("id").eq("image_path", input.imagePath).limit(1);
      if (!references?.length) await removeMenuImage(input.imagePath);
    }
    console.error("admin_menu_update_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Perubahan menu belum tersimpan." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function DELETE(request: Request, context: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return adminFailure(auth);
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Product not found." }, { status: 400, headers: noStoreHeaders() });
  try {
    const { data, error } = await createAdminClient().rpc("archive_product", { p_product_id: id, p_actor_id: auth.actorId });
    if (error) throw error;
    if (data !== true) return NextResponse.json({ error: "Product not found or already archived." }, { status: 409, headers: noStoreHeaders() });
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
    const { data, error } = await createAdminClient().rpc("restore_product", { p_product_id: id, p_actor_id: auth.actorId });
    if (error) throw error;
    if (data !== true) return NextResponse.json({ error: "Product is not archived or does not exist." }, { status: 409, headers: noStoreHeaders() });
    return NextResponse.json({ restored: true }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_menu_restore_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Menu belum berhasil dipulihkan." }, { status: 503, headers: noStoreHeaders() });
  }
}
