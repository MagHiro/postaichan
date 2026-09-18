"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Home, ReceiptText, Search, X } from "lucide-react";
import { products } from "@/lib/data";
import { formatCompactIDR } from "@/lib/format";
import type { CartItem, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ORDER_CATEGORIES,
  formatTableShort,
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

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export function OrderExperience({ tableToken }: { tableToken?: string }) {
  // Start empty so the cart can never capture the local fallback IDs
  // ("taichan-10", …) which the checkout API rejects (it requires UUIDs).
  // The fallback list is only used when /api/menu is unreachable (offline demo).
  const [menuProducts, setMenuProducts] = useState<Product[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [category, setCategory] = useState<OrderCategory>("Semua Menu");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [placedOrders, setPlacedOrders] = useState<PlacedOrder[]>([]);
  const [activeTab, setActiveTab] = useState<"home" | "orders">("home");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [step, setStep] = useState<OrderStep>("menu");
  const [orderType, setOrderType] = useState<"Dine in" | "Takeaway">(
    tableToken ? "Dine in" : "Takeaway",
  );
  const [session, setSession] = useState<{
    token: string;
    orderType: "dine_in" | "takeaway";
  } | null>(null);
  const [payment, setPayment] = useState<PaymentAttempt | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [variant, setVariant] = useState("Medium");
  const [rice, setRice] = useState("Rice");
  const [addons, setAddons] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  const shortTable = useMemo(() => formatTableShort(tableToken), [tableToken]);
  const tableLabel = shortTable ?? "Dine in";
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/menu", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!active) return;
        // Server menu carries real UUIDs required by /api/checkout.
        // Fall back to the bundled demo list only when the server menu
        // is unreachable/empty (offline demo) — those items cannot be
        // checked out and are blocked with a clear message in beginCheckout.
        if (payload?.products?.length) setMenuProducts(payload.products);
        else setMenuProducts(products);
      })
      .catch(() => {
        if (active) setMenuProducts(products);
      })
      .finally(() => {
        if (active) setMenuLoading(false);
      });
    const fallback = window.setTimeout(() => {
      if (active) setMenuLoading(false);
    }, 2500);
    return () => {
      active = false;
      window.clearTimeout(fallback);
    };
  }, []);

  useEffect(() => {
    const want = orderType === "Dine in" ? "dine_in" : "takeaway";
    let active = true;
    setSession(null);
    fetch("/api/customer/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderType: want, tableToken }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active && payload?.sessionToken)
          setSession({ token: payload.sessionToken, orderType: want });
      })
      .catch(() => {
        if (active) setSession(null);
      });
    return () => {
      active = false;
    };
  }, [orderType, tableToken]);

  useEffect(() => {
    if (!toast) return;
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [toast]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menuProducts.filter((product) => {
      if (!matchesOrderCategory(product, category)) return false;
      if (
        q &&
        !`${product.name} ${product.description}`.toLowerCase().includes(q)
      )
        return false;
      return true;
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

  function openProduct(product: Product) {
    if (!product.available) return;
    setSelectedProduct(product);
    setVariant("Medium");
    setRice("Rice");
    setAddons([]);
    setQuantity(1);
    setNote("");
    setStep("configure");
  }

  function addToCart() {
    if (!selectedProduct) return;
    const modifierPrice =
      addons.length * 5000 + (rice === "Lontong" ? 2000 : 0);
    const key = `${selectedProduct.id}-${variant}-${rice}-${addons.join("-")}-${note.trim()}`;
    const nextItem: CartItem = {
      key,
      product: selectedProduct,
      quantity,
      variant:
        selectedProduct.options === "spice"
          ? variant
          : selectedProduct.options === "rice"
            ? rice
            : undefined,
      addons,
      note: note.trim() || undefined,
      unitPrice: selectedProduct.price + modifierPrice,
    };
    setCart((current) => {
      const existing = current.find((item) => item.key === key);
      if (existing)
        return current.map((item) =>
          item.key === key
            ? { ...item, quantity: item.quantity + quantity }
            : item,
        );
      return [...current, nextItem];
    });
    setStep("menu");
    showToast(`${selectedProduct.name} ditambahkan`);
  }

  function quickAdd(product: Product) {
    if (!product.available) return;
    if (product.options && product.options !== "none")
      return openProduct(product);
    setCart((current) => {
      const existing = current.find((item) => item.key === product.id);
      if (existing)
        return current.map((item) =>
          item.key === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      return [
        ...current,
        {
          key: product.id,
          product,
          quantity: 1,
          addons: [],
          unitPrice: product.price,
        },
      ];
    });
    showToast(`${product.name} ditambahkan`);
  }

  function updateQuantity(key: string, delta: number) {
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
    // Demo fallback items use non-UUID ids ("taichan-10", …) which the
    // server rejects. Block early with a clear message instead of the
    // generic validation error, and refresh from the server menu.
    if (cart.some((item) => !UUID_RE.test(item.product.id))) {
      setCheckoutError(
        "Menu belum termuat dari server. Tarik untuk memuat ulang lalu pilih menu lagi.",
      );
      try {
        const menuResponse = await fetch("/api/menu", { cache: "no-store" });
        const menuPayload = menuResponse.ok ? await menuResponse.json() : null;
        if (menuPayload?.products?.length)
          setMenuProducts(menuPayload.products);
      } catch {}
      return;
    }
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
            tableToken,
          }),
        });
        const sessionPayload = await sessionResponse.json();
        if (!sessionResponse.ok || !sessionPayload.sessionToken)
          throw new Error(
            sessionPayload.error ?? "We couldn't start your order.",
          );
        activeSessionToken = sessionPayload.sessionToken as string;
        setSession({ token: activeSessionToken as string, orderType: want });
      }
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          sessionToken: activeSessionToken,
          orderType: orderType === "Dine in" ? "dine_in" : "takeaway",
          tableToken,
          items: cart.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
            variantNames: item.variant ? [item.variant] : [],
            addonNames: item.addons,
            note: item.note,
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "We couldn't start payment.");
      setPayment({
        orderId: payload.orderId,
        orderNumber: payload.orderNumber,
        amountIdr: payload.totalIdr,
        qrString: payload.qrString,
        expiresAt: payload.expiresAt,
      });
      setStep("payment");
    } catch (error) {
      setCheckoutError(
        error instanceof Error ? error.message : "We couldn't start payment.",
      );
    } finally {
      setCheckoutLoading(false);
    }
  }

  if (step === "payment" && payment && session) {
    return (
      <PaymentView
        payment={payment}
        sessionToken={session.token}
        orderType={orderType}
        tableLabel={tableLabel}
        // Back keeps the cart intact and drops the stale QR: returning and
        // checking out again creates a NEW order (fresh UUID), so no
        // double-charge against the abandoned attempt.
        onBack={() => {
          setPayment(null);
          setStep("menu");
          setActiveTab("orders");
        }}
        onPaid={() => {
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
          setCart([]);
          setPayment(null);
          setStep("menu");
          setActiveTab("home");
        }}
        onViewOrders={() => {
          setCart([]);
          setPayment(null);
          setStep("menu");
          setActiveTab("orders");
        }}
      />
    );
  }

  const dineIn = orderType === "Dine in";

  return (
    <main className="flex min-h-screen justify-center bg-white text-neutral-900 antialiased selection:bg-[#FDBD2C] selection:text-neutral-900">
      <div className="relative flex min-h-screen w-full max-w-[440px] flex-col bg-white pb-36">
        <header className="sticky top-0 z-30 border-b border-neutral-100 bg-white/90 backdrop-blur-md">
          <div className="px-5 pb-3 pt-4">
            <div className="relative flex items-center justify-center">
              {logoFailed ? (
                <p className="text-[15px] font-semibold tracking-tight">
                  Bara &amp; Burn
                </p>
              ) : (
                <img
                  src="/logo.png"
                  alt="Baraburn"
                  onError={() => setLogoFailed(true)}
                  className="h-11 w-auto max-w-[240px] object-contain"
                />
              )}
              {dineIn && shortTable && (
                <p className="absolute right-0 text-xs text-neutral-400">
                  {shortTable}
                </p>
              )}
            </div>
            <div className="mt-3 flex rounded-full bg-neutral-100 p-1">
              <button
                onClick={() => setOrderType("Dine in")}
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
                onClick={() => setOrderType("Takeaway")}
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
          </div>
        </header>

        {activeTab === "home" ? (
          <div key="home" className="ord-rise flex-1 px-5 pt-7">
            <h1 className="text-[22px] font-medium leading-snug tracking-tight">
              Mau makan apa?
            </h1>
            <p className="mt-1 text-[13px] text-neutral-500">
              {dineIn
                ? "Pesan dari meja, bayar via QRIS."
                : "Pesan cepat, ambil di kasir."}
            </p>

            <div className="relative mt-6">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-neutral-400">
                <Search size={16} />
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari menu"
                className="w-full rounded-full bg-neutral-100 py-2.5 pl-10 pr-10 text-sm outline-none transition placeholder:text-neutral-400 focus:bg-white focus:ring-2 focus:ring-[#FDBD2C]/50"
              />
              {search && (
                <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                  <button
                    aria-label="Hapus pencarian"
                    onClick={() => setSearch("")}
                    className="rounded-full p-1 text-neutral-400"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            <div className="no-scrollbar -mx-5 mt-5 flex gap-2 overflow-x-auto px-5">
              {ORDER_CATEGORIES.map((item) => (
                <button
                  key={item}
                  onClick={() => setCategory(item)}
                  className={cn(
                    "shrink-0 rounded-full px-3.5 py-1.5 text-[13px] transition",
                    category === item
                      ? "bg-[#FDBD2C]/15 font-medium text-neutral-900"
                      : "text-neutral-500",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>

            <div className="mt-8 flex items-baseline justify-between">
              <h2 className="text-sm font-medium">{category}</h2>
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
            ) : filteredProducts.length === 0 ? (
              <EmptyState
                title="Tidak ketemu"
                hint="Coba kata lain atau ganti kategori."
              />
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-7">
                {filteredProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onOpen={openProduct}
                    onQuickAdd={quickAdd}
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

        <nav className="fixed inset-x-0 bottom-0 z-40">
          <div className="shadow-sheet mx-auto flex max-w-[440px] border-t border-neutral-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
            <button
              onClick={() => setActiveTab("home")}
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
              onClick={() => setActiveTab("orders")}
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
                Orders
              </span>
            </button>
          </div>
        </nav>

        {toast && (
          <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-5">
            <p className="ord-toast shadow-soft rounded-full bg-neutral-900 px-4 py-2 text-[13px] text-white">
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
          variant={variant}
          setVariant={setVariant}
          rice={rice}
          setRice={setRice}
          addons={addons}
          setAddons={setAddons}
          note={note}
          setNote={setNote}
          onClose={() => setStep("menu")}
          onAdd={addToCart}
        />
      )}
    </main>
  );
}
