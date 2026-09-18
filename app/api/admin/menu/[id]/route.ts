import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { productMutationSchema } from "@/lib/menu-schema";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

async function getAdmin() { return authorizeStaff("admin"); }

export async function PATCH(request: Request, context: Context) {
  const auth = await getAdmin();
  if (!auth.allowed) return NextResponse.json({ error: "Administrator authorization required." }, { status: auth.actorId ? 403 : 401, headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Product not found." }, { status: 400, headers: noStoreHeaders() });
  const parsed = productMutationSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Perubahan menu tidak valid." }, { status: 400, headers: noStoreHeaders() });
  try {
    const supabase = createAdminClient();
    const input = parsed.data;
    if (input.categoryId !== undefined) {
      const { data: category } = await supabase.from("categories").select("id").eq("id", input.categoryId).eq("active", true).maybeSingle();
      if (!category) return NextResponse.json({ error: "Kategori tidak tersedia." }, { status: 409, headers: noStoreHeaders() });
    }
    const update = { ...(input.categoryId === undefined ? {} : { category_id: input.categoryId }), ...(input.name === undefined ? {} : { name: input.name }), ...(input.description === undefined ? {} : { description: input.description || null }), ...(input.imageUrl === undefined ? {} : { image_path: input.imageUrl || null }), ...(input.priceIdr === undefined ? {} : { price_idr: input.priceIdr }), ...(input.estimatedCostIdr === undefined ? {} : { estimated_cost_idr: input.estimatedCostIdr }), ...(input.available === undefined ? {} : { available: input.available }) };
    const { data, error } = await supabase.from("products").update(update).eq("id", id).eq("active", true).select("id, name, description, image_path, price_idr, estimated_cost_idr, available, active, archived_at, category_id, categories(name)").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Product not found." }, { status: 404, headers: noStoreHeaders() });
    const { error: auditError } = await supabase.from("audit_logs").insert({ actor_id: auth.actorId, action: "product_updated", entity_type: "product", entity_id: id, new_value: update });
    if (auditError) throw auditError;
    return NextResponse.json({ product: data }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_menu_update_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Perubahan menu belum tersimpan." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function DELETE(request: Request, context: Context) {
  const auth = await getAdmin();
  if (!auth.allowed) return NextResponse.json({ error: "Administrator authorization required." }, { status: auth.actorId ? 403 : 401, headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Product not found." }, { status: 400, headers: noStoreHeaders() });
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.from("products").update({ active: false, available: false, archived_at: new Date().toISOString() }).eq("id", id).eq("active", true).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Product not found or already archived." }, { status: 409, headers: noStoreHeaders() });
    const { error: auditError } = await supabase.from("audit_logs").insert({ actor_id: auth.actorId, action: "product_archived", entity_type: "product", entity_id: id });
    if (auditError) throw auditError;
    return NextResponse.json({ archived: true }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_menu_archive_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Menu belum berhasil diarsipkan." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request, context: Context) {
  const auth = await getAdmin();
  if (!auth.allowed) return NextResponse.json({ error: "Administrator authorization required." }, { status: auth.actorId ? 403 : 401, headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Product not found." }, { status: 400, headers: noStoreHeaders() });
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.from("products").update({ active: true, archived_at: null }).eq("id", id).eq("active", false).not("archived_at", "is", null).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Product is not archived or does not exist." }, { status: 409, headers: noStoreHeaders() });
    const { error: auditError } = await supabase.from("audit_logs").insert({ actor_id: auth.actorId, action: "product_restored", entity_type: "product", entity_id: id });
    if (auditError) throw auditError;
    return NextResponse.json({ restored: true }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_menu_restore_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Menu belum berhasil dipulihkan." }, { status: 503, headers: noStoreHeaders() });
  }
}
