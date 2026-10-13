"use client";
import { useEffect, useState } from "react";
import type { ReceiptSettings } from "@/lib/receipt-types";

const LABEL = "mb-1.5 block text-sm font-medium";
const INPUT = "h-12 w-full rounded-2xl bg-[#F3EFE6] px-4 text-sm outline-none focus:ring-2 focus:ring-[#FDBD2C]/50";
const initial: ReceiptSettings = {
  merchant_name: "Tempat Taichan", address: "", footer: "Terima kasih sudah memesan!",
  paper_width_mm: 58, ble_service_uuid: "ffe0", ble_characteristic_uuid: "ffe1",
};

export function ReceiptSettingsManager() {
  const [form, setForm] = useState<ReceiptSettings>(initial);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/admin/receipt-settings", { cache: "no-store" })
      .then(async response => { const json = await response.json(); if (!response.ok) throw new Error(json.error); return json; })
      .then(json => { if (active) setForm(json.settings); })
      .catch(error => { if (active) setNotice(error instanceof Error ? error.message : "Gagal memuat pengaturan."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const change = (key: keyof ReceiptSettings, value: string | number) => setForm(current => ({ ...current, [key]: value }));
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/admin/receipt-settings", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Gagal menyimpan pengaturan.");
      setForm(payload.settings); setNotice("Pengaturan struk tersimpan.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Gagal menyimpan."); }
    finally { setSaving(false); }
  }
  return (
    <form onSubmit={(e) => void save(e)} className="max-w-2xl space-y-5 rounded-[28px] border border-[#EFE7D6] bg-[#FFFEFB] p-5 shadow-soft sm:p-7" aria-busy={saving || loading}>
      <div><label htmlFor="receipt-name" className={LABEL}>Nama toko di struk</label>
        <input id="receipt-name" required maxLength={80} value={form.merchant_name} onChange={e => change("merchant_name",e.target.value)} className={INPUT} /></div>
      <div><label htmlFor="receipt-address" className={LABEL}>Alamat atau keterangan toko</label>
        <textarea id="receipt-address" rows={2} maxLength={200} value={form.address} onChange={e => change("address",e.target.value)} className="w-full rounded-2xl bg-[#F3EFE6] p-4 text-sm outline-none focus:ring-2 focus:ring-[#FDBD2C]/50" /></div>
      <div><label htmlFor="receipt-footer" className={LABEL}>Pesan penutup</label>
        <textarea id="receipt-footer" rows={2} maxLength={240} value={form.footer} onChange={e => change("footer",e.target.value)} className="w-full rounded-2xl bg-[#F3EFE6] p-4 text-sm outline-none focus:ring-2 focus:ring-[#FDBD2C]/50" /></div>
      <div><label htmlFor="receipt-width" className={LABEL}>Lebar kertas thermal</label>
        <select id="receipt-width" value={form.paper_width_mm} onChange={e => change("paper_width_mm",Number(e.target.value))} className={INPUT}>
          <option value={58}>58 mm (32 karakter)</option><option value={80}>80 mm (48 karakter)</option>
        </select></div>
      <div className="border-t border-[#EFE7D6] pt-5">
        <h3 className="font-semibold">Bluetooth LE ESC/POS</h3>
        <p className="my-2 text-xs leading-relaxed text-[#78716C]">Nilai standar FFE0/FFE1 digunakan beberapa printer BLE. Ubah sesuai dokumentasi perangkat. Printer Bluetooth Classic/SPP dan Safari iPhone tidak mendukung koneksi langsung melalui Web Bluetooth; gunakan menu Cetak biasa/AirPrint.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="ble-service" className={LABEL}>Service UUID</label><input id="ble-service" className={INPUT} required maxLength={36} value={form.ble_service_uuid} onChange={e=>change("ble_service_uuid",e.target.value)} /></div>
          <div><label htmlFor="ble-char" className={LABEL}>Write characteristic UUID</label><input id="ble-char" className={INPUT} required maxLength={36} value={form.ble_characteristic_uuid} onChange={e=>change("ble_characteristic_uuid",e.target.value)} /></div>
        </div>
      </div>
      {notice && <p role="status" className="text-sm text-[#78716C]">{notice}</p>}
      <button type="submit" disabled={loading || saving} className="min-h-12 rounded-full bg-[#FDBD2C] px-6 text-sm font-semibold disabled:opacity-40">{saving ? "Menyimpan…" : "Simpan pengaturan"}</button>
    </form>
  );
}
