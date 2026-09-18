"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import {
  Banknote,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Download,
  Flame,
  LayoutDashboard,
  Loader2,
  Menu as MenuIcon,
  Minus,
  Package,
  Plus,
  QrCode,
  ReceiptText,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  Trash2,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
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
    window.setTimeout(() => setNotice(null), 2800);
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
      if (!silent && (!ordersResponse.ok || !reportResponse.ok)) showNotice("Sebagian data live gagal dimuat.");
    } catch {
      if (!silent) showNotice("Koneksi terputus. Coba muat ulang workspace.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadOperations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const hasActive = orders.some((order) => order.status !== "Completed");

  // Silent refresh while there is kitchen activity, so Midtrans webhook
  // settlements (paid → New) surface without a manual reload.
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
      // Unpaid (awaiting_payment) orders have no valid kitchen transition —
      // explain it instead of surfacing the raw 409.
      if (response.status === 409 && order.paymentStatus !== "Paid") {
        showNotice(`Pesanan ${order.number} belum lunas, tidak bisa dimasak.`);
        return;
      }
      showNotice(payload?.error ?? "Status pesanan gagal diperbarui.");
      return;
    }
    await loadOperations();
    showNotice("Status pesanan diperbarui.");
  }

  // Kitchen gate: unpaid QRIS must be explicitly confirmed before cooking,
  // so an expired/ditolak QR never slips into the queue by accident.
  function advanceOrderGuarded(order: Order) {
    if (order.paymentStatus !== "Paid" && order.status !== "Completed") {
      if (!window.confirm(`Pesanan ${order.number} belum lunas. Tetap lanjutkan ke dapur?`)) return;
    }
    void advanceOrder(order);
  }

  return (
    <div className="min-h-screen bg-[#FAF8F5] text-[#18181B] antialiased selection:bg-[#FF381E] selection:text-white lg:flex">
      {/* ---------- Desktop dark sidebar ---------- */}
      <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col bg-[#18181B] px-4 py-5 text-white lg:flex">
        <BrandMark />
        <p className="mt-8 px-3 text-xs font-bold uppercase tracking-wider text-stone-400">Workspace</p>
        <nav className="mt-2 space-y-1">
          {(Object.keys(NAV_LABEL) as NavItem[]).map((item) => (
            <NavButton key={item} item={item} active={nav === item} onClick={setNav} badge={item === "Orders" ? activeCount : 0} />
          ))}
          <TableQrLink />
        </nav>
        <div className="mt-auto space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute h-full w-full animate-ping rounded-full bg-[#FF381E] opacity-60" />
                <span className="h-2 w-2 rounded-full bg-[#FF381E]" />
              </span>
              <span className="text-[13px] font-bold">{activeCount} pesanan aktif</span>
            </div>
            <p className="mt-1.5 text-[13px] font-semibold leading-relaxed text-stone-400">Data live dari Supabase.</p>
          </div>
          <div className="flex items-center gap-3 border-t border-white/10 px-1 pt-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FF381E] text-[13px] font-black text-white">RA</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold">Rafi Aditya</p>
              <p className="text-[13px] font-semibold text-stone-400">Administrator</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* ---------- Mobile top bar ---------- */}
        <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#FAF8F5]/90 px-4 pb-2 pt-3 backdrop-blur-md lg:hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#18181B]">
                <Flame size={14} className="fill-[#FF381E] text-[#FF381E]" />
              </span>
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-[#18181B]">Tempat Taichan</p>
                <p className="flex items-center gap-1 text-[13px] font-semibold text-stone-600">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF381E]" />
                  {activeCount} aktif · {date}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void loadOperations()}
                aria-label="Muat ulang"
                className="pos-press flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 shadow-xs"
              >
                <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              </button>
              <button
                onClick={() => setNav("POS")}
                className="pos-press flex h-9 items-center gap-1.5 rounded-xl bg-[#FF381E] px-3 text-[13px] font-bold text-white shadow-md"
              >
                <Plus size={15} /> Baru
              </button>
            </div>
          </div>
        </header>

        {/* ---------- Desktop top bar ---------- */}
        <header className="sticky top-0 z-30 hidden items-center justify-between border-b border-stone-200/80 bg-[#FAF8F5]/90 px-8 py-4 backdrop-blur-md lg:flex">
          <div className="min-w-0">
            <p className="text-[13px] font-bold uppercase tracking-wider text-stone-600">
              {formatLongDate(date)} · Waktu Jakarta
            </p>
            <h1 className="mt-0.5 truncate text-2xl font-extrabold tracking-normal text-[#18181B]">
              {nav === "Overview" ? jakartaGreeting() : NAV_LABEL[nav]}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => void loadOperations()}
              className="pos-press flex h-10 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 text-[13px] font-bold text-stone-600 shadow-xs"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              Muat ulang
            </button>
            <button
              onClick={() => setNav("POS")}
              className="pos-press flex h-10 items-center gap-2 rounded-xl bg-[#FF381E] px-4 text-[13px] font-bold text-white shadow-md hover:bg-[#e03018]"
            >
              <Plus size={15} /> Pesanan baru
            </button>
          </div>
        </header>

        {/* ---------- Content ---------- */}
        <main className="mx-auto max-w-[1440px] px-4 pb-32 pt-5 sm:px-6 lg:px-8 lg:pb-16 lg:pt-7">
          <div key={nav} className="pos-fade">
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

      {/* ---------- Mobile bottom tab bar ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#18181B]/95 px-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md lg:hidden">
        <div className="mx-auto grid max-w-[440px] grid-cols-5 gap-1">
          {(Object.keys(NAV_LABEL) as NavItem[]).map((item) => (
            <MobileTab key={item} item={item} active={nav === item} onClick={setNav} badge={item === "Orders" ? activeCount : 0} />
          ))}
        </div>
      </nav>

      {/* ---------- Toast ---------- */}
      {notice && (
        <div className="pos-toast fixed bottom-24 left-1/2 z-[60] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full bg-[#18181B] px-4 py-3 text-[13px] font-bold text-white shadow-2xl lg:bottom-8">
          <CheckCircle2 size={15} className="shrink-0 text-emerald-400" />
          <span className="truncate">{notice}</span>
        </div>
      )}
    </div>
  );
}

/* ================= Shell bits ================= */

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FF381E]">
        <Flame size={18} className="fill-white text-white" />
      </span>
      <div>
        <p className="text-[13px] font-extrabold tracking-normal text-white">Tempat Taichan</p>
        <p className="text-xs font-bold uppercase tracking-wide text-stone-400">Operator desk</p>
      </div>
    </div>
  );
}

const NAV_ICON: Record<NavItem, typeof LayoutDashboard> = {
  Overview: LayoutDashboard,
  Orders: ClipboardList,
  POS: ShoppingBag,
  Menu: MenuIcon,
  Reports: TrendingUp,
};

