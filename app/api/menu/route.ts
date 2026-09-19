import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

type ProductRow = { id: string; name: string; description: string | null; image_path: string | null; price_idr: number; available: boolean; stock_tracked: boolean; stock_quantity: number; popular: boolean; display_order: number; category_id: string; category_name: string };
type ModifierRow = { product_id: string; group_id: string; group_name: string; selection: "single" | "multiple"; required: boolean; min_selection: number; max_selection: number; group_order: number; option_id: string; option_name: string; price_adjustment_idr: number; available: boolean; option_order: number };

export async function GET() {
  try {
    await query("select public.release_expired_inventory_reservations()");
    const [products, variants, addons, settings, reservations] = await Promise.all([
      query<ProductRow>(
        `select p.id, p.name, p.description, p.image_path, p.price_idr, p.available, p.stock_tracked, p.stock_quantity, p.popular, p.display_order,
                c.id as category_id, c.name as category_name
         from public.products p join public.categories c on c.id = p.category_id
         where p.active = true and p.archived_at is null and c.active = true
         order by p.display_order asc, p.name asc`,
      ),
      query<ModifierRow>(
        `select pvg.product_id, vg.id as group_id, vg.name as group_name, vg.selection, vg.required, vg.min_selection, vg.max_selection, vg.display_order as group_order,
                vo.id as option_id, vo.name as option_name, vo.price_adjustment_idr, vo.available, vo.display_order as option_order
         from public.product_variant_groups pvg
         join public.variant_groups vg on vg.id = pvg.group_id and vg.active = true
         join public.variant_options vo on vo.group_id = vg.id
         order by pvg.product_id, vg.display_order, vo.display_order`,
      ),
      query<ModifierRow>(
        `select pag.product_id, ag.id as group_id, ag.name as group_name, 'multiple'::public.modifier_selection as selection, ag.required, ag.min_selection, ag.max_selection, ag.display_order as group_order,
                ao.id as option_id, ao.name as option_name, ao.price_adjustment_idr, ao.available, ao.display_order as option_order
         from public.product_addon_groups pag
         join public.addon_groups ag on ag.id = pag.group_id and ag.active = true
         join public.addon_options ao on ao.group_id = ag.id
         order by pag.product_id, ag.display_order, ao.display_order`,
      ),
      query<{ qris_enabled: boolean; cash_enabled: boolean }>("select qris_enabled, cash_enabled from public.restaurant_settings order by created_at asc limit 1"),
      query<{ product_id: string; quantity: number }>(
        `select iri.product_id, sum(iri.quantity)::integer as quantity
         from public.inventory_reservation_items iri
         join public.inventory_reservations ir on ir.id = iri.reservation_id
         where ir.status = 'reserved' and ir.expires_at > timezone('utc', now())
         group by iri.product_id`,
      ),
    ]);

    const reservedByProduct = new Map(reservations.rows.map((row) => [row.product_id, Number(row.quantity)]));
    const groupsByProduct = new Map<string, Array<ModifierRow & { type: "variant" | "addon" }>>();
    for (const row of [...variants.rows.map((value) => ({ ...value, type: "variant" as const })), ...addons.rows.map((value) => ({ ...value, type: "addon" as const }))]) {
      const list = groupsByProduct.get(row.product_id) ?? [];
      list.push(row);
      groupsByProduct.set(row.product_id, list);
    }

    const categoryMap = new Map<string, { id: string; name: string }>();
    const safeProducts = products.rows.map((product) => {
      categoryMap.set(product.category_id, { id: product.category_id, name: product.category_name });
      const groups = new Map<string, { id: string; name: string; type: "variant" | "addon"; selection: string; required: boolean; minSelection: number; maxSelection: number; displayOrder: number; options: Array<{ id: string; name: string; priceAdjustmentIdr: number; costAdjustmentIdr: number; available: boolean }> }>();
      for (const row of (groupsByProduct.get(product.id) ?? []).sort((a, b) => a.group_order - b.group_order || a.option_order - b.option_order)) {
        const group = groups.get(row.group_id) ?? { id: row.group_id, name: row.group_name, type: row.type, selection: row.selection, required: row.required, minSelection: row.min_selection, maxSelection: row.max_selection, displayOrder: row.group_order, options: [] };
        group.options.push({ id: row.option_id, name: row.option_name, priceAdjustmentIdr: row.price_adjustment_idr, costAdjustmentIdr: 0, available: row.available });
        groups.set(row.group_id, group);
      }
      const modifierGroups = [...groups.values()];
      const sellableStock = product.stock_tracked ? Math.max(0, Number(product.stock_quantity) - (reservedByProduct.get(product.id) ?? 0)) : undefined;
      const stockAvailable = !product.stock_tracked || (sellableStock ?? 0) > 0;
      const modifiersAvailable = modifierGroups.every((group) => !group.required || group.options.filter((option) => option.available).length >= Math.max(1, group.minSelection));
      return { id: product.id, name: product.name, description: product.description ?? "", categoryId: product.category_id, category: product.category_name, price: product.price_idr, available: product.available && stockAvailable && modifiersAvailable, stockTracked: product.stock_tracked, stockQuantity: product.stock_tracked ? sellableStock : undefined, popular: product.popular, imageUrl: product.image_path, accent: "#f5f5f5", imageTone: "from-neutral-100 via-neutral-200 to-neutral-300", modifierGroups };
    });
    return NextResponse.json({ products: safeProducts, categories: [...categoryMap.values()], settings: { qrisEnabled: settings.rows[0]?.qris_enabled === true, cashEnabled: settings.rows[0]?.cash_enabled === true } }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("menu_fetch_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Menu belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
