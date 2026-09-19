import test from "node:test";
import assert from "node:assert/strict";
import { calculateTotals, validateCheckoutLine, CheckoutDomainError } from "../lib/domain/checkout.ts";
import { canTransitionOrder } from "../lib/domain/order-state.ts";
import { canApplyPaymentStatus, paymentStatusFromProvider } from "../lib/domain/payment-state.ts";
import { createOpaqueToken, hashOpaqueToken } from "../lib/domain/tokens.ts";
import { netRecognizedPayment } from "../lib/reports.ts";
import { jakartaRange } from "../lib/reports.ts";
import { buildCartItem } from "../lib/domain/cart.ts";

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

test("Jakarta report ranges are bounded and inclusive by calendar date", () => {
  const range = jakartaRange("2026-09-01", "2026-09-07");
  assert.equal(range.days, 7);
  assert.equal(range.from, "2026-09-01");
  assert.equal(range.to, "2026-09-07");
  assert.throws(() => jakartaRange("2026-09-07", "2026-09-01"), /REPORT_RANGE_LIMIT/);
  assert.throws(() => jakartaRange("2026-09-01", "2026-10-02"), /REPORT_RANGE_LIMIT/);
});
