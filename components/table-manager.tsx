"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Plus } from "lucide-react";
import { QrPreview } from "@/components/admin/qr-preview";

type Table = { id: string; label: string; code: string; active: boolean; qr_token_version: number };
type Preview = { label: string; orderingUrl: string; qrDataUrl: string };

export function TableManager() {
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [editing, setEditing] = useState<{ id: string; label: string; code: string } | null>(null);
  const [newTable, setNewTable] = useState({ label: "", code: "TBL-" });

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch("/api/admin/tables", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (response.ok) setTables(payload.tables ?? []);
      else { setLoadError(true); setNotice(payload?.error ?? "Meja belum dapat dimuat."); }
    } catch {
      setLoadError(true);
      setNotice("Koneksi terputus. Coba muat meja lagi.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function presentQr(label: string, orderingUrl: string) {
    const qrDataUrl = await QRCode.toDataURL(new URL(orderingUrl, window.location.origin).toString(), { width: 720, margin: 2, color: { dark: "#18181B", light: "#ffffff" } });
    setPreview({ label, orderingUrl: new URL(orderingUrl, window.location.origin).toString(), qrDataUrl });
  }

  async function createTable() {
    if (!newTable.label.trim() || !/^TBL-[A-Z0-9-]{1,24}$/.test(newTable.code.trim().toUpperCase())) { setNotice("Isi label dan kode dengan format TBL-NOMOR."); return; }
    setWorking("create");
    try {
      const response = await fetch("/api/admin/tables", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: newTable.label, code: newTable.code.toUpperCase(), active: true }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setNotice(payload?.error ?? "Meja belum dapat dibuat."); return; }
      setNewTable({ label: "", code: "TBL-" });
      await presentQr(payload.table.label, payload.orderingUrl);
      await load();
      setNotice("Meja dibuat. Simpan QR ini sekarang.");
    } catch {
      setNotice("Koneksi terputus. Meja belum dapat dibuat.");
    } finally { setWorking(null); }
  }

  async function rotate(table: Table) {
    if (!window.confirm(`Rotasi QR ${table.label}? QR lama langsung tidak berlaku.`)) return;
    setWorking(table.id);
    try {
      const response = await fetch(`/api/admin/tables/${table.id}`, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setNotice(payload?.error ?? "QR gagal dirotasi."); return; }
      await presentQr(table.label, payload.orderingUrl);
      await load();
      setNotice("QR dirotasi. QR lama sudah tidak berlaku.");
    } catch {
      setNotice("Koneksi terputus. QR meja belum dapat dirotasi.");
    } finally { setWorking(null); }
  }

  async function toggle(table: Table) {
    const action = table.active ? "nonaktifkan" : "aktifkan";
    if (!window.confirm(`${action[0].toUpperCase() + action.slice(1)} ${table.label}?`)) return;
    setWorking(table.id);
    try {
      const response = await fetch(`/api/admin/tables/${table.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !table.active }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) setNotice(payload?.error ?? "Status meja gagal diubah.");
      else await load();
    } catch {
      setNotice("Koneksi terputus. Status meja belum berubah.");
    } finally { setWorking(null); }
  }

  async function saveEdit() {
    if (!editing) return;
    setWorking(editing.id);
    try {
      const response = await fetch(`/api/admin/tables/${editing.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: editing.label, code: editing.code.toUpperCase() }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) setNotice(payload?.error ?? "Perubahan meja gagal disimpan.");
      else { setEditing(null); await load(); }
    } catch {
      setNotice("Koneksi terputus. Perubahan meja belum tersimpan.");
    } finally { setWorking(null); }
  }

  return (
    <main className="min-h-screen bg-[#FAFAFA] px-5 py-8 text-neutral-900 lg:px-10">
      <div className="mx-auto max-w-[820px]">
        <p className="text-xs text-neutral-400">Administrator · <a href="/admin" className="text-neutral-500">Pengaturan</a></p>
        <h1 className="mt-1 text-[22px] font-medium tracking-tight">Meja &amp; QR</h1>
        <p className="mt-1 text-[13px] text-neutral-500">QR lama langsung tidak berlaku setelah rotasi. Token mentah hanya ditampilkan sekali.</p>
        {notice && <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 shadow-soft text-[13px] text-neutral-500"><span>{notice}</span>{loadError && <button type="button" onClick={() => { setNotice(null); void load(); }} className="h-9 rounded-full bg-neutral-900 px-4 text-xs font-medium text-white">Coba lagi</button>}</div>}
        {preview && <QrPreview label={preview.label} orderingUrl={preview.orderingUrl} qrDataUrl={preview.qrDataUrl} onClose={() => setPreview(null)} onCopy={() => { void navigator.clipboard?.writeText(preview.orderingUrl); setNotice("URL QR disalin."); }} />}

        <section className="mt-8 rounded-2xl border border-neutral-100 p-5">
          <div className="flex items-center gap-2"><Plus size={16} /><h2 className="text-sm font-medium">Buat meja baru</h2></div>
          <form onSubmit={(event) => { event.preventDefault(); void createTable(); }} className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
            <label htmlFor="new-table-label" className="text-[13px] text-neutral-500">Label<input id="new-table-label" required value={newTable.label} onChange={(event) => setNewTable({ ...newTable, label: event.target.value })} className="input mt-1" placeholder="Meja 01" /></label>
            <label htmlFor="new-table-code" className="text-[13px] text-neutral-500">Kode unik<input id="new-table-code" required value={newTable.code} onChange={(event) => setNewTable({ ...newTable, code: event.target.value.toUpperCase() })} className="input mt-1" placeholder="TBL-01" /></label>
            <button type="submit" disabled={working === "create"} className="h-11 self-end rounded-full bg-[#FDBD2C] px-5 text-[13px] font-medium disabled:opacity-50">{working === "create" ? "Membuat…" : "Buat & tampilkan QR"}</button>
          </form>
          <p className="mt-3 text-xs text-neutral-400">Gunakan URL/QR ini untuk membuka pemesanan dine-in meja tersebut.</p>
        </section>

        {loading ? <p className="py-14 text-center text-[13px] text-neutral-500">Memuat meja…</p> : tables.length ? <div className="mt-8 divide-y divide-neutral-100">{tables.map((table) => <div key={table.id} className="py-4">{editing?.id === table.id ? <form onSubmit={(event) => { event.preventDefault(); void saveEdit(); }} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]"><label htmlFor={`edit-table-label-${table.id}`} className="text-[13px] text-neutral-500">Label<input id={`edit-table-label-${table.id}`} required value={editing.label} onChange={(event) => setEditing({ ...editing, label: event.target.value })} className="input mt-1" /></label><label htmlFor={`edit-table-code-${table.id}`} className="text-[13px] text-neutral-500">Kode<input id={`edit-table-code-${table.id}`} required value={editing.code} onChange={(event) => setEditing({ ...editing, code: event.target.value.toUpperCase() })} className="input mt-1" /></label><button type="submit" disabled={working === table.id} className="h-11 self-end rounded-full bg-[#FDBD2C] px-4 text-[13px] font-medium disabled:opacity-50">Simpan</button><button type="button" onClick={() => setEditing(null)} className="h-11 self-end rounded-full border border-neutral-200 px-4 text-[13px] font-medium">Batal</button></form> : <div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><p className="text-[13px] font-medium">{table.label} · {table.code}</p><p className="mt-1 text-xs text-neutral-400">QR v{table.qr_token_version} · {table.active ? "Aktif" : "Nonaktif"}</p></div><button type="button" onClick={() => setEditing({ id: table.id, label: table.label, code: table.code })} aria-label={`Edit ${table.label}`} className="flex h-10 items-center gap-2 rounded-full border border-neutral-200 px-4 text-[13px] font-medium">Edit</button><button type="button" onClick={() => void toggle(table)} disabled={working === table.id} className="h-10 rounded-full border border-neutral-200 px-4 text-[13px] font-medium disabled:opacity-50">{table.active ? "Nonaktifkan" : "Aktifkan"}</button><button type="button" onClick={() => void rotate(table)} disabled={working === table.id} className="flex h-10 items-center gap-2 rounded-full bg-neutral-900 px-4 text-[13px] font-medium text-white disabled:opacity-40">Rotasi QR</button></div>}</div>)}</div> : <p className="py-14 text-center text-[13px] text-neutral-500">Belum ada meja. Buat meja pertama di atas.</p>}
      </div>
    </main>
  );
}
