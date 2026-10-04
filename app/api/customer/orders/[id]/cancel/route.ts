import { NextResponse } from "next/server";
import { cancelOrderWithProvider } from "@/lib/payments/cancel-order";
import { hashOpaqueToken } from "@/lib/domain/tokens";
import { uuidParamSchema } from "@/lib/schemas";
import { consumeRateLimit, noStoreHeaders, sameOrigin } from "@/lib/security/request";
import { createRequestId, structuredLog } from "@/lib/security/structured-log";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const requestId = createRequestId();
  if (!sameOrigin(request)) return NextResponse.json({ code: "INVALID_ORIGIN", error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const token = request.headers.get("x-order-access-token");
  if (!token) return NextResponse.json({ code: "SESSION_TOKEN_REQUIRED", error: "Token akses pesanan dibutuhkan." }, { status: 401, headers: noStoreHeaders() });
  const { id } = await params;
  if (!uuidParamSchema.safeParse(id).success) return NextResponse.json({ code: "ORDER_NOT_FOUND", error: "Pesanan tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });

  try {
    const sessionHash = hashOpaqueToken(token);
    if (!(await consumeRateLimit(request, "customer-cancel", 8, 300, sessionHash.slice(0, 24)))) {
      return NextResponse.json({ code: "CANCEL_RATE_LIMITED", error: "Terlalu banyak percobaan pembatalan. Coba lagi sebentar." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "300" } });
    }

    const result = await cancelOrderWithProvider({ orderId: id, sessionHash, requestId });
    if (!result.ok) return NextResponse.json(result, { status: result.status, headers: noStoreHeaders() });
    return NextResponse.json({ cancelled: true, orderStatus: "cancelled", paymentStatus: result.paymentStatus }, { headers: noStoreHeaders() });
  } catch (error) {
    structuredLog("error", "customer_order_cancel_failed", requestId, { orderId: id, errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ code: "ORDER_CANCEL_INTERNAL_ERROR", error: "Pesanan belum dibatalkan karena server gagal menyelesaikan permintaan. Coba lagi.", retryable: true }, { status: 503, headers: noStoreHeaders() });
  }
}