function NavButton({ item, active, onClick, badge = 0 }: { item: NavItem; active: boolean; onClick: (item: NavItem) => void; badge?: number }) {
  const Icon = NAV_ICON[item];
  return (
    <button
      onClick={() => onClick(item)}
      className={cn(
        "pos-press flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px]",
        active ? "bg-[#FF381E]/15 font-bold text-white" : "font-semibold text-stone-400 hover:bg-white/5 hover:text-stone-200",
      )}
    >
      <Icon size={17} className={active ? "text-[#FF381E]" : ""} />
      <span className="flex-1">{NAV_LABEL[item]}</span>
      {badge > 0 && (
        <span key={badge} className="pos-pop rounded-full bg-[#FF381E] px-1.5 py-0.5 text-[13px] font-black text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

function MobileTab({ item, active, onClick, badge = 0 }: { item: NavItem; active: boolean; onClick: (item: NavItem) => void; badge?: number }) {
  const Icon = NAV_ICON[item];
  return (
    <button onClick={() => onClick(item)} className="relative flex flex-col items-center gap-1 rounded-xl px-1 py-1.5">
      <span className={cn("pos-press relative flex h-8 w-12 items-center justify-center rounded-full", active ? "bg-[#FF381E]/20" : "")}>
        <Icon size={19} className={active ? "text-[#FF381E]" : "text-stone-400"} strokeWidth={active ? 2.5 : 2} />
        {badge > 0 && (
          <span
            key={badge}
            className="pos-pop absolute -right-0.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-[#18181B] bg-[#FF381E] px-0.5 text-[11px] font-black text-white"
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </span>
      <span className={cn("text-[13px]", active ? "font-bold text-white" : "font-semibold text-stone-400")}>{NAV_LABEL[item]}</span>
      {active && <span className="absolute -top-2 h-1 w-8 rounded-full bg-[#FF381E]" />}
    </button>
  );
}

function TableQrLink() {
  return (
    <a
      href="/admin/tables"
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold text-stone-400 hover:bg-white/5 hover:text-stone-200"
    >
      <QrCode size={17} />
      <span className="flex-1">QR Meja</span>
    </a>
  );
}

function SectionHead({ eyebrow, title, sub, action }: { eyebrow: string; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div>
        <p className="text-[13px] font-bold uppercase tracking-wider text-stone-600">{eyebrow}</p>
        <h2 className="mt-1.5 text-2xl font-extrabold tracking-normal text-[#18181B] sm:text-[28px]">{title}</h2>
        {sub && <p className="mt-1 text-[13px] font-semibold leading-relaxed text-stone-600">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/* ================= Shared atoms ================= */

function Metric({
  label,
  value,
  detail,
  icon,
  accent,
  index = 0,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  accent: string;
  index?: number;
}) {
  return (
    <div
      className="pos-rise pos-lift rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs"
      style={{ "--d": `${index * 70}ms` } as CSSProperties}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold uppercase tracking-wider text-stone-600">{label}</span>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-[9px]", accent)}>{icon}</span>
      </div>
      <p className="mt-4 text-[26px] font-extrabold tracking-normal text-[#18181B]">{value}</p>
      <p className="mt-1 text-[13px] font-semibold text-stone-600">{detail}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: Order["status"] }) {
  const styles: Record<Order["status"], string> = {
    New: "bg-[#FF381E]/10 text-[#FF381E]",
    Preparing: "bg-amber-500/10 text-amber-600",
    Ready: "bg-emerald-600/10 text-emerald-600",
    Completed: "bg-stone-500/10 text-stone-600",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-extrabold uppercase tracking-wider", styles[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Bar({ value, className }: { value: number; className?: string }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidth(value));
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-stone-100">
      <div className={cn("pos-grow h-full rounded-full", className ?? "bg-[#FF381E]")} style={{ width: `${Math.min(100, Math.max(0, width))}%` }} />
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-14 text-[13px] font-semibold text-stone-600">
      <Loader2 size={15} className="animate-spin text-[#FF381E]" /> {label}
    </div>
  );
}

function EmptyBlock({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-stone-100 text-stone-600">{icon}</div>
      <p className="mt-3 text-sm font-bold text-[#18181B]">{title}</p>
      <p className="mt-1 text-[13px] font-semibold text-stone-600">{sub}</p>
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
  const maxSeller = Math.max(1, ...(summary?.bestSellers.slice(0, 5).map((item) => item.quantity) ?? [1]));

  return (
    <div className="space-y-5 lg:space-y-6">
      <SectionHead
        eyebrow={`Live · ${summary?.date ?? "Memuat"}`}
        title="Hari ini sekilas."
        sub="Angka operasional untuk hari bisnis Jakarta."
        action={
          <a
            href={`/api/reports/daily.pdf?date=${summary?.date ?? jakartaToday()}`}
            className="pos-press flex h-10 items-center justify-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 text-[13px] font-bold text-stone-600 shadow-xs"
          >
            <Download size={15} /> PDF Harian
          </a>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Pendapatan kotor"
          value={summary ? formatCompactIDR(summary.revenueIdr) : "—"}
          detail="Hanya pembayaran lunas"
          accent="bg-[#FF381E]/10 text-[#FF381E]"
          icon={<Wallet size={17} />}
          index={0}
        />
        <Metric
          label="Pesanan lunas"
          value={summary ? String(summary.orderCount) : "—"}
          detail="Terkonfirmasi pembayaran"
          accent="bg-emerald-600/10 text-emerald-600"
          icon={<ClipboardList size={17} />}
          index={1}
        />
        <Metric
          label="Estimasi laba kotor"
          value={summary ? formatCompactIDR(summary.estimatedGrossProfitIdr) : "—"}
          detail="Pendapatan − COGS − fee"
          accent="bg-violet-600/10 text-violet-600"
          icon={<TrendingUp size={17} />}
          index={2}
        />
        <Metric
          label="Rata-rata order"
          value={summary ? formatCompactIDR(summary.averageOrderValueIdr) : "—"}
          detail="Dine in + takeaway"
          accent="bg-sky-600/10 text-sky-600"
          icon={<Store size={17} />}
          index={3}
        />
      </div>

      <div className="grid gap-4 lg:gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.8fr)]">
        {/* Attention queue */}
        <section className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-xs">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3.5 sm:px-5">
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-[#18181B]">Perlu tindakan</h3>
              <p className="mt-0.5 text-[13px] font-semibold text-stone-600">Ketuk pesanan untuk memajukan status</p>
            </div>
            <button onClick={onOpenOrders} className="pos-press flex items-center gap-0.5 text-[13px] font-bold text-[#FF381E]">
              Semua <ChevronRight size={14} />
            </button>
          </div>
          {loading ? (
            <LoadingBlock label="Memuat pesanan…" />
          ) : active.length ? (
            <div className="divide-y divide-stone-100">
              {active.slice(0, 5).map((order, i) => (
                <div
                  key={order.id}
                  className="pos-rise flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
                  style={{ "--d": `${i * 60}ms` } as CSSProperties}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={cn("h-9 w-1 shrink-0 rounded-full", order.status === "New" ? "animate-pulse bg-[#FF381E]" : "bg-stone-200")} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-[#18181B]">{order.number}</p>
                        <StatusBadge status={order.status} />
                        {order.paymentStatus !== "Paid" && order.status !== "Completed" && (
                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-extrabold uppercase tracking-wider text-amber-600">
                            Belum bayar
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-[13px] font-semibold text-stone-600">
                        {order.type}
                        {order.table ? ` · ${order.table}` : ""} · {order.items} item · {order.time}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 pl-4 sm:justify-end sm:pl-0">
                    <span className="text-sm font-extrabold tracking-normal">{formatCompactIDR(order.total)}</span>
                    <button
                      onClick={() => onAdvance(order)}
                      className="pos-press rounded-lg bg-[#18181B] px-3 py-2 text-[13px] font-bold text-white hover:bg-[#FF381E]"
                    >
                      {order.status === "New" ? "Mulai masak" : order.status === "Preparing" ? "Tandai siap" : "Selesaikan"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock icon={<ClipboardList size={18} />} title="Tidak ada pesanan aktif." sub="Pesanan lunas baru akan muncul di sini." />
          )}
        </section>

        {/* Best sellers */}
        <section className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs sm:p-5">
          <h3 className="text-sm font-black uppercase tracking-wider text-[#18181B]">Terlaris</h3>
          <p className="mt-0.5 text-[13px] font-semibold text-stone-600">Porsi lunas hari ini</p>
          {summary?.bestSellers.length ? (
            <div className="mt-4 space-y-4">
              {summary.bestSellers.slice(0, 5).map((item, index) => (
                <div key={item.name}>
                  <div className="flex items-center gap-3">
                    <span className="w-5 shrink-0 text-[13px] font-bold text-stone-600">{String(index + 1).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-[#18181B]">{item.name}</p>
                      <p className="mt-0.5 text-[13px] font-semibold text-stone-600">{item.quantity} porsi</p>
                    </div>
                    <span className="shrink-0 text-[13px] font-black">{formatCompactIDR(item.revenueIdr)}</span>
                  </div>
                  <div className="ml-8 mt-2">
                    <Bar value={(item.quantity / maxSeller) * 100} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-[13px] font-semibold text-stone-600">Belum ada penjualan lunas periode ini.</p>
          )}
        </section>
      </div>

      {/* Daily close */}
      <div className="pos-rise overflow-hidden rounded-2xl bg-[#18181B] p-5 text-white shadow-xl sm:p-6" style={{ "--d": "120ms" } as CSSProperties}>
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-start gap-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FF381E]/15">
              <ReceiptText size={18} className="text-[#FF381E]" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-stone-600">Tutup kasir</p>
              <h3 className="mt-1 text-xl font-extrabold tracking-normal">Siap tutup counter?</h3>
              <p className="mt-1 text-[13px] font-semibold leading-relaxed text-stone-600">
                Unduh PDF setelah memastikan pembayaran dan status terakhir.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              if (window.confirm("Unduh laporan harian Jakarta setelah memeriksa pesanan dan pembayaran pending?"))
                window.location.href = `/api/reports/daily.pdf?date=${summary?.date ?? jakartaToday()}`;
            }}
            className="pos-press flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 text-[13px] font-bold text-[#18181B] hover:bg-[#FF381E] hover:text-white"
          >
            <Download size={15} /> Tutup & unduh PDF
          </button>
        </div>
      </div>
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
  const [detailLoading, setDetailLoading] = useState(false);

  const counts = FILTERS.map(({ key }) => ({ key, n: key === "All" ? orders.length : orders.filter((o) => o.status === key).length }));
  const filtered = orders.filter(
    (order) =>
      (filter === "All" || order.status === filter) && `${order.number} ${order.table ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );

  async function openDetail(order: Order) {
    setDetailId(order.id);
    setDetailLoading(true);
    const response = await fetch(`/api/pos/orders/${order.id}`, { cache: "no-store" });
    const payload = await response.json();
    setDetail(response.ok ? payload : null);
    setDetailLoading(false);
    if (!response.ok) onShowNotice(payload.error ?? "Detail pesanan tidak tersedia.");
  }

  // Refresh the open drawer silently (post-settlement state) without
  // flashing the full-page loader.
  async function refreshDetail(orderId: string) {
    const response = await fetch(`/api/pos/orders/${orderId}`, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload) setDetail(payload);
  }

  return (
    <div className="space-y-5">
      <SectionHead
        eyebrow="Operasional / Pesanan"
        title="Pesanan live"
        sub={`${filtered.length} pesanan · hari bisnis Jakarta.`}
        action={
          <a
            href={`/api/reports/daily.pdf?date=${jakartaToday()}`}
            className="pos-press hidden h-10 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3.5 text-[13px] font-bold text-stone-600 shadow-xs sm:flex"
          >
            <Download size={15} /> PDF Harian
          </a>
        }
      />

      {/* Search */}
      <div className="relative">
        <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-600" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari nomor atau meja…"
          className="h-11 w-full rounded-xl border border-stone-200 bg-white pl-10 pr-10 text-sm font-semibold text-[#18181B] shadow-xs outline-none placeholder:text-stone-400 focus:border-transparent focus:ring-2 focus:ring-[#FF381E]"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            aria-label="Hapus pencarian"
            className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-stone-100 text-stone-600"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Filter rail */}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {FILTERS.map(({ key, label }) => {
          const n = counts.find((c) => c.key === key)?.n ?? 0;
          const isActive = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "pos-press flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-[13px] tracking-normal",
                isActive
                  ? "bg-[#18181B] font-bold text-white shadow-sm"
                  : "border border-stone-200 bg-white font-semibold text-stone-600",
              )}
            >
              {label}
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[13px] font-black",
                  isActive ? "bg-[#FF381E] text-white" : "bg-stone-100 text-stone-600",
                )}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {/* List — table header uses eyebrow token */}
      <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-xs">
        <div className="hidden grid-cols-[1.7fr_1fr_0.6fr_0.9fr_1fr] gap-4 border-b border-stone-100 bg-stone-50/60 px-5 py-3 text-[13px] font-bold uppercase tracking-wider text-stone-600 md:grid">
          <span>Pesanan</span>
          <span>Tipe</span>
          <span>Item</span>
          <span>Total</span>
          <span className="text-right">Status</span>
        </div>
        {loading ? (
          <LoadingBlock label="Memuat pesanan…" />
        ) : filtered.length ? (
          <div className="divide-y divide-stone-100">
            {filtered.map((order, i) => (
              <button
                key={order.id}
                onClick={() => void openDetail(order)}
                className="pos-rise grid w-full gap-2 px-4 py-3.5 text-left transition-colors hover:bg-stone-50 sm:px-5 md:grid-cols-[1.7fr_1fr_0.6fr_0.9fr_1fr] md:items-center md:gap-4"
                style={{ "--d": `${Math.min(i, 8) * 40}ms` } as CSSProperties}
              >
                <div className="flex items-center justify-between gap-2 md:block">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-[#18181B]">
                    {order.number}
                    {order.paymentStatus !== "Paid" && order.status !== "Completed" && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-extrabold uppercase tracking-wider text-amber-600">
                        Belum bayar
                      </span>
                    )}
                  </p>
                  <p className="text-[13px] font-semibold text-stone-600 md:mt-1">Hari ini · {order.time}</p>
                </div>
                <p className="hidden text-[13px] font-semibold text-stone-600 md:block">
                  {order.type}
                  {order.table && <span className="mt-0.5 block text-[13px] font-semibold text-stone-600">{order.table}</span>}
                </p>
                <p className="hidden text-[13px] font-semibold tabular-nums text-stone-600 md:block">{order.items}</p>
                <p className="text-[13px] font-black tabular-nums tracking-normal text-[#18181B] md:block">{formatCompactIDR(order.total)}</p>
                <div className="flex items-center justify-between gap-2 md:justify-end">
                  <span className="text-[13px] font-semibold text-stone-600 md:hidden">
                    {order.type}
                    {order.table ? ` · ${order.table}` : ""} · {order.items} item
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={order.status} />
                    {order.status !== "Completed" && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAdvance(order);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.stopPropagation();
                            onAdvance(order);
                          }
                        }}
                        className="pos-press rounded-lg bg-[#FF381E]/10 px-2.5 py-1.5 text-[13px] font-bold text-[#FF381E]"
                      >
                        Lanjut
                      </span>
                    )}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyBlock
            icon={<ClipboardList size={18} />}
            title="Tidak ada pesanan cocok."
            sub="Pesanan customer dan kasir yang lunas akan muncul di sini."
          />
        )}
      </div>

      {detailLoading &&
        createPortal(
          <div className="pos-backdrop fixed inset-0 z-50 flex items-center justify-center bg-[#18181B]/20">
            <div className="rounded-full bg-white p-4 shadow-xl">
              <Loader2 className="animate-spin text-[#FF381E]" size={20} />
            </div>
          </div>,
          document.body,
        )}
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
            // Cashier confirmed "Lunas" in the QR modal: refresh list + drawer
            // so the order flips to paid/New without a manual reload.
            await onRefresh();
            await refreshDetail(orderId);
          }}
        />
      )}
    </div>
  );
}

const ORDER_STEPS = ["Diterima", "Dimasak", "Siap", "Selesai"];

function rawStepIndex(status: string) {
  if (["paid", "accepted", "awaiting_payment"].includes(status)) return 0;
  if (status === "processing") return 1;
  if (status === "ready") return 2;
  if (status === "completed") return 3;
  return -1;
}

function rawStatusBadge(status: string): { label: string; className: string } {
  if (["paid", "accepted", "awaiting_payment"].includes(status)) return { label: "Baru", className: "bg-[#FF381E]/10 text-[#FF381E]" };
  if (status === "processing") return { label: "Dimasak", className: "bg-amber-500/10 text-amber-600" };
  if (status === "ready") return { label: "Siap", className: "bg-emerald-600/10 text-emerald-600" };
  if (status === "completed") return { label: "Selesai", className: "bg-stone-500/10 text-stone-600" };
  return { label: "Batal", className: "bg-rose-500/10 text-rose-600" };
}

function nextActionLabel(status: string) {
  if (["paid", "accepted", "awaiting_payment"].includes(status)) return "Mulai masak";
  if (status === "processing") return "Tandai siap";
  if (status === "ready") return "Selesaikan pesanan";
  if (status === "completed") return "Pesanan selesai";
  return "Pesanan dibatalkan";
}

function payMethodLabel(method?: string) {
  if (!method) return "—";
  if (method.toLowerCase() === "qris") return "QRIS";
  if (["cash", "tunai"].includes(method.toLowerCase())) return "Tunai";
  return method.toUpperCase();
}

function payStateInfo(status?: string): { label: string; className: string; dot: string } {
  if (status === "settled") return { label: "Lunas", className: "bg-emerald-600/10 text-emerald-600", dot: "bg-emerald-500" };
  if (status === "pending") return { label: "Menunggu", className: "bg-amber-500/10 text-amber-600", dot: "bg-amber-500" };
  if (status === "expired") return { label: "Kedaluwarsa", className: "bg-stone-500/10 text-stone-600", dot: "bg-stone-400" };
  if (status === "failed") return { label: "Gagal", className: "bg-rose-500/10 text-rose-600", dot: "bg-rose-500" };
  if (status === "refunded") return { label: "Refund", className: "bg-stone-500/10 text-stone-600", dot: "bg-stone-400" };
  if (status === "partially_refunded") return { label: "Refund parsial", className: "bg-stone-500/10 text-stone-600", dot: "bg-stone-400" };
  if (status) return { label: status.replace(/_/g, " "), className: "bg-stone-500/10 text-stone-600", dot: "bg-stone-400" };
  return { label: "—", className: "bg-stone-500/10 text-stone-600", dot: "bg-stone-300" };
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
  const statusBadge = rawStatusBadge(detail.order.status);
  const step = rawStepIndex(detail.order.status);
  const payLabel = payMethodLabel(payment?.method);
  const payState = payStateInfo(payment?.status);
  const actionLabel = nextActionLabel(detail.order.status);
  const showSubtotal = detail.order.subtotal_idr !== detail.order.total_idr;
  const PayIcon = (payment?.method ?? "").toLowerCase() === "cash" ? Banknote : payLabel === "QRIS" ? QrCode : Wallet;
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
        onShowNotice(`${detail.order.order_number} lunas — siap dimasak.`);
        onSettled?.(detailId);
      } else if (payload.paymentStatus === "expired") {
        onShowNotice("QRIS kedaluwarsa. Tampilkan ulang kode atau buat pesanan baru.");
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
        onShowNotice(payload?.error ?? "QR belum bisa ditampilkan ulang.");
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
    // Live countdown for the Midtrans QR window (1s tick).
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      window.clearInterval(timer);
    };
  }, [onClose]);

  return createPortal(
    <div className="pos-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#18181B]/30 sm:items-stretch sm:justify-end" onClick={onClose}>
      <aside
        className="pos-panel flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[20px] bg-[#FAF8F5] shadow-2xl sm:max-h-none sm:h-full sm:w-full sm:max-w-[460px] sm:rounded-none sm:border-l sm:border-stone-200"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Detail pesanan ${detail.order.order_number}`}
      >
        {/* Grabber (mobile sheet affordance) */}
        <div className="bg-white pt-2.5 sm:hidden">
          <div className="mx-auto h-1 w-10 rounded-full bg-stone-300" />
        </div>

        {/* Header: eyebrow + title per DESIGN.md sheet tokens */}
        <div className="border-b border-stone-200/80 bg-white px-5 pb-4 pt-2 sm:pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13px] font-bold uppercase tracking-wider text-stone-600">Detail pesanan</p>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-extrabold uppercase tracking-wider", statusBadge.className)}>
                  {statusBadge.label}
                </span>
              </div>
              <h2 className="mt-1 truncate text-2xl font-extrabold tracking-normal text-[#18181B] tabular-nums">{detail.order.order_number}</h2>
              <p className="mt-0.5 text-[13px] font-semibold text-stone-600">
                {formatCreatedAt(detail.order.created_at)} · {totalItems} porsi · {detail.items.length} baris
              </p>
              <p className="mt-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[13px] font-semibold text-stone-600">
                  {detail.order.order_type === "dine_in" ? <Store size={11} /> : <ShoppingBag size={11} />}
                  {detail.order.order_type === "dine_in" ? (table ?? "Dine in") : "Takeaway"}
                </span>
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Tutup detail"
              autoFocus
              className="pos-press flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600"
            >
              <X size={17} />
            </button>
          </div>

          {/* Status stepper */}
          {step >= 0 && (
            <ol className="mt-4 flex items-center" aria-label="Progres pesanan">
              {ORDER_STEPS.map((label, i) => {
                const reached = i <= step;
                const current = i === step;
                return (
                  <li key={label} className={cn("flex items-center", i < ORDER_STEPS.length - 1 && "flex-1")} aria-current={current ? "step" : undefined}>
                    <div className="flex flex-col items-center gap-1">
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-black transition-colors",
                          reached ? "bg-[#FF381E] text-white" : "bg-stone-100 text-stone-600",
                          current && "ring-2 ring-[#FF381E]/30",
                        )}
                      >
                        {i < step ? <Check size={12} strokeWidth={3} /> : i + 1}
                      </span>
                      <span className={cn("text-[13px] leading-none", reached ? "font-bold text-[#18181B]" : "font-semibold text-stone-600")}>
                        {label}
                      </span>
                    </div>
                    {i < ORDER_STEPS.length - 1 && (
                      <span className={cn("mx-1 mb-4 h-0.5 flex-1 rounded-full transition-colors", i < step ? "bg-[#FF381E]" : "bg-stone-200")} aria-hidden />
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {/* Itemized receipt */}
          <section className="pos-rise overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-xs" style={{ "--d": "60ms" } as CSSProperties}>
            <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <ReceiptText size={15} className="text-[#FF381E]" />
                <h3 className="text-[13px] font-bold text-[#18181B]">Rincian item</h3>
              </div>
              <span className="text-[13px] font-bold uppercase tracking-wider text-stone-600">Snapshot harga</span>
            </div>
            {detail.items.map((item, i) => {
              const modifiers = item.order_item_modifiers?.map((m) => m.modifier_name_snapshot).filter(Boolean) ?? [];
              return (
                <div
                  key={item.id}
                  className="pos-rise border-b border-stone-100 px-4 py-3 last:border-0"
                  style={{ "--d": `${Math.min(i, 8) * 40}ms` } as CSSProperties}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 min-w-7 items-center justify-center rounded-lg bg-stone-100 px-1.5 text-[13px] font-black text-[#18181B]">
                      {item.quantity}×
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold leading-snug text-[#18181B]">{item.product_name_snapshot}</p>
                      <p className="mt-1 text-[13px] font-semibold leading-relaxed text-stone-600">
                        {formatCompactIDR(item.unit_price_idr)} / porsi
                      </p>
                      {modifiers.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {modifiers.map((m) => (
                            <span key={m} className="rounded px-1.5 py-0.5 text-[13px] font-semibold text-stone-600 bg-black/5">
                              {m}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-1 text-[13px] font-semibold text-stone-600">Original</p>
                      )}
                      {item.note && (
                        <p className="mt-1.5 rounded-lg bg-[#FF381E]/5 px-2 py-1 text-[13px] font-semibold italic leading-relaxed text-[#FF381E]">
                          “{item.note}”
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-[13px] font-black tabular-nums text-[#18181B]">{formatCompactIDR(item.line_total_idr)}</span>
                  </div>
                </div>
              );
            })}
            <dl className="space-y-1.5 border-t border-stone-100 bg-stone-50/60 px-4 py-4">
              {showSubtotal && (
                <div className="flex items-center justify-between">
                  <dt className="text-[13px] font-semibold text-stone-600">Subtotal</dt>
                  <dd className="text-[13px] font-black tabular-nums text-[#18181B]">{formatCompactIDR(detail.order.subtotal_idr)}</dd>
                </div>
              )}
              <div className="flex items-center justify-between">
                <dt className="text-[13px] font-semibold uppercase tracking-wider text-stone-600">Total</dt>
                <dd className="text-sm font-extrabold tabular-nums tracking-normal text-[#FF381E]">{formatCompactIDR(detail.order.total_idr)}</dd>
              </div>
            </dl>
          </section>

          {/* Payment — Midtrans status, harmonized type */}
          <section className="pos-rise overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-xs" style={{ "--d": "120ms" } as CSSProperties}>
            <div className="flex items-center gap-3 p-4">
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", payState.className)}>
                <PayIcon size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold uppercase tracking-wider text-stone-600">
                  Pembayaran · {payLabel}
                  {payment?.provider ? ` · ${payment.provider}` : ""}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-[13px] font-bold text-[#18181B]">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", payState.dot)} />
                  {payState.label}
                  {typeof payment?.amount_idr === "number" && payment.amount_idr !== detail.order.total_idr && (
                    <span className="font-semibold tabular-nums text-stone-600">· {formatCompactIDR(payment.amount_idr)}</span>
                  )}
                </p>
              </div>
              {typeof payment?.fee_idr === "number" && payment.fee_idr > 0 && (
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-stone-600">fee {formatCompactIDR(payment.fee_idr)}</span>
              )}
            </div>
            <div className="border-t border-stone-100 bg-stone-50/60 px-4 py-3">
              {payment?.status === "settled" ? (
                <p className="text-[13px] font-semibold text-stone-600">
                  Lunas{payment.settled_at ? ` · ${formatCreatedAt(payment.settled_at)}` : ""} · pesanan layak masuk dapur
                </p>
              ) : payment?.status === "pending" && payRemainingMs !== null && payRemainingMs > 0 ? (
                <p className="flex items-center gap-1.5 text-[13px] font-semibold text-stone-600">
                  <Clock3 size={12} className="shrink-0" />
                  QR berlaku <span className="font-bold tabular-nums text-stone-600">{formatCountdown(payRemainingMs)}</span>
                  <span className="text-stone-600">· Midtrans QRIS 15 mnt</span>
                </p>
              ) : payment?.status === "pending" ? (
                <p className="text-[13px] font-bold text-stone-600">QR kedaluwarsa — jangan terima bayar ke kode lama</p>
              ) : payment?.status === "expired" ? (
                <p className="text-[13px] font-semibold text-stone-600">QR kedaluwarsa — buat pesanan baru untuk kode fresh</p>
              ) : payment?.status === "failed" ? (
                <p className="text-[13px] font-bold text-rose-500">Ditolak provider — minta customer coba lagi</p>
              ) : (
                <p className="text-[13px] font-semibold text-stone-600">{payState.label}</p>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-2.5 border-t border-stone-200/80 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5">
          {payment?.status === "pending" && (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => void checkPaymentNow()}
                disabled={checkingPay}
                className="pos-press flex h-11 items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white text-[13px] font-bold text-stone-600 shadow-xs disabled:opacity-60"
              >
                {checkingPay ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Cek pembayaran
              </button>
              <button
                onClick={() => void resumeQrCode()}
                disabled={checkingPay}
                className="pos-press flex h-11 items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white text-[13px] font-bold text-stone-600 shadow-xs disabled:opacity-60"
              >
                <QrCode size={14} />
                Tampilkan QR
              </button>
            </div>
          )}
          <button
            onClick={onAdvance}
            disabled={done}
            className="pos-press h-12 w-full rounded-xl bg-[#FF381E] text-sm font-bold text-white shadow-md hover:bg-[#e03018] disabled:bg-stone-200 disabled:text-stone-600 disabled:shadow-none"
          >
            {actionLabel}
          </button>
          <p className="text-center text-[13px] font-semibold text-stone-600">
            {payment?.status === "settled" || !payment
              ? "Memajukan status akan memperbarui antrean dapur."
              : "Pembayaran belum lunas — pastikan Midtrans settled sebelum masak."}
          </p>
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
    <div className="pos-backdrop absolute inset-0 z-10 flex items-center justify-center bg-[#18181B]/50 p-4" onClick={onClose}>
      <section
        className="pos-pop w-full max-w-[300px] rounded-2xl bg-[#FAF8F5] p-5 text-center shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`QRIS ${orderNumber}`}
      >
        <p className="text-[13px] font-bold uppercase tracking-wider text-stone-600">QRIS · {orderNumber}</p>
        {qr ? (
          <img src={qr} alt="QRIS pembayaran" className="mx-auto mt-4 h-48 w-48 rounded-2xl border border-stone-200 bg-white p-2" />
        ) : (
          <div className="pos-skeleton mx-auto mt-4 h-48 w-48 rounded-2xl" />
        )}
        <p className="mt-3 text-xl font-extrabold tabular-nums tracking-normal text-[#18181B]">{formatIDR(totalIdr)}</p>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-stone-600">
          <Clock3 size={12} />
          {remainingMs > 0 ? (
            <span>
              Berlaku <span className="font-bold tabular-nums text-stone-600">{formatCountdown(remainingMs)}</span>
            </span>
          ) : (
            <span className="font-bold text-stone-600">Kedaluwarsa</span>
          )}
        </p>
        <button onClick={onClose} className="pos-press mt-4 h-11 w-full rounded-xl bg-[#18181B] text-[13px] font-bold text-white">
          Tutup
        </button>
      </section>
    </div>
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
        onShowNotice(payload.error ?? "Pesanan kasir gagal dibuat.");
        return;
      }
      setPayment({ orderId: payload.orderId, qrString: payload.qrString, orderNumber: payload.orderNumber, totalIdr: payload.totalIdr, expiresAt: payload.expiresAt });
      setCart([]);
      setCartOpen(false);
    } catch {
      onShowNotice("Pesanan kasir gagal dibuat.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionHead
        eyebrow="Counter / Pesanan baru"
        title="Kasir cepat"
        sub={orderType === "dine_in" ? "Mode dine in · QRIS" : "Mode takeaway · QRIS"}
      />

      {/* Order type toggle */}
      <div className="grid max-w-md grid-cols-2 gap-1 rounded-xl border border-stone-200/70 bg-stone-100 p-1">
        {(
          [
            { key: "dine_in", label: "Makan di Tempat", icon: Store },
            { key: "takeaway", label: "Takeaway", icon: ShoppingBag },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setOrderType(key)}
            className={cn(
              "pos-press flex items-center justify-center gap-1.5 rounded-lg py-2 text-[13px]",
              orderType === key ? "bg-white font-bold text-[#18181B] shadow-sm" : "font-semibold text-stone-600",
            )}
          >
            <Icon size={14} className={orderType === key ? "text-[#FF381E]" : ""} />
            {label}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Menu */}
        <section className="rounded-2xl border border-stone-200/80 bg-white p-3.5 shadow-xs sm:p-4">
          <div className="relative">
            <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-600" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari menu…"
              className="h-11 w-full rounded-xl border border-stone-200 bg-[#FAF8F5] pl-10 pr-4 text-sm font-semibold text-[#18181B] outline-none placeholder:text-stone-400 focus:border-transparent focus:ring-2 focus:ring-[#FF381E]"
            />
          </div>
          <div className="no-scrollbar -mx-3.5 mt-3 flex gap-2 overflow-x-auto px-3.5 pb-1 sm:-mx-4 sm:px-4">
            {categories.map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className={cn(
                  "pos-press shrink-0 rounded-full px-4 py-2 text-[13px] tracking-normal",
                  category === item
                    ? "bg-[#18181B] font-bold text-white shadow-sm"
                    : "border border-stone-200 bg-white font-semibold text-stone-600",
                )}
              >
                {item}
              </button>
            ))}
          </div>

          {filtered.length ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
              {filtered.map((product, i) => {
                const inCart = cart.find((item) => item.product.id === product.id)?.quantity ?? 0;
                return (
                  <article
                    key={product.id}
                    className={cn(
                      "pos-rise group flex flex-col justify-between rounded-2xl border border-stone-200/80 bg-white p-2.5 shadow-xs transition-shadow hover:shadow-md",
                      !product.available && "opacity-55",
                    )}
                    style={{ "--d": `${Math.min(i, 8) * 40}ms` } as CSSProperties}
                  >
                    <button onClick={() => add(product)} disabled={!product.available} className="text-left" aria-label={`Tambah ${product.name}`}>
                      <div className="relative mb-2 aspect-square overflow-hidden rounded-xl bg-stone-100">
                        {product.imageUrl ? (
                          <img
                            src={product.imageUrl}
                            alt={product.name}
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className={cn("flex h-full w-full items-center justify-center bg-gradient-to-br", product.imageTone)}>
                            <Flame size={26} className="fill-white/30 text-white/30" />
                          </div>
                        )}
                        {product.popular && (
                          <span className="absolute left-2 top-2 rounded-full bg-[#FF381E] px-2 py-0.5 text-xs font-extrabold uppercase tracking-wider text-white shadow-sm">
                            Favorit
                          </span>
                        )}
                        {inCart > 0 && (
                          <span
                            key={inCart}
                            className="pos-pop absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#18181B] px-1.5 text-[13px] font-black text-white"
                          >
                            {inCart}
                          </span>
                        )}
                      </div>
                      <p className="line-clamp-1 text-[13px] font-bold leading-snug text-[#18181B]">{product.name}</p>
                      <p className="mt-1 line-clamp-2 min-h-[28px] text-[13px] font-semibold leading-relaxed text-stone-600">
                        {product.available ? (product.description || "—") : "Stok habis"}
                      </p>
                    </button>
                    <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-2">
                      <div>
                        <span className="block text-[13px] font-semibold text-stone-600">Harga</span>
                        <span className="text-[13px] font-black text-[#18181B]">{formatCompactIDR(product.price)}</span>
                      </div>
                      <button
                        onClick={() => add(product)}
                        disabled={!product.available}
                        aria-label={`Tambah ${product.name}`}
                        className="pos-press flex h-8 w-8 items-center justify-center rounded-full bg-[#18181B] text-white shadow-sm hover:bg-[#FF381E] disabled:bg-stone-200"
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyBlock icon={<Search size={18} />} title="Menu tidak ditemukan." sub="Coba kata kunci atau kategori lain." />
          )}
        </section>

        {/* Cart — desktop dark panel */}
        <aside className="pos-rise sticky top-24 hidden flex-col overflow-hidden rounded-2xl border border-stone-800 bg-[#18181B] text-white shadow-2xl xl:flex">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-wider text-stone-400">Pesanan berjalan</p>
              <h3 className="mt-1 text-sm font-extrabold tracking-normal">{orderType === "dine_in" ? "Dine in" : "Takeaway"} · QRIS</h3>
            </div>
            {cart.length > 0 && (
              <button onClick={() => setCart([])} className="pos-press flex items-center gap-1 text-[13px] font-bold text-stone-400 hover:text-white">
                <Trash2 size={13} /> Hapus
              </button>
            )}
          </div>
          <div className="max-h-[380px] flex-1 space-y-1 overflow-y-auto p-3">
            {cart.map((item) => (
              <div key={item.product.id} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold">{item.product.name}</p>
                  <p className="mt-0.5 text-[13px] font-semibold text-stone-400">{formatCompactIDR(item.product.price)} / porsi</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setQty(item.product.id, -1)}
                    aria-label="Kurangi"
                    className="pos-press flex h-7 w-7 items-center justify-center rounded-full border border-white/15 text-stone-300 hover:border-[#FF381E]"
                  >
                    <Minus size={13} />
                  </button>
                  <span className="w-5 text-center text-[13px] font-black">{item.quantity}</span>
                  <button
                    onClick={() => setQty(item.product.id, 1)}
                    aria-label="Tambah"
                    className="pos-press flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#18181B] hover:bg-[#FF381E] hover:text-white"
                  >
                    <Plus size={13} />
                  </button>
                </div>
                <span className="w-[76px] shrink-0 text-right text-[13px] font-black">{formatCompactIDR(item.product.price * item.quantity)}</span>
              </div>
            ))}
            {!cart.length && (
              <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 text-center">
                <ShoppingBag size={22} className="text-stone-400" />
                <p className="text-[13px] font-semibold text-stone-400">Ketuk menu untuk mulai pesanan.</p>
              </div>
            )}
          </div>
          <div className="border-t border-white/10 p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[13px] font-semibold uppercase tracking-wider text-stone-400">Total</span>
              <span className="text-sm font-extrabold tracking-normal">{formatIDR(total)}</span>
            </div>
            <p className="mb-3 text-[13px] font-semibold text-stone-400">{count} item · bayar via QRIS</p>
            <button
              disabled={!cart.length || saving}
              onClick={() => void createOrder()}
              className="pos-press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF381E] text-sm font-bold text-white shadow-md hover:bg-[#e03018] disabled:bg-white/10 disabled:text-stone-400 disabled:shadow-none"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              {saving ? "Membuat…" : "Buat pembayaran QRIS"}
            </button>
          </div>
        </aside>
      </div>

      {/* Cart — mobile floating bar */}
      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-[76px] z-40 mx-auto max-w-[440px] px-3 xl:hidden">
          <div className="pos-bar flex items-center gap-3 rounded-2xl border border-stone-800 bg-[#18181B] p-2.5 pl-4 text-white shadow-2xl">
            <button onClick={() => setCartOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label="Buka keranjang">
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-stone-700 bg-stone-800/90">
                <ShoppingBag size={18} />
                <span
                  key={count}
                  className="pos-pop absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#18181B] bg-[#FF381E] px-1 text-[11px] font-black"
                >
                  {count}
                </span>
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold uppercase tracking-wider text-stone-400">
                  {count} item · {orderType === "dine_in" ? "Dine in" : "Takeaway"}
                </span>
                <span className="block truncate text-sm font-extrabold tracking-normal">{formatIDR(total)}</span>
              </span>
            </button>
            <button
              onClick={() => setCartOpen(true)}
              className="pos-press flex shrink-0 items-center gap-1 rounded-xl bg-[#FF381E] px-4 py-2.5 text-[13px] font-bold shadow-md"
            >
              Lihat <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Cart — mobile sheet */}
      {cartOpen && (
        <div className="pos-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#18181B]/30 xl:hidden" onClick={() => setCartOpen(false)}>
          <section
            className="pos-panel flex max-h-[88dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[20px] bg-[#FAF8F5] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-stone-300" />
            <div className="flex items-center justify-between px-5 pb-3 pt-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-stone-600">Pesanan berjalan</p>
                <h2 className="mt-0.5 text-2xl font-extrabold tracking-normal text-[#18181B]">
                  {orderType === "dine_in" ? "Dine in" : "Takeaway"}
                </h2>
              </div>
              <button
                onClick={() => setCartOpen(false)}
                aria-label="Tutup keranjang"
                className="pos-press flex h-9 w-9 items-center justify-center rounded-full bg-white text-stone-600 shadow-xs"
              >
                <X size={17} />
              </button>
            </div>
            <div className="flex-1 space-y-2.5 overflow-y-auto px-4 pb-4">
              {cart.map((item) => (
                <div key={item.product.id} className="flex items-center gap-3 rounded-2xl border border-stone-200/80 bg-white p-3 shadow-xs">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-[#18181B]">{item.product.name}</p>
                    <p className="mt-0.5 text-[13px] font-black">{formatCompactIDR(item.product.price * item.quantity)}</p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => setQty(item.product.id, -1)}
                      aria-label="Kurangi"
                      className="pos-press flex h-8 w-8 items-center justify-center rounded-full bg-stone-100 text-stone-600"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="w-5 text-center text-sm font-extrabold">{item.quantity}</span>
                    <button
                      onClick={() => setQty(item.product.id, 1)}
                      aria-label="Tambah"
                      className="pos-press flex h-8 w-8 items-center justify-center rounded-full bg-[#18181B] text-white"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {!cart.length && <p className="py-10 text-center text-[13px] font-semibold text-stone-600">Keranjang kosong.</p>}
            </div>
            <div className="border-t border-stone-200/80 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-semibold uppercase tracking-wider text-stone-600">Total · {count} item</span>
                <span className="text-sm font-extrabold tracking-normal">{formatIDR(total)}</span>
              </div>
              <button
                disabled={!cart.length || saving}
                onClick={() => void createOrder()}
                className="pos-press flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF381E] text-sm font-bold text-white shadow-md hover:bg-[#e03018] disabled:bg-stone-200 disabled:text-stone-600 disabled:shadow-none"
              >
                {saving && <Loader2 size={15} className="animate-spin" />}
                {saving ? "Membuat…" : "Buat pembayaran QRIS"}
              </button>
            </div>
          </section>
        </div>
      )}

      {payment && (
        <CashierPayment
          payment={payment}
          onClose={() => setPayment(null)}
          onSettled={() => {
            onShowNotice(`${payment.orderNumber} lunas — masuk antrean.`);
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
        // Offline / unreachable — keep the QR on screen; next tick retries.
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
    <div className="pos-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#18181B]/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <section
        className="pos-panel w-full max-w-[380px] rounded-t-[20px] bg-[#FAF8F5] p-5 text-center shadow-2xl sm:rounded-[18px]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Pembayaran QRIS ${payment.orderNumber}`}
      >
        <div className="flex items-start justify-between text-left">
          <div>
            <p className="text-[13px] font-bold uppercase tracking-wider text-stone-600">QRIS Kasir · Midtrans</p>
            <h2 className="mt-1 text-xl font-extrabold tracking-normal text-[#18181B] tabular-nums">{payment.orderNumber}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup pembayaran"
            className="pos-press flex h-8 w-8 items-center justify-center rounded-full bg-white text-stone-600 shadow-xs"
          >
            <X size={16} />
          </button>
        </div>

        {state === "settled" ? (
          <div className="mx-auto mt-5 flex h-56 w-56 flex-col items-center justify-center gap-2 rounded-2xl bg-emerald-600/10 px-6">
            <span className="pos-pop flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white">
              <Check size={28} strokeWidth={3} />
            </span>
            <p className="text-sm font-extrabold tracking-normal text-emerald-700">Pembayaran lunas</p>
            <p className="text-[13px] font-semibold text-stone-600">Pesanan masuk antrean dapur.</p>
          </div>
        ) : state === "expired" ? (
          <div className="mx-auto mt-5 flex h-56 w-56 flex-col items-center justify-center gap-2 rounded-2xl bg-stone-100 px-6">
            <Clock3 size={28} className="text-stone-600" />
            <p className="text-sm font-extrabold tracking-normal text-stone-600">QRIS kedaluwarsa</p>
            <p className="text-[13px] font-semibold leading-relaxed text-stone-600">Buat pesanan baru untuk kode fresh — jangan terima bayar ke kode lama.</p>
          </div>
        ) : state === "failed" ? (
          <div className="mx-auto mt-5 flex h-56 w-56 flex-col items-center justify-center gap-2 rounded-2xl bg-rose-500/10 px-6">
            <X size={28} className="text-rose-500" />
            <p className="text-sm font-extrabold tracking-normal text-rose-600">Pembayaran gagal</p>
            <p className="text-[13px] font-semibold leading-relaxed text-stone-600">Minta customer coba lagi atau buat pesanan baru.</p>
          </div>
        ) : qr ? (
          <img src={qr} alt="QRIS pembayaran" className="mx-auto mt-5 h-56 w-56 rounded-2xl border border-stone-200 bg-white p-2 shadow-xs" />
        ) : (
          <div className="pos-skeleton mx-auto mt-5 h-56 w-56 rounded-2xl" />
        )}

        <p className="mt-4 text-2xl font-extrabold tabular-nums tracking-normal text-[#18181B]">{formatIDR(payment.totalIdr)}</p>
        <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-stone-600">
          <Clock3 size={13} />
          {state === "settled" ? (
            <span className="font-bold text-emerald-600">Lunas · terverifikasi Midtrans</span>
          ) : state === "pending" ? (
            <span>
              Berlaku <span className="font-bold tabular-nums text-stone-600">{formatCountdown(remainingMs)}</span> · auto-cek tiap 8 dtk
            </span>
          ) : state === "expired" ? (
            <span className="font-bold text-stone-600">Kode kedaluwarsa</span>
          ) : (
            <span className="font-bold text-rose-500">Ditolak provider</span>
          )}
        </p>
        <button
          onClick={onClose}
          className={cn(
            "pos-press mt-5 h-12 w-full rounded-xl text-sm font-bold text-white",
            state === "settled" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-[#18181B] hover:bg-[#FF381E]",
          )}
        >
          {state === "settled" ? "Tutup · lanjut kasir" : "Tutup"}
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

  const totalSplit = Math.max(1, (report?.dineInRevenueIdr ?? 0) + (report?.takeawayRevenueIdr ?? 0));
  const dineInPct = ((report?.dineInRevenueIdr ?? 0) / totalSplit) * 100;
  const maxSeller = Math.max(1, ...(report?.bestSellers.map((item) => item.quantity) ?? [1]));

  return (
    <div className="space-y-5 lg:space-y-6">
      <SectionHead
        eyebrow="Insight / Laporan"
        title="Laporan harian"
        sub="Hari bisnis Jakarta · hanya pembayaran lunas."
        action={
          <div className="flex gap-2">
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="h-10 rounded-xl border border-stone-200 bg-white px-3 text-[13px] font-semibold text-stone-600 shadow-xs outline-none focus:ring-2 focus:ring-[#FF381E]"
            />
            <button
              onClick={() => void load()}
              className="pos-press flex h-10 items-center gap-2 rounded-xl bg-[#18181B] px-3.5 text-[13px] font-bold text-white"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {loading ? "Memuat…" : "Muat"}
            </button>
            <a
              href={`/api/reports/daily.pdf?date=${date}`}
              className="pos-press flex h-10 items-center gap-2 rounded-xl bg-[#FF381E] px-3.5 text-[13px] font-bold text-white shadow-md hover:bg-[#e03018]"
            >
              <Download size={14} /> PDF
            </a>
          </div>
        }
      />

      {report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Pendapatan"
              value={formatCompactIDR(report.revenueIdr)}
              detail={`${report.orderCount} pesanan lunas`}
              accent="bg-[#FF381E]/10 text-[#FF381E]"
              icon={<Wallet size={17} />}
              index={0}
            />
            <Metric
              label="Estimasi COGS"
              value={formatCompactIDR(report.estimatedCogsIdr)}
              detail="Snapshot biaya"
              accent="bg-violet-600/10 text-violet-600"
              icon={<Package size={17} />}
              index={1}
            />
            <Metric
              label="Fee pembayaran"
              value={formatCompactIDR(report.paymentFeesIdr)}
              detail="Fee provider tercatat"
              accent="bg-sky-600/10 text-sky-600"
              icon={<QrCode size={17} />}
              index={2}
            />
            <Metric
              label="Estimasi laba kotor"
              value={formatCompactIDR(report.estimatedGrossProfitIdr)}
              detail="Bukan laba bersih"
              accent="bg-emerald-600/10 text-emerald-600"
              icon={<TrendingUp size={17} />}
              index={3}
            />
          </div>

          <div className="grid gap-4 lg:gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* Revenue split */}
            <section className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs sm:p-5">
              <h3 className="text-sm font-black uppercase tracking-wider text-[#18181B]">Komposisi pendapatan</h3>
              <p className="mt-0.5 text-[13px] font-semibold text-stone-600">Dine in vs takeaway</p>
              <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-stone-100">
                <div className="pos-grow h-full bg-[#FF381E]" style={{ width: `${dineInPct}%` }} />
                <div className="pos-grow h-full bg-[#18181B]" style={{ width: `${100 - dineInPct}%` }} />
              </div>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] font-bold">
                    <span className="h-2 w-2 rounded-full bg-[#FF381E]" /> Dine in
                  </span>
                  <span className="text-[13px] font-black">{formatCompactIDR(report.dineInRevenueIdr)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] font-bold">
                    <span className="h-2 w-2 rounded-full bg-[#18181B]" /> Takeaway
                  </span>
                  <span className="text-[13px] font-black">{formatCompactIDR(report.takeawayRevenueIdr)}</span>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-stone-100 pt-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-stone-600">Pesanan</p>
                  <p className="mt-1 text-sm font-extrabold tracking-normal">{report.orderCount}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-stone-600">Rata-rata</p>
                  <p className="mt-1 text-sm font-extrabold tracking-normal">{formatCompactIDR(report.averageOrderValueIdr)}</p>
                </div>
              </div>
            </section>

            {/* Best sellers */}
            <section className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs sm:p-5">
              <h3 className="text-sm font-black uppercase tracking-wider text-[#18181B]">Terlaris</h3>
              <p className="mt-0.5 text-[13px] font-semibold text-stone-600">{report.date} · porsi lunas</p>
              {report.bestSellers.length ? (
                <div className="mt-4 divide-y divide-stone-100">
                  {report.bestSellers.map((item) => (
                    <div key={item.name} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-[13px] font-bold">{item.name}</span>
                        <span className="shrink-0 text-[13px] font-semibold text-stone-600">
                          {item.quantity} · {formatCompactIDR(item.revenueIdr)}
                        </span>
                      </div>
                      <div className="mt-2">
                        <Bar value={(item.quantity / maxSeller) * 100} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-10 text-center text-[13px] font-semibold text-stone-600">Belum ada penjualan lunas periode ini.</p>
              )}
            </section>
          </div>

          {/* Settled orders */}
          <section className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-xs">
            <div className="border-b border-stone-100 px-4 py-3.5 sm:px-5">
              <h3 className="text-sm font-black uppercase tracking-wider text-[#18181B]">Pesanan lunas</h3>
              <p className="mt-0.5 text-[13px] font-semibold text-stone-600">{report.orders.length} baris · urut waktu</p>
            </div>
            {report.orders.length ? (
              <div className="max-h-[380px] divide-y divide-stone-100 overflow-y-auto">
                {report.orders.slice(-12).reverse().map((item) => (
                  <div key={item.orderNumber} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold">{item.orderNumber}</p>
                      <p className="mt-0.5 text-[13px] font-semibold text-stone-600">
                        {item.type === "dine_in" ? "Dine in" : "Takeaway"} ·{" "}
                        {new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(
                          new Date(item.createdAt),
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[13px] font-black">{formatCompactIDR(item.totalIdr)}</span>
                      <Check size={14} className="text-emerald-600" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-[13px] font-semibold text-stone-600">Belum ada pesanan lunas.</p>
            )}
          </section>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-5 py-16 text-center">
          {loading ? (
            <LoadingBlock label="Memuat laporan…" />
          ) : (
            <>
              <Bell size={20} className="mx-auto text-stone-300" />
              <p className="mt-3 text-sm font-bold">Tidak ada data laporan tanggal ini.</p>
              <p className="mt-1 text-[13px] font-semibold text-stone-600">Pilih tanggal lain lalu tekan Muat.</p>
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
  if (hour < 11) return "Selamat pagi, Rafi";
  if (hour < 15) return "Selamat siang, Rafi";
  if (hour < 19) return "Selamat sore, Rafi";
  return "Selamat malam, Rafi";
}
