import test from "node:test";
import { indonesianOrderAnnouncement } from "../lib/order-alerts.ts";
import { formatEscPos, bluetoothUuid } from "../lib/receipt-escpos.ts";
import type { ReceiptData } from "../lib/receipt-types.ts";
import { cashierOrderSchema, checkoutSchema, customerNameSchema } from "../lib/schemas.ts";
import assert from "node:assert/strict";
import { calculateTotals, validateCheckoutLine, CheckoutDomainError } from "../lib/domain/checkout.ts";
import { canTransitionOrder } from "../lib/domain/order-state.ts";
import { canApplyPaymentStatus, paymentStatusFromProvider } from "../lib/domain/payment-state.ts";
import { createOpaqueToken, hashOpaqueToken } from "../lib/domain/tokens.ts";
import { netRecognizedPayment } from "../lib/reports.ts";
import { jakartaRange } from "../lib/reports.ts";
import { buildCartItem } from "../lib/domain/cart.ts";
import { shiftCloseSchema, shiftIntakeItemSchema, shiftOpenSchema } from "../lib/schemas.ts";
import { shiftDatabaseFailure } from "../lib/domain/shift-errors.ts";
import { checkoutDatabaseFailure } from "../lib/domain/checkout-errors.ts";

const product = {
  id: "product-1", name: "Meal", priceIdr: 20_000, estimatedCostIdr: 8_000, active: true, available: true,
  modifierGroups: [{ id: "group-1", type: "variant" as const, selection: "single" as const, required: true, minSelection: 1, maxSelection: 1, active: true, options: [{ id: "option-1", groupId: "group-1", type: "variant" as const, name: "Spicy", priceAdjustmentIdr: 2_000, costAdjustmentIdr: 500, available: true }] }],
};

test("authoritative line validation uses option IDs and product relationships", () => {
  const line = validateCheckoutLine({ productId: product.id, quantity: 2, variantOptionIds: ["option-1"], addonOptionIds: [] }, product);
  assert.equal(line.unitPriceIdr, 22_000);
  assert.equal(line.lineTotalIdr, 44_000);
  assert.throws(() => validateCheckoutLine({ productId: product.id, quantity: 1, variantOptionIds: [], addonOptionIds: [] }, product), CheckoutDomainError);
  assert.throws(() => validateCheckoutLine({ productId: product.id, quantity: 1, variantOptionIds: ["option-1", "option-1"], addonOptionIds: [] }, product), /duplicate/i);
  assert.throws(() => validateCheckoutLine({ productId: product.id, quantity: 1, variantOptionIds: [], addonOptionIds: ["option-1"] }, product), /compatible/i);
});

test("tax and service charge use deterministic half-up IDR rounding", () => {
  const totals = calculateTotals([{ lineTotalIdr: 101, unitCostIdr: 40, quantity: 1 }], 500, 750);
  assert.deepEqual(totals, { subtotalIdr: 101, discountIdr: 0, taxIdr: 5, serviceChargeIdr: 8, totalIdr: 114, estimatedCostIdr: 40 });
});

test("operational order transitions are explicit", () => {
  assert.equal(canTransitionOrder("paid", "accepted"), true);
  assert.equal(canTransitionOrder("paid", "processing"), false);
  assert.equal(canTransitionOrder("awaiting_payment", "cancelled"), true);
  assert.equal(canTransitionOrder("completed", "cancelled"), false);
});

test("payment transitions are monotonic and provider mapping is shared", () => {
  assert.equal(canApplyPaymentStatus("settled", "pending"), false);
  assert.equal(canApplyPaymentStatus("settled", "expired"), false);
  assert.equal(canApplyPaymentStatus("pending", "settled"), true);
  assert.equal(paymentStatusFromProvider("settlement", "accept"), "settled");
  assert.equal(paymentStatusFromProvider("expire"), "expired");
});

test("customer/table access tokens are opaque and hashed", () => {
  const token = createOpaqueToken();
  assert.ok(token.length >= 40);
  assert.notEqual(token, hashOpaqueToken(token));
  assert.equal(hashOpaqueToken(token), hashOpaqueToken(token));
});

test("report revenue is net of refunds and excludes orphaned settlements", () => {
  assert.equal(netRecognizedPayment({ status: "settled", amount_idr: 100_000, refunded_amount_idr: 25_000 }), 75_000);
  assert.equal(netRecognizedPayment({ status: "refunded", amount_idr: 100_000, refunded_amount_idr: 100_000 }), 0);
  assert.equal(netRecognizedPayment({ status: "settled", amount_idr: 100_000, orphaned_settlement: true }), 0);
});

