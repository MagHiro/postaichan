import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = createAdminClient();
    const [{ data: products, error: productError }, { data: variantLinks, error: variantError }, { data: addonLinks, error: addonError }, { data: settings, error: settingsError }] = await Promise.all([
      supabase.from("products").select("id, name, description, image_path, price_idr, available, popular, display_order, categories!inner(id, name, active)").eq("active", true).is("archived_at", null).eq("categories.active", true).order("display_order", { ascending: true }),
      supabase.from("product_variant_groups").select("product_id, variant_groups(id, name, selection, required, min_selection, max_selection, active, display_order, variant_options(id, name, price_adjustment_idr, cost_adjustment_idr, available, display_order))"),
      supabase.from("product_addon_groups").select("product_id, addon_groups(id, name, required, min_selection, max_selection, active, display_order, addon_options(id, name, price_adjustment_idr, cost_adjustment_idr, available, display_order))"),
      supabase.from("restaurant_settings").select("qris_enabled, cash_enabled").order("created_at", { ascending: true }).limit(1).maybeSingle(),
    ]);
    if (productError) throw productError;
    if (variantError) throw variantError;
    if (addonError) throw addonError;
    if (settingsError) throw settingsError;
    const variantsByProduct = new Map<string, unknown[]>();
    for (const link of variantLinks ?? []) { const group = Array.isArray(link.variant_groups) ? link.variant_groups[0] : link.variant_groups; if (group) variantsByProduct.set(link.product_id, [...(variantsByProduct.get(link.product_id) ?? []), { ...group, type: "variant" }]); }
    const addonsByProduct = new Map<string, unknown[]>();
    for (const link of addonLinks ?? []) { const group = Array.isArray(link.addon_groups) ? link.addon_groups[0] : link.addon_groups; if (group) addonsByProduct.set(link.product_id, [...(addonsByProduct.get(link.product_id) ?? []), { ...group, type: "addon" }]); }
    const categoryMap = new Map<string, { id: string; name: string }>();
    const safeProducts = (products ?? []).map((product) => {
      const category = Array.isArray(product.categories) ? product.categories[0] : product.categories;
      if (category) categoryMap.set(category.id, { id: category.id, name: category.name });
      const groups = [...(variantsByProduct.get(product.id) ?? []), ...(addonsByProduct.get(product.id) ?? [])].sort((a, b) => Number((a as { display_order?: number }).display_order ?? 0) - Number((b as { display_order?: number }).display_order ?? 0));
      return { id: product.id, name: product.name, description: product.description ?? "", categoryId: category?.id ?? "", category: category?.name ?? "", price: product.price_idr, available: product.available, popular: product.popular === true, imageUrl: product.image_path ?? null, accent: "#f5f5f5", imageTone: "from-neutral-100 via-neutral-200 to-neutral-300", modifierGroups: groups.map((group) => { const type = (group as { type: "variant" | "addon" }).type; return { id: (group as { id: string }).id, name: (group as { name: string }).name, type, selection: type === "addon" ? "multiple" : (group as { selection: string }).selection, required: (group as { required: boolean }).required, minSelection: (group as { min_selection: number }).min_selection, maxSelection: (group as { max_selection: number }).max_selection, options: ((group as { variant_options?: unknown[]; addon_options?: unknown[] }).variant_options ?? (group as { addon_options?: unknown[] }).addon_options ?? []).map((option) => { const value = option as { id: string; name: string; price_adjustment_idr: number; available: boolean }; return { id: value.id, name: value.name, priceAdjustmentIdr: value.price_adjustment_idr, costAdjustmentIdr: 0, available: value.available }; }) }; }) };
    });
    return NextResponse.json({ products: safeProducts, categories: [...categoryMap.values()], settings: { qrisEnabled: settings?.qris_enabled === true, cashEnabled: settings?.cash_enabled === true } }, { headers: { ...noStoreHeaders(), "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } });
  } catch (error) {
    console.error("menu_fetch_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Menu belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
