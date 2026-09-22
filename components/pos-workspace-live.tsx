"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { ArrowRight, BarChart3, BookOpen, CalendarDays, Check, ChefHat, ChevronRight, CircleDollarSign, Clock3, Coins, CreditCard, Download, Info, LayoutDashboard, Minus, MoreVertical, PackageOpen, Percent, Plus, ReceiptText, RefreshCw, Search, Settings, ShoppingBag, ShoppingCart, Store, Trash2, TrendingUp, UserRound, UsersRound, X } from "lucide-react";
import { formatCompactIDR, formatCountdown, formatIDR } from "@/lib/format";
import type { CartItem, Order, Product } from "@/lib/types";
import { buildCartItem } from "@/lib/domain/cart";
import type { DailyReport } from "@/lib/reports";
import { cn } from "@/lib/utils";
import { MenuManager } from "@/components/menu-manager";
import { ProductSheet } from "@/components/order/ProductSheet";
import { useDialogFocus } from "@/components/use-dialog-focus";

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
      | { method?: string; provider?: string; status?: string; amount_idr?: number; fee_idr?: number; expires_at?: string | null; settled_at?: string | null; created_at?: string | null; qr_image_url?: string | null }
      | Array<{ method?: string; provider?: string; status?: string; amount_idr?: number; fee_idr?: number; expires_at?: string | null; settled_at?: string | null; created_at?: string | null; qr_image_url?: string | null }>
      | null;
  };
  items: Array<{
    id: string;
    product_name_snapshot: string;
    image_url?: string | null;
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

const NAV_SHORT_LABEL: Record<NavItem, string> = {
  Overview: "Ringkas",
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
  Pending: "Menunggu bayar",
  New: "Baru",
  Accepted: "Diterima",
  Preparing: "Dimasak",
  Ready: "Siap",
  Completed: "Selesai",
  Cancelled: "Dibatalkan",
  Refunded: "Refund",
};

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "All", label: "Semua" },
  { key: "Pending", label: "Menunggu bayar" },
  { key: "New", label: "Baru" },
  { key: "Accepted", label: "Diterima" },
  { key: "Preparing", label: "Dimasak" },
  { key: "Ready", label: "Siap" },
  { key: "Completed", label: "Selesai" },
  { key: "Cancelled", label: "Dibatalkan" },
  { key: "Refunded", label: "Refund" },
];

function isActiveOrder(order: Order) {
  return !["Completed", "Cancelled", "Refunded"].includes(order.status);
}

