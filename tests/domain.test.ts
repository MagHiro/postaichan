import test from "node:test";
import assert from "node:assert/strict";
import { calculateTotals, validateCheckoutLine, CheckoutDomainError } from "../lib/domain/checkout.ts";
import { canTransitionOrder } from "../lib/domain/order-state.ts";
import { canApplyPaymentStatus, paymentStatusFromProvider } from "../lib/domain/payment-state.ts";
import { createOpaqueToken, hashOpaqueToken } from "../lib/domain/tokens.ts";
import { netRecognizedPayment } from "../lib/reports.ts";

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