test("tracked stock is enforced before checkout", () => {
  const tracked = { ...product, stockTracked: true, stockQuantity: 2 };
  assert.doesNotThrow(() => validateCheckoutLine({ productId: tracked.id, quantity: 2, variantOptionIds: ["option-1"], addonOptionIds: [] }, tracked));
  assert.throws(() => validateCheckoutLine({ productId: tracked.id, quantity: 3, variantOptionIds: ["option-1"], addonOptionIds: [] }, tracked), (error) => error instanceof CheckoutDomainError && error.code === "STOCK_CONFLICT");
});

test("cart keys keep modifier variants separate", () => {
  const cartProduct = { id: product.id, name: product.name, description: "", category: "Sate", price: product.priceIdr, cost: product.estimatedCostIdr, available: true, accent: "#fff", imageTone: "", modifierGroups: [{ id: "group-1", name: "Level", type: "variant" as const, selection: "single" as const, required: true, minSelection: 1, maxSelection: 1, options: [{ id: "option-1", name: "Spicy", priceAdjustmentIdr: 2_000, costAdjustmentIdr: 500, available: true }] }] };
  const mild = buildCartItem(cartProduct, ["option-1"], [], 1);
  const original = buildCartItem({ ...cartProduct, modifierGroups: [] }, [], [], 1);
  assert.notEqual(mild.key, original.key);
  assert.equal(mild.unitPrice, 22_000);
});

test("add-on quantities affect cart price and authoritative validation", () => {
  const addonProduct = {
    ...product,
    modifierGroups: [
      ...product.modifierGroups,
      { id: "addon-group-1", type: "addon" as const, selection: "multiple" as const, required: false, minSelection: 0, maxSelection: 3, active: true, options: [{ id: "addon-1", groupId: "addon-group-1", type: "addon" as const, name: "Extra sambal", priceAdjustmentIdr: 5_000, costAdjustmentIdr: 1_500, available: true }] },
    ],
  };
  const cartProduct = { id: product.id, name: product.name, description: "", category: "Sate", price: product.priceIdr, cost: product.estimatedCostIdr, available: true, accent: "#fff", imageTone: "", modifierGroups: [{ id: "group-1", name: "Level", type: "variant" as const, selection: "single" as const, required: true, minSelection: 1, maxSelection: 1, options: [{ id: "option-1", name: "Spicy", priceAdjustmentIdr: 2_000, costAdjustmentIdr: 500, available: true }] }, { id: "addon-group-1", name: "Tambahan", type: "addon" as const, selection: "multiple" as const, required: false, minSelection: 0, maxSelection: 3, options: [{ id: "addon-1", name: "Extra sambal", priceAdjustmentIdr: 5_000, costAdjustmentIdr: 1_500, available: true }] }] };
  const cartItem = buildCartItem(cartProduct, ["option-1"], ["addon-1", "addon-1"], 1);
  assert.equal(cartItem.unitPrice, 32_000);
  assert.deepEqual(cartItem.addonLabels, ["Extra sambal × 2"]);
  const line = validateCheckoutLine({ productId: product.id, quantity: 1, variantOptionIds: ["option-1"], addonOptionIds: ["addon-1", "addon-1"] }, addonProduct);
  assert.equal(line.unitPriceIdr, 32_000);
  assert.equal(line.modifiers.filter((modifier) => modifier.id === "addon-1").length, 2);
});

test("settled_at Date objects compare correctly against ISO range bounds", () => {
  // Regression: the pg driver returns timestamptz as Date. Comparing
  // Date >= string is always false, which zeroed every daily report.
  const settled = new Date("2026-09-22T10:15:38.606Z");
  const normalized = new Date(settled).toISOString();
  assert.equal(normalized >= "2026-09-21T17:00:00.000Z" && normalized < "2026-09-22T17:00:00.000Z", true);
  assert.equal((settled as unknown as string) >= "2026-09-21T17:00:00.000Z", false);
});

test("Jakarta report ranges are bounded and inclusive by calendar date", () => {
  const range = jakartaRange("2026-09-01", "2026-09-07");
  assert.equal(range.days, 7);
  assert.equal(range.from, "2026-09-01");
  assert.equal(range.to, "2026-09-07");
  assert.throws(() => jakartaRange("2026-09-07", "2026-09-01"), /REPORT_RANGE_LIMIT/);
  assert.throws(() => jakartaRange("2026-09-01", "2026-10-02"), /REPORT_RANGE_LIMIT/);
});

test("shift intake requires valid per-product quantities", () => {
  const valid = shiftOpenSchema.safeParse({ note: "pagi", items: [{ productId: "00000000-0000-0000-0000-000000000000", quantity: 10 }] });
  assert.equal(valid.success, true);
  assert.equal(shiftOpenSchema.safeParse({ items: [{ productId: "not-a-uuid", quantity: 1 }] }).success, false);
  assert.equal(shiftOpenSchema.safeParse({ items: [{ productId: "00000000-0000-0000-0000-000000000000", quantity: -1 }] }).success, false);
  assert.equal(shiftIntakeItemSchema.safeParse({ productId: "00000000-0000-0000-0000-000000000000", quantity: 1_000_001 }).success, false);
  assert.equal(shiftCloseSchema.safeParse({ note: "x".repeat(241) }).success, false);
});

