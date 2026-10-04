"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, RefreshCw, RotateCcw } from "lucide-react";
import { AdminHeader } from "@/components/admin/admin-header";
import { formatCompactIDR } from "@/lib/format";

type Orphan = { order_number: string; order_status: string; payment_id: string; payment_status: string; provider_order_id: string; provider_transaction_id: string | null; amount_idr: number; refunded_amount_idr: number; settled_at: string; inventory_state: string; reason: string };
type Attempt = { attempt_id: string; payment_id: string; order_number: string; amount_idr: number; refund_key: string; state: string; last_error_code: string | null };
type Alert = { id: string; payment_id: string | null; order_number: string | null; alert_type: string; details: Record<string, unknown>; created_at: string };

export function ReconciliationManager() {
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [refundKeys, setRefundKeys] = useState<Record<string, string>>({});

  async function load() {
    try {
      const response = await fetch("/api/admin/reconciliation", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Rekonsiliasi belum dapat dimuat.");
      setOrphans(payload.orphanedSettlements ?? []);
      setAttempts(payload.refundAttempts ?? []);
      setAlerts(payload.alerts ?? []);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Rekonsiliasi belum dapat dimuat."); }
  }

  useEffect(() => { void load(); }, []);

  async function action(key: string, data: Record<string, unknown>) {
    setBusy(key); setNotice("");
    try {
      const response = await fetch("/api/admin/reconciliation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Rekonsiliasi belum selesai.");
      setNotice("Perubahan rekonsiliasi tersimpan dan tercatat di audit log.");
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Rekonsiliasi belum selesai."); }
    finally { setBusy(null); }
  }

  function reasonFor(id: string, fallback: string) { return reasons[id]?.trim() || fallback; }
  function idempotencyFor(id: string, amountIdr: number) {
    const storageKey = `refund-idempotency:${id}:${amountIdr}`;
    const key = `${id}:${amountIdr}`;
    let value = refundKeys[key];
    if (!value) {
      try { value = sessionStorage.getItem(storageKey) ?? ""; } catch { value = ""; }
      if (!value) value = crypto.randomUUID();
      try { sessionStorage.setItem(storageKey, value); } catch { /* Keep the same value in this page session. */ }
      setRefundKeys((previous) => ({ ...previous, [key]: value! }));
    }
    return value;
  }

  return (
    <>
      <AdminHeader icon={<AlertTriangle size={20} strokeWidth={1.8} />} title="Rekonsiliasi pembayaran" description="Settlement dan refund provider yang memerlukan keputusan admin." actions={<button type="button" onClick={() => void load()} className="flex h-10 items-center gap-2 rounded-full border border-[#E5DCC8] px-4 text-[13px]"><RefreshCw size={14} />Muat ulang</button>} />
      {notice && <p role="status" className="mt-5 rounded-xl bg-white px-4 py-3 text-[13px] text-[#57534E] shadow-soft">{notice}</p>}
      <section className="mt-8">
        <h2 className="text-sm font-medium">Settlement orphan</h2>
        <p className="mt-1 text-[13px] text-[#78716C]">Dana yang dikonfirmasi Midtrans tetapi belum diakui dalam operasional. Menerima settlement mengonsumsi stok secara atomik.</p>
        {!orphans.length ? <p className="mt-4 rounded-xl bg-white px-4 py-5 text-[13px] text-[#A8A29E]">Tidak ada settlement orphan yang belum ditangani.</p> : <div className="mt-4 space-y-3">{orphans.map((item) => {
          const remaining = item.amount_idr - item.refunded_amount_idr;
          return <article key={item.payment_id} className="rounded-2xl border border-[#EFE7D6] bg-[#FFFEFB] p-4 shadow-soft sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">Pesanan {item.order_number}</h3><p className="mt-1 text-xs text-[#78716C]">Pembayaran {item.payment_id} · provider {item.provider_transaction_id ?? item.provider_order_id}</p></div><strong className="text-sm tabular-nums">{formatCompactIDR(remaining)}</strong></div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4"><div><dt className="text-[#A8A29E]">Settlement</dt><dd>{new Date(item.settled_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</dd></div><div><dt className="text-[#A8A29E]">Status pesanan</dt><dd>{item.order_status}</dd></div><div><dt className="text-[#A8A29E]">Status pembayaran</dt><dd>{item.payment_status}</dd></div><div><dt className="text-[#A8A29E]">Reservasi stok</dt><dd>{item.inventory_state}</dd></div></dl>
            <p className="mt-3 text-xs text-[#78716C]">{item.reason}</p>
            <label className="mt-4 block text-xs text-[#78716C]">Catatan audit<input value={reasons[item.payment_id] ?? ""} onChange={(event) => setReasons((previous) => ({ ...previous, [item.payment_id]: event.target.value }))} className="input mt-1" placeholder="Alasan menerima atau mengembalikan settlement" /></label>
            <div className="mt-4 flex flex-wrap gap-2">{item.payment_status === "settled" && <button type="button" disabled={Boolean(busy)} onClick={() => void action(item.payment_id, { action: "accept_settlement", paymentId: item.payment_id, reason: reasonFor(item.payment_id, "Settlement diterima setelah pemeriksaan stok.") })} className="flex h-10 items-center gap-2 rounded-full bg-[#FDBD2C] px-4 text-xs font-medium disabled:opacity-50"><Check size={14} />Terima settlement</button>}{remaining > 0 && <button type="button" disabled={Boolean(busy)} onClick={() => void action(item.payment_id, { action: "refund_settlement", paymentId: item.payment_id, amountIdr: remaining, reason: reasonFor(item.payment_id, "Refund sisa settlement orphan setelah rekonsiliasi."), idempotencyKey: idempotencyFor(item.payment_id, remaining) })} className="flex h-10 items-center gap-2 rounded-full border border-[#E5DCC8] px-4 text-xs font-medium disabled:opacity-50"><RotateCcw size={14} />Refund sisa {item.payment_status === "partially_refunded" ? "(lanjutkan)" : "penuh"}</button>}{item.payment_status === "refunded" && remaining === 0 && <button type="button" disabled={Boolean(busy)} onClick={() => void action(item.payment_id, { action: "complete_orphaned_refund", paymentId: item.payment_id, reason: reasonFor(item.payment_id, "Refund penuh diverifikasi; tutup rekonsiliasi settlement orphan.") })} className="flex h-10 items-center gap-2 rounded-full border border-[#E5DCC8] px-4 text-xs font-medium disabled:opacity-50"><Check size={14} />Selesaikan rekonsiliasi refund</button>}</div>
          </article>;
        })}</div>}
      </section>
      <section className="mt-9">
        <h2 className="text-sm font-medium">Refund menunggu konfirmasi lokal</h2>
        {!attempts.length ? <p className="mt-4 rounded-xl bg-white px-4 py-5 text-[13px] text-[#A8A29E]">Tidak ada percobaan refund yang menunggu rekonsiliasi.</p> : <div className="mt-4 divide-y divide-[#E9E1D1] rounded-2xl bg-white px-4">{attempts.map((attempt) => <div key={attempt.attempt_id} className="flex flex-wrap items-center gap-3 py-4"><div className="min-w-0 flex-1"><p className="text-[13px] font-medium">{attempt.order_number} · {formatCompactIDR(attempt.amount_idr)}</p><p className="mt-1 break-all text-xs text-[#78716C]">{attempt.refund_key} · {attempt.state}{attempt.last_error_code ? ` · ${attempt.last_error_code}` : ""}</p></div><button type="button" disabled={Boolean(busy)} onClick={() => void action(attempt.attempt_id, { action: "reconcile_refund_attempt", attemptId: attempt.attempt_id })} className="h-9 rounded-full border border-[#E5DCC8] px-4 text-xs disabled:opacity-50">Rekonsiliasi</button></div>)}</div>}
      </section>
      <section className="mt-9">
        <h2 className="text-sm font-medium">Peringatan provider</h2>
        {!alerts.length ? <p className="mt-4 rounded-xl bg-white px-4 py-5 text-[13px] text-[#A8A29E]">Tidak ada peringatan terbuka.</p> : <div className="mt-4 divide-y divide-[#E9E1D1] rounded-2xl bg-white px-4">{alerts.map((alert) => {
          const metadata = alert.details.metadata && typeof alert.details.metadata === "object" ? alert.details.metadata as Record<string, unknown> : {};
          const rawKeys = alert.details.refundKeys ?? metadata.refundKeys;
          const keys = Array.isArray(rawKeys) ? rawKeys.filter((value): value is string => typeof value === "string") : [];
          const rawRefunds = alert.details.refunds ?? metadata.refunds;
          const refunds = Array.isArray(rawRefunds) ? rawRefunds.flatMap((value) => {
            if (!value || typeof value !== "object") return [];
            const item = value as Record<string, unknown>;
            return typeof item.refundKey === "string" ? [{ refundKey: item.refundKey, amountIdr: typeof item.amountIdr === "number" ? item.amountIdr : null }] : [];
          }) : [];
          const refundTargets = refunds.length ? refunds : keys.map((refundKey) => ({ refundKey, amountIdr: null }));
          return <div key={alert.id} className="py-4"><div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><p className="text-[13px] font-medium">{alert.order_number ?? alert.payment_id ?? "Provider reconciliation"} · {alert.alert_type}</p><p className="mt-1 text-xs text-[#78716C]">{alert.id}</p></div></div>
            {alert.alert_type === "provider_refund_without_local_attempt" && alert.payment_id && refundTargets.map(({ refundKey, amountIdr }) => <form key={refundKey} className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void action(alert.id, { action: "reconcile_provider_refund", alertId: alert.id, paymentId: alert.payment_id, refundKey, amountIdr: Number(form.get("amount")), reason: String(form.get("reason") ?? "") }); }}><span className="basis-full break-all text-xs">Refund key: {refundKey}</span><label className="text-xs">Jumlah<input name="amount" required type="number" min="1" defaultValue={amountIdr ?? ""} className="input mt-1 w-40" /></label><label className="min-w-[220px] flex-1 text-xs">Catatan<input name="reason" required minLength={3} maxLength={240} className="input mt-1" /></label><button type="submit" disabled={Boolean(busy)} className="h-10 rounded-full border border-[#E5DCC8] px-4 text-xs disabled:opacity-50">Catat refund provider</button></form>)}
            {alert.alert_type === "provider_refund_without_local_attempt" && alert.payment_id && refundTargets.length === 0 && <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void action(alert.id, { action: "reconcile_provider_refund", alertId: alert.id, paymentId: alert.payment_id, refundKey: String(form.get("refundKey") ?? ""), amountIdr: Number(form.get("amount")), reason: String(form.get("reason") ?? "") }); }}><label className="min-w-[220px] flex-1 text-xs">Kunci refund dari Midtrans<input name="refundKey" required minLength={1} maxLength={160} className="input mt-1" /></label><label className="text-xs">Jumlah<input name="amount" required type="number" min="1" className="input mt-1 w-40" /></label><label className="min-w-[220px] flex-1 text-xs">Catatan<input name="reason" required minLength={3} maxLength={240} className="input mt-1" /></label><button type="submit" disabled={Boolean(busy)} className="h-10 rounded-full border border-[#E5DCC8] px-4 text-xs disabled:opacity-50">Catat refund provider</button></form>}
            {["provider_create_outcome_unknown", "provider_create_finalize_lost"].includes(alert.alert_type) && alert.payment_id && <div className="mt-3 flex flex-wrap items-end gap-2"><label className="min-w-[220px] flex-1 text-xs">Catatan audit<input value={reasons[alert.id] ?? ""} onChange={(event) => setReasons((previous) => ({ ...previous, [alert.id]: event.target.value }))} className="input mt-1" maxLength={240} placeholder="Alasan pemeriksaan transaksi provider" /></label><button type="button" disabled={Boolean(busy)} onClick={() => void action(alert.id, { action: "reconcile_provider_creation", alertId: alert.id, paymentId: alert.payment_id, reason: reasonFor(alert.id, "Status transaksi Midtrans diperiksa dan disinkronkan.") })} className="h-10 rounded-full border border-[#E5DCC8] px-4 text-xs disabled:opacity-50">Periksa status transaksi</button></div>}
          </div>;
        })}</div>}
      </section>
    </>
  );
}
