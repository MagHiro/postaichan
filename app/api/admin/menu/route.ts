import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { productMutationSchema } from "@/lib/menu-schema";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";
import { isMenuImagePath, removeMenuImage } from "@/lib/uploads/menu-storage";

export const runtime = "nodejs";

async function adminAuth() { return authorizeStaff("admin"); }

function failure(auth: Awaited<ReturnType<typeof authorizeStaff>>) {
  return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
}

async function cleanupImage(imagePath: string | null | undefined) {
  if (!imagePath || !isMenuImagePath(imagePath)) return;
  const references = await query("select id from public.products where image_path = $1 limit 1", [imagePath]);
  if (references.rowCount === 0) await removeMenuImage(imagePath);
}

export async function GET() {
  const auth = await adminAuth();
  if (!auth.allowed) return failure(auth);
  try {
    const [products, categories] = await Promise.all([
      query(`select p.id, p.name, p.description, p.image_path, p.price_idr, p.estimated_cost_idr, p.available, p.active, p.archived_at, p.category_id, p.stock_tracked, p.stock_quantity, c.name as category_name from public.products p join public.categories c on c.id = p.category_id order by p.display_order asc, p.name asc`),
      query("select id, name, active, display_order from public.categories where active = true order by display_order asc, name asc"),
    ]);
    return NextResponse.json({ products: products.rows.map((product) => ({ ...product, categories: product.category_name ? { name: product.category_name } : null })), categories: categories.rows }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_menu_read_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Menu belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request) {
  const auth = await adminAuth();
  if (!auth.allowed) return failure(auth);
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = productMutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data menu belum lengkap atau tidak valid." }, { status: 400, headers: noStoreHeaders() });
  const input = parsed.data;
  try {
    const result = await query(
      "select * from public.create_product_with_audit($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid)",
      [input.categoryId, input.name, input.description ?? null, input.imagePath ?? null, input.priceIdr, input.estimatedCostIdr, input.available, input.stockTracked, input.stockQuantity, auth.actorId],
    );
    const product = result.rows[0];
    if (!product) { await cleanupImage(input.imagePath); return NextResponse.json({ error: "Menu belum berhasil dibuat." }, { status: 503, headers: noStoreHeaders() }); }
    return NextResponse.json({ product }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    await cleanupImage(input.imagePath).catch(() => undefined);
    const message = error instanceof Error ? error.message.split(":")[0] : "";
    return NextResponse.json({ error: message === "CATEGORY_NOT_AVAILABLE" ? "Kategori tidak tersedia." : "Menu belum berhasil dibuat." }, { status: message === "CATEGORY_NOT_AVAILABLE" ? 409 : 503, headers: noStoreHeaders() });
  }
}