test("shift gate failures explain the closed register", () => {
  assert.deepEqual(shiftDatabaseFailure(new Error("SHIFT_CLOSE_BLOCKED:2")), { code: "SHIFT_CLOSE_BLOCKED", error: "Masih ada 2 pembayaran QR yang belum selesai. Tunggu lunas atau kedaluwarsa dulu.", status: 409 });
  assert.deepEqual(shiftDatabaseFailure(new Error("SHIFT_INTAKE_INCOMPLETE:Sate, Lontong")), { code: "SHIFT_INTAKE_INCOMPLETE", error: "Produk ini belum diisi stok awalnya: Sate, Lontong.", status: 400 });
  assert.equal(shiftDatabaseFailure(new Error("SHIFT_ALREADY_OPEN")).status, 409);
  const staffClosed = checkoutDatabaseFailure(new Error("SHIFT_CLOSED"), "staff");
  assert.equal(staffClosed.status, 409);
  assert.match(staffClosed.error, /Buka kasir/);
  const guestClosed = checkoutDatabaseFailure(new Error("SHIFT_CLOSED"), "customer");
  assert.match(guestClosed.error, /Kasir sedang tutup/);
});

test("customer handoff names are normalized and cashier checkout requires them", () => {
  const cart = [{ productId: "00000000-0000-4000-8000-000000000001", quantity: 1 }];
  const key = "00000000-0000-4000-8000-000000000002";
  assert.equal(customerNameSchema.parse("  Mbak Rina  "), "Mbak Rina");
  assert.equal(customerNameSchema.safeParse("   ").success, false);
  assert.equal(customerNameSchema.safeParse("A".repeat(81)).success, false);
  assert.equal(customerNameSchema.safeParse("Someone\nElse").success, false);
  assert.equal(cashierOrderSchema.safeParse({ idempotencyKey: key, items: cart, paymentMethod: "cash" }).success, false);
  assert.equal(cashierOrderSchema.parse({ idempotencyKey: key, items: cart, paymentMethod: "cash", customerName: "  Budi  " }).customerName, "Budi");
  assert.equal(checkoutSchema.parse({ idempotencyKey: key, sessionToken: "s".repeat(32), items: cart }).customerName, undefined);
  assert.equal(checkoutSchema.parse({ idempotencyKey: key, sessionToken: "s".repeat(32), items: cart, customerName: "Rafi" }).customerName, "Rafi");
});

test("Indonesian narration and ESC/POS receipt preserve customer, order and payment details", () => {
  assert.equal(indonesianOrderAnnouncement({ number: "TT-12", customer: "Rina", table: "Meja 3" }), "Pesanan baru atas nama Rina, Meja 3.");
  assert.equal(indonesianOrderAnnouncement({ number: "TT-13" }), "Pesanan baru nomor TT-13, untuk pengambilan di kasir.");
  const receipt: ReceiptData = {
    orderNumber: "TT-1209", customerName: "Rina", tableLabel: "Meja 3",
    createdAt: "2026-10-13T11:00:00.000Z",
    paymentLabel: "Tunai", paymentStatus: "settled",
    subtotalIdr: 25000, totalIdr: 25000,
    lines: [{ name: "Sate Taichan", quantity: 1, unitPriceIdr: 25000, lineTotalIdr: 25000,
      note: "Pedas", modifiers: ["Sambal ekstra"] }],
    settings: { merchant_name: "Tempat Taichan", address: "Jl. Contoh 10", footer: "Terima kasih",
      paper_width_mm: 58, ble_service_uuid: "ffe0", ble_characteristic_uuid: "ffe1" },
  };
  assert.equal(bluetoothUuid("ffe0"), 0xffe0);
  assert.equal(bluetoothUuid("0000ffe1"), 0xffe1);
  assert.equal(bluetoothUuid("0000ffe0-0000-1000-8000-00805f9b34fb"), "0000ffe0-0000-1000-8000-00805f9b34fb");
  const bytes = formatEscPos(receipt);
  assert.deepEqual(Array.from(bytes.slice(0, 2)), [0x1b, 0x40]);
  assert.deepEqual(Array.from(bytes.slice(-3)), [0x1d, 0x56, 0x00]);
  const text = new TextDecoder().decode(bytes.slice(2, -3));
  for (const fragment of ["Tempat Taichan", "Rina", "Meja 3", "TT-1209", "Sate Taichan", "Terima kasih", "TOTAL"]) {
    assert.ok(text.includes(fragment), fragment);
  }
});
