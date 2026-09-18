"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { BookOpen, LayoutDashboard, Minus, Plus, ReceiptText, Search, ShoppingBag, TrendingUp, X } from "lucide-react";
import { categories, products as fallbackProducts } from "@/lib/data";
import { formatCompactIDR, formatCountdown, formatIDR } from "@/lib/format";
import type { Order, Product } from "@/lib/types";
import type { DailyReport } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { MenuManager } from "@/components/menu-manager";

type NavItem = "Overview" | "Orders" | "POS" | "Menu" | "Reports";
type Detail = {
  order: {
    order_number: string;
    order_type: string;
    status: string;
    subtotal_idr: number;
    total_idr: number;
    created_at: string;
    restaurant_tables?: { label?: string } | Array<{ label?: string }> | null;
    payments?:
      | { method?: string; provider?: string; status?: string; amount_idr?: number; fee_idr?: number; expires_at?: string | null; settled_at?: string | null; created_at?: string | null }
      | Array<{ method?: string; provider?: string; status?: string; amount_idr?: number; fee_idr?: number; expires_at?: string | null; settled_at?: string | null; created_at?: string | null }>
      | null;
  };
  items: Array<{
    id: string;
    product_name_snapshot: string;
    quantity: number;
    unit_price_idr: number;
    line_total_idr: number;
    note?: string | null;
    order_item_modifiers?: Array<{ modifier_name_snapshot: string; modifier_type: string }>;
  }>;
};

const NAV_LABEL: Record<NavItem, string> = {
  Overview: "Ringkasan",
  Orders: "Pesanan",
  POS: "Kasir",
  Menu: "Menu",
  Reports: "Laporan",
};

const NAV_ICON: Record<NavItem, typeof LayoutDashboard> = {
  Overview: LayoutDashboard,
  Orders: ReceiptText,
  POS: ShoppingBag,
  Menu: BookOpen,
  Reports: TrendingUp,
};

const STATUS_LABEL: Record<Order["status"], string> = {
  New: "Baru",
  Preparing: "Dimasak",
  Ready: "Siap",
  Completed: "Selesai",
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "All", label: "Semua" },
  { key: "New", label: "Baru" },
  { key: "Preparing", label: "Dimasak" },
  { key: "Ready", label: "Siap" },
  { key: "Completed", label: "Selesai" },
];

