import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authFailureMessage, authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { modifierGroupMutationSchema } from "@/lib/menu-schema";
import { readJsonBody, noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

async function adminAuth() { return authorizeStaff("admin"); }

function failure(auth: Awaited<ReturnType<typeof authorizeStaff>>) {
  return NextResponse.json({ error: authFailureMessage(auth, "Administrator authorization required.", "Authentication required.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
}

export async function GET() {
  const auth = await adminAuth();
  if (!auth.allowed) return failure(auth);
  try {
    const [variantGroups, variantOptions, addonGroups, addonOptions, assignments] = await Promise.all([
      query(`select vg.id, vg.name, vg.selection, vg.required, vg.min_selection as "minSelection", vg.max_selection as "maxSelection", vg.display_order as "displayOrder", vg.active,
              (select count(*)::integer from public.product_variant_groups pvg join public.products p on p.id = pvg.product_id where pvg.group_id = vg.id and p.active = true) as "productCount"
        from public.variant_groups vg order by vg.display_order asc, vg.name asc`),
      query(`select vo.id, vo.group_id as "groupId", vo.name, vo.price_adjustment_idr as "priceAdjustmentIdr", vo.cost_adjustment_idr as "costAdjustmentIdr", vo.available, vo.display_order as "displayOrder"
        from public.variant_options vo order by vo.display_order asc, vo.name asc`),
      query(`select ag.id, ag.name, ag.required, ag.min_selection as "minSelection", ag.max_selection as "maxSelection", ag.display_order as "displayOrder", ag.active,
              (select count(*)::integer from public.product_addon_groups pag join public.products p on p.id = pag.product_id where pag.group_id = ag.id and p.active = true) as "productCount"
        from public.addon_groups ag order by ag.display_order asc, ag.name asc`),
      query(`select ao.id, ao.group_id as "groupId", ao.name, ao.price_adjustment_idr as "priceAdjustmentIdr", ao.cost_adjustment_idr as "costAdjustmentIdr", ao.available, ao.display_order as "displayOrder"
        from public.addon_options ao order by ao.display_order asc, ao.name asc`),
      query(`select p.id as "productId",
              coalesce((select array_agg(pvg.group_id) from public.product_variant_groups pvg where pvg.product_id = p.id), '{}') as "variantGroupIds",
              coalesce((select array_agg(pag.group_id) from public.product_addon_groups pag where pag.product_id = p.id), '{}') as "addonGroupIds"
        from public.products p where p.active = true`),
    ]);
    return NextResponse.json({
      variantGroups: variantGroups.rows.map((group) => ({ ...group, kind: "variant" as const, options: variantOptions.rows.filter((option) => option.groupId === group.id) })),
      addonGroups: addonGroups.rows.map((group) => ({ ...group, kind: "addon" as const, selection: "multiple", options: addonOptions.rows.filter((option) => option.groupId === group.id) })),
      assignments: assignments.rows,
    }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_modifiers_read_failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Opsi belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request) {
  const auth = await adminAuth();
  if (!auth.allowed) return failure(auth);
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const body = await readJsonBody(request);

  if (body instanceof Response) return body;

  const parsed = modifierGroupMutationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Data opsi belum lengkap atau tidak valid." }, { status: 400, headers: noStoreHeaders() });
  const input = parsed.data;
  try {
    const result = await query<{ create_modifier_group: string }>(
      "select public.create_modifier_group($1, $2, $3, $4, $5, $6, $7, $8::uuid) as create_modifier_group",
      [input.kind, input.name, input.selection ?? null, input.required ?? null, input.minSelection ?? null, input.maxSelection ?? null, input.displayOrder ?? null, auth.actorId],
    );
    const groupId = result.rows[0]?.create_modifier_group;
    if (!groupId) return NextResponse.json({ error: "Grup opsi belum berhasil dibuat." }, { status: 503, headers: noStoreHeaders() });
    return NextResponse.json({ groupId }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message.split(":")[0] : "";
    if (message === "INVALID_MODIFIER") return NextResponse.json({ error: "Data opsi belum lengkap atau tidak valid." }, { status: 400, headers: noStoreHeaders() });
    console.error("admin_modifier_group_create_failed", { errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Grup opsi belum berhasil dibuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
