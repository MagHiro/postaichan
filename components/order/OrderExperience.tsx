"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Home, ReceiptText, Search, X } from "lucide-react";
import { formatCompactIDR } from "@/lib/format";
import type { CartItem, Product } from "@/lib/types";
import { buildCartItem } from "@/lib/domain/cart";
import { cn } from "@/lib/utils";
import {
  matchesOrderCategory,
  type OrderCategory,
  type OrderStep,
  type PaymentAttempt,
  type PlacedOrder,
} from "./constants";
import { PaymentView } from "./PaymentView";
import { ProductCard } from "./ProductCard";
import { ProductSheet } from "./ProductSheet";
import { SuccessView } from "./SuccessView";
import { CartSheet } from "./CartSheet";
import { EmptyState, SkeletonCard } from "./ui";

export function OrderExperience({ tableToken, generalToken }: { tableToken?: string; generalToken?: string }) {
  // The customer surface renders only the authoritative server catalog.
  const [menuProducts, setMenuProducts] = useState<Product[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [menuRetry, setMenuRetry] = useState(0);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<OrderCategory>("Semua Menu");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [placedOrders, setPlacedOrders] = useState<PlacedOrder[]>([]);
  const [activeTab, setActiveTab] = useState<"home" | "orders">("home");
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [step, setStep] = useState<OrderStep>("menu");
  const [orderType, setOrderType] = useState<"Dine in" | "Takeaway">(
    tableToken ? "Dine in" : "Takeaway",
  );
  const [session, setSession] = useState<{
    token: string;
    orderType: "dine_in" | "takeaway";
    tableLabel: string | null;
  } | null>(null);
  const [payment, setPayment] = useState<PaymentAttempt | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [variantOptionIds, setVariantOptionIds] = useState<string[]>([]);
  const [addonOptionIds, setAddonOptionIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const tableLabel = session?.tableLabel ?? "Dine in";
  const toastTimer = useRef<number | null>(null);
  const checkoutIntentKey = useRef<string | null>(null);

  function resetCheckoutIntent() { checkoutIntentKey.current = null; }

  useEffect(() => {
    let active = true;
    setMenuLoading(true);
    setMenuError(null);
    const loadingTimeout = window.setTimeout(() => {
      if (active) {
        setMenuLoading(false);
        setMenuError("Menu belum dapat dimuat. Coba lagi.");
      }
    }, 8000);

    fetch("/api/menu", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error ?? "Menu belum dapat dimuat.");
        }
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        if (payload?.products?.length) {
          setMenuError(null);
          setMenuProducts(payload.products);
          setCategories(["Semua Menu", ...(payload.categories ?? []).map((item: { name: string }) => item.name), ...(payload.products.some((item: Product) => item.popular) ? ["Paket Hemat"] : [])]);
        } else setMenuError("Menu belum tersedia saat ini.");
      })
      .catch((error) => {
        if (active) setMenuError(error instanceof Error ? error.message : "Menu belum dapat dimuat. Coba lagi.");
      })
      .finally(() => {
        if (active) {
          window.clearTimeout(loadingTimeout);
          setMenuLoading(false);
        }
      });
    return () => {
      active = false;
      window.clearTimeout(loadingTimeout);
    };
  }, [menuRetry]);

  useEffect(() => {
    const want = orderType === "Dine in" ? "dine_in" : "takeaway";
    let active = true;
    const stored = window.sessionStorage.getItem(`tt-session-${want}`);
    if (stored) {
      try {
        const value = JSON.parse(stored) as { token: string; tableToken?: string; generalToken?: string; tableLabel?: string | null; expiresAt?: string };
        if (value.tableToken === tableToken && value.generalToken === generalToken && (!value.expiresAt || new Date(value.expiresAt).getTime() > Date.now())) {
          setSessionError(null);
          setSession({ token: value.token, orderType: want, tableLabel: value.tableLabel ?? null });
          return () => { active = false; };
        }
      } catch { window.sessionStorage.removeItem(`tt-session-${want}`); }
    }
    setSession(null);
    setSessionError(null);
    fetch("/api/customer/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderType: want, tableToken: want === "dine_in" ? tableToken : undefined, generalToken }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? "QR pemesanan belum dapat digunakan.");
        return payload;
      })
      .then((payload) => {
        if (active && payload?.sessionToken) {
          setSession({ token: payload.sessionToken, orderType: want, tableLabel: payload.tableLabel ?? null });
          window.sessionStorage.setItem(`tt-session-${want}`, JSON.stringify({ token: payload.sessionToken, tableToken, generalToken, tableLabel: payload.tableLabel ?? null, expiresAt: payload.expiresAt }));
        }
      })
      .catch(() => {
        if (active) { setSession(null); setSessionError("QR pemesanan sudah tidak aktif. Minta QR terbaru dari kasir."); }
      });
    return () => {
      active = false;
    };
  }, [orderType, tableToken, generalToken]);

  useEffect(() => {
    if (!session) return;
    const activePayment = window.sessionStorage.getItem("tt-active-payment");
    if (!activePayment) return;
    let cancelled = false;
    void (async () => {
      try {
        const reference = JSON.parse(activePayment) as { orderId?: string; idempotencyKey?: string };
        if (!reference.orderId) return;
        if (reference.idempotencyKey) checkoutIntentKey.current = reference.idempotencyKey;
        const response = await fetch(`/api/customer/payments/${reference.orderId}`, { method: "POST", headers: { "x-order-access-token": session.token }, cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (cancelled || !response.ok || !payload) return;
        if (payload.paymentStatus === "pending" && (payload.qrString || payload.qrImageUrl)) {
          setPayment({ orderId: reference.orderId!, orderNumber: payload.orderNumber, amountIdr: payload.amountIdr, qrString: payload.qrString ?? undefined, qrImageUrl: payload.qrImageUrl ?? undefined, expiresAt: payload.expiresAt });
          setStep("payment");
        } else if (payload.paymentStatus === "settled") {
          setPayment({ orderId: reference.orderId!, orderNumber: payload.orderNumber, amountIdr: payload.amountIdr, expiresAt: payload.expiresAt });
          setStep("success");
        }
      } catch { /* A new checkout can recover if the stored payment is gone. */ }
    })();
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (!toast) return;
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [toast]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return menuProducts.filter((product) => {
      if (!matchesOrderCategory(product, category)) return false;
      if (!query) return true;
      return `${product.name} ${product.description} ${product.category}`
        .toLowerCase()
        .includes(query);
    });
  }, [menuProducts, category, search]);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );

  function showToast(message: string) {
    setToast(message);
  }

  function toggleFavorite(product: Product) {
    setFavoriteProductIds((current) =>
      current.includes(product.id)
        ? current.filter((id) => id !== product.id)
        : [...current, product.id],
    );
  }

  function goBack() {
    if (activeTab === "orders") {
      setActiveTab("home");
      return;
    }
    if (window.history.length > 1) window.history.back();
  }

  function openProduct(product: Product) {
    if (!product.available) return;
    if ((tableToken || generalToken) && !session) { showToast(sessionError ?? "Sesi pemesanan belum siap."); return; }
    setSelectedProduct(product);
    setVariantOptionIds([]);
    setAddonOptionIds([]);
    setQuantity(1);
    setNote("");
    setStep("configure");
  }

  function addToCart() {
    if (!selectedProduct) return;
    const nextItem = buildCartItem(selectedProduct, variantOptionIds, addonOptionIds, quantity, note);
    setCart((current) => {
      const existing = current.find((item) => item.key === nextItem.key);
      if (existing)
        return current.map((item) =>
          item.key === nextItem.key
            ? { ...item, quantity: item.quantity + quantity }
            : item,
        );
      return [...current, nextItem];
    });
    resetCheckoutIntent();
    setStep("menu");
    showToast(`${selectedProduct.name} ditambahkan`);
  }

  function quickAdd(product: Product) {
    if (!product.available) return;
    if ((tableToken || generalToken) && !session) { showToast(sessionError ?? "Sesi pemesanan belum siap."); return; }
    if ((product.modifierGroups ?? []).length > 0)
      return openProduct(product);
    const item = buildCartItem(product, [], [], 1);
    setCart((current) => {
      const existing = current.find((line) => line.key === item.key);
      if (existing)
        return current.map((line) =>
          line.key === item.key
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      return [...current, item];
    });
    showToast(`${product.name} ditambahkan`);
  }

  function updateQuantity(key: string, delta: number) {
    resetCheckoutIntent();
    setCart((current) =>
      current.flatMap((item) => {
        if (item.key !== key) return [item];
        const nextQty = item.quantity + delta;
        return nextQty > 0 ? [{ ...item, quantity: nextQty }] : [];
      }),
    );
  }

  async function beginCheckout() {
    if (cart.length === 0) return;
    if ((tableToken || generalToken) && !session) { setCheckoutError(sessionError ?? "QR pemesanan sudah tidak aktif."); return; }
    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      const want = orderType === "Dine in" ? "dine_in" : "takeaway";
      let activeSessionToken =
        session && session.orderType === want ? session.token : null;
      if (!activeSessionToken) {
        const sessionResponse = await fetch("/api/customer/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orderType: orderType === "Dine in" ? "dine_in" : "takeaway",
            tableToken: want === "dine_in" ? tableToken : undefined,
            generalToken,
          }),
        });
        const sessionPayload = await sessionResponse.json();
        if (!sessionResponse.ok || !sessionPayload.sessionToken)
          throw new Error(
            sessionPayload.error ?? "Pesanan belum dapat dimulai. Coba lagi.",
          );
        activeSessionToken = sessionPayload.sessionToken as string;
          setSession({ token: activeSessionToken as string, orderType: want, tableLabel: sessionPayload.tableLabel ?? null });
      }
      if (!checkoutIntentKey.current) checkoutIntentKey.current = crypto.randomUUID();
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: checkoutIntentKey.current,
          sessionToken: activeSessionToken,
          orderType: orderType === "Dine in" ? "dine_in" : "takeaway",
          items: cart.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
            variantOptionIds: item.variantOptionIds,
            addonOptionIds: item.addonOptionIds,
            note: item.note,
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Pembayaran belum dapat dibuat. Coba lagi.");
      if (!payload.qrString && !payload.qrImageUrl) throw new Error("Pembayaran belum siap. Coba lagi dengan tombol yang sama.");
      setPayment({
        orderId: payload.orderId,
        orderNumber: payload.orderNumber,
        amountIdr: payload.totalIdr,
        qrString: payload.qrString ?? undefined,
        qrImageUrl: payload.qrImageUrl ?? undefined,
        expiresAt: payload.expiresAt,
      });
      setStep("payment");
      window.sessionStorage.setItem("tt-active-payment", JSON.stringify({ orderId: payload.orderId, idempotencyKey: checkoutIntentKey.current }));
    } catch (error) {
      setCheckoutError(
        error instanceof Error ? error.message : "Checkout gagal tanpa detail. Coba lagi; jika berulang, muat ulang menu.",
      );
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function cancelCustomerOrder() {
    if (!payment || !session) return;
    if (!window.confirm(`Batalkan pesanan ${payment.orderNumber}? QR pembayaran akan dinonaktifkan.`)) return;
    const response = await fetch(`/api/customer/orders/${payment.orderId}/cancel`, {
      method: "POST",
      headers: { "x-order-access-token": session.token },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? "Pesanan belum dapat dibatalkan.");
    window.sessionStorage.removeItem("tt-active-payment");
    setCart([]);
    setPayment(null);
    resetCheckoutIntent();
    setStep("menu");
    setActiveTab("orders");
    showToast(`${payment.orderNumber} dibatalkan.`);
  }

  if (step === "payment" && payment && session) {
    return (
      <PaymentView
        payment={payment}
        sessionToken={session.token}
        orderType={orderType}
        tableLabel={tableLabel}
        // Keep the intent key with the cart. Returning to checkout resumes the
        // same server-side payment intent instead of creating a second order.
        onBack={() => {
          setPayment(null);
          setStep("menu");
          setActiveTab("orders");
        }}
        onPaid={() => {
          window.sessionStorage.removeItem("tt-active-payment");
          resetCheckoutIntent();
          setPlacedOrders((current) => [
            {
              orderNumber: payment.orderNumber,
              amountIdr: payment.amountIdr,
              orderType,
              tableLabel,
              time: new Date().toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            },
            ...current,
          ]);
          setStep("success");
        }}
        onRetry={() => {
          setPayment(null);
          setCheckoutError(null);
          setStep("menu");
          setActiveTab("orders");
          // Re-run checkout on the next tick so the orders tab is mounted
          // before beginCheckout kicks off the fresh charge.
          window.setTimeout(() => void beginCheckout(), 0);
        }}
        onCancel={cancelCustomerOrder}
      />
    );
  }

  if (step === "success") {
    return (
      <SuccessView
        orderType={orderType}
        tableLabel={tableLabel}
        amount={payment?.amountIdr ?? subtotal}
        orderNumber={payment?.orderNumber ?? "—"}
        onHome={() => {
          window.sessionStorage.removeItem("tt-active-payment");
          setCart([]);
          setPayment(null);
          setStep("menu");
          setActiveTab("home");
        }}
        onViewOrders={() => {
          window.sessionStorage.removeItem("tt-active-payment");
          setCart([]);
          setPayment(null);
          setStep("menu");
          setActiveTab("orders");
        }}
      />
    );
  }

  const dineIn = orderType === "Dine in";
  const menuTitle = category === "Semua Menu" ? "Menu" : category;

  return (
    <main className="flex min-h-screen justify-center bg-white text-neutral-900 antialiased selection:bg-[#FDBD2C] selection:text-neutral-900">
      <div className="relative flex min-h-screen w-full max-w-[440px] flex-col bg-white pb-36">
        <header className="sticky top-0 z-30 border-b border-neutral-100 bg-white/90 backdrop-blur-md">
          <div className="px-5 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
            <div className="relative flex h-10 items-center justify-center">
              <button
                type="button"
                onClick={goBack}
                aria-label="Kembali"
                className="absolute left-0 flex h-9 w-9 items-center justify-center rounded-full text-neutral-900 transition active:scale-95"
              >
                <ArrowLeft size={21} strokeWidth={1.8} />
              </button>
              <h1 className="max-w-[230px] truncate text-[18px] font-medium tracking-tight">
                {menuTitle}
              </h1>
              {dineIn && session?.tableLabel && (
                <p className="absolute right-0 text-xs text-neutral-400">
                  {session.tableLabel}
                </p>
              )}
            </div>
            <div role="group" aria-label="Jenis pesanan" className="mt-3 flex rounded-full bg-neutral-100 p-1">
              <button
                type="button"
                onClick={() => { resetCheckoutIntent(); setOrderType("Dine in"); }}
                aria-pressed={dineIn}
                className={cn(
                  "flex-1 rounded-full py-1.5 text-center text-[13px] transition",
                  dineIn
                    ? "bg-white font-medium shadow-xs"
                    : "text-neutral-500",
                )}
              >
                Dine in
              </button>
              <button
                type="button"
                onClick={() => { resetCheckoutIntent(); setOrderType("Takeaway"); }}
                aria-pressed={!dineIn}
                className={cn(
                  "flex-1 rounded-full py-1.5 text-center text-[13px] transition",
                  !dineIn
                    ? "bg-white font-medium shadow-xs"
                    : "text-neutral-500",
                )}
              >
                Takeaway
              </button>
            </div>
            {sessionError && <div role="alert" className="mt-3 rounded-2xl bg-neutral-50 px-4 py-3 text-[13px] leading-relaxed text-neutral-600">{sessionError}</div>}
          </div>
        </header>

        {activeTab === "home" ? (
          <div key="home" className="ord-rise flex-1 px-5 pt-4" aria-busy={menuLoading}>
            <div className="relative">
              <Search
                aria-hidden="true"
                size={18}
                strokeWidth={1.8}
                className="pointer-events-none absolute inset-y-0 left-4 my-auto text-neutral-400"
              />
              <label htmlFor="menu-search" className="sr-only">
                Cari menu
              </label>
              <input
                id="menu-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari menu"
                className="h-12 w-full rounded-2xl bg-neutral-100 pl-11 pr-11 text-[13px] outline-none transition placeholder:text-neutral-400 focus:bg-white focus:ring-2 focus:ring-[#FDBD2C]/50"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Hapus pencarian"
                  onClick={() => setSearch("")}
                  className="absolute inset-y-0 right-3 my-auto flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition active:scale-95"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            <div className="no-scrollbar -mx-5 mt-4 flex gap-2 overflow-x-auto px-5">
              {categories.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  aria-pressed={category === item}
                  className={cn(
                    "shrink-0 rounded-full px-3.5 py-2 text-[13px] transition active:scale-95",
                    category === item
                      ? "bg-[#FDBD2C]/20 font-medium text-neutral-900"
                      : "bg-neutral-100 text-neutral-500",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="mt-7 flex items-baseline justify-between">
              <h2 className="text-sm font-medium">{menuTitle}</h2>
              <span className="text-xs text-neutral-400">
                {filteredProducts.length} menu
              </span>
            </div>

            {menuLoading ? (
              <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-7">
                {[0, 1, 2, 3].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : menuError ? (
              <div>
                <EmptyState title={menuError} hint="Periksa koneksi lalu coba lagi." />
                <button type="button" onClick={() => setMenuRetry((attempt) => attempt + 1)} className="mx-auto block h-11 rounded-full bg-neutral-900 px-5 text-[13px] font-medium text-white">Coba lagi</button>
              </div>
            ) : filteredProducts.length === 0 ? (
              <EmptyState title="Tidak ketemu" hint="Coba kata lain atau ganti kategori." />
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-7">
                {filteredProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onOpen={openProduct}
                    onQuickAdd={quickAdd}
                    isFavorite={favoriteProductIds.includes(product.id)}
                    onToggleFavorite={toggleFavorite}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div key="orders" className="ord-rise flex-1 px-5 pt-7">
            <h1 className="text-[22px] font-medium tracking-tight">Pesanan</h1>
            <p className="mt-1 text-[13px] text-neutral-500">
              {dineIn ? `${tableLabel} · Dine in` : "Takeaway · Ambil di kasir"}
            </p>

            {cart.length === 0 && placedOrders.length === 0 ? (
              <EmptyState
                title="Belum ada pesanan"
                hint="Pilih menu dari Beranda untuk mulai."
              />
            ) : (
              <>
                {cart.length > 0 && (
                  <div className="mt-7">
                    <p className="text-xs text-neutral-400">
                      Keranjang · {cartCount} item
                    </p>
                    <div className="mt-1">
                      <CartSheet
                        cart={cart}
                        onUpdate={updateQuantity}
                        onCheckout={beginCheckout}
                        checkoutLoading={checkoutLoading}
                        checkoutError={checkoutError}
                        checkoutDisabled={Boolean((tableToken || generalToken) && !session)}
                      />
                    </div>
                  </div>
                )}

                {placedOrders.length > 0 && (
                  <div className={cn(cart.length > 0 && "mt-10")}>
                    <p className="text-xs text-neutral-400">Riwayat</p>
                    <div className="mt-1 divide-y divide-neutral-100">
                      {placedOrders.map((order) => (
                        <div
                          key={order.orderNumber}
                          className="flex items-center justify-between gap-3 py-3.5"
                        >
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium">
                              {order.orderNumber}
                            </p>
                            <p className="mt-0.5 text-xs text-neutral-400">
                              {order.orderType === "Dine in"
                                ? order.tableLabel
                                : "Takeaway"}{" "}
                              · {order.time}
                            </p>
                          </div>
                          <p className="shrink-0 text-[13px] tabular-nums text-neutral-500">
                            {formatCompactIDR(order.amountIdr)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {cart.length === 0 && placedOrders.length > 0 && (
                  <button
                    onClick={() => setActiveTab("home")}
                    className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-neutral-900 text-sm font-medium text-white transition active:scale-[0.98]"
                  >
                    Pesan lagi
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <nav aria-label="Navigasi pemesanan" className="fixed inset-x-0 bottom-0 z-40">
          <div className="mx-auto flex max-w-[440px] border-t border-neutral-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
            <button
              type="button"
              onClick={() => setActiveTab("home")}
              aria-current={activeTab === "home" ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 transition",
                activeTab === "home" ? "text-neutral-900" : "text-neutral-400",
              )}
            >
              <Home size={20} strokeWidth={activeTab === "home" ? 2 : 1.6} />
              <span
                className={cn(
                  "text-[11px]",
                  activeTab === "home" ? "font-medium" : "font-normal",
                )}
              >
                Home
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("orders")}
              aria-current={activeTab === "orders" ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 transition",
                activeTab === "orders"
                  ? "text-neutral-900"
                  : "text-neutral-400",
              )}
            >
              <span className="relative">
                <ReceiptText
                  size={20}
                  strokeWidth={activeTab === "orders" ? 2 : 1.6}
                />
                {cartCount > 0 && (
                  <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-neutral-900 px-1 text-[10px] font-medium tabular-nums text-white">
                    {cartCount}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "text-[11px]",
                  activeTab === "orders" ? "font-medium" : "font-normal",
                )}
              >
                Pesanan
              </span>
            </button>
          </div>
        </nav>

        {toast && (
          <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-5">
            <p role="status" aria-live="polite" className="ord-toast shadow-soft rounded-full bg-neutral-900 px-4 py-2 text-[13px] text-white">
              {toast}
            </p>
          </div>
        )}
      </div>

      {step === "configure" && selectedProduct && (
        <ProductSheet
          product={selectedProduct}
          quantity={quantity}
          setQuantity={setQuantity}
          variantOptionIds={variantOptionIds}
          setVariantOptionIds={setVariantOptionIds}
          addonOptionIds={addonOptionIds}
          setAddonOptionIds={setAddonOptionIds}
          note={note}
          setNote={setNote}
          onClose={() => setStep("menu")}
          onAdd={addToCart}
          isFavorite={favoriteProductIds.includes(selectedProduct.id)}
          onToggleFavorite={toggleFavorite}
        />
      )}
    </main>
  );
}