export function PosWorkspaceLive() {
  const [nav, setNav] = useState<NavItem>("Overview");
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const date = jakartaToday();
  const activeCount = orders.filter((order) => order.status !== "Completed").length;

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2200);
  }

  async function loadOperations(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [ordersResponse, reportResponse] = await Promise.all([
        fetch(`/api/pos/orders?date=${date}`, { cache: "no-store" }),
        fetch(`/api/reports/daily?date=${date}`, { cache: "no-store" }),
      ]);
      const ordersPayload = await ordersResponse.json();
      const reportPayload = await reportResponse.json();
      if (ordersResponse.status === 401 || reportResponse.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (ordersResponse.ok) setOrders(ordersPayload.orders ?? []);
      if (reportResponse.ok) setSummary(reportPayload);
      if (!silent && (!ordersResponse.ok || !reportResponse.ok)) showNotice("Sebagian data belum termuat.");
    } catch {
      if (!silent) showNotice("Koneksi terputus. Coba muat ulang.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadOperations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const hasActive = orders.some((order) => order.status !== "Completed");

  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => void loadOperations(true), 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, hasActive]);

  async function advanceOrder(order: Order) {
    const next =
      order.status === "New" ? "processing" : order.status === "Preparing" ? "ready" : order.status === "Ready" ? "completed" : null;
    if (!next) return;
    const response = await fetch(`/api/pos/orders/${order.id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      if (response.status === 409 && order.paymentStatus !== "Paid") {
        showNotice(`Pesanan ${order.number} belum lunas.`);
        return;
      }
      showNotice(payload?.error ?? "Status gagal diperbarui.");
      return;
    }
    await loadOperations();
    showNotice("Status diperbarui.");
  }

  function advanceOrderGuarded(order: Order) {
    if (order.paymentStatus !== "Paid" && order.status !== "Completed") {
      if (!window.confirm(`Pesanan ${order.number} belum lunas. Tetap lanjutkan?`)) return;
    }
    void advanceOrder(order);
  }

  return (
    <div className="min-h-screen bg-white text-neutral-900 antialiased lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-[216px] shrink-0 flex-col bg-white px-5 py-6 lg:flex">
        <p className="text-[15px] font-medium tracking-tight">Tempat Taichan</p>
        <p className="mt-1 text-xs text-neutral-400">Operator</p>
        <nav className="mt-10 space-y-1">
          {(Object.keys(NAV_LABEL) as NavItem[]).map((item) => {
            const Icon = NAV_ICON[item];
            const active = nav === item;
            return (
              <button
                key={item}
                onClick={() => setNav(item)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-full px-3.5 py-2 text-[13px] transition active:scale-[0.98]",
                  active ? "bg-[#FDBD2C]/15 font-medium text-neutral-900" : "font-normal text-neutral-500",
                )}
              >
                <Icon size={17} strokeWidth={active ? 2 : 1.6} className={active ? "text-neutral-900" : "text-neutral-400"} />
                <span className="flex-1 text-left">{NAV_LABEL[item]}</span>
                {item === "Orders" && activeCount > 0 && (
                  <span className="text-xs font-medium tabular-nums text-neutral-400">{activeCount}</span>
                )}
              </button>
            );
          })}
        </nav>
        <p className="mt-auto text-xs leading-relaxed text-neutral-400">
          {activeCount} pesanan aktif
          <br />
          {date}
        </p>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 border-b border-neutral-100 bg-white/90 px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-md lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium tracking-tight">{pageTitle(nav)}</p>
              <p className="mt-0.5 text-xs tabular-nums text-neutral-400">
                {activeCount} aktif · {date}
              </p>
            </div>
            {nav !== "POS" && (
              <button
                onClick={() => setNav("POS")}
                className="flex h-10 shrink-0 items-center rounded-full bg-[#FDBD2C] px-5 text-[13px] font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98]"
              >
                Baru
              </button>
            )}
          </div>
        </header>

        {/* Desktop top bar */}
        <header className="sticky top-0 z-30 hidden border-b border-neutral-100 bg-white/90 px-8 py-5 backdrop-blur-md lg:block">
          <div className="mx-auto flex max-w-[1120px] items-end justify-between">
            <div>
              <p className="text-xs text-neutral-400">{formatLongDate(date)}</p>
              <h1 className="mt-1 text-[22px] font-medium leading-snug tracking-tight">{pageTitle(nav)}</h1>
            </div>
            <div className="flex items-center gap-5">
              <button onClick={() => void loadOperations()} className="text-[13px] font-normal text-neutral-500 active:scale-[0.98]">
                {loading ? "Memuat…" : "Muat ulang"}
              </button>
              <button
                onClick={() => setNav("POS")}
                className="h-10 rounded-full bg-[#FDBD2C] px-5 text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98]"
              >
                Pesanan baru
              </button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main
          className={cn(
            "mx-auto max-w-[1120px] px-5 pt-6 lg:px-8 lg:pb-20 lg:pt-10",
            nav === "POS" ? "pb-[calc(208px+env(safe-area-inset-bottom))]" : "pb-[calc(128px+env(safe-area-inset-bottom))]",
          )}
        >
          <div key={nav} className="ord-rise">
            {nav === "Overview" && (
              <LiveOverview
                orders={orders}
                summary={summary}
                loading={loading}
                onAdvance={advanceOrderGuarded}
                onOpenOrders={() => setNav("Orders")}
              />
            )}
            {nav === "Orders" && <LiveOrders orders={orders} onAdvance={advanceOrderGuarded} loading={loading} onShowNotice={showNotice} onRefresh={() => loadOperations(true)} />}
            {nav === "POS" && <LiveCashier onShowNotice={showNotice} />}
            {nav === "Menu" && <MenuManager onShowNotice={showNotice} />}
            {nav === "Reports" && <LiveReports initialReport={summary} onShowNotice={showNotice} />}
          </div>
        </main>
      </div>

      {/* Mobile bottom tabs */}
      <nav className="shadow-sheet fixed inset-x-0 bottom-0 z-40 border-t border-neutral-100 bg-white/95 px-3 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md lg:hidden">
        <div className="mx-auto grid max-w-[440px] grid-cols-5 gap-1">
          {(Object.keys(NAV_LABEL) as NavItem[]).map((item) => {
            const Icon = NAV_ICON[item];
            const active = nav === item;
            return (
              <button
                key={item}
                onClick={() => setNav(item)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl py-2",
                  active ? "bg-neutral-100" : "active:bg-neutral-50",
                )}
              >
                <Icon size={21} strokeWidth={active ? 2.2 : 1.6} className={active ? "text-neutral-900" : "text-neutral-400"} />
                <span className={cn("flex items-center gap-1 text-[11px] leading-none", active ? "font-medium text-neutral-900" : "font-normal text-neutral-400")}>
                  {NAV_LABEL[item]}
                  {item === "Orders" && activeCount > 0 && (
                    <span className="rounded-full bg-[#FDBD2C] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-neutral-900">
                      {activeCount > 99 ? "99+" : activeCount}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {notice && (
        <div className="pointer-events-none fixed inset-x-0 top-[max(4.5rem,env(safe-area-inset-top))] z-[60] flex justify-center px-5 lg:top-20">
          <p className="ord-toast shadow-soft pointer-events-auto max-w-[440px] truncate rounded-full bg-neutral-900 px-4 py-2.5 text-[13px] text-white">{notice}</p>
        </div>
      )}
    </div>
  );
}

function pageTitle(nav: NavItem) {
  if (nav === "Overview") return jakartaGreeting();
  return NAV_LABEL[nav];
}

/* ================= Shared ================= */

function PageHead({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0">
        <h2 className="hidden text-[22px] font-medium leading-snug tracking-tight lg:block">{title}</h2>
        {sub && <p className="text-[13px] text-neutral-500 lg:mt-1">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-neutral-400">{label}</p>
      <p className="mt-1 break-words text-lg font-medium tabular-nums leading-snug tracking-tight sm:text-[22px]">{value}</p>
      <p className="mt-0.5 truncate text-xs text-neutral-500 sm:text-[13px]">{detail}</p>
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return <p className="py-14 text-center text-[13px] text-neutral-500">{label}</p>;
}

function EmptyBlock({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="px-5 py-14 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-[13px] text-neutral-500">{sub}</p>
    </div>
  );
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-2xl bg-neutral-100 pl-10 pr-10 text-sm outline-none placeholder:text-neutral-400 focus:bg-white focus:ring-2 focus:ring-[#FDBD2C]/50 lg:rounded-full"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          aria-label="Hapus pencarian"
          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 active:bg-neutral-200"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function QtyStepper({ count, onMinus, onPlus, large = false }: { count: number; onMinus: () => void; onPlus: () => void; large?: boolean }) {
  const size = large ? "h-11 w-11" : "h-9 w-9";
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onMinus}
        aria-label="Kurangi"
        className={cn("flex items-center justify-center rounded-full border border-neutral-200 text-neutral-500 active:scale-95", size)}
      >
        <Minus size={15} />
      </button>
      <span className={cn("text-center font-medium tabular-nums", large ? "w-6 text-[15px]" : "w-5 text-sm")}>{count}</span>
      <button
        onClick={onPlus}
        aria-label="Tambah"
        className={cn("flex items-center justify-center rounded-full bg-neutral-900 text-white active:scale-95", size)}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

/* ================= Overview ================= */

function LiveOverview({
  orders,
  summary,
  loading,
  onAdvance,
  onOpenOrders,
}: {
  orders: Order[];
  summary: DailyReport | null;
  loading: boolean;
  onAdvance: (order: Order) => void;
  onOpenOrders: () => void;
}) {
  const active = orders.filter((order) => order.status !== "Completed");
  const dateLabel = summary?.date ?? jakartaToday();

  return (
    <div>
      <PageHead title="Hari ini" />

      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-neutral-100 bg-neutral-100 lg:mt-6 xl:grid-cols-4">
        <div className="bg-white p-4 sm:p-5">
          <Metric label="Pendapatan" value={summary ? formatCompactIDR(summary.revenueIdr) : "—"} detail="Lunas" />
        </div>
        <div className="bg-white p-4 sm:p-5">
          <Metric label="Pesanan" value={summary ? String(summary.orderCount) : "—"} detail="Lunas hari ini" />
        </div>
        <div className="bg-white p-4 sm:p-5">
          <Metric label="Est. laba" value={summary ? formatCompactIDR(summary.estimatedGrossProfitIdr) : "—"} detail="Setelah COGS + fee" />
        </div>
        <div className="bg-white p-4 sm:p-5">
          <Metric label="Rata-rata" value={summary ? formatCompactIDR(summary.averageOrderValueIdr) : "—"} detail="Per pesanan" />
        </div>
      </div>

      <section className="mt-8 border-t border-neutral-100 pt-6">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium">
            Perlu tindakan
            {active.length > 0 && <span className="ml-2 font-normal tabular-nums text-neutral-400">{active.length}</span>}
          </h3>
          {active.length > 5 && (
            <button onClick={onOpenOrders} className="text-[13px] font-normal text-neutral-500">
              Semua
            </button>
          )}
        </div>
        <div className="mt-1">
          {loading ? (
            <LoadingBlock label="Memuat pesanan…" />
          ) : active.length ? (
            <div className="divide-y divide-neutral-100">
              {active.slice(0, 5).map((order) => (
                <div key={order.id} className="flex items-center gap-3 py-2">
                  <button
                    onClick={onOpenOrders}
                    className="min-w-0 flex-1 rounded-2xl px-2 py-2.5 text-left active:bg-neutral-50"
                    aria-label={`Lihat ${order.number}`}
                  >
                    <p className="truncate text-[14px] font-medium">
                      {order.number} <span className="font-normal text-neutral-400">· {STATUS_LABEL[order.status]}</span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-neutral-400">
                      {order.table ?? order.type} · {order.items} item · {order.time}
                      {order.paymentStatus !== "Paid" ? " · Belum bayar" : ""}
                    </p>
                    <p className="mt-1 text-[13px] tabular-nums text-neutral-500">{formatCompactIDR(order.total)}</p>
                  </button>
                  <button
                    onClick={() => onAdvance(order)}
                    aria-label={`Lanjut ${order.number}`}
                    className="flex h-11 shrink-0 items-center rounded-full bg-neutral-900 px-5 text-[13px] font-medium text-white active:scale-[0.98]"
                  >
                    {order.status === "New" ? "Mulai" : order.status === "Preparing" ? "Siap" : "Selesai"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock title="Tidak ada pesanan aktif." sub="Pesanan baru akan muncul di sini." />
          )}
        </div>
      </section>

      <section className="mt-8 border-t border-neutral-100 pt-6">
        <h3 className="text-sm font-medium">Terlaris</h3>
        {summary?.bestSellers.length ? (
          <div className="mt-1 divide-y divide-neutral-100">
            {summary.bestSellers.slice(0, 5).map((item) => (
              <div key={item.name} className="flex items-center justify-between gap-3 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{item.name}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-neutral-400">{item.quantity} porsi</p>
                </div>
                <span className="shrink-0 text-[13px] tabular-nums text-neutral-500">{formatCompactIDR(item.revenueIdr)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-10 text-center text-[13px] text-neutral-500">Belum ada penjualan lunas.</p>
        )}
      </section>

      <section className="mt-8 flex flex-col gap-3 border-t border-neutral-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-medium">Tutup kasir</h3>
          <p className="mt-1 text-[13px] text-neutral-500">Pastikan pembayaran terakhir lunas.</p>
        </div>
        <button
          onClick={() => {
            if (window.confirm("Unduh laporan harian Jakarta?")) window.location.href = `/api/reports/daily.pdf?date=${dateLabel}`;
          }}
          className="h-10 shrink-0 rounded-full bg-[#FDBD2C] px-5 text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98]"
        >
          Unduh PDF
        </button>
      </section>
    </div>
  );
}

/* ================= Orders ================= */

function LiveOrders({
  orders,
  onAdvance,
  loading,
  onShowNotice,
  onRefresh,
}: {
  orders: Order[];
  onAdvance: (order: Order) => void;
  loading: boolean;
  onShowNotice: (message: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const counts = FILTERS.map(({ key }) => ({ key, n: key === "All" ? orders.length : orders.filter((o) => o.status === key).length }));
  const filtered = orders.filter(
    (order) =>
      (filter === "All" || order.status === filter) && `${order.number} ${order.table ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );

  async function openDetail(order: Order) {
    setDetailId(order.id);
    const response = await fetch(`/api/pos/orders/${order.id}`, { cache: "no-store" });
    const payload = await response.json();
    setDetail(response.ok ? payload : null);
    if (!response.ok) onShowNotice(payload.error ?? "Detail tidak tersedia.");
  }

  async function refreshDetail(orderId: string) {
    const response = await fetch(`/api/pos/orders/${orderId}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload) setDetail(payload);
  }

  return (
    <div>
      <PageHead
        title="Pesanan"
        sub={`${filtered.length} pesanan · hari bisnis Jakarta`}
        action={
          <a href={`/api/reports/daily.pdf?date=${jakartaToday()}`} className="hidden text-[13px] font-normal text-neutral-500 sm:block">
            Unduh PDF
          </a>
        }
      />

      <div className="mt-6">
        <SearchField value={query} onChange={setQuery} placeholder="Cari nomor atau meja…" />
      </div>

      <div className="no-scrollbar -mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1">
        {FILTERS.map(({ key, label }) => {
          const n = counts.find((c) => c.key === key)?.n ?? 0;
          const isActive = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              aria-pressed={isActive}
              className={cn(
                "flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[13px] transition active:scale-[0.98]",
                isActive ? "border-neutral-900 bg-neutral-900 font-medium text-white" : "border-neutral-200 font-normal text-neutral-500",
              )}
            >
              {label} <span className={cn("tabular-nums", isActive ? "text-neutral-300" : "text-neutral-400")}>{n}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        {loading ? (
          <LoadingBlock label="Memuat pesanan…" />
        ) : filtered.length ? (
          <div className="divide-y divide-neutral-100">
            {filtered.map((order) => (
              <div key={order.id} className="flex items-center gap-3 py-2">
                <button
                  onClick={() => void openDetail(order)}
                  className="min-w-0 flex-1 rounded-2xl px-2 py-2.5 text-left active:bg-neutral-50"
                  aria-label={`Detail ${order.number}`}
                >
                  <p className="truncate text-[14px] font-medium">{order.number}</p>
                  <p className="mt-0.5 truncate text-xs text-neutral-400">
                    {order.table ?? order.type} · {order.items} item · {order.time}
                  </p>
                  <p className="mt-1 text-[13px] tabular-nums text-neutral-500">
                    {formatCompactIDR(order.total)}
                    <span className="ml-2 text-xs font-normal text-neutral-400">
                      {STATUS_LABEL[order.status]}
                      {order.paymentStatus !== "Paid" && order.status !== "Completed" ? " · Belum bayar" : ""}
                    </span>
                  </p>
                </button>
                {order.status !== "Completed" ? (
                  <button
                    onClick={() => onAdvance(order)}
                    aria-label={`Lanjut ${order.number}`}
                    className="flex h-11 shrink-0 items-center rounded-full bg-neutral-900 px-5 text-[13px] font-medium text-white active:scale-[0.98]"
                  >
                    {order.status === "New" ? "Mulai" : order.status === "Preparing" ? "Siap" : "Selesai"}
                  </button>
                ) : (
                  <span className="shrink-0 px-2 text-xs text-neutral-300">Selesai</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyBlock title="Tidak ada pesanan cocok." sub="Pesanan yang lunas akan muncul di sini." />
        )}
      </div>

      {detail && detailId && (
        <OrderDetail
          detail={detail}
          detailId={detailId}
          onClose={() => {
            setDetail(null);
            setDetailId(null);
          }}
          onAdvance={() => {
            const current = orders.find((item) => item.number === detail.order.order_number);
            if (current) onAdvance(current);
            setDetail(null);
            setDetailId(null);
          }}
          onShowNotice={onShowNotice}
          onSettled={async (orderId) => {
            await onRefresh();
            await refreshDetail(orderId);
          }}
        />
      )}
    </div>
  );
}

function payMethodLabel(method?: string) {
  if (!method) return "—";
  if (method.toLowerCase() === "qris") return "QRIS";
  if (["cash", "tunai"].includes(method.toLowerCase())) return "Tunai";
  return method.toUpperCase();
}

function payStateLabel(status?: string) {
  if (status === "settled") return "Lunas";
  if (status === "pending") return "Menunggu";
  if (status === "expired") return "Kedaluwarsa";
  if (status === "failed") return "Gagal";
  if (status === "refunded") return "Refund";
  if (status) return status.replace(/_/g, " ");
  return "—";
}

function rawStatusLabel(status: string) {
  if (["paid", "accepted", "awaiting_payment"].includes(status)) return "Baru";
  if (status === "processing") return "Dimasak";
  if (status === "ready") return "Siap";
  if (status === "completed") return "Selesai";
  return "Batal";
}

function nextActionLabel(status: string) {
  if (["paid", "accepted", "awaiting_payment"].includes(status)) return "Mulai masak";
  if (status === "processing") return "Tandai siap";
  if (status === "ready") return "Selesaikan";
  if (status === "completed") return "Selesai";
  return "Dibatalkan";
}

function formatCreatedAt(iso: string) {
  const date = new Date(iso);
  const time = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(date);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return day === jakartaToday() ? `Hari ini · ${time}` : `${day} · ${time}`;
}

function OrderDetail({ detail, detailId, onClose, onAdvance, onSettled, onShowNotice }: { detail: Detail; detailId: string; onClose: () => void; onAdvance: () => void; onSettled?: (orderId: string) => void; onShowNotice: (message: string) => void }) {
  const table = Array.isArray(detail.order.restaurant_tables) ? detail.order.restaurant_tables[0]?.label : detail.order.restaurant_tables?.label;
  const payment = Array.isArray(detail.order.payments) ? detail.order.payments[0] : detail.order.payments;
  const totalItems = detail.items.reduce((sum, item) => sum + item.quantity, 0);
  const done = ["completed", "cancelled", "refunded"].includes(detail.order.status);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const payExpiresMs = payment?.expires_at ? new Date(payment.expires_at).getTime() : null;
  const payRemainingMs = payExpiresMs !== null ? payExpiresMs - nowMs : null;
  const [checkingPay, setCheckingPay] = useState(false);
  const [resumeQr, setResumeQr] = useState<{ qrString: string; expiresAt: string } | null>(null);

  async function checkPaymentNow() {
    setCheckingPay(true);
    try {
      const response = await fetch(`/api/pos/orders/${detailId}/payment`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        onShowNotice(payload?.error ?? "Status pembayaran belum bisa dicek.");
        return;
      }
      if (payload.paymentStatus === "settled") {
        onShowNotice(`${detail.order.order_number} lunas.`);
        onSettled?.(detailId);
      } else if (payload.paymentStatus === "expired") {
        onShowNotice("QRIS kedaluwarsa. Buat pesanan baru.");
        onSettled?.(detailId);
      } else if (payload.paymentStatus === "failed") {
        onShowNotice("Pembayaran ditolak provider.");
        onSettled?.(detailId);
      } else {
        onShowNotice("Belum ada pembayaran terdeteksi.");
      }
    } finally {
      setCheckingPay(false);
    }
  }

  async function resumeQrCode() {
    setCheckingPay(true);
    try {
      const response = await fetch(`/api/pos/orders/${detailId}/payment`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        onShowNotice(payload?.error ?? "QR belum bisa ditampilkan.");
        return;
      }
      if (payload.paymentStatus === "settled") {
        onShowNotice(`${detail.order.order_number} sudah lunas.`);
        onSettled?.(detailId);
        return;
      }
      if (!payload.qrString || payload.paymentStatus !== "pending") {
        onShowNotice("QR sudah tidak berlaku. Buat pesanan baru.");
        return;
      }
      setResumeQr({ qrString: payload.qrString, expiresAt: payload.expiresAt });
    } finally {
      setCheckingPay(false);
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      window.clearInterval(timer);
    };
  }, [onClose]);

  return createPortal(
    <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/30" onClick={onClose}>
      <aside
        className="ord-sheet flex max-h-[92vh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[28px] bg-white"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Detail ${detail.order.order_number}`}
      >
        <div className="mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-neutral-200" />
        <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-3">
          <div className="min-w-0">
            <p className="text-xs text-neutral-400">
              Detail · {rawStatusLabel(detail.order.status)}
            </p>
            <h2 className="mt-1 text-lg font-medium tabular-nums tracking-tight">{detail.order.order_number}</h2>
            <p className="mt-0.5 text-[13px] text-neutral-500">
              {formatCreatedAt(detail.order.created_at)} · {totalItems} porsi
            </p>
            <p className="mt-1 text-[13px] text-neutral-500">
              {detail.order.order_type === "dine_in" ? (table ?? "Dine in") : "Takeaway"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup detail"
            autoFocus
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 active:scale-95"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 space-y-7 overflow-y-auto px-5 pb-5">
          <section>
            <p className="text-xs text-neutral-400">Item · {detail.items.length} baris</p>
            <div className="mt-1 divide-y divide-neutral-100">
              {detail.items.map((item) => {
                const modifiers = item.order_item_modifiers?.map((m) => m.modifier_name_snapshot).filter(Boolean) ?? [];
                return (
                  <div key={item.id} className="flex gap-3 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">
                        {item.quantity}× {item.product_name_snapshot}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-neutral-400">
                        {modifiers.length > 0 ? modifiers.join(" · ") : "Original"}
                        {item.note ? ` · “${item.note}”` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-[13px] tabular-nums text-neutral-500">{formatCompactIDR(item.line_total_idr)}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-baseline justify-between border-t border-neutral-100 pt-3">
              <span className="text-[13px] text-neutral-500">Total</span>
              <span className="text-[15px] font-medium tabular-nums">{formatCompactIDR(detail.order.total_idr)}</span>
            </div>
          </section>

          <section>
            <p className="text-xs text-neutral-400">Pembayaran</p>
            <div className="mt-1 divide-y divide-neutral-100">
              <div className="flex items-center justify-between py-2.5">
                <span className="text-[13px] text-neutral-400">Metode</span>
                <span className="text-[13px] font-medium">
                  {payMethodLabel(payment?.method)}
                  {payment?.provider ? ` · ${payment.provider}` : ""}
                </span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="text-[13px] text-neutral-400">Status</span>
                <span className="text-[13px] font-medium">{payStateLabel(payment?.status)}</span>
              </div>
              {payment?.status === "pending" && payRemainingMs !== null && payRemainingMs > 0 && (
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-[13px] text-neutral-400">QR berlaku</span>
                  <span className="text-[13px] tabular-nums text-neutral-500">{formatCountdown(payRemainingMs)}</span>
                </div>
              )}
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-neutral-500">
              {payment?.status === "settled"
                ? "Lunas · siap masuk dapur."
                : payment?.status === "pending"
                  ? "Menunggu pembayaran customer."
                  : payment?.status === "expired"
                    ? "QR kedaluwarsa · buat pesanan baru."
                    : payment?.status === "failed"
                      ? "Ditolak provider · minta coba lagi."
                      : payStateLabel(payment?.status)}
            </p>
          </section>
        </div>

        <div className="border-t border-neutral-100 bg-white/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <button
            onClick={onAdvance}
            disabled={done}
            className="h-[52px] w-full rounded-2xl bg-[#FDBD2C] text-[15px] font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
          >
            {nextActionLabel(detail.order.status)}
          </button>
          {payment?.status === "pending" && (
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                onClick={() => void checkPaymentNow()}
                disabled={checkingPay}
                className="h-11 w-full rounded-full text-[13px] font-normal text-neutral-500 active:bg-neutral-50 disabled:opacity-60"
              >
                {checkingPay ? "Mengecek…" : "Cek pembayaran"}
              </button>
              <button
                onClick={() => void resumeQrCode()}
                disabled={checkingPay}
                className="h-11 w-full rounded-full text-[13px] font-normal text-neutral-500 active:bg-neutral-50 disabled:opacity-60"
              >
                Tampilkan QR
              </button>
            </div>
          )}
        </div>
        {resumeQr && (
          <ResumeQrOverlay
            qrString={resumeQr.qrString}
            expiresAt={resumeQr.expiresAt}
            orderNumber={detail.order.order_number}
            totalIdr={detail.order.total_idr}
            onClose={() => setResumeQr(null)}
          />
        )}
      </aside>
    </div>,
    document.body,
  );
}

/* ================= Cashier ================= */

function ResumeQrOverlay({ qrString, expiresAt, orderNumber, totalIdr, onClose }: { qrString: string; expiresAt: string; orderNumber: string; totalIdr: number; onClose: () => void }) {
  const [qr, setQr] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    QRCode.toDataURL(qrString, { width: 320, margin: 2, color: { dark: "#18181B", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [qrString]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const remainingMs = new Date(expiresAt).getTime() - now;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-900/30 p-4" onClick={onClose}>
      <section
        className="shadow-soft w-full max-w-[300px] rounded-3xl bg-white p-5 text-center"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`QRIS ${orderNumber}`}
      >
        <p className="text-xs text-neutral-400">QRIS · {orderNumber}</p>
        {qr ? (
          <img src={qr} alt="QRIS pembayaran" className="mx-auto mt-4 h-48 w-48 rounded-2xl border border-neutral-100 p-2" />
        ) : (
          <div className="ord-skeleton mx-auto mt-4 h-48 w-48 rounded-2xl" />
        )}
        <p className="mt-3 text-[15px] font-medium tabular-nums">{formatIDR(totalIdr)}</p>
        <p className="mt-1 text-[13px] text-neutral-400">
          {remainingMs > 0 ? <span>Berlaku {formatCountdown(remainingMs)}</span> : <span>Kedaluwarsa</span>}
        </p>
        <button onClick={onClose} className="mt-4 h-12 w-full rounded-full bg-neutral-900 text-sm font-medium text-white active:scale-[0.98]">
          Tutup
        </button>
      </section>
    </div>
  );
}

type PosTable = { id: string; label: string; code: string; active: boolean };

function TableQrSection() {
  const [tables, setTables] = useState<PosTable[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [qr, setQr] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/pos/tables", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        const list: PosTable[] = payload?.tables ?? [];
        setTables(list);
        if (list.length) setSelectedCode((current) => current ?? list[0].code);
      })
      .catch(() => undefined);
  }, []);

  const selected = tables.find((table) => table.code === selectedCode) ?? null;
  const customerUrl = selected && origin ? `${origin}/order/t/${selected.code}` : "";

  useEffect(() => {
    if (!customerUrl) {
      setQr("");
      return;
    }
    QRCode.toDataURL(customerUrl, { width: 320, margin: 2, color: { dark: "#18181B", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [customerUrl]);

  if (!tables.length) return null;

  function downloadQr() {
    if (!qr || !selected) return;
    const link = document.createElement("a");
    link.href = qr;
    link.download = `${selected.code.toLowerCase()}-qr.png`;
    link.click();
  }

  return (
    <section className="mt-10 border-t border-neutral-100 pt-6">
      <h3 className="text-sm font-medium">QR Meja</h3>
      <p className="mt-1 text-[13px] text-neutral-500">Pindai untuk membuka menu di meja.</p>
      <div className="no-scrollbar -mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1">
        {tables.map((table) => (
          <button
            key={table.code}
            onClick={() => setSelectedCode(table.code)}
            aria-pressed={table.code === selectedCode}
            className={cn(
              "flex h-10 shrink-0 items-center rounded-full border px-4 text-[13px] transition active:scale-[0.98]",
              table.code === selectedCode ? "border-neutral-900 bg-neutral-900 font-medium text-white" : "border-neutral-200 font-normal text-neutral-500",
            )}
          >
            {table.label}
          </button>
        ))}
      </div>
      {selected && (
        <div className="mt-6 flex flex-col items-center text-center">
          <div className="shadow-soft w-fit rounded-3xl border border-neutral-100 bg-white p-4">
            {qr ? (
              <img src={qr} alt={`QR ${selected.label}`} className="h-56 w-56 rounded-2xl" />
            ) : (
              <div className="ord-skeleton h-56 w-56 rounded-2xl" />
            )}
          </div>
          <p className="mt-3 text-[13px] font-medium">
            {selected.label} · {selected.code}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">{selected.active ? "Aktif" : "Nonaktif"}</p>
          <div className="mt-3 flex items-center gap-5">
            <button onClick={downloadQr} className="text-[13px] font-medium text-neutral-900 active:scale-[0.98]">
              Unduh
            </button>
            <a href={customerUrl} target="_blank" rel="noreferrer" className="text-[13px] font-normal text-neutral-500">
              Uji
            </a>
          </div>
        </div>
      )}
    </section>
  );
}

type CartLine = { product: Product; quantity: number };

function LiveCashier({ onShowNotice }: { onShowNotice: (message: string) => void }) {
  const [menu, setMenu] = useState<Product[]>(fallbackProducts);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [category, setCategory] = useState<string>("Semua");
  const [query, setQuery] = useState("");
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway">("dine_in");
  const [payment, setPayment] = useState<{ orderId: string; qrString: string; orderNumber: string; totalIdr: number; expiresAt: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    fetch("/api/menu")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.products?.length) setMenu(payload.products);
      })
      .catch(() => undefined);
  }, []);

  const filtered = menu.filter(
    (product) =>
      (category === "Semua" || product.category === category) &&
      `${product.name} ${product.description ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const total = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);

  function add(product: Product) {
    if (!product.available) return;
    setCart((current) => {
      const found = current.find((item) => item.product.id === product.id);
      return found
        ? current.map((item) => (item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item))
        : [...current, { product, quantity: 1 }];
    });
  }

  function setQty(id: string, delta: number) {
    setCart((current) =>
      current
        .map((item) => (item.product.id === id ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0),
    );
  }

  async function createOrder() {
    if (!cart.length || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/pos/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          orderType,
          items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.qrString) {
        onShowNotice(payload.error ?? "Pesanan gagal dibuat.");
        return;
      }
      setPayment({ orderId: payload.orderId, qrString: payload.qrString, orderNumber: payload.orderNumber, totalIdr: payload.totalIdr, expiresAt: payload.expiresAt });
      setCart([]);
      setCartOpen(false);
    } catch {
      onShowNotice("Pesanan gagal dibuat.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="hidden lg:block">
        <PageHead title="Kasir" sub={orderType === "dine_in" ? "Dine in · QRIS" : "Takeaway · QRIS"} />
      </div>

      <div className="flex max-w-md rounded-2xl bg-neutral-100 p-1 lg:mt-6 lg:rounded-full">
        {(
          [
            { key: "dine_in", label: "Dine in" },
            { key: "takeaway", label: "Takeaway" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setOrderType(key)}
            aria-pressed={orderType === key}
            className={cn(
              "h-11 flex-1 rounded-xl text-center text-sm transition active:scale-[0.98] lg:rounded-full lg:text-[13px]",
              orderType === key ? "bg-white font-medium shadow-xs" : "font-normal text-neutral-500",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-8 grid items-start gap-10 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <SearchField value={query} onChange={setQuery} placeholder="Cari menu…" />
          <div className="no-scrollbar -mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1">
            {categories.map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                aria-pressed={category === item}
                className={cn(
                  "flex h-10 shrink-0 items-center rounded-full border px-4 text-[13px] transition active:scale-[0.98]",
                  category === item ? "border-neutral-900 bg-neutral-900 font-medium text-white" : "border-neutral-200 font-normal text-neutral-500",
                )}
              >
                {item}
              </button>
            ))}
          </div>

          {filtered.length ? (
            <div className="mt-6">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-medium">{category === "Semua" ? "Semua menu" : category}</h3>
                <span className="text-xs tabular-nums text-neutral-400">{filtered.length} item</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {filtered.map((product) => {
                  const qty = cart.find((item) => item.product.id === product.id)?.quantity ?? 0;
                  return (
                    <button
                      key={product.id}
                      onClick={() => add(product)}
                      disabled={!product.available}
                      aria-label={product.available ? `Tambah ${product.name}` : `${product.name} habis`}
                      className={cn(
                        "min-w-0 rounded-2xl border p-2 text-left transition active:scale-[0.98] disabled:opacity-60",
                        qty > 0 ? "border-neutral-900" : "border-neutral-100",
                      )}
                    >
                      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-neutral-100">
                        {product.imageUrl ? (
                          <img src={product.imageUrl} alt={product.name} loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-lg font-medium text-neutral-400">
                            {product.name.slice(0, 1)}
                          </div>
                        )}
                        {qty > 0 && (
                          <span className="absolute right-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-neutral-900 px-2 text-xs font-medium tabular-nums text-white">
                            ×{qty}
                          </span>
                        )}
                        {!product.available && (
                          <span className="absolute inset-x-2 bottom-2 rounded-full bg-white/95 py-1 text-center text-xs font-medium text-neutral-500">
                            Habis
                          </span>
                        )}
                      </div>
                      <p className="mt-2 truncate px-1 text-[13px] font-medium leading-snug">{product.name}</p>
                      <p className="mt-0.5 px-1 pb-1 text-[13px] tabular-nums text-neutral-500">{formatCompactIDR(product.price)}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyBlock title="Menu tidak ditemukan." sub="Coba kata kunci atau kategori lain." />
          )}
        </section>

        {/* Cart — desktop */}
        <aside className="sticky top-24 hidden xl:block">
          <h3 className="text-sm font-medium">Pesanan berjalan</h3>
          <p className="mt-1 text-[13px] text-neutral-500">
            {orderType === "dine_in" ? "Dine in" : "Takeaway"} · QRIS
          </p>
          <div className="mt-2">
            {cart.length ? (
              <div className="divide-y divide-neutral-100">
                {cart.map((item) => (
                  <div key={item.product.id} className="flex gap-3 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{item.product.name}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-neutral-400">{formatCompactIDR(item.product.price)} / porsi</p>
                      <div className="mt-2">
                        <QtyStepper count={item.quantity} onMinus={() => setQty(item.product.id, -1)} onPlus={() => setQty(item.product.id, 1)} />
                      </div>
                    </div>
                    <span className="shrink-0 text-[13px] tabular-nums text-neutral-500">{formatCompactIDR(item.product.price * item.quantity)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-10 text-[13px] text-neutral-500">Ketuk menu untuk mulai.</p>
            )}
          </div>
          <div className="mt-2 flex items-baseline justify-between border-t border-neutral-100 pt-4">
            <span className="text-[13px] text-neutral-500">Total · {count} item</span>
            <span className="text-[15px] font-medium tabular-nums">{formatIDR(total)}</span>
          </div>
          <button
            disabled={!cart.length || saving}
            onClick={() => void createOrder()}
            className="mt-4 h-12 w-full rounded-full bg-[#FDBD2C] text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
          >
            {saving ? "Membuat…" : "Buat pembayaran"}
          </button>
          {cart.length > 0 && (
            <button onClick={() => setCart([])} className="mt-1 h-12 w-full rounded-full text-sm font-normal text-neutral-500">
              Kosongkan
            </button>
          )}
        </aside>
      </div>

      <TableQrSection />

      {/* Cart — mobile bar */}
      {cart.length > 0 && !cartOpen && (
        <div className="fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-30 mx-auto max-w-[440px] px-4 xl:hidden">
          <button
            onClick={() => setCartOpen(true)}
            aria-label={`Buka keranjang, ${count} item, ${formatIDR(total)}`}
            className="shadow-soft flex w-full items-center justify-between gap-3 rounded-2xl border border-neutral-900 bg-neutral-900 py-3 pl-4 pr-3 text-white active:scale-[0.99]"
          >
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-xs tabular-nums text-neutral-400">{count} item</span>
              <span className="block truncate text-[15px] font-medium tabular-nums">{formatIDR(total)}</span>
            </span>
            <span className="flex h-10 shrink-0 items-center rounded-xl bg-[#FDBD2C] px-5 text-sm font-medium text-neutral-900">
              Lihat
            </span>
          </button>
        </div>
      )}

      {/* Cart — mobile sheet */}
      {cartOpen && (
        <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/30 xl:hidden" onClick={() => setCartOpen(false)}>
          <section
            className="ord-sheet flex max-h-[88vh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[28px] bg-white"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Keranjang"
          >
            <div className="mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-neutral-200" />
            <div className="flex items-start justify-between px-5 pb-3 pt-2">
              <div>
                <p className="text-xs text-neutral-400">
                  Pesanan berjalan · {orderType === "dine_in" ? "Dine in" : "Takeaway"}
                </p>
                <h2 className="mt-1 text-lg font-medium tabular-nums tracking-tight">
                  {count} item · {formatIDR(total)}
                </h2>
              </div>
              <button
                onClick={() => setCartOpen(false)}
                aria-label="Tutup keranjang"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 active:scale-95"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5">
              {cart.length ? (
                <div className="divide-y divide-neutral-100">
                  {cart.map((item) => (
                    <div key={item.product.id} className="flex items-center gap-3 py-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">{item.product.name}</p>
                        <p className="mt-0.5 text-[13px] tabular-nums text-neutral-500">{formatCompactIDR(item.product.price * item.quantity)}</p>
                      </div>
                      <QtyStepper count={item.quantity} onMinus={() => setQty(item.product.id, -1)} onPlus={() => setQty(item.product.id, 1)} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-10 text-center text-[13px] text-neutral-500">Keranjang kosong.</p>
              )}
            </div>
            <div className="border-t border-neutral-100 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-[13px] text-neutral-500">Total · {count} item</span>
                <span className="text-base font-medium tabular-nums">{formatIDR(total)}</span>
              </div>
              <button
                disabled={!cart.length || saving}
                onClick={() => void createOrder()}
                className="h-[52px] w-full rounded-2xl bg-[#FDBD2C] text-[15px] font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
              >
                {saving ? "Membuat…" : `Buat pembayaran · ${formatCompactIDR(total)}`}
              </button>
              {cart.length > 0 && (
                <button
                  onClick={() => setCart([])}
                  className="h-11 w-full rounded-full text-[13px] font-normal text-neutral-400 active:bg-neutral-50"
                >
                  Kosongkan
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {payment && (
        <CashierPayment
          payment={payment}
          onClose={() => setPayment(null)}
          onSettled={() => {
            onShowNotice(`${payment.orderNumber} lunas.`);
          }}
        />
      )}
    </div>
  );
}

function CashierPayment({
  payment,
  onClose,
  onSettled,
}: {
  payment: { orderId: string; qrString: string; orderNumber: string; totalIdr: number; expiresAt: string };
  onClose: () => void;
  onSettled?: () => void;
}) {
  const [qr, setQr] = useState("");
  const [phase, setPhase] = useState<"pending" | "settled" | "expired" | "failed">("pending");
  const [now, setNow] = useState(() => Date.now());
  const settledRef = useRef(false);

  useEffect(() => {
    QRCode.toDataURL(payment.qrString, { width: 320, margin: 2, color: { dark: "#18181B", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [payment.qrString]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const remainingMs = new Date(payment.expiresAt).getTime() - now;
  const timedOut = remainingMs <= 0;

  useEffect(() => {
    if (settledRef.current || phase !== "pending" || timedOut) return;
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch(`/api/pos/orders/${payment.orderId}/payment`, { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (cancelled || !response.ok || !payload) return;
        if (payload.paymentStatus === "settled") {
          settledRef.current = true;
          setPhase("settled");
          onSettled?.();
        } else if (payload.paymentStatus === "expired" || payload.paymentStatus === "failed") {
          setPhase(payload.paymentStatus);
        }
      } catch {
        // Keep QR on screen; next tick retries.
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [payment.orderId, phase, timedOut, onSettled]);

  const state = timedOut && phase === "pending" ? "expired" : phase;

  return createPortal(
    <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/30 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <section
        className="ord-sheet w-full max-w-[380px] rounded-t-[28px] bg-white p-5 text-center sm:rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Pembayaran ${payment.orderNumber}`}
      >
        <div className="flex items-start justify-between text-left">
          <div>
            <p className="text-xs text-neutral-400">QRIS · {payment.orderNumber}</p>
            <p className="mt-3 text-3xl font-medium tabular-nums tracking-tight">{formatIDR(payment.totalIdr)}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup pembayaran"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 active:scale-95"
          >
            <X size={15} />
          </button>
        </div>

        <div className="shadow-soft mx-auto mt-8 w-fit rounded-3xl border border-neutral-100 bg-white p-4">
          {state === "settled" ? (
            <p className="flex h-56 w-56 items-center justify-center px-6 text-center text-sm font-medium">Pembayaran lunas.</p>
          ) : state === "expired" ? (
            <p className="flex h-56 w-56 items-center justify-center px-6 text-center text-[13px] text-neutral-500">
              Kode kedaluwarsa. Buat pesanan baru.
            </p>
          ) : state === "failed" ? (
            <p className="flex h-56 w-56 items-center justify-center px-6 text-center text-[13px] text-neutral-500">Pembayaran gagal. Coba lagi.</p>
          ) : qr ? (
            <img src={qr} alt="QRIS pembayaran" className="h-56 w-56 rounded-2xl" />
          ) : (
            <div className="ord-skeleton h-56 w-56 rounded-2xl" />
          )}
        </div>
        <p className="mt-6 text-[13px] text-neutral-400">
          {state === "settled" ? (
            "Terverifikasi · masuk antrean dapur"
          ) : state === "pending" ? (
            <span>
              Berlaku <span className="tabular-nums">{formatCountdown(remainingMs)}</span> · Scan dengan e-wallet apa pun
            </span>
          ) : state === "expired" ? (
            "Kode kedaluwarsa"
          ) : (
            "Ditolak provider"
          )}
        </p>
        <button
          onClick={onClose}
          className="mb-[max(0.25rem,env(safe-area-inset-bottom))] mt-8 h-[52px] w-full rounded-2xl bg-[#FDBD2C] text-[15px] font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98]"
        >
          {state === "settled" ? "Lanjut kasir" : "Tutup"}
        </button>
      </section>
    </div>,
    document.body,
  );
}

/* ================= Reports ================= */

function LiveReports({ initialReport, onShowNotice }: { initialReport: DailyReport | null; onShowNotice: (message: string) => void }) {
  const [date, setDate] = useState(jakartaToday());
  const [report, setReport] = useState<DailyReport | null>(initialReport);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setReport(initialReport);
  }, [initialReport]);

  async function load() {
    setLoading(true);
    const response = await fetch(`/api/reports/daily?date=${date}`, { cache: "no-store" });
    const payload = await response.json();
    setReport(response.ok ? payload : null);
    setLoading(false);
    if (!response.ok) onShowNotice(payload.error ?? "Laporan gagal dimuat.");
  }

  return (
    <div>
      <PageHead
        title="Laporan"
        sub="Hari bisnis Jakarta · pembayaran lunas"
        action={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-label="Tanggal laporan"
                className="h-11 flex-1 rounded-2xl bg-neutral-100 px-4 text-sm font-normal outline-none focus:bg-white focus:ring-2 focus:ring-[#FDBD2C]/50 sm:h-10 sm:flex-none sm:rounded-full sm:text-[13px]"
              />
              <button
                onClick={() => void load()}
                className="flex h-11 items-center rounded-2xl bg-neutral-900 px-5 text-sm font-medium text-white active:scale-[0.98] sm:h-10 sm:rounded-full sm:text-[13px]"
              >
                {loading ? "Memuat…" : "Muat"}
              </button>
            </div>
            <a
              href={`/api/reports/daily.pdf?date=${date}`}
              className="flex h-11 items-center justify-center rounded-2xl border border-neutral-200 text-sm font-medium text-neutral-900 active:bg-neutral-50 sm:h-10 sm:rounded-full sm:border-0 sm:text-[13px]"
            >
              Unduh PDF
            </a>
          </div>
        }
      />

      {report ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-neutral-100 bg-neutral-100 xl:grid-cols-4">
            <div className="bg-white p-4 sm:p-5">
              <Metric label="Pendapatan" value={formatCompactIDR(report.revenueIdr)} detail={`${report.orderCount} pesanan`} />
            </div>
            <div className="bg-white p-4 sm:p-5">
              <Metric label="Est. COGS" value={formatCompactIDR(report.estimatedCogsIdr)} detail="Snapshot biaya" />
            </div>
            <div className="bg-white p-4 sm:p-5">
              <Metric label="Fee" value={formatCompactIDR(report.paymentFeesIdr)} detail="Fee provider" />
            </div>
            <div className="bg-white p-4 sm:p-5">
              <Metric label="Est. laba" value={formatCompactIDR(report.estimatedGrossProfitIdr)} detail="Bukan laba bersih" />
            </div>
          </div>

          <section className="mt-8 border-t border-neutral-100 pt-6">
            <h3 className="text-sm font-medium">Komposisi</h3>
            <div className="mt-1 divide-y divide-neutral-100">
              <div className="flex items-center justify-between py-3">
                <span className="text-[13px] font-medium">Dine in</span>
                <span className="text-[13px] tabular-nums text-neutral-500">{formatCompactIDR(report.dineInRevenueIdr)}</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-[13px] font-medium">Takeaway</span>
                <span className="text-[13px] tabular-nums text-neutral-500">{formatCompactIDR(report.takeawayRevenueIdr)}</span>
              </div>
              <div className="flex items-center justify-between py-3">
                <span className="text-[13px] text-neutral-400">Rata-rata</span>
                <span className="text-[13px] tabular-nums text-neutral-500">{formatCompactIDR(report.averageOrderValueIdr)}</span>
              </div>
            </div>
          </section>

          <section className="mt-8 border-t border-neutral-100 pt-6">
            <h3 className="text-sm font-medium">Terlaris</h3>
            {report.bestSellers.length ? (
              <div className="mt-1 divide-y divide-neutral-100">
                {report.bestSellers.map((item) => (
                  <div key={item.name} className="flex items-center justify-between gap-3 py-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{item.name}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-neutral-400">{item.quantity} porsi</p>
                    </div>
                    <span className="shrink-0 text-[13px] tabular-nums text-neutral-500">{formatCompactIDR(item.revenueIdr)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-[13px] text-neutral-500">Belum ada penjualan lunas.</p>
            )}
          </section>

          <section className="mt-8 border-t border-neutral-100 pt-6">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-medium">Pesanan lunas</h3>
              <span className="text-xs text-neutral-400">{report.orders.length} baris</span>
            </div>
            {report.orders.length ? (
              <div className="mt-2 divide-y divide-neutral-100">
                {report.orders
                  .slice(-12)
                  .reverse()
                  .map((item) => (
                    <div key={item.orderNumber} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium">{item.orderNumber}</p>
                        <p className="mt-0.5 text-xs text-neutral-400">
                          {item.type === "dine_in" ? "Dine in" : "Takeaway"} ·{" "}
                          {new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(
                            new Date(item.createdAt),
                          )}
                        </p>
                      </div>
                      <span className="shrink-0 text-[13px] tabular-nums text-neutral-500">{formatCompactIDR(item.totalIdr)}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="py-10 text-center text-[13px] text-neutral-500">Belum ada pesanan lunas.</p>
            )}
          </section>
        </>
      ) : (
        <div className="px-5 py-14 text-center">
          {loading ? (
            <p className="text-[13px] text-neutral-500">Memuat laporan…</p>
          ) : (
            <>
              <p className="text-sm font-medium">Tidak ada data tanggal ini.</p>
              <p className="mt-1 text-[13px] text-neutral-500">Pilih tanggal lain lalu tekan Muat.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ================= Helpers ================= */

function jakartaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function formatLongDate(date: string) {
  const parsed = new Date(`${date}T12:00:00+07:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(parsed);
}

function jakartaGreeting() {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", hour12: false }).format(new Date()));
  if (hour < 11) return "Selamat pagi";
  if (hour < 15) return "Selamat siang";
  if (hour < 19) return "Selamat sore";
  return "Selamat malam";
}
