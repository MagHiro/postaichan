import { NextResponse } from "next/server";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { consumeRateLimit, noStoreHeaders, sameOrigin } from "@/lib/security/request";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMenuImagePath, MenuImageError, MENU_UPLOAD_MAX_BYTES, removeMenuImage, storeMenuImage } from "@/lib/uploads/menu-storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MENU_UPLOAD_MAX_BYTES + 256_000) return NextResponse.json({ error: "Ukuran gambar maksimal 5 MB." }, { status: 413, headers: noStoreHeaders() });
  try {
    if (!(await consumeRateLimit(request, "menu-upload", 12, 300, auth.actorId ?? "dev"))) return NextResponse.json({ error: "Terlalu banyak upload. Coba lagi sebentar." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "300" } });
    const form = await request.formData();
    const value = form.get("image");
    if (!(value instanceof File)) return NextResponse.json({ error: "Pilih file gambar terlebih dahulu." }, { status: 400, headers: noStoreHeaders() });
    const stored = await storeMenuImage(value);
    return NextResponse.json({ imagePath: stored.imagePath }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof MenuImageError) return NextResponse.json({ error: error.message }, { status: 400, headers: noStoreHeaders() });
    console.error("menu_image_upload_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Gambar belum dapat diunggah. Coba lagi." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function DELETE(request: Request) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = z.object({ imagePath: z.string().regex(/^\/uploads\/menu\/[A-Za-z0-9_-]+\.webp$/) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isMenuImagePath(parsed.data.imagePath)) return NextResponse.json({ error: "Path gambar tidak valid." }, { status: 400, headers: noStoreHeaders() });
  try {
    const { data: references, error } = await createAdminClient().from("products").select("id").eq("image_path", parsed.data.imagePath).limit(1);
    if (error) throw error;
    if (!references?.length) await removeMenuImage(parsed.data.imagePath);
    return NextResponse.json({ removed: !references?.length }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("menu_image_cleanup_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Gambar belum dapat dibersihkan." }, { status: 503, headers: noStoreHeaders() });
  }
}
