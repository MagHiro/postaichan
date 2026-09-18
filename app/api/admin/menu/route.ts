import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { productMutationSchema } from "@/lib/menu-schema";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

async function adminAuth() {
  const auth = await authorizeStaff("admin");
  return auth;
}

export async function GET() {
  const auth = await adminAuth();
  if (!auth.allowed) return NextResponse.json({ error: "Administrator authorization required." }, { status: auth.actorId ? 403 : 401, headers: noStoreHeaders() });
  try {
    const supabase = createAdminClient();
    const [{ data: products, error: productsError }, { data: categories, error: categoriesError }] = await Promise.all([
      supabase.from("products").select("id, name, description, image_path, price_idr, estimated_cost_idr, available, active, archived_at, category_id, categories(name)").order("display_order", { ascending: true }),
      supabase.from("categories").select("id, name, active, display_order").eq("active", true).order("display_order", { ascending: true }),
    ]);
    if (productsError) throw productsError;
    if (categoriesError) throw categoriesError;
    return NextResponse.json({ products: products ?? [], categories: categories ?? [] }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_menu_read_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Menu belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request) {
  const auth = await adminAuth();
  if (!auth.allowed) return NextResponse.json({ error: "Administrator authorization required." }, { status: auth.actorId ? 403 : 401, headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = productMutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data menu belum lengkap atau tidak valid." }, { status: 400, headers: noStoreHeaders() });
  try {
    const supabase = createAdminClient();
    const input = parsed.data;
    const { data: category, error: categoryError } = await supabase.from("categories").select("id").eq("id", input.categoryId).eq("active", true).maybeSingle();
    if (categoryError) throw categoryError;
    if (!category) return NextResponse.json({ error: "Kategori tidak tersedia." }, { status: 409, headers: noStoreHeaders() });
    const { data, error } = await supabase.from("products").insert({ category_id: input.categoryId, name: input.name, description: input.description || null, image_path: input.imageUrl || null, price_idr: input.priceIdr, estimated_cost_idr: input.estimatedCostIdr, available: input.available, active: true, created_by: auth.actorId }).select("id, name, description, image_path, price_idr, estimated_cost_idr, available, active, archived_at, category_id, categories(name)").single();
    if (error) throw error;
    const { error: auditError } = await supabase.from("audit_logs").insert({ actor_id: auth.actorId, action: "product_created", entity_type: "product", entity_id: data.id, new_value: { name: data.name, category_id: data.category_id, price_idr: data.price_idr } });
    if (auditError) throw auditError;
    return NextResponse.json({ product: data }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_menu_create_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Menu belum berhasil dibuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