export function PosWorkspaceLive({ role }: { role: "operator" | "admin" }) {
  const [nav, setNav] = useState<NavItem>("Overview");
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const date = jakartaToday();
  const activeCount = orders.filter(isActiveOrder).length;
  const noticeTimer = useRef<number | null>(null);

  function showNotice(message: string) {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200);
  }

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
  }, []);

  async function loadOperations(silent = false) {
    if (!silent) setLoading(true);
    try {
      const ordersResponse = await fetch(`/api/pos/orders?date=${date}`, { cache: "no-store" });
      const ordersPayload = await ordersResponse.json();
      const reportResponse = role === "admin" ? await fetch(`/api/reports/daily?date=${date}`, { cache: "no-store" }) : null;
      const reportPayload = reportResponse ? await reportResponse.json() : null;
      if (ordersResponse.status === 401 || reportResponse?.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (ordersResponse.ok) setOrders(ordersPayload.orders ?? []);
      if (reportResponse?.ok) setSummary(reportPayload);
      if (!ordersResponse.ok || reportResponse?.ok === false) {
        setWorkspaceError("Sebagian data belum termuat. Coba muat ulang.");
        if (!silent) showNotice("Sebagian data belum termuat.");
      } else {
        setWorkspaceError(null);
      }
    } catch {
      setWorkspaceError("Koneksi terputus. Coba muat ulang untuk melihat data terbaru.");
      if (!silent) showNotice("Koneksi terputus. Coba muat ulang.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadOperations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const hasActive = orders.some(isActiveOrder);

  useEffect(() => {
    if (!hasActive) return;
    const timer = window.setInterval(() => void loadOperations(true), 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, hasActive]);

  async function advanceOrder(order: Order) {
    if (advancingId) return;
    const next =
      order.status === "New" ? "accepted" : order.status === "Accepted" ? "processing" : order.status === "Preparing" ? "ready" : order.status === "Ready" ? "completed" : null;
    if (!next) return;
    setAdvancingId(order.id);
    try {
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
    } catch {
      showNotice("Koneksi terputus. Status belum berubah.");
    } finally {
      setAdvancingId(null);
    }
  }

  function advanceOrderGuarded(order: Order) {
    if (order.paymentStatus !== "Paid") {
      showNotice(`Pesanan ${order.number} masih menunggu pembayaran.`);
      return;
    }
    void advanceOrder(order);
  }

  const navItems = (Object.keys(NAV_LABEL) as NavItem[]).filter((item) => role === "admin" || (item !== "Menu" && item !== "Reports"));

  return (
    <div className="pos-theme flex h-[100dvh] max-h-[100dvh] min-h-[100dvh] w-full flex-col overflow-hidden antialiased lg:h-auto lg:max-h-none lg:min-h-screen lg:overflow-visible lg:bg-[radial-gradient(circle_at_100%_0%,rgba(253,189,44,0.08),transparent_24rem)] lg:pl-[266px]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden h-screen w-[266px] flex-col overflow-y-auto border-r border-neutral-100 bg-white px-5 py-8 lg:flex">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[15px] font-medium tracking-tight">Tempat Taichan</p>
            <p className="mt-1 text-xs text-neutral-400">{role === "admin" ? "Administrator" : "Staff"}</p>
          </div>
          <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#FDBD2C] shadow-[0_0_0_4px_rgba(253,189,44,0.14)]" />
        </div>
        <nav aria-label="Navigasi workspace" className="mt-10 space-y-1">
          {navItems.map((item) => {
            const Icon = NAV_ICON[item];
            const active = nav === item;
            return (
              <button
                type="button"
                key={item}
                onClick={() => setNav(item)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-full px-3.5 py-2 text-[13px] transition active:scale-[0.98]",
                  active ? "bg-white/10 font-medium text-neutral-900" : "font-normal text-neutral-500",
                )}
              >
                <Icon size={17} strokeWidth={active ? 2 : 1.6} className={active ? "text-[#FDBD2C]" : "text-neutral-400"} />
                <span className="flex-1 text-left">{NAV_LABEL[item]}</span>
                {item === "Orders" && activeCount > 0 && (
                  <span className="text-xs font-medium tabular-nums text-neutral-400">{activeCount}</span>
                )}
              </button>
            );
          })}
        </nav>
        {role === "admin" && <a href="/admin" className="mt-4 flex items-center gap-3 rounded-full px-3.5 py-2 text-[13px] text-neutral-500"><Settings size={17} strokeWidth={1.6} /><span>Admin / Pengaturan</span></a>}
        <p className="mt-auto text-xs leading-relaxed text-neutral-400">
          {activeCount} pesanan aktif
          <br />
          {date}
        </p>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:block lg:min-h-screen">
        {/* Mobile top bar */}
        <header className="shrink-0 border-b border-neutral-100 bg-white/90 px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-md lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium tracking-tight"><span aria-hidden="true" className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#FDBD2C] align-middle" />{pageTitle(nav)}</p>
              <p className="mt-0.5 text-xs tabular-nums text-neutral-400">
                {activeCount} aktif · {date}
              </p>
            </div>
            {nav !== "POS" && (
              <button
                type="button"
                onClick={() => setNav("POS")}
                className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-[#FDBD2C] px-5 text-[13px] font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98]"
              >
                <Plus size={16} strokeWidth={2} />
                Pesanan baru
              </button>
            )}
          </div>
        </header>

        {/* Desktop top bar */}
        <header className="sticky top-0 z-30 hidden border-b border-neutral-100 bg-white/90 px-0 py-5 backdrop-blur-md lg:block">
          <div className="mx-auto flex max-w-[1540px] items-end justify-between px-8 xl:px-12 2xl:px-[74px]">
            <div>
              <p className="text-xs text-neutral-400">{formatLongDate(date)}</p>
              <h1 className="mt-1 text-[22px] font-medium leading-snug tracking-tight">{pageTitle(nav)}</h1>
            </div>
            <div className="flex items-center gap-5">
              <span className="hidden items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-xs text-neutral-400 xl:flex"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#FDBD2C] shadow-[0_0_0_3px_rgba(253,189,44,0.18)]" />Operasional</span>
              <button type="button" onClick={() => void loadOperations()} disabled={loading} className="flex items-center gap-2 text-[13px] font-normal text-neutral-400 active:scale-[0.98] disabled:opacity-50">
                <RefreshCw size={15} strokeWidth={1.8} />
                {loading ? "Memuat…" : "Muat ulang"}
              </button>
              <button
                onClick={() => setNav("POS")}
                className="flex h-10 items-center gap-2 rounded-full bg-[#FDBD2C] px-5 text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98]"
              >
                <Plus size={17} strokeWidth={2} />
                Pesanan baru
              </button>
              <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-neutral-300">
                <UserRound size={18} strokeWidth={1.7} />
              </span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main
          className={cn(
            "min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain mx-auto w-full max-w-[1540px] px-5 pb-[calc(128px+env(safe-area-inset-bottom))] pt-6 lg:min-h-0 lg:flex-none lg:overflow-visible lg:px-8 xl:px-12 2xl:px-[74px] lg:pb-20",
            nav === "Orders" || nav === "Menu" ? "lg:pt-3" : "lg:pt-10",
            nav === "POS" ? "pb-[calc(208px+env(safe-area-inset-bottom))]" : "",
          )}
        >
          <div key={nav} className="pos-fade">
            {workspaceError && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[13px] text-neutral-600"><span>{workspaceError}</span><button type="button" onClick={() => void loadOperations()} className="h-9 rounded-full bg-neutral-900 px-4 text-xs font-medium text-white">Muat ulang</button></div>}
            {nav === "Overview" && (
              <LiveOverview
                orders={orders}
                summary={summary}
                isAdmin={role === "admin"}
                loading={loading}
                onAdvance={advanceOrderGuarded}
                advancingId={advancingId}
                onOpenOrders={() => setNav("Orders")}
              />
            )}
            {nav === "Orders" && <LiveOrders orders={orders} isAdmin={role === "admin"} onAdvance={advanceOrderGuarded} advancingId={advancingId} loading={loading} onShowNotice={showNotice} onRefresh={() => loadOperations(true)} onNewOrder={() => setNav("POS")} />}
            {nav === "POS" && <LiveCashier onShowNotice={showNotice} onOrderCreated={() => loadOperations(true)} />}
            {nav === "Menu" && role === "admin" && <MenuManager onShowNotice={showNotice} />}
            {nav === "Reports" && role === "admin" && <LiveReports initialReport={summary} onShowNotice={showNotice} />}
          </div>
        </main>
      </div>

      {/* Mobile bottom tabs */}
      <nav aria-label="Navigasi workspace" className="shadow-sheet fixed inset-x-0 bottom-0 z-40 border-t border-neutral-100 bg-white/95 px-3 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md lg:hidden">
        <div className={cn("mx-auto grid w-full gap-1", navItems.length === 3 ? "max-w-[360px] grid-cols-3 sm:max-w-[520px]" : "max-w-[440px] grid-cols-5 sm:max-w-[720px]")}>
          {navItems.map((item) => {
            const Icon = NAV_ICON[item];
            const active = nav === item;
            return (
              <button
                type="button"
                key={item}
                onClick={() => setNav(item)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl py-2",
                  active ? "bg-[#FDBD2C]/15 ring-1 ring-[#FDBD2C]/30" : "active:bg-neutral-50",
                )}
              >
                <Icon size={21} strokeWidth={active ? 2.2 : 1.6} className={active ? "text-neutral-900" : "text-neutral-400"} />
                <span className={cn("flex items-center gap-1 text-[11px] leading-none", active ? "font-medium text-neutral-900" : "font-normal text-neutral-400")}>
                  {NAV_SHORT_LABEL[item]}
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
          <p role="status" aria-live="polite" className="ord-toast shadow-soft pointer-events-auto max-w-[min(92vw,680px)] rounded-2xl bg-neutral-900 px-4 py-2.5 text-left text-[13px] leading-relaxed text-white">{notice}</p>
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

function Metric({ label, value, detail, icon, tone = "neutral" }: { label: string; value: string; detail: string; icon?: React.ReactNode; tone?: "gold" | "green" | "orange" | "blue" | "purple" | "neutral" }) {
  const iconTone = {
    gold: "bg-[#FDBD2C]/20 text-[#FDBD2C]",
    green: "bg-[#2F8062]/60 text-emerald-100",
    orange: "bg-[#FDBD2C]/20 text-[#FDBD2C]",
    blue: "bg-blue-500/20 text-blue-200",
    purple: "bg-violet-500/20 text-violet-200",
    neutral: "bg-white/10 text-neutral-200",
  }[tone];
  return (
    <div className={cn("min-w-0", Boolean(icon) && "flex items-center gap-3 sm:gap-4 max-[400px]:flex-col max-[400px]:items-start max-[400px]:gap-2")}>
      {icon && <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-full sm:h-16 sm:w-16 max-[400px]:h-10 max-[400px]:w-10", iconTone)}>{icon}</span>}
      <div className="min-w-0">
        <p className="truncate text-[11px] leading-tight text-neutral-400 sm:text-xs">{label}</p>
        <p className="mt-1 break-words text-xl font-medium tabular-nums leading-snug tracking-tight text-white sm:text-[22px]">{value}</p>
        <p className="mt-0.5 truncate text-[11px] leading-tight text-neutral-400 sm:text-[13px]">{detail}</p>
      </div>
    </div>
  );
}

function ReportMetric({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: React.ReactNode; tone: "green" | "blue" | "orange" | "purple" }) {
  const toneClasses = {
    green: "border-emerald-400/15 bg-[#16211f] text-emerald-300",
    blue: "border-blue-400/15 bg-[#171f2b] text-blue-300",
    orange: "border-orange-400/15 bg-[#241e1a] text-orange-300",
    purple: "border-violet-400/15 bg-[#211c2c] text-violet-300",
  }[tone];
  const iconClasses = {
    green: "bg-emerald-500 text-white",
    blue: "bg-blue-500 text-white",
    orange: "bg-orange-500 text-white",
    purple: "bg-violet-500 text-white",
  }[tone];
  return (
    <div className={cn("min-w-0 rounded-2xl border p-5", toneClasses)}>
      <div className="flex items-start gap-4">
        <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-full", iconClasses)}>{icon}</span>
        <div className="min-w-0">
          <p className="truncate text-[13px] text-neutral-300">{label}</p>
          <p className="mt-1 text-[22px] font-medium leading-tight tabular-nums tracking-tight text-white">{value}</p>
          <p className="mt-1 truncate text-[13px] text-neutral-400">{detail}</p>
        </div>
      </div>
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

function SearchField({ value, onChange, placeholder, id = "workspace-search" }: { value: string; onChange: (v: string) => void; placeholder: string; id?: string }) {
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">{placeholder}</label>
      <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" />
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-2xl bg-neutral-100 pl-10 pr-10 text-sm outline-none placeholder:text-neutral-400 focus:bg-white focus:ring-2 focus:ring-[#FDBD2C]/50 lg:rounded-full"
      />
      {value && (
        <button
          type="button"
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

function QtyStepper({ count, onMinus, onPlus, large = false, itemName }: { count: number; onMinus: () => void; onPlus: () => void; large?: boolean; itemName?: string }) {
  const size = large ? "h-11 w-11" : "h-9 w-9";
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onMinus}
        aria-label={itemName ? `Kurangi ${itemName}` : "Kurangi"}
        className={cn("flex items-center justify-center rounded-full border border-neutral-200 text-neutral-500 active:scale-95", size)}
      >
        <Minus size={15} />
      </button>
      <span aria-live="polite" className={cn("text-center font-medium tabular-nums", large ? "w-6 text-[15px]" : "w-5 text-sm")}>{count}</span>
      <button
        type="button"
        onClick={onPlus}
        aria-label={itemName ? `Tambah ${itemName}` : "Tambah"}
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
  isAdmin,
  loading,
  onAdvance,
  advancingId,
  onOpenOrders,
}: {
  orders: Order[];
  summary: DailyReport | null;
  isAdmin: boolean;
  loading: boolean;
  onAdvance: (order: Order) => void;
  advancingId: string | null;
  onOpenOrders: () => void;
}) {
  const active = orders.filter(isActiveOrder);
  const dateLabel = summary?.date ?? jakartaToday();

  return (
    <div>
      <PageHead title="Hari ini" />

      {isAdmin ? <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="min-h-[132px] rounded-2xl border border-[#FDBD2C]/25 bg-[#282321] p-5 shadow-[0_14px_32px_rgba(0,0,0,0.14)]"><Metric icon={<BarChart3 size={26} strokeWidth={1.8} />} tone="gold" label="Penjualan bersih" value={summary ? formatCompactIDR(summary.netRevenueIdr) : "—"} detail="Settlement Jakarta" /></div>
        <div className="min-h-[132px] rounded-2xl border border-[#2F8062]/40 bg-[#1d2925] p-5 shadow-[0_14px_32px_rgba(0,0,0,0.14)]"><Metric icon={<ShoppingCart size={26} strokeWidth={1.8} />} tone="green" label="Pesanan" value={summary ? String(summary.orderCount) : "—"} detail="Lunas hari ini" /></div>
        <div className="min-h-[132px] rounded-2xl border border-[#FDBD2C]/30 bg-[#29271d] p-5 shadow-[0_14px_32px_rgba(0,0,0,0.14)]"><Metric icon={<Coins size={26} strokeWidth={1.8} />} tone="orange" label="Est. laba" value={summary ? formatCompactIDR(summary.estimatedGrossProfitIdr) : "—"} detail="Setelah COGS + fee" /></div>
        <div className="min-h-[132px] rounded-2xl border border-white/[0.08] bg-[#1b2029] p-5 shadow-[0_14px_32px_rgba(0,0,0,0.14)]"><Metric icon={<BarChart3 size={26} strokeWidth={1.8} />} tone="neutral" label="Rata-rata" value={summary ? formatCompactIDR(summary.averageOrderValueIdr) : "—"} detail="Per pesanan" /></div>
      </div> : <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-2"><div className="min-h-[132px] rounded-2xl border border-[#FDBD2C]/25 bg-[#282321] p-5 shadow-[0_14px_32px_rgba(0,0,0,0.14)]"><Metric icon={<ShoppingBag size={26} strokeWidth={1.8} />} tone="gold" label="Pesanan aktif" value={String(active.length)} detail="Perlu tindakan" /></div><div className="min-h-[132px] rounded-2xl border border-[#FDBD2C]/25 bg-[#29271d] p-5 shadow-[0_14px_32px_rgba(0,0,0,0.14)]"><Metric icon={<Coins size={26} strokeWidth={1.8} />} tone="orange" label="Menunggu bayar" value={String(orders.filter((order) => order.status === "Pending").length)} detail="Belum masuk dapur" /></div></div>}

      <section className="mt-6 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1b2029] p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#FDBD2C]" />
            <h3 className="text-sm font-medium">
              Perlu tindakan
              {active.length > 0 && <span className="ml-2 rounded-lg bg-white/10 px-2 py-1 text-xs font-normal tabular-nums text-neutral-300">{active.length}</span>}
            </h3>
          </div>
          {active.length > 5 && (
            <button type="button" onClick={onOpenOrders} className="text-[13px] font-normal text-neutral-400">
              Semua
            </button>
          )}
        </div>
        <div className="mt-4">
          {loading ? (
            <LoadingBlock label="Memuat pesanan…" />
          ) : active.length ? (
            <div className="divide-y divide-white/[0.08]">
              {active.slice(0, 5).map((order) => (
                <div key={order.id} className="flex items-center gap-3 py-4">
                  <button
                    type="button"
                    onClick={onOpenOrders}
                    className="min-w-0 flex-1 rounded-2xl px-2 py-2.5 text-left active:bg-white/5"
                    aria-label={`Lihat ${order.number}`}
                  >
                    <p className="truncate text-[14px] font-medium text-white">
                      {order.number} <span className="font-normal text-neutral-400">· {STATUS_LABEL[order.status]}</span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-neutral-400">
                      {order.table ?? order.type} · {order.items} item · {order.time}
                      {order.paymentStatus !== "Paid" ? " · Belum bayar" : ""}
                    </p>
                    <p className="mt-1 text-[13px] tabular-nums text-neutral-300">{formatCompactIDR(order.total)}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAdvance(order)}
                    disabled={order.status === "Pending" || advancingId === order.id}
                    aria-busy={advancingId === order.id}
                    aria-label={`Lanjut ${order.number}`}
                    className={cn(
                      "flex h-11 shrink-0 items-center rounded-full px-5 text-[13px] font-medium active:scale-[0.98]",
                      order.status === "Pending" ? "bg-white/10 text-neutral-400" : "bg-[#FDBD2C] text-neutral-900",
                    )}
                  >
                    {order.status === "Pending" ? "Menunggu" : order.status === "New" ? "Terima" : order.status === "Accepted" ? "Mulai" : order.status === "Preparing" ? "Siap" : "Selesai"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock title="Tidak ada pesanan aktif." sub="Pesanan baru akan muncul di sini." />
          )}
        </div>
      </section>

      {isAdmin && <section className="mt-8 border-t border-neutral-100 pt-6">
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
      </section>}

      {isAdmin && <section className="mt-8 flex flex-col gap-3 border-t border-neutral-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
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
      </section>}
    </div>
  );
}

/* ================= Orders ================= */

function LiveOrders({
  orders,
  isAdmin,
  onAdvance,
  advancingId,
  loading,
  onShowNotice,
  onRefresh,
  onNewOrder,
}: {
  orders: Order[];
  isAdmin: boolean;
  onAdvance: (order: Order) => void;
  advancingId: string | null;
  loading: boolean;
  onShowNotice: (message: string) => void;
  onRefresh: () => Promise<void>;
  onNewOrder: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const counts = FILTERS.map(({ key }) => ({ key, n: key === "All" ? orders.length : orders.filter((o) => o.status === key).length }));
  const filtered = orders.filter(
    (order) =>
      (filter === "All" || order.status === filter) && `${order.number} ${order.table ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );

  async function openDetail(order: Order) {
    if (openingId) return;
    setOpeningId(order.id);
    setDetailId(order.id);
    try {
      const response = await fetch(`/api/pos/orders/${order.id}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      setDetail(response.ok ? payload : null);
      if (!response.ok) {
        setDetailId(null);
        onShowNotice(payload?.error ?? "Detail tidak tersedia.");
      }
    } catch {
      setDetail(null);
      setDetailId(null);
      onShowNotice("Koneksi terputus. Detail belum dapat dibuka.");
    } finally {
      setOpeningId(null);
    }
  }

  async function refreshDetail(orderId: string) {
    const response = await fetch(`/api/pos/orders/${orderId}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload) setDetail(payload);
  }

  async function cancelOrder(orderId: string, orderNumber: string) {
    if (!window.confirm(`Batalkan pesanan ${orderNumber}? QR pending akan dinonaktifkan.`)) return;
    try {
      const response = await fetch(`/api/pos/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        onShowNotice(payload?.error ?? "Pesanan belum dapat dibatalkan.");
        return;
      }
      setDetail(null);
      setDetailId(null);
      await onRefresh();
      onShowNotice(`${orderNumber} dibatalkan.`);
    } catch {
      onShowNotice("Koneksi terputus. Pesanan belum dibatalkan.");
    }
  }

  const processingCount = orders.filter((order) => ["Accepted", "Preparing"].includes(order.status)).length;
  const completedCount = orders.filter((order) => order.status === "Completed").length;
  const pendingCount = orders.filter((order) => order.status === "Pending").length;

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="min-h-[132px] rounded-2xl border border-[#2F8062]/40 bg-[#1d2925] p-5 shadow-[0_14px_32px_rgba(0,0,0,0.14)]"><Metric icon={<ShoppingBag size={26} strokeWidth={1.8} />} tone="green" label="Total pesanan" value={String(orders.length)} detail="Hari ini" /></div>
        <div className="min-h-[132px] rounded-2xl border border-[#FDBD2C]/30 bg-[#29271d] p-5 shadow-[0_14px_32px_rgba(0,0,0,0.14)]"><Metric icon={<Clock3 size={26} strokeWidth={1.8} />} tone="orange" label="Menunggu bayar" value={String(pendingCount)} detail="Perlu tindakan" /></div>
        <div className="min-h-[132px] rounded-2xl border border-blue-400/25 bg-[#1d2430] p-5 shadow-[0_14px_32px_rgba(0,0,0,0.14)]"><Metric icon={<ChefHat size={26} strokeWidth={1.8} />} tone="blue" label="Sedang diproses" value={String(processingCount)} detail="Di dapur" /></div>
        <div className="min-h-[132px] rounded-2xl border border-violet-400/25 bg-[#25202e] p-5 shadow-[0_14px_32px_rgba(0,0,0,0.14)]"><Metric icon={<Check size={26} strokeWidth={1.8} />} tone="purple" label="Selesai" value={String(completedCount)} detail="Hari ini" /></div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <SearchField value={query} onChange={setQuery} placeholder="Cari nomor pesanan atau meja…" />
        </div>
        {isAdmin && <a href={`/api/reports/daily.pdf?date=${jakartaToday()}`} className="hidden h-11 shrink-0 items-center gap-2 rounded-full border border-white/[0.12] px-5 text-[13px] font-normal text-neutral-300 transition hover:bg-white/5 sm:flex"><Download size={15} strokeWidth={1.8} />Unduh PDF</a>}
      </div>

      <div className="no-scrollbar -mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 xl:mx-0 xl:px-0">
        {FILTERS.map(({ key, label }) => {
          const n = counts.find((c) => c.key === key)?.n ?? 0;
          const isActive = filter === key;
          const dotTone = {
            Pending: "bg-[#FDBD2C]",
            New: "bg-blue-500",
            Accepted: "bg-violet-500",
            Preparing: "bg-[#FDBD2C]",
            Ready: "bg-emerald-400",
            Completed: "bg-neutral-400",
            Cancelled: "bg-red-400",
            Refunded: "bg-neutral-500",
          }[key];
          return (
            <button
              type="button"
              key={key}
              onClick={() => setFilter(key)}
              aria-pressed={isActive}
              className={cn(
                "flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[13px] transition active:scale-[0.98]",
                isActive ? "border-[#FDBD2C] bg-[#FDBD2C]/15 font-medium text-white" : "border-white/[0.14] font-normal text-neutral-300 hover:bg-white/5",
              )}
            >
              {key !== "All" && <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", dotTone)} />}
              {label} <span className={cn("tabular-nums", isActive ? "text-neutral-500" : "text-neutral-400")}>{n}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6">
        {loading ? (
          <LoadingBlock label="Memuat pesanan…" />
        ) : filtered.length ? (
          <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1b2029]">
            <div className="hidden grid-cols-[1.1fr_1.45fr_.8fr_1.1fr_auto] gap-4 bg-white/[0.04] px-6 py-3 text-xs text-neutral-400 lg:grid">
              <span>Pesanan</span>
              <span>Detail</span>
              <span>Total</span>
              <span>Status</span>
              <span className="text-right">Aksi</span>
            </div>
            <div className="divide-y divide-white/[0.08]">
              {filtered.map((order) => {
                const statusTone = order.status === "Pending"
                  ? "bg-[#FDBD2C]/15 text-[#FDBD2C]"
                  : order.status === "Completed"
                    ? "bg-[#2F8062]/35 text-emerald-200"
                    : order.status === "Cancelled" || order.status === "Refunded"
                      ? "bg-red-500/15 text-red-300"
                      : order.status === "New"
                        ? "bg-blue-500/15 text-blue-200"
                        : order.status === "Accepted"
                          ? "bg-violet-500/15 text-violet-200"
                          : order.status === "Preparing"
                            ? "bg-[#FDBD2C]/15 text-[#FDBD2C]"
                            : "bg-emerald-500/15 text-emerald-200";
                return (
                  <div key={order.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 px-4 py-4 sm:px-5 lg:grid-cols-[1.1fr_1.45fr_.8fr_1.1fr_auto] lg:items-center lg:gap-4 lg:px-6">
                    <button
                      type="button"
                      onClick={() => void openDetail(order)}
                      disabled={openingId === order.id}
                      aria-busy={openingId === order.id}
                      className="min-w-0 rounded-xl text-left transition active:bg-white/5 lg:rounded-none"
                      aria-label={`Detail ${order.number}`}
                    >
                      <p className="truncate text-[14px] font-medium text-white">{order.number}</p>
                      <p className="mt-1 truncate text-xs text-neutral-400">{formatShortDate(jakartaToday())} · {order.time}</p>
                    </button>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-neutral-300"><ShoppingBag size={16} strokeWidth={1.7} /></span>
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-white">{order.type}</p>
                        <p className="mt-0.5 truncate text-xs text-neutral-400">{order.table ? `${order.table} · ` : ""}{order.items} item</p>
                      </div>
                    </div>
                    <p className="self-center text-[13px] font-medium tabular-nums text-white">{formatCompactIDR(order.total)}</p>
                    <span className={cn("inline-flex w-fit items-center gap-2 rounded-full px-3 py-2 text-xs font-medium", statusTone)}><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{STATUS_LABEL[order.status]}</span>
                    <div className="flex justify-end">
                      {order.status === "Pending" ? (
                        <button type="button" onClick={() => void openDetail(order)} className="h-10 rounded-full bg-[#FDBD2C] px-5 text-[13px] font-medium text-neutral-900 active:scale-[0.98]">Lihat</button>
                      ) : isActiveOrder(order) ? (
                        <button type="button" onClick={() => onAdvance(order)} disabled={advancingId === order.id} aria-busy={advancingId === order.id} aria-label={`Lanjut ${order.number}`} className="h-10 rounded-full bg-[#FDBD2C] px-5 text-[13px] font-medium text-neutral-900 active:scale-[0.98] disabled:opacity-40">{order.status === "New" ? "Terima" : order.status === "Accepted" ? "Mulai" : order.status === "Preparing" ? "Siap" : "Selesai"}</button>
                      ) : (
                        <button type="button" onClick={() => void openDetail(order)} aria-label={`Buka detail ${order.number}`} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-neutral-300 active:scale-95">•••</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
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
          onCancel={() => void cancelOrder(detailId, detail.order.order_number)}
          onShowNotice={onShowNotice}
          onNewOrder={() => {
            setDetail(null);
            setDetailId(null);
            onNewOrder();
          }}
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
  if (status === "awaiting_payment") return "Menunggu pembayaran";
  if (status === "paid") return "Baru";
  if (status === "accepted") return "Diterima";
  if (status === "processing") return "Dimasak";
  if (status === "ready") return "Siap";
  if (status === "completed") return "Selesai";
  if (status === "cancelled") return "Dibatalkan";
  if (status === "refunded") return "Refund";
  return "Batal";
}

function nextActionLabel(status: string) {
  if (status === "awaiting_payment") return "Menunggu pembayaran";
  if (status === "paid") return "Terima pesanan";
  if (status === "accepted") return "Mulai masak";
  if (status === "processing") return "Tandai siap";
  if (status === "ready") return "Selesaikan";
  if (status === "completed") return "Selesai";
  if (status === "cancelled") return "Dibatalkan";
  if (status === "refunded") return "Refund";
  return "Dibatalkan";
}

function formatCreatedAt(iso: string) {
  const date = new Date(iso);
  const time = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(date);
  const day = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(date);
  return `${day} · ${time}`;
}

function formatShortDate(date: string) {
  const parsed = new Date(`${date}T12:00:00+07:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(parsed);
}

function OrderDetail({ detail, detailId, onClose, onAdvance, onCancel, onSettled, onShowNotice, onNewOrder }: { detail: Detail; detailId: string; onClose: () => void; onAdvance: () => void; onCancel: () => void; onSettled?: (orderId: string) => void; onShowNotice: (message: string) => void; onNewOrder: () => void }) {
  const table = Array.isArray(detail.order.restaurant_tables) ? detail.order.restaurant_tables[0]?.label : detail.order.restaurant_tables?.label;
  const payment = Array.isArray(detail.order.payments) ? detail.order.payments[0] : detail.order.payments;
  const totalItems = detail.items.reduce((sum, item) => sum + item.quantity, 0);
  const done = ["awaiting_payment", "completed", "cancelled", "refunded"].includes(detail.order.status);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const payExpiresMs = payment?.expires_at ? new Date(payment.expires_at).getTime() : null;
  const payRemainingMs = payExpiresMs !== null ? payExpiresMs - nowMs : null;
  const isStale = detail.order.status === "cancelled" || detail.order.status === "refunded" || payment?.status === "expired";
  const statusTone = detail.order.status === "cancelled" || detail.order.status === "refunded"
    ? "bg-red-500/15 text-red-300"
    : detail.order.status === "awaiting_payment"
      ? "bg-[#FDBD2C]/15 text-[#FDBD2C]"
      : detail.order.status === "completed"
        ? "bg-emerald-500/15 text-emerald-300"
        : "bg-blue-500/15 text-blue-200";
  const paymentTone = payment?.status === "settled"
    ? "bg-emerald-500/15 text-emerald-300"
    : payment?.status === "expired" || payment?.status === "failed"
      ? "bg-red-500/15 text-red-300"
      : "bg-[#FDBD2C]/15 text-[#FDBD2C]";
  const noticeTitle = payment?.status === "expired" ? "QR kedaluwarsa" : detail.order.status === "cancelled" ? "Pesanan dibatalkan" : "Pembayaran belum selesai";
  const noticeDescription = payment?.status === "expired" || detail.order.status === "cancelled"
    ? "Buat pesanan baru untuk melanjutkan."
    : "Selesaikan pembayaran untuk melanjutkan pesanan.";
  const [checkingPay, setCheckingPay] = useState(false);
  const [resumeQr, setResumeQr] = useState<{ qrString?: string; qrImageUrl?: string; expiresAt: string } | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, onClose);

  async function checkPaymentNow() {
    setCheckingPay(true);
    try {
      const response = await fetch(`/api/pos/orders/${detailId}/payment`, { method: "POST", cache: "no-store" });
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
    } catch {
      onShowNotice("Koneksi ke server pembayaran terputus. Status pesanan belum berubah.");
    } finally {
      setCheckingPay(false);
    }
  }

  async function resumeQrCode() {
    setCheckingPay(true);
    try {
      const response = await fetch(`/api/pos/orders/${detailId}/payment`, { method: "POST", cache: "no-store" });
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
      if ((!payload.qrString && !payload.qrImageUrl) || payload.paymentStatus !== "pending") {
        onShowNotice("QR sudah tidak berlaku. Buat pesanan baru.");
        return;
      }
      setResumeQr({ qrString: payload.qrString ?? undefined, qrImageUrl: payload.qrImageUrl ?? undefined, expiresAt: payload.expiresAt });
    } catch {
      onShowNotice("Koneksi ke server pembayaran terputus. QR belum dapat ditampilkan.");
    } finally {
      setCheckingPay(false);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return createPortal(
    <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#070a0f]/80 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <aside
        ref={dialogRef}
        tabIndex={-1}
        className="ord-sheet relative flex max-h-[94dvh] w-full max-w-[1100px] flex-col overflow-hidden rounded-t-[30px] border border-white/[0.12] bg-[#151a22] text-[#f4f4f5] shadow-[0_24px_80px_rgba(0,0,0,0.5)] sm:max-h-[90dvh] sm:rounded-[32px]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-detail-title"
      >
        <div className="mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-white/25 sm:mt-5" />
        <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-5 pt-4 sm:px-12 sm:pb-7 sm:pt-6">
          <div className="min-w-0">
            <div className={cn("inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium", statusTone)}>
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-current" />
              {rawStatusLabel(detail.order.status)}
            </div>
            <h2 id="order-detail-title" className="mt-5 truncate text-3xl font-medium leading-tight tracking-tight text-white sm:text-4xl">{detail.order.order_number}</h2>
            <p className="mt-1.5 text-sm text-neutral-400 sm:text-base">{formatCreatedAt(detail.order.created_at)}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#202631] px-4 py-2 text-sm text-neutral-300">
                <ShoppingBag size={18} strokeWidth={1.7} />
                {detail.order.order_type === "dine_in" ? (table ?? "Dine in") : "Takeaway"}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-[#202631] px-4 py-2 text-sm text-neutral-300">
                <UsersRound size={18} strokeWidth={1.7} />
                {totalItems} porsi
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup detail"
            autoFocus
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#232a35] text-neutral-300 transition hover:bg-[#2b323e] active:scale-95"
          >
            <X size={22} strokeWidth={1.8} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-6 sm:px-12 sm:pb-8">
          <section>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-lg font-medium text-white sm:text-xl">Item Pesanan</h3>
              <span className="shrink-0 text-sm text-neutral-400">{detail.items.length} item · {totalItems} baris</span>
            </div>
            <div className="mt-4 space-y-3">
              {detail.items.map((item) => {
                const modifierCounts = new Map<string, number>();
                for (const modifier of item.order_item_modifiers ?? []) {
                  if (modifier.modifier_name_snapshot) modifierCounts.set(modifier.modifier_name_snapshot, (modifierCounts.get(modifier.modifier_name_snapshot) ?? 0) + 1);
                }
                const modifiers = Array.from(modifierCounts, ([name, count]) => count > 1 ? `${name} × ${count}` : name);
                return (
                  <div key={item.id} className="flex gap-3 rounded-2xl border border-white/[0.08] bg-[#1b2029] p-3.5 sm:gap-5 sm:p-5">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/[0.1] bg-[#232a35] text-neutral-400 sm:h-24 sm:w-24">
                      {item.image_url ? <img src={item.image_url} alt="" className="h-full w-full object-cover" /> : <ShoppingBag size={28} strokeWidth={1.4} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-medium text-white sm:text-lg">{item.product_name_snapshot}</p>
                      <p className="mt-1 text-sm tabular-nums text-neutral-300">{item.quantity} × {formatCompactIDR(item.unit_price_idr)}</p>
                      <p className="mt-2 truncate text-sm text-neutral-400">
                        {modifiers.length > 0 ? modifiers.join(" · ") : "Original"}
                        {item.note ? ` · “${item.note}”` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 self-start text-base font-medium tabular-nums text-white sm:text-xl">{formatCompactIDR(item.line_total_idr)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-7 border-t border-white/[0.08] pt-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <ReceiptText size={28} strokeWidth={1.6} className="text-neutral-300" />
                <span className="text-lg font-medium text-white">Total</span>
              </div>
              <span className="text-2xl font-medium tabular-nums text-white sm:text-3xl">{formatCompactIDR(detail.order.total_idr)}</span>
            </div>
          </section>

          <section className="mt-6 border-t border-white/[0.08] pt-6">
            <div className="flex items-center gap-4">
              <CreditCard size={28} strokeWidth={1.6} className="text-neutral-300" />
              <h3 className="text-lg font-medium text-white">Pembayaran</h3>
            </div>
            <div className="mt-5 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-base text-neutral-400">Metode</span>
                <span className="text-right text-base text-white">
                  {payMethodLabel(payment?.method)}
                  {payment?.provider ? ` · ${payment.provider}` : ""}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-base text-neutral-400">Status</span>
                <span className={cn("inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium", paymentTone)}>
                  <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-current" />
                  {payStateLabel(payment?.status)}
                </span>
              </div>
              {payment?.status === "pending" && payRemainingMs !== null && payRemainingMs > 0 && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-base text-neutral-400">QR berlaku</span>
                  <span className="text-base tabular-nums text-neutral-300">{formatCountdown(payRemainingMs)}</span>
                </div>
              )}
            </div>
          </section>

          {isStale && (
            <div className="mt-6 flex gap-4 rounded-2xl border border-[#FDBD2C]/40 bg-[#FDBD2C]/10 p-4 sm:p-5">
              <Info size={28} strokeWidth={1.8} className="mt-0.5 shrink-0 text-[#FDBD2C]" />
              <div className="min-w-0">
                <p className="text-base font-medium text-white">{noticeTitle}</p>
                <p className="mt-1 text-sm leading-relaxed text-neutral-300">{noticeDescription}</p>
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-white/[0.08] bg-[#151a22]/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:px-12 sm:pt-5">
          {isStale ? (
            <>
              <button
                type="button"
                onClick={onNewOrder}
                className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#FDBD2C] text-base font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98]"
              >
                <RefreshCw size={21} strokeWidth={1.9} />
                Buat pesanan baru
              </button>
              <button
                type="button"
                onClick={onClose}
                className="mt-3 h-14 w-full rounded-2xl border border-white/[0.28] text-base text-neutral-300 transition hover:bg-white/5 active:scale-[0.98]"
              >
                Tutup
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onAdvance}
                disabled={done}
                className="h-14 w-full rounded-2xl bg-[#FDBD2C] text-base font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
              >
                {nextActionLabel(detail.order.status)}
              </button>
              {payment?.status === "pending" && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void checkPaymentNow()}
                    disabled={checkingPay}
                    className="h-11 w-full rounded-full text-[13px] text-neutral-400 transition hover:bg-white/5 disabled:opacity-60"
                  >
                    {checkingPay ? "Mengecek…" : "Cek pembayaran"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void resumeQrCode()}
                    disabled={checkingPay}
                    className="h-11 w-full rounded-full text-[13px] text-neutral-400 transition hover:bg-white/5 disabled:opacity-60"
                  >
                    Tampilkan QR
                  </button>
                </div>
              )}
              {["draft", "awaiting_payment"].includes(detail.order.status) && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="mt-1 h-11 w-full rounded-full text-[13px] text-red-300 transition hover:bg-red-500/10"
                >
                  Batalkan pesanan
                </button>
              )}
            </>
          )}
        </div>
        {resumeQr && (
          <ResumeQrOverlay
            qrString={resumeQr.qrString}
            qrImageUrl={resumeQr.qrImageUrl}
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

function ResumeQrOverlay({ qrString, qrImageUrl, expiresAt, orderNumber, totalIdr, onClose }: { qrString?: string; qrImageUrl?: string; expiresAt: string; orderNumber: string; totalIdr: number; onClose: () => void }) {
  const [qr, setQr] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, onClose);
  useEffect(() => {
    if (!qrString) {
      setQr("");
      return;
    }
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
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#070a0f]/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="shadow-soft w-full max-w-[300px] rounded-3xl border border-white/[0.12] bg-[#151a22] p-5 text-center text-white"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-qr-title"
      >
        <p id="resume-qr-title" className="text-xs text-neutral-400">QRIS · {orderNumber}</p>
        {qrImageUrl ? (
          <img src={qrImageUrl} alt="QRIS pembayaran" className="mx-auto mt-4 h-48 w-48 rounded-2xl border border-white/[0.12] bg-white p-2" />
        ) : qr ? (
          <img src={qr} alt="QRIS pembayaran" className="mx-auto mt-4 h-48 w-48 rounded-2xl border border-white/[0.12] bg-white p-2" />
        ) : (
          <div className="ord-skeleton mx-auto mt-4 h-48 w-48 rounded-2xl" />
        )}
        <p className="mt-3 text-[15px] font-medium tabular-nums">{formatIDR(totalIdr)}</p>
        <p className="mt-1 text-[13px] text-neutral-400">
          {remainingMs > 0 ? <span>Berlaku {formatCountdown(remainingMs)}</span> : <span>Kedaluwarsa</span>}
        </p>
        <button type="button" onClick={onClose} className="mt-4 h-12 w-full rounded-full bg-[#FDBD2C] text-sm font-medium text-neutral-900 active:scale-[0.98]">
          Tutup
        </button>
      </section>
    </div>
  );
}

type CartLine = CartItem;

function LiveCashier({ onShowNotice, onOrderCreated }: { onShowNotice: (message: string) => void; onOrderCreated?: () => Promise<void> }) {
  const [menu, setMenu] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"qris" | "cash">("qris");
  const [paymentSettings, setPaymentSettings] = useState({ qrisEnabled: false, cashEnabled: false });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [variantOptionIds, setVariantOptionIds] = useState<string[]>([]);
  const [addonOptionIds, setAddonOptionIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [tables, setTables] = useState<Array<{ id: string; label: string; active: boolean }>>([]);
  const [tableId, setTableId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>("Semua Menu");
  const [query, setQuery] = useState("");
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway">("dine_in");
  const [payment, setPayment] = useState<{ orderId: string; qrString?: string; qrImageUrl?: string; orderNumber: string; totalIdr: number; expiresAt: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const intentKey = useRef<string | null>(null);
  const cartDialogRef = useRef<HTMLElement>(null);
  useDialogFocus(cartDialogRef, () => setCartOpen(false), cartOpen);

  useEffect(() => {
    fetch("/api/menu", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.products?.length) setMenu(payload.products);
        setCategories(["Semua Menu", ...(payload?.categories ?? []).map((item: { name: string }) => item.name)]);
        setPaymentSettings(payload?.settings ?? { qrisEnabled: false, cashEnabled: false });
        if (payload?.settings?.qrisEnabled === false) setPaymentMethod("cash");
      })
      .catch(() => onShowNotice("Menu kasir belum dapat dimuat. Coba muat ulang."));
    fetch("/api/pos/tables", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => setTables((payload?.tables ?? []).filter((table: { active?: boolean }) => table.active)))
      .catch(() => onShowNotice("Daftar meja belum dapat dimuat."));
    // The notice callback is intentionally captured for the initial load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = menu.filter(
    (product) =>
      (category === "Semua Menu" || product.category === category) &&
      `${product.name} ${product.description ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const total = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);

  function add(product: Product) {
    if (!product.available) return;
    if ((product.modifierGroups ?? []).length > 0) {
      setSelectedProduct(product);
      setVariantOptionIds([]);
      setAddonOptionIds([]);
      setQuantity(1);
      setNote("");
      return;
    }
    intentKey.current = null;
    const item = buildCartItem(product, [], [], 1);
    setCart((current) => {
      const found = current.find((line) => line.key === item.key);
      return found
        ? current.map((line) => (line.key === item.key ? { ...line, quantity: line.quantity + 1 } : line))
        : [...current, item];
    });
  }

  function addConfiguredProduct() {
    if (!selectedProduct) return;
    intentKey.current = null;
    const item = buildCartItem(selectedProduct, variantOptionIds, addonOptionIds, quantity, note);
    setCart((current) => {
      const found = current.find((line) => line.key === item.key);
      return found ? current.map((line) => line.key === item.key ? { ...line, quantity: line.quantity + quantity } : line) : [...current, item];
    });
    setSelectedProduct(null);
    onShowNotice(`${selectedProduct.name} ditambahkan.`);
  }

  function setQty(key: string, delta: number) {
    intentKey.current = null;
    setCart((current) =>
      current
        .map((item) => (item.key === key ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0),
    );
  }

  function clearCart() {
    if (!cart.length) return;
    if (window.confirm("Kosongkan semua item dari pesanan berjalan?")) {
      intentKey.current = null;
      setCart([]);
    }
  }

  async function createOrder() {
    if (!cart.length || saving) return;
    if (paymentMethod === "qris" && !paymentSettings.qrisEnabled) { onShowNotice("QRIS sedang tidak tersedia."); return; }
    if (paymentMethod === "cash" && !paymentSettings.cashEnabled) { onShowNotice("Pembayaran tunai sedang tidak tersedia."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/pos/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: intentKey.current ?? (intentKey.current = crypto.randomUUID()),
          orderType,
          tableId: orderType === "dine_in" ? tableId : null,
          paymentMethod,
          items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity, variantOptionIds: item.variantOptionIds, addonOptionIds: item.addonOptionIds, note: item.note })),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || (paymentMethod === "qris" && !payload.qrString && !payload.qrImageUrl)) {
        onShowNotice(payload?.error ?? "Pesanan gagal dibuat.");
        return;
      }
      if (paymentMethod === "cash") {
        setCart([]); intentKey.current = null; setCartOpen(false); await onOrderCreated?.(); onShowNotice(`${payload.orderNumber} lunas tunai.`); return;
      }
      setPayment({ orderId: payload.orderId, qrString: payload.qrString ?? undefined, qrImageUrl: payload.qrImageUrl ?? undefined, orderNumber: payload.orderNumber, totalIdr: payload.totalIdr, expiresAt: payload.expiresAt });
      setCart([]);
      setCartOpen(false);
      await onOrderCreated?.();
    } catch {
      onShowNotice("Koneksi ke server checkout terputus. Tidak diketahui apakah pesanan dibuat; cek daftar pesanan sebelum mencoba lagi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="hidden lg:block">
        <PageHead title="Kasir" sub={`${orderType === "dine_in" ? "Dine in" : "Takeaway"} · ${paymentMethod === "cash" ? "Tunai" : "QRIS"}`} />
      </div>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0 rounded-2xl border border-white/[0.06] bg-[#171c24] p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1.08fr]">
            <div className="flex rounded-full border border-white/[0.12] bg-white/[0.03] p-1">
              {(
                [
                  { key: "dine_in", label: "Dine in" },
                  { key: "takeaway", label: "Takeaway" },
                ] as const
              ).map(({ key, label }) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => { setOrderType(key); if (key === "takeaway") setTableId(null); }}
                  aria-pressed={orderType === key}
                  className={cn(
                    "h-11 flex-1 rounded-full text-center text-[13px] transition active:scale-[0.98]",
                    orderType === key ? "bg-[#FDBD2C]/15 font-medium text-white ring-1 ring-[#FDBD2C]" : "font-normal text-neutral-400",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex rounded-full border border-white/[0.12] bg-white/[0.03] p-1">
              {([{ key: "cash", label: "Tunai", enabled: paymentSettings.cashEnabled }, { key: "qris", label: "QRIS", enabled: paymentSettings.qrisEnabled }] as const).map((method) => <button type="button" key={method.key} onClick={() => method.enabled && setPaymentMethod(method.key)} disabled={!method.enabled} aria-pressed={paymentMethod === method.key} className={cn("h-11 flex-1 rounded-full text-[13px] transition disabled:opacity-30", paymentMethod === method.key ? "bg-white/10 font-medium text-white ring-1 ring-[#FDBD2C]" : "text-neutral-400")}>{method.label}</button>)}
            </div>
            {orderType === "dine_in" && (
              <label htmlFor="cashier-table" className="block text-[13px] text-neutral-400 sm:col-span-2 xl:col-span-1">
                Meja <span className="text-neutral-500">· opsional</span>
                <select id="cashier-table" value={tableId ?? ""} onChange={(event) => setTableId(event.target.value || null)} className="input mt-2 h-11 rounded-xl">
                  <option value="">Tanpa meja / walk-in</option>
                  {tables.map((table) => <option key={table.id} value={table.id}>{table.label}</option>)}
                </select>
              </label>
            )}
          </div>

          <div className="mt-6">
            <SearchField value={query} onChange={setQuery} placeholder="Cari menu… (contoh: sate taichan)" />
          </div>
          <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1">
            {categories.map((item) => (
              <button
                type="button"
                key={item}
                onClick={() => setCategory(item)}
                aria-pressed={category === item}
                className={cn(
                  "flex h-10 shrink-0 items-center rounded-full border px-4 text-[13px] transition active:scale-[0.98]",
                  category === item ? "border-[#FDBD2C] bg-[#FDBD2C]/15 font-medium text-white" : "border-white/[0.14] font-normal text-neutral-400 hover:bg-white/5",
                )}
              >
                {item}
              </button>
            ))}
          </div>

          {filtered.length ? (
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium tracking-tight text-white">Menu</h3>
                <span className="text-xs tabular-nums text-neutral-400">{filtered.length} item</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {filtered.map((product) => {
                  const qty = cart.filter((item) => item.product.id === product.id).reduce((sum, item) => sum + item.quantity, 0);
                  return (
                    <button
                      type="button"
                      key={product.id}
                      onClick={() => add(product)}
                      disabled={!product.available}
                      aria-label={product.available ? `Tambah ${product.name}` : `${product.name} habis`}
                      className={cn(
                        "relative min-w-0 rounded-2xl border border-white/[0.08] bg-[#1b2029] p-2.5 text-left transition hover:border-[#FDBD2C]/60 active:scale-[0.98] disabled:opacity-60",
                        qty > 0 ? "border-[#FDBD2C] bg-[#282321]" : "",
                      )}
                    >
                      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-[#232a35]">
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
                      <p className="mt-2 truncate px-1 text-[13px] font-medium leading-snug text-white">{product.name}</p>
                      <p className="mt-0.5 truncate px-1 text-xs text-neutral-400">{product.description || "Menu pilihan"}</p>
                      <p className="mt-1 px-1 pb-1 text-[13px] font-medium tabular-nums text-white">{formatCompactIDR(product.price)}</p>
                      {product.stockTracked && product.available && <p className="px-1 pb-1 text-xs tabular-nums text-neutral-400">{product.stockQuantity ?? 0} tersisa</p>}
                      <span aria-hidden="true" className="absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-full bg-[#FDBD2C] text-neutral-900 shadow-[0_6px_14px_rgba(253,189,44,0.2)]"><Plus size={18} strokeWidth={2.2} /></span>
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
        <aside className="sticky top-6 hidden max-h-[calc(100dvh-7.5rem)] overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#171c24] p-6 lg:block">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-medium tracking-tight text-white">Pesanan saat ini</h3>
            {cart.length > 0 && <button type="button" onClick={clearCart} className="flex items-center gap-2 text-[13px] text-neutral-400 transition hover:text-white"><Trash2 size={15} strokeWidth={1.8} />Hapus Semua</button>}
          </div>
          <p className="mt-1 text-[13px] text-neutral-400">
            {orderType === "dine_in" ? "Dine in" : "Takeaway"} · {paymentMethod === "cash" ? "Tunai" : "QRIS"}
          </p>
          <div className="mt-4">
            {cart.length ? (
              <div className="divide-y divide-white/[0.08]">
                {cart.map((item) => (
                  <div key={item.key} className="flex gap-3 py-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-[#232a35] text-lg font-medium text-neutral-400">
                      {item.product.imageUrl ? <img src={item.product.imageUrl} alt="" className="h-full w-full object-cover" /> : item.product.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-white">{item.product.name}</p>
                      <p className="mt-0.5 text-xs text-neutral-400">{[...item.variantLabels, ...item.addonLabels].join(" · ") || "Original"}</p>
                      <p className="mt-1 text-[13px] font-medium tabular-nums text-white">{formatCompactIDR(item.unitPrice * item.quantity)}</p>
                      <div className="mt-2">
                        <QtyStepper itemName={item.product.name} count={item.quantity} onMinus={() => setQty(item.key, -1)} onPlus={() => setQty(item.key, 1)} />
                      </div>
                    </div>
                    <button type="button" onClick={() => setQty(item.key, -item.quantity)} aria-label={`Hapus ${item.product.name}`} className="flex h-8 w-8 shrink-0 items-center justify-center text-neutral-400 active:text-white"><MoreVertical size={18} /></button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-10 text-[13px] text-neutral-500">Ketuk menu untuk mulai.</p>
            )}
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-white/[0.08] pt-5">
            <span className="text-[13px] text-neutral-400">Total <span className="text-neutral-500">({count} item)</span></span>
            <span className="text-lg font-medium tabular-nums text-white">{formatIDR(total)}</span>
          </div>
          <button
            type="button"
            disabled={!cart.length || saving}
            onClick={() => void createOrder()}
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#FDBD2C] text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
          >
            <ReceiptText size={17} strokeWidth={1.9} />
            {saving ? "Membuat…" : "Buat pembayaran"}
          </button>
        </aside>
      </div>

      {/* Cart — mobile bar */}
      {cart.length > 0 && !cartOpen && (
        <div className="fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-30 mx-auto max-w-[440px] px-4 lg:hidden">
                <button
                  type="button"
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
        <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/30 lg:hidden" onClick={() => setCartOpen(false)}>
            <section
            ref={cartDialogRef}
            tabIndex={-1}
            className="ord-sheet flex max-h-[88vh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[28px] bg-white"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cashier-cart-title"
            aria-label="Keranjang"
          >
            <div className="mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-neutral-200" />
            <div className="flex items-start justify-between px-5 pb-3 pt-2">
              <div>
                <p className="text-xs text-neutral-400">
                  Pesanan berjalan · {orderType === "dine_in" ? "Dine in" : "Takeaway"}
                </p>
                <h2 id="cashier-cart-title" className="mt-1 text-lg font-medium tabular-nums tracking-tight">
                  {count} item · {formatIDR(total)}
                </h2>
              </div>
              <button
                type="button"
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
                    <div key={item.key} className="flex items-center gap-3 py-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">{item.product.name}</p>
                        <p className="mt-0.5 truncate text-xs text-neutral-400">{[...item.variantLabels, ...item.addonLabels].join(" · ") || "Original"}</p>
                        <p className="mt-0.5 text-[13px] tabular-nums text-neutral-500">{formatCompactIDR(item.unitPrice * item.quantity)}</p>
                      </div>
                      <QtyStepper itemName={item.product.name} count={item.quantity} onMinus={() => setQty(item.key, -1)} onPlus={() => setQty(item.key, 1)} />
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
                type="button"
                disabled={!cart.length || saving}
                onClick={() => void createOrder()}
                className="h-[52px] w-full rounded-2xl bg-[#FDBD2C] text-[15px] font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
              >
                {saving ? "Membuat…" : `Buat pembayaran · ${formatCompactIDR(total)}`}
              </button>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={clearCart}
                  className="h-11 w-full rounded-full text-[13px] font-normal text-neutral-400 active:bg-neutral-50"
                >
                  Kosongkan
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {selectedProduct && (
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
          onClose={() => setSelectedProduct(null)}
          onAdd={addConfiguredProduct}
        />
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
  payment: { orderId: string; qrString?: string; qrImageUrl?: string; orderNumber: string; totalIdr: number; expiresAt: string };
  onClose: () => void;
  onSettled?: () => void;
}) {
  const [qr, setQr] = useState("");
  const [phase, setPhase] = useState<"pending" | "settled" | "expired" | "failed">("pending");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const settledRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, onClose);

  useEffect(() => {
    if (!payment.qrString) {
      setQr("");
      return;
    }
    QRCode.toDataURL(payment.qrString, { width: 320, margin: 2, color: { dark: "#18181B", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [payment.qrString]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remainingMs = new Date(payment.expiresAt).getTime() - now;
  const timedOut = remainingMs <= 0;

  useEffect(() => {
    if (settledRef.current || phase !== "pending" || timedOut) return;
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch(`/api/pos/orders/${payment.orderId}/payment`, { method: "POST", cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !payload) {
          setStatusMessage(payload?.error ?? "Status pembayaran belum dapat disinkronkan. Coba lagi.");
          return;
        }
        setStatusMessage(null);
        if (payload.paymentStatus === "settled") {
          settledRef.current = true;
          setPhase("settled");
          onSettled?.();
        } else if (payload.paymentStatus === "expired" || payload.paymentStatus === "failed") {
          setPhase(payload.paymentStatus);
        }
      } catch {
        if (!cancelled) setStatusMessage("Koneksi ke server pembayaran terputus. QR tetap aktif; sistem akan mencoba lagi.");
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
    <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#070a0f]/80 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="ord-sheet w-full max-w-[380px] rounded-t-[28px] border border-white/[0.12] bg-[#151a22] p-5 text-center text-white sm:rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cashier-payment-title"
      >
        <div className="flex items-start justify-between text-left">
          <div>
            <p id="cashier-payment-title" className="text-xs text-neutral-400">QRIS · {payment.orderNumber}</p>
            <p className="mt-3 text-3xl font-medium tabular-nums tracking-tight">{formatIDR(payment.totalIdr)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pembayaran"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#232a35] text-neutral-300 active:scale-95"
          >
            <X size={15} />
          </button>
        </div>

        <div className="shadow-soft mx-auto mt-8 w-fit rounded-3xl border border-white/[0.12] bg-white p-4">
          {state === "settled" ? (
            <p className="flex h-56 w-56 items-center justify-center px-6 text-center text-sm font-medium">Pembayaran lunas.</p>
          ) : state === "expired" ? (
            <p className="flex h-56 w-56 items-center justify-center px-6 text-center text-[13px] text-neutral-500">
              Kode kedaluwarsa. Buat pesanan baru.
            </p>
          ) : state === "failed" ? (
            <p className="flex h-56 w-56 items-center justify-center px-6 text-center text-[13px] text-neutral-500">Pembayaran gagal. Coba lagi.</p>
          ) : payment.qrImageUrl ? (
            <img src={payment.qrImageUrl} alt="QRIS pembayaran" width={224} height={224} decoding="async" className="h-56 w-56 rounded-2xl" />
          ) : qr ? (
            <img src={qr} alt="QRIS pembayaran" width={224} height={224} decoding="async" className="h-56 w-56 rounded-2xl" />
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
        {statusMessage && <p role="status" aria-live="polite" className="mt-2 text-[12px] leading-relaxed text-red-300">{statusMessage}</p>}
        <button
          type="button"
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
  const [from, setFrom] = useState(jakartaToday());
  const [to, setTo] = useState(jakartaToday());
  const [report, setReport] = useState<DailyReport | null>(initialReport);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setReport(initialReport);
  }, [initialReport]);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(`/api/reports/daily?from=${from}&to=${to}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      setReport(response.ok ? payload : null);
      if (!response.ok) onShowNotice(payload?.error ?? "Laporan gagal dimuat.");
    } catch {
      setReport(null);
      onShowNotice("Koneksi terputus. Coba muat laporan lagi.");
    } finally {
      setLoading(false);
    }
  }

  function applyPreset(key: "Today" | "Yesterday" | "Last 7 days") {
    const today = jakartaToday();
    if (key === "Today") {
      setFrom(today);
      setTo(today);
      return;
    }
    const date = new Date(`${today}T12:00:00+07:00`);
    date.setDate(date.getDate() - (key === "Yesterday" ? 1 : 6));
    const value = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(date);
    setFrom(value);
    setTo(key === "Yesterday" ? value : today);
  }

  const today = jakartaToday();
  const todaySelected = from === today && to === today;

  return (
    <div>
      <PageHead
        title="Laporan"
        sub="Hari bisnis Jakarta · pembayaran lunas"
        action={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {([{ key: "Today", label: "Hari ini" }, { key: "Yesterday", label: "Kemarin" }, { key: "Last 7 days", label: "7 hari" }] as const).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key)}
                  className={cn(
                    "h-11 rounded-full border px-4 text-[13px] transition active:scale-[0.98]",
                    key === "Today" && todaySelected ? "border-[#FDBD2C] bg-[#FDBD2C]/10 font-medium text-[#FDBD2C]" : "border-white/[0.1] bg-[#1b2029] text-neutral-300 hover:bg-white/5",
                  )}
                >
                  {label}
                </button>
              ))}
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-white/[0.08] bg-[#232a35] px-3 sm:flex-none">
                <CalendarDays size={15} strokeWidth={1.7} className="shrink-0 text-neutral-300" />
                <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="Tanggal mulai laporan" className="min-w-0 flex-1 bg-transparent px-1 text-[12px] text-white outline-none [color-scheme:dark] sm:w-[104px] sm:flex-none" />
                <ArrowRight size={14} strokeWidth={1.7} className="shrink-0 text-neutral-400" />
                <input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="Tanggal akhir laporan" className="min-w-0 flex-1 bg-transparent px-1 text-[12px] text-white outline-none [color-scheme:dark] sm:w-[104px] sm:flex-none" />
                <CalendarDays size={15} strokeWidth={1.7} className="shrink-0 text-neutral-300" />
              </div>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="flex h-11 items-center justify-center rounded-full bg-[#FDBD2C] px-5 text-[13px] font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? "Memuat…" : "Muat"}
              </button>
            </div>
            <a
              href={`/api/reports/daily.pdf?from=${from}&to=${to}`}
              className="flex h-11 items-center justify-center gap-2 rounded-full border border-white/[0.12] px-4 text-[13px] text-neutral-300 transition hover:bg-white/5 active:scale-[0.98]"
            >
              <Download size={15} strokeWidth={1.8} />
              Unduh PDF
            </a>
          </div>
        }
      />

      {report ? (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <ReportMetric icon={<TrendingUp size={22} strokeWidth={1.8} />} tone="green" label="Penjualan bersih" value={formatCompactIDR(report.netRevenueIdr)} detail={`${report.orderCount} pesanan lunas`} />
            <ReportMetric icon={<CircleDollarSign size={22} strokeWidth={1.8} />} tone="blue" label="Penjualan kotor" value={formatCompactIDR(report.grossRevenueIdr)} detail="Settlement periode ini" />
            <ReportMetric icon={<RefreshCw size={22} strokeWidth={1.8} />} tone="orange" label="Refund" value={formatCompactIDR(report.refundsIdr)} detail="Diproses periode ini" />
            <ReportMetric icon={<BarChart3 size={22} strokeWidth={1.8} />} tone="purple" label="Est. laba" value={formatCompactIDR(report.estimatedGrossProfitIdr)} detail="Bukan laba bersih" />
          </div>

          <section className="mt-6 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1b2029]">
            <div className="px-5 pb-4 pt-5 sm:px-6">
              <h3 className="text-base font-medium text-white">Rincian Laporan</h3>
              <p className="mt-1 text-[13px] text-neutral-400">Berdasarkan sumber penjualan</p>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_24px] gap-4 bg-white/[0.04] px-5 py-3 text-[13px] text-neutral-300 sm:px-6">
              <span>Komposisi</span>
              <span>Total</span>
              <span aria-hidden="true" />
            </div>
            <div className="divide-y divide-white/[0.08]">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_24px] items-center gap-4 px-5 py-3.5 sm:px-6">
                <div className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white"><ShoppingBag size={15} strokeWidth={1.8} /></span><span className="truncate text-[14px] font-medium text-white">Dine in</span></div>
                <span className="text-[13px] font-medium tabular-nums text-white">{formatCompactIDR(report.dineInRevenueIdr)}</span>
                <ChevronRight size={17} strokeWidth={1.7} className="text-neutral-300" />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_24px] items-center gap-4 px-5 py-3.5 sm:px-6">
                <div className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Store size={15} strokeWidth={1.8} /></span><span className="truncate text-[14px] font-medium text-white">Takeaway</span></div>
                <span className="text-[13px] font-medium tabular-nums text-white">{formatCompactIDR(report.takeawayRevenueIdr)}</span>
                <ChevronRight size={17} strokeWidth={1.7} className="text-neutral-300" />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_24px] items-center gap-4 px-5 py-3.5 sm:px-6">
                <div className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white"><BarChart3 size={15} strokeWidth={1.8} /></span><span className="truncate text-[14px] font-medium text-white">Rata-rata</span></div>
                <span className="text-[13px] font-medium tabular-nums text-white">{formatCompactIDR(report.averageOrderValueIdr)}</span>
                <ChevronRight size={17} strokeWidth={1.7} className="text-neutral-300" />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_24px] items-center gap-4 px-5 py-3.5 sm:px-6">
                <div className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-500 text-white"><Percent size={15} strokeWidth={1.8} /></span><span className="truncate text-[14px] font-medium text-white">Est. COGS · fee</span></div>
                <span className="text-right text-[13px] font-medium tabular-nums text-white">{formatCompactIDR(report.estimatedCogsIdr)} · {formatCompactIDR(report.paymentFeesIdr)}</span>
                <ChevronRight size={17} strokeWidth={1.7} className="text-neutral-300" />
              </div>
            </div>
          </section>

          {report.dailyBreakdown.length > 1 && <section className="mt-6 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1b2029]"><div className="px-5 pb-4 pt-5 sm:px-6"><h3 className="text-base font-medium text-white">Per hari</h3><p className="mt-1 text-[13px] text-neutral-400">Ringkasan settlement per tanggal</p></div><div className="divide-y divide-white/[0.08]">{report.dailyBreakdown.map((day) => <div key={day.date} className="flex items-center justify-between gap-3 px-5 py-3.5 sm:px-6"><div><p className="text-[13px] font-medium text-white">{day.date}</p><p className="mt-0.5 text-xs text-neutral-400">{day.paidOrderCount} pesanan · refund {formatCompactIDR(day.refundsIdr)}</p></div><span className="text-[13px] font-medium tabular-nums text-white">{formatCompactIDR(day.netRevenueIdr)}</span></div>)}</div></section>}

          <section className="mt-6 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1b2029]">
            <div className="px-5 pb-4 pt-5 sm:px-6">
              <h3 className="text-base font-medium text-white">Transaksi Terlaris</h3>
              <p className="mt-1 text-[13px] text-neutral-400">Produk dengan penjualan terbanyak pada periode ini</p>
            </div>
            {report.bestSellers.length ? (
              <div className="divide-y divide-white/[0.08]">
                {report.bestSellers.map((item) => (
                  <div key={item.name} className="flex items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-white">{item.name}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-neutral-400">{item.quantity} porsi</p>
                    </div>
                    <span className="shrink-0 text-[13px] font-medium tabular-nums text-white">{formatCompactIDR(item.revenueIdr)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[180px] flex-col items-center justify-center px-5 pb-8 text-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-neutral-300"><PackageOpen size={27} strokeWidth={1.6} /></span>
                <p className="mt-4 text-[15px] font-medium text-white">Belum ada penjualan lunas.</p>
                <p className="mt-1 text-[13px] text-neutral-400">Data akan muncul setelah ada transaksi yang selesai.</p>
              </div>
            )}
          </section>

          <section className="mt-6 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1b2029]">
            <div className="px-5 pb-4 pt-5 sm:px-6">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-base font-medium text-white">Pesanan lunas</h3>
                <span className="text-xs text-neutral-400">{report.orders.length} baris</span>
              </div>
              <p className="text-[13px] text-neutral-400">Transaksi yang masuk ke settlement periode ini</p>
            </div>
            {report.orders.length ? (
              <div className="divide-y divide-white/[0.08]">
                {report.orders
                  .slice(-12)
                  .reverse()
                  .map((item) => (
                    <div key={item.orderNumber} className="flex items-center justify-between gap-3 px-5 py-3.5 sm:px-6">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-white">{item.orderNumber}</p>
                        <p className="mt-0.5 text-xs text-neutral-400">
                          {item.type === "dine_in" ? "Dine in" : "Takeaway"} ·{" "}
                          {new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(
                            new Date(item.settledAt),
                          )}
                        </p>
                      </div>
                      <span className="shrink-0 text-[13px] font-medium tabular-nums text-white">{formatCompactIDR(item.totalIdr)}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="px-5 pb-8 text-[13px] text-neutral-400 sm:px-6">Belum ada pesanan lunas pada periode ini.</p>
            )}
          </section>
        </>
      ) : (
        <div className="mt-6 rounded-2xl border border-white/[0.08] bg-[#1b2029] px-5 py-14 text-center">
          {loading ? (
            <p className="text-[13px] text-neutral-400">Memuat laporan…</p>
          ) : (
            <>
              <p className="text-sm font-medium text-white">Tidak ada data tanggal ini.</p>
              <p className="mt-1 text-[13px] text-neutral-400">Pilih tanggal lain lalu tekan Muat.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ================= Helpers ================= */

function jakartaToday() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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
