import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("products")
      .select("id, name, description, image_path, price_idr, estimated_cost_idr, available, display_order, categories(name)")
      .eq("active", true)
      .is("archived_at", null)
      .order("display_order", { ascending: true });

    if (error) throw error;
    return NextResponse.json({
      products: (data ?? []).map((product) => {
        const categoryValue = Array.isArray(product.categories)
          ? (product.categories[0] as { name?: string } | undefined)?.name
          : (product.categories as { name?: string } | null)?.name;
        const category = categoryValue === "Rice" ? "Rice Bowl" : categoryValue;
        return {
          id: product.id,
          name: product.name,
          description: product.description ?? "",
          category,
          price: product.price_idr,
          cost: product.estimated_cost_idr,
          available: product.available,
          imageUrl: (product as { image_path?: string | null }).image_path ?? null,
          accent: "#f3d7bd",
          imageTone: category === "Drinks" ? "from-[#e0e4bf] via-[#a8bf88] to-[#3f6b4a]" : category === "Extras" ? "from-[#f2c7b7] via-[#cf5e44] to-[#762f26]" : "from-[#efc6a3] via-[#dc8f61] to-[#8c4730]",
          popular: product.name === "Sate Taichan 10 Tusuk" || product.name === "Rice Bowl Taichan",
          options: product.name === "Rice Bowl Taichan" ? "rice" : ["Sate Taichan 10 Tusuk", "Sate Taichan 5 Tusuk", "Sate Kulit Crispy"].includes(product.name) ? "spice" : "none",
        };
      }),
    }, { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" } });
  } catch (error) {
    console.error("menu_fetch_failed", error);
    return NextResponse.json({ error: "Menu belum dapat dimuat." }, { status: 503 });
  }
}
