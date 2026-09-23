"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Plus } from "lucide-react";
import { QrPreview } from "@/components/admin/qr-preview";

type GeneralQr = { id: string; label: string; kind: string; active: boolean; token_version: number };
type Preview = { label: string; orderingUrl: string; qrDataUrl: string };

export function GeneralQrManager() {
  const [codes, setCodes] = useState<GeneralQr[]>([]);
  const [label, setLabel] = useState("");
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch("/api/admin/qr/general", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (response.ok) setCodes(payload.codes ?? []);
      else { setLoadError(true); setNotice(payload?.error ?? "QR umum belum dapat dimuat."); }
    } catch {
      setLoadError(true);
      setNotice("Koneksi terputus. Coba muat QR umum lagi.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function presentQr(qrLabel: string, orderingUrl: string) {
    const absoluteUrl = new URL(orderingUrl, window.location.origin).toString();
    const qrDataUrl = await QRCode.toDataURL(absoluteUrl, { width: 720, margin: 2, color: { dark: "#18181B", light: "#ffffff" } });
    setPreview({ label: qrLabel, orderingUrl: absoluteUrl, qrDataUrl });
  }

  async function createCode() {
    if (!label.trim()) { setNotice("Label QR umum wajib diisi."); return; }
    setWorking("create");
    try {
      const response = await fetch("/api/admin/qr/general", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setNotice(payload?.error ?? "QR umum belum dapat dibuat."); return; }
      setLabel("");
      await presentQr(payload.code.label, payload.orderingUrl);
      await load();
      setNotice("QR umum dibuat. Simpan QR ini sekarang.");
    } catch {
      setNotice("Koneksi terputus. QR umum belum dapat dibuat.");
    } finally { setWorking(null); }
  }

  async function rotate(code: GeneralQr) {
    if (!window.confirm(`Rotasi QR ${code.label}? QR lama langsung tidak berlaku.`)) return;
    setWorking(code.id);
    try {
      const response = await fetch(`/api/admin/qr/general/${code.id}`, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setNotice(payload?.error ?? "QR umum gagal dirotasi."); return; }
      await presentQr(code.label, payload.orderingUrl);
      await load();
      setNotice("QR dirotasi. QR lama sudah tidak berlaku.");
    } catch {
      setNotice("Koneksi terputus. QR umum belum dapat dirotasi.");
    } finally { setWorking(null); }
  }

  async function toggle(code: GeneralQr) {
    const action = code.active ? "nonaktifkan" : "aktifkan";
    if (!window.confirm(`${action[0].toUpperCase() + action.slice(1)} ${code.label}?`)) return;
    setWorking(code.id);
    try {
      const response = await fetch(`/api/admin/qr/general/${code.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !code.active }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) setNotice(payload?.error ?? "Status QR gagal diubah.");
      else await load();
    } catch {
      setNotice("Koneksi terputus. Status QR belum berubah.");
    } finally { setWorking(null); }
  }

  async function saveLabel() {
    if (!editing) return;
    setWorking(editing.id);
    try {
      const response = await fetch(`/api/admin/qr/general/${editing.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: editing.label }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) setNotice(payload?.error ?? "Label QR gagal disimpan.");
      else { setEditing(null); await load(); }
    } catch {
      setNotice("Koneksi terputus. Label QR belum tersimpan.");
    } finally { setWorking(null); }
  }

  return (
    <main className="min-h-screen bg-white px-5 py-8 text-neutral-900 lg:px-10">
      <div className="mx-auto max-w-[820px]">
        <p className="text-xs text-neutral-400">Administrator · <a href="/admin" className="text-neutral-500">Pengaturan</a></p>
        <h1 className="mt-1 text-[22px] font-medium tracking-tight">QR umum</h1>
        <p className="mt-1 text-[13px] text-neutral-500">QR ini tidak terkait meja. Customer memilih Dine in tanpa meja atau Takeaway saat memesan.</p>
        {notice && <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-neutral-50 px-4 py-3 text-[13px] text-neutral-500"><span>{notice}</span>{loadError && <button type="button" onClick={() => { setNotice(null); void load(); }} className="h-9 rounded-full bg-neutral-900 px-4 text-xs font-medium text-white">Coba lagi</button>}</div>}
        {preview && <QrPreview label={preview.label} orderingUrl={preview.orderingUrl} qrDataUrl={preview.qrDataUrl} onClose={() => setPreview(null)} onCopy={() => { void navigator.clipboard?.writeText(preview.orderingUrl); setNotice("URL QR disalin."); }} />}

        <section className="mt-8 rounded-2xl border border-neutral-100 p-5">
          <div className="flex items-center gap-2"><Plus size={16} /><h2 className="text-sm font-medium">Buat QR umum</h2></div>
          <form onSubmit={(event) => { event.preventDefault(); void createCode(); }} className="mt-4 flex flex-col gap-3 sm:flex-row"><label htmlFor="new-general-qr-label" className="flex-1 text-[13px] text-neutral-500">Label<input id="new-general-qr-label" required value={label} onChange={(event) => setLabel(event.target.value)} className="input mt-1" placeholder="QR kasir" /></label><button type="submit" disabled={working === "create"} className="h-11 self-end rounded-full bg-[#FDBD2C] px-5 text-[13px] font-medium disabled:opacity-50">{working === "create" ? "Membuat…" : "Buat & tampilkan QR"}</button></form>
        </section>

        {loading ? <p className="py-14 text-center text-[13px] text-neutral-500">Memuat QR…</p> : codes.length ? <div className="mt-8 divide-y divide-neutral-100">{codes.map((code) => <div key={code.id} className="py-4">{editing?.id === code.id ? <form onSubmit={(event) => { event.preventDefault(); void saveLabel(); }} className="flex flex-col gap-3 sm:flex-row"><label htmlFor={`edit-general-qr-${code.id}`} className="sr-only">Label QR</label><input id={`edit-general-qr-${code.id}`} required value={editing.label} onChange={(event) => setEditing({ ...editing, label: event.target.value })} className="input flex-1" /><button type="submit" disabled={working === code.id} className="h-11 rounded-full bg-[#FDBD2C] px-4 text-[13px] font-medium">Simpan</button><button type="button" onClick={() => setEditing(null)} className="h-11 rounded-full border border-neutral-200 px-4 text-[13px]">Batal</button></form> : <div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><p className="text-[13px] font-medium">{code.label}</p><p className="mt-1 text-xs text-neutral-400">QR v{code.token_version} · {code.active ? "Aktif" : "Nonaktif"}</p></div><button type="button" onClick={() => setEditing({ id: code.id, label: code.label })} aria-label={`Edit ${code.label}`} className="flex h-10 items-center gap-2 rounded-full border border-neutral-200 px-4 text-[13px] font-medium">Edit</button><button type="button" onClick={() => void toggle(code)} disabled={working === code.id} className="h-10 rounded-full border border-neutral-200 px-4 text-[13px] font-medium disabled:opacity-50">{code.active ? "Nonaktifkan" : "Aktifkan"}</button><button type="button" onClick={() => void rotate(code)} disabled={working === code.id} className="flex h-10 items-center gap-2 rounded-full bg-neutral-900 px-4 text-[13px] font-medium text-white disabled:opacity-40">Rotasi QR</button></div>}</div>)}</div> : <p className="py-14 text-center text-[13px] text-neutral-500">Belum ada QR umum. Buat QR pertama di atas.</p>}
      </div>
    </main>
  );
}
