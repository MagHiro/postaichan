import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { productMutationSchema } from "@/lib/menu-schema";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";
import { isMenuImagePath, removeMenuImage } from "@/lib/uploads/menu-storage";

export const runtime = "nodejs";

async function adminAuth() {
  const auth = await authorizeStaff("admin");
  return auth;
}

export async function GET() {
  const auth = await adminAuth();
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  try {
    const supabase = createAdminClient();
    const [{ data: products, error: productsError }, { data: categories, error: categoriesError }] = await Promise.all([
      supabase.from("products").select("id, name, description, image_path, price_idr, estimated_cost_idr, available, active, archived_at, category_id, stock_tracked, stock_quantity, categories(name)").order("display_order", { ascending: true }),
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
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = productMutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data menu belum lengkap atau tidak valid." }, { status: 400, headers: noStoreHeaders() });
  const input = parsed.data;
  async function cleanupImage() {
    if (!input.imagePath || !isMenuImagePath(input.imagePath)) return;
    const { data: references } = await createAdminClient().from("products").select("id").eq("image_path", input.imagePath).limit(1);
    if (!references?.length) await removeMenuImage(input.imagePath);
  }
  try {
    const supabase = createAdminClient();
    const { data: created, error } = await supabase.rpc("create_product_with_audit", { p_category_id: input.categoryId, p_name: input.name, p_description: input.description ?? null, p_image_path: input.imagePath ?? null, p_price_idr: input.priceIdr, p_estimated_cost_idr: input.estimatedCostIdr, p_available: input.available, p_stock_tracked: input.stockTracked, p_stock_quantity: input.stockQuantity, p_actor_id: auth.actorId });
    if (error) {
      const message = String(error.message || "").split(":")[0];
      await cleanupImage();
      return NextResponse.json({ error: message === "CATEGORY_NOT_AVAILABLE" ? "Kategori tidak tersedia." : "Menu belum berhasil dibuat." }, { status: message === "CATEGORY_NOT_AVAILABLE" ? 409 : 503, headers: noStoreHeaders() });
    }
    const product = Array.isArray(created) ? created[0] : created;
    if (!product) { await cleanupImage(); return NextResponse.json({ error: "Menu belum berhasil dibuat." }, { status: 503, headers: noStoreHeaders() }); }
    return NextResponse.json({ product }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    await cleanupImage();
    console.error("admin_menu_create_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Menu belum berhasil dibuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
