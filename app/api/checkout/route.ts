import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkoutSchema } from "@/lib/schemas";
import { MidtransProvider } from "@/lib/payments/midtrans";

export const runtime = "nodejs";

function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

export async function POST(request: Request) {
  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pesanan belum lengkap. Periksa kembali item dan pilihanmu." }, { status: 400 });
  const input = parsed.data;

  try {
    const supabase = createAdminClient();
    const { data: existing } = await supabase.from("orders").select("id, order_number, total_idr, status").eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (existing) return NextResponse.json({ orderId: existing.id, orderNumber: existing.order_number, totalIdr: existing.total_idr, status: existing.status, replayed: true });

    const productIds = input.items.map((item) => item.productId);
    const { data: session, error: sessionError } = await supabase.from("customer_sessions").select("id, order_type, table_id, expires_at").eq("access_token_hash", hashToken(input.sessionToken)).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (sessionError || !session || session.order_type !== input.orderType) return NextResponse.json({ error: "Sesi order sudah tidak berlaku. Scan QR lagi untuk melanjutkan." }, { status: 401 });
    const { data: menu, error: menuError } = await supabase.from("products").select("id, name, price_idr, estimated_cost_idr, available, active").in("id", productIds);
    if (menuError) throw menuError;
    const byId = new Map((menu ?? []).map((product) => [product.id, product]));
    for (const item of input.items) {
      const product = byId.get(item.productId);
      if (!product || !product.active || !product.available) return NextResponse.json({ error: `${product?.name ?? "Salah satu menu"} sudah tidak tersedia. Silakan perbarui pesananmu.` }, { status: 409 });
    }

    const variantNames = [...new Set(input.items.flatMap((item) => item.variantNames))];
    const addonNames = [...new Set(input.items.flatMap((item) => item.addonNames))];
    const [{ data: variants, error: variantsError }, { data: addons, error: addonsError }] = await Promise.all([
      variantNames.length ? supabase.from("variant_options").select("name, price_adjustment_idr, cost_adjustment_idr").in("name", variantNames).eq("available", true) : Promise.resolve({ data: [], error: null }),
      addonNames.length ? supabase.from("addon_options").select("name, price_adjustment_idr, cost_adjustment_idr").in("name", addonNames).eq("available", true) : Promise.resolve({ data: [], error: null }),
    ]);
    if (variantsError) throw variantsError;
    if (addonsError) throw addonsError;
    const variantByName = new Map((variants ?? []).map((option) => [option.name, option]));
    const addonByName = new Map((addons ?? []).map((option) => [option.name, option]));
    for (const item of input.items) {
      if (item.variantNames.some((name) => !variantByName.has(name)) || item.addonNames.some((name) => !addonByName.has(name))) return NextResponse.json({ error: "One of the selected options is no longer available. Please review your cart." }, { status: 409 });
    }
    const modifierForItem = (item: typeof input.items[number]) => [...item.variantNames.map((name) => ({ type: "variant", name, price: variantByName.get(name)!.price_adjustment_idr, cost: variantByName.get(name)!.cost_adjustment_idr })), ...item.addonNames.map((name) => ({ type: "addon", name, price: addonByName.get(name)!.price_adjustment_idr, cost: addonByName.get(name)!.cost_adjustment_idr }))];
    const lines = input.items.map((item) => { const product = byId.get(item.productId)!; const modifiers = modifierForItem(item); const modifierPrice = modifiers.reduce((sum, modifier) => sum + modifier.price, 0); const modifierCost = modifiers.reduce((sum, modifier) => sum + modifier.cost, 0); return { product_id: product.id, product_name_snapshot: product.name, quantity: item.quantity, unit_price_idr: product.price_idr + modifierPrice, unit_cost_snapshot_idr: product.estimated_cost_idr + modifierCost, line_total_idr: (product.price_idr + modifierPrice) * item.quantity, note: item.note ?? null, modifiers }; });
    const subtotal = lines.reduce((sum, line) => sum + line.line_total_idr, 0);
    const { data: nextNumber, error: numberError } = await supabase.rpc("next_order_number");
    if (numberError || !nextNumber) throw numberError ?? new Error("Order number could not be created.");
    const { data: order, error: orderError } = await supabase.from("orders").insert({ order_number: nextNumber, idempotency_key: input.idempotencyKey, customer_session_id: session.id, table_id: session.table_id, order_type: input.orderType === "dine_in" ? "dine_in" : "takeaway", status: "awaiting_payment", subtotal_idr: subtotal, total_idr: subtotal, estimated_cost_idr: lines.reduce((sum, line) => sum + line.unit_cost_snapshot_idr * line.quantity, 0) }).select("id, order_number, total_idr").single();
    if (orderError || !order) throw orderError ?? new Error("Order could not be created.");
    const { error: lineError } = await supabase.from("order_items").insert(lines.map((line) => { const { modifiers: _modifiers, ...snapshot } = line; return { ...snapshot, order_id: order.id }; }));
    if (lineError) throw lineError;
    const { data: createdItems } = await supabase.from("order_items").select("id, product_name_snapshot").eq("order_id", order.id).order("created_at", { ascending: true });
    const modifierRows = lines.flatMap((line, index) => (line.modifiers ?? []).map((modifier) => ({ order_item_id: createdItems?.[index]?.id, modifier_type: modifier.type, modifier_name_snapshot: modifier.name, price_adjustment_idr: modifier.price, cost_adjustment_snapshot_idr: modifier.cost })).filter((row) => row.order_item_id));
    if (modifierRows.length) { const { error: modifierError } = await supabase.from("order_item_modifiers").insert(modifierRows); if (modifierError) throw modifierError; }

    const paymentOrderId = `${order.order_number}-${randomUUID().slice(0, 8)}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const provider = new MidtransProvider();
    const payment = await provider.createPayment({ providerOrderId: paymentOrderId, amountIdr: subtotal, expiresAt });
    const { error: paymentError } = await supabase.from("payments").insert({ order_id: order.id, provider: "midtrans", method: "qris", status: "pending", amount_idr: subtotal, provider_order_id: payment.providerOrderId, provider_transaction_id: payment.providerTransactionId, qr_string: payment.qrString, expires_at: payment.expiresAt.toISOString() });
    if (paymentError) throw paymentError;
    return NextResponse.json({ orderId: order.id, orderNumber: order.order_number, totalIdr: order.total_idr, qrString: payment.qrString, expiresAt: payment.expiresAt.toISOString() }, { status: 201 });
  } catch (error) {
    console.error("checkout_failed", error);
    return NextResponse.json({ error: "Kami belum bisa membuat pembayaran. Coba lagi sebentar." }, { status: 503 });
  }
}
