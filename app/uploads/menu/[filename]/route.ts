import { isMenuImagePath, readMenuImage } from "@/lib/uploads/menu-storage";

export const runtime = "nodejs";

type Context = { params: Promise<{ filename: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { filename } = await params;
  const imagePath = `/uploads/menu/${filename}`;
  if (!isMenuImagePath(imagePath)) return new Response(null, { status: 404 });
  try {
    const image = await readMenuImage(imagePath);
    if (!image) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(image.byteLength),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("menu_image_read_failed", error);
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
