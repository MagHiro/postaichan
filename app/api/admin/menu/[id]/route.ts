import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { productMutationSchema } from "@/lib/menu-schema";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

async function guard() {
  const auth = await authorizeStaff();
  return auth.allowed ? null : NextResponse.json({ error: "Staff authorization required." }, { status: 401 });
}

export async function PATCH(request: Request, context: Context) {
  const denied = await guard();
  if (denied) return denied;
  const parsed = productMutationSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Perubahan menu tidak valid." }, { status: 400 });
  const { id } = await context.params;
  try {
    const supabase = createAdminClient();
    const input = parsed.data;
    const update = {
      ...(input.categoryId === undefined ? {} : { category_id: input.categoryId }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description || null }),
      ...(input.imageUrl === undefined ? {} : { image_path: input.imageUrl || null }),
      ...(input.priceIdr === undefined ? {} : { price_idr: input.priceIdr }),
      ...(input.estimatedCostIdr === undefined ? {} : { estimated_cost_idr: input.estimatedCostIdr }),
      ...(input.available === undefined ? {} : { available: input.available }),
    };
    const { data, error } = await supabase.from("products").update(update).eq("id", id).select("id, name, description, image_path, price_idr, estimated_cost_idr, available, active, archived_at, category_id, categories(name)").single();
    if (error) throw error;
    return NextResponse.json({ product: data });
  } catch (error) {
    console.error("admin_menu_update_failed", error);
    return NextResponse.json({ error: "Perubahan menu belum tersimpan." }, { status: 503 });
  }
}

export async function DELETE(_: Request, context: Context) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("products").update({ active: false, available: false, archived_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ archived: true });
  } catch (error) {
    console.error("admin_menu_archive_failed", error);
    return NextResponse.json({ error: "Menu belum berhasil diarsipkan." }, { status: 503 });
  }
}
