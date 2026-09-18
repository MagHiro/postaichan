"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bell,
  Check,
  ChevronRight,
  Clock,
  Flame,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  UtensilsCrossed,
  X,
} from "lucide-react";
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
} from "./constants";
import { CartSheet } from "./CartSheet";
import { PaymentView } from "./PaymentView";
import { ProductCard } from "./ProductCard";
import { ProductSheet } from "./ProductSheet";
import { SuccessView } from "./SuccessView";
import { Container, EmptyState, SkeletonCard } from "./ui";

export function OrderExperience({ tableToken }: { tableToken?: string }) {
  const [menuProducts, setMenuProducts] = useState(products);
  const [menuLoading, setMenuLoading] = useState(true);
  const [category, setCategory] = useState<OrderCategory>("Semua Menu");
  const [search, setSearch] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
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

  const shortTable = useMemo(() => formatTableShort(tableToken), [tableToken]);
  const tableLabel = shortTable ?? "Dine in";
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/menu", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active && payload?.products?.length)
          setMenuProducts(payload.products);
      })
      .catch(() => {})
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
      if (availableOnly && !product.available) return false;
      if (
        q &&
        !`${product.name} ${product.description}`.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [menuProducts, category, search, availableOnly]);

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
    showToast(`${selectedProduct.name} masuk keranjang`);
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
    showToast(`${product.name} +1`);
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
        onBack={() => setStep("cart")}
        onPaid={() => setStep("success")}
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
        onNewOrder={() => {
          setCart([]);
          setPayment(null);
          setStep("menu");
        }}
      />
    );
  }

  const dineIn = orderType === "Dine in";

  return (
    <main className="flex min-h-screen justify-center bg-stone-200 text-[#18181B] antialiased selection:bg-[#FF381E] selection:text-white">
      <div className="relative flex min-h-screen w-full max-w-[440px] flex-col border-x border-stone-200 bg-[#FAF8F5] pb-28 shadow-2xl">
        <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#FAF8F5]/90 px-4 pb-2 pt-3 backdrop-blur-md">
          <div className="flex items-center justify-between py-1">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#18181B] text-white shadow-sm">
                <Flame size={14} className="fill-[#FF381E] text-[#FF381E]" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black uppercase tracking-wider text-[#18181B]">
                    Bara & Burn
                  </span>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF381E]" />
                </div>
                <p className="flex items-center gap-0.5 text-[11px] font-medium text-stone-500">
                  <Clock size={13} className="text-emerald-600" />
                  Buka Sekarang{shortTable ? ` · ${shortTable}` : ""}
                </p>
              </div>
            </div>
            <button
              aria-label="Notifikasi"
              onClick={() => showToast("Belum ada notifikasi baru")}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white text-[#18181B] shadow-xs transition-colors hover:bg-stone-50"
            >
              <Bell size={19} />
            </button>
          </div>
          <div className="mt-3 flex items-center rounded-xl border border-stone-200/70 bg-stone-100 p-1">
            <button
              onClick={() => setOrderType("Dine in")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-center text-xs transition-all duration-200",
                dineIn
                  ? "bg-white font-bold text-[#18181B] shadow-sm"
                  : "font-semibold text-stone-500 hover:text-[#18181B]",
              )}
            >
              <UtensilsCrossed
                size={12}
                className={dineIn ? "text-[#FF381E]" : undefined}
              />
              Makan di Tempat
            </button>
            <button
              onClick={() => setOrderType("Takeaway")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-center text-xs transition-all duration-200",
                !dineIn
                  ? "bg-white font-bold text-[#18181B] shadow-sm"
                  : "font-semibold text-stone-500 hover:text-[#18181B]",
              )}
            >
              <ShoppingBag
                size={12}
                className={!dineIn ? "text-[#FF381E]" : undefined}
              />
              Takeaway (Bungkus)
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 pt-3">
          <div className="mb-4">
            <h1 className="text-2xl font-extrabold tracking-tight text-[#18181B]">
              {dineIn ? (
                <>
                  Makan di sini, yuk.{" "}
                  <span className="inline-block transition-transform hover:scale-110">
                    🔥
                  </span>
                </>
              ) : (
                <>
                  Bungkus, tinggal ambil.{" "}
                  <span className="inline-block transition-transform hover:scale-110">
                    🔥
                  </span>
                </>
              )}
            </h1>
            <p className="mt-0.5 text-xs font-normal text-stone-500">
              {dineIn
                ? "Bikin nagih dari suapan pertama"
                : "Pesan cepat, ambil di kasir"}
            </p>
          </div>

          <div className="relative mb-4">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-stone-400">
              <Search size={18} />
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari sate taichan, rice bowl, sambal..."
              className="w-full rounded-xl border border-stone-200 bg-white py-2.5 pl-10 pr-10 text-sm text-[#18181B] shadow-xs transition-all placeholder:text-stone-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#FF381E]"
            />
            <div className="absolute inset-y-0 right-0 flex items-center pr-3">
              {search ? (
                <button
                  aria-label="Hapus pencarian"
                  onClick={() => setSearch("")}
                  className="rounded-md p-1 text-stone-400 hover:text-stone-700"
                >
                  <X size={15} />
                </button>
              ) : (
                <button
                  aria-label="Hanya tampilkan yang tersedia"
                  onClick={() => setAvailableOnly((v) => !v)}
                  className={cn(
                    "rounded-md p-1 transition-colors",
                    availableOnly
                      ? "text-[#FF381E]"
                      : "text-stone-400 hover:text-stone-700",
                  )}
                >
                  <SlidersHorizontal size={16} />
                </button>
              )}
            </div>
          </div>

          <div className="no-scrollbar relative -mx-4 mb-5 flex items-center gap-2 overflow-x-auto px-4">
            {ORDER_CATEGORIES.map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className={cn(
                  "shrink-0 rounded-full px-4 py-2 text-xs tracking-tight transition-colors",
                  category === item
                    ? "bg-[#18181B] font-bold text-white shadow-sm"
                    : item === "Paket Hemat"
                      ? "border border-red-200 bg-red-50/50 font-bold text-[#FF381E]"
                      : "border border-stone-200 bg-white font-semibold text-stone-700 hover:border-stone-400",
                )}
              >
                {item === "Paket Hemat" ? "Paket Hemat 🔥" : item}
              </button>
            ))}
          </div>

          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-black uppercase tracking-wider text-[#18181B]">
                Menu Pilihan Hari Ini
              </h2>
              <span className="rounded bg-[#FF381E]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#FF381E]">
                PEDAS GURIH
              </span>
            </div>
            <span className="text-xs font-medium text-stone-400">
              {filteredProducts.length} Menu
            </span>
          </div>

          {menuLoading ? (
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <EmptyState
              title="Tidak ketemu"
              hint="Coba kata lain atau ganti kategori di atas."
            />
          ) : (
            <div className="grid grid-cols-2 gap-3">
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

          <div className="mt-5 flex items-center justify-between rounded-2xl border border-stone-200/90 bg-white p-3.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-[#FF381E]">
                <UtensilsCrossed size={18} />
              </div>
              <div>
                <h4 className="text-xs font-bold text-[#18181B]">
                  Sambal Dipisah / Campur?
                </h4>
                <p className="text-[11px] text-stone-500">
                  Atur selera pedasmu di halaman checkout
                </p>
              </div>
            </div>
            <ChevronRight size={18} className="shrink-0 text-stone-400" />
          </div>
        </main>

        {cartCount > 0 && step !== "cart" && (
          <div className="fixed inset-x-0 bottom-3 z-40 mx-auto w-full max-w-[420px] px-3">
            <div className="flex items-center justify-between rounded-2xl border border-stone-800 bg-[#18181B] p-2.5 pl-4 text-white shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-stone-700 bg-stone-800/90 text-white">
                    <ShoppingBag size={20} />
                  </div>
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[#18181B] bg-[#FF381E] text-[10px] font-black text-white">
                    {cartCount}
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
                    {cartCount} Menu ·{" "}
                    {dineIn ? (shortTable ?? "Makan di Tempat") : "Takeaway"}
                  </div>
                  <div className="text-sm font-extrabold tracking-tight text-white">
                    {formatCompactIDR(subtotal)}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setStep("cart")}
                className="flex items-center gap-1.5 rounded-xl bg-[#FF381E] px-4 py-2.5 text-xs font-bold text-white shadow-md transition-all hover:bg-[#e03018] active:scale-95"
              >
                Lihat Pesanan
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        )}

        {toast && (
          <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50">
            <Container className="flex justify-center">
              <p className="ord-toast flex items-center gap-2 whitespace-nowrap rounded-full bg-[#18181B] px-4 py-2 text-xs font-semibold text-white shadow-lg">
                <Check size={14} className="text-emerald-300" /> {toast}
              </p>
            </Container>
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
      {step === "cart" && (
        <CartSheet
          cart={cart}
          orderType={orderType}
          tableLabel={tableLabel}
          menuProducts={menuProducts}
          onClose={() => setStep("menu")}
          onUpdate={updateQuantity}
          onQuickAdd={quickAdd}
          onCheckout={beginCheckout}
          checkoutLoading={checkoutLoading}
          checkoutError={checkoutError}
        />
      )}
    </main>
  );
}
