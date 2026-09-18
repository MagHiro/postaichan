import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { productMutationSchema } from "@/lib/menu-schema";

export const runtime = "nodejs";

async function guard() {
  const auth = await authorizeStaff();
  return auth.allowed ? null : NextResponse.json({ error: "Staff authorization required." }, { status: 401 });
}

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  try {
    const supabase = createAdminClient();
    const [{ data: products, error: productsError }, { data: categories, error: categoriesError }] = await Promise.all([
      supabase.from("products").select("id, name, description, image_path, price_idr, estimated_cost_idr, available, active, archived_at, category_id, categories(name)").order("display_order", { ascending: true }),
      supabase.from("categories").select("id, name, active, display_order").eq("active", true).order("display_order", { ascending: true }),
    ]);
    if (productsError) throw productsError;
    if (categoriesError) throw categoriesError;
    return NextResponse.json({ products: products ?? [], categories: categories ?? [] });
  } catch (error) {
    console.error("admin_menu_read_failed", error);
    return NextResponse.json({ error: "Menu belum dapat dimuat." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const parsed = productMutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data menu belum lengkap atau tidak valid." }, { status: 400 });
  try {
    const supabase = createAdminClient();
    const input = parsed.data;
    const { data, error } = await supabase.from("products").insert({ category_id: input.categoryId, name: input.name, description: input.description || null, image_path: input.imageUrl || null, price_idr: input.priceIdr, estimated_cost_idr: input.estimatedCostIdr, available: input.available, active: true }).select("id, name, description, image_path, price_idr, estimated_cost_idr, available, active, archived_at, category_id, categories(name)").single();
    if (error) throw error;
    return NextResponse.json({ product: data }, { status: 201 });
  } catch (error) {
    console.error("admin_menu_create_failed", error);
    return NextResponse.json({ error: "Menu belum berhasil dibuat." }, { status: 503 });
  }
}
