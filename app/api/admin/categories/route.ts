import { NextResponse } from "next/server";
import { databaseErrorCode, query } from "@/lib/db";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { categoryMutationSchema } from "@/lib/menu-schema";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

export async function GET() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  try {
    const result = await query(
      `select c.id, c.name, c.description, c.display_order as "displayOrder", c.active,
              (select count(*)::integer from public.products p where p.category_id = c.id and p.active = true) as product_count
       from public.categories c
       order by c.display_order asc, c.name asc`,
    );
    return NextResponse.json({ categories: result.rows }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_categories_list_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Kategori belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = categoryMutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data kategori belum lengkap atau tidak valid." }, { status: 400, headers: noStoreHeaders() });
  try {
    const result = await query("select * from public.create_category($1, $2, $3, $4::uuid)", [parsed.data.name, parsed.data.description ?? null, parsed.data.displayOrder ?? 0, auth.actorId]);
    const category = result.rows[0];
    if (!category) return NextResponse.json({ error: "Kategori belum berhasil dibuat." }, { status: 503, headers: noStoreHeaders() });
    return NextResponse.json({ category }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    if (databaseErrorCode(error) === "23505") return NextResponse.json({ error: "Nama kategori sudah digunakan." }, { status: 409, headers: noStoreHeaders() });
    const message = error instanceof Error ? error.message.split(":")[0] : "";
    if (message === "INVALID_CATEGORY") return NextResponse.json({ error: "Data kategori belum lengkap atau tidak valid." }, { status: 400, headers: noStoreHeaders() });
    console.error("admin_category_create_failed", message || "unknown");
    return NextResponse.json({ error: "Kategori belum berhasil dibuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
