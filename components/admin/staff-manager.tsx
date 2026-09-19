"use client";

import { useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";

type Staff = { id: string; display_name: string; email: string; role: "operator" | "admin"; active: boolean; created_at: string };

export function StaffManager() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ displayName: "", email: "", initialPassword: "", role: "operator" as "operator" | "admin" });

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/staff", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (response.ok) setStaff(payload.staff ?? []);
      else setNotice(payload?.error ?? "Akun staff belum dapat dimuat.");
    } catch {
      setNotice("Koneksi terputus. Coba muat akun staff lagi.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function createStaff() {
    setSaving(true); setNotice(null);
    try {
      const response = await fetch("/api/admin/staff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setNotice(payload?.error ?? "Akun staff belum dapat dibuat."); return; }
      setForm({ displayName: "", email: "", initialPassword: "", role: "operator" });
      setShowForm(false);
      await load();
      setNotice("Akun staff dibuat. Sampaikan password awal melalui kanal aman.");
    } catch {
      setNotice("Koneksi terputus. Akun staff belum dapat dibuat.");
    } finally { setSaving(false); }
  }

  async function update(id: string, change: { active?: boolean; role?: "operator" | "admin" }) {
    const target = staff.find((item) => item.id === id);
    if (!target) return;
    if (change.active === false && !window.confirm(`Nonaktifkan ${target.display_name}? Sesi baru akun ini akan ditolak.`)) return;
    setSaving(true); setNotice(null);
    try {
      const response = await fetch(`/api/admin/staff/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(change) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) setNotice(payload?.error ?? "Perubahan akun belum tersimpan.");
      else await load();
    } catch {
      setNotice("Koneksi terputus. Perubahan akun belum tersimpan.");
    } finally { setSaving(false); }
  }

  return (
    <main className="min-h-screen bg-white px-5 py-8 text-neutral-900 lg:px-10">
      <div className="mx-auto max-w-[820px]">
        <p className="text-xs text-neutral-400">Administrator · <a href="/admin" className="text-neutral-500">Pengaturan</a></p>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h1 className="mt-1 text-[22px] font-medium tracking-tight">Akun staff</h1><p className="mt-1 text-[13px] text-neutral-500">Password awal hanya dimasukkan saat pembuatan dan tidak ditampilkan kembali.</p></div><button type="button" onClick={() => setShowForm(true)} className="flex h-11 items-center justify-center gap-2 rounded-full bg-[#FDBD2C] px-5 text-[13px] font-medium"><UserPlus size={15} />Tambah staff</button></div>
        {notice && <p className="mt-5 rounded-xl bg-neutral-50 px-4 py-3 text-[13px] text-neutral-600">{notice}</p>}
        {loading ? <p className="py-14 text-center text-[13px] text-neutral-500">Memuat akun…</p> : staff.length ? <div className="mt-8 divide-y divide-neutral-100">{staff.map((member) => <div key={member.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="truncate text-[14px] font-medium">{member.display_name}</p><p className="mt-1 truncate text-xs text-neutral-400">{member.email || "Email tidak tersedia"}</p></div><select value={member.role} onChange={(event) => void update(member.id, { role: event.target.value as "operator" | "admin" })} disabled={saving} className="h-10 rounded-full border border-neutral-200 px-3 text-[13px]"><option value="operator">Staff</option><option value="admin">Admin</option></select><button type="button" onClick={() => void update(member.id, { active: !member.active })} disabled={saving} className="h-10 rounded-full border border-neutral-200 px-4 text-[13px] font-medium disabled:opacity-50">{member.active ? "Nonaktifkan" : "Aktifkan"}</button><span className="text-xs text-neutral-400">{member.active ? "Aktif" : "Nonaktif"}</span></div>)}</div> : <p className="py-14 text-center text-[13px] text-neutral-500">Belum ada akun staff.</p>}
      </div>
      {showForm && <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/30 sm:items-center sm:p-5" onClick={() => setShowForm(false)}><section className="ord-sheet w-full max-w-[500px] rounded-t-[28px] bg-white p-5 sm:rounded-[28px]" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true"><div className="flex items-start justify-between"><div><p className="text-xs text-neutral-400">Akun baru</p><h2 className="mt-1 text-lg font-medium">Tambah staff</h2></div><button type="button" onClick={() => setShowForm(false)} aria-label="Tutup" className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-500"><X size={15} /></button></div><div className="mt-6 space-y-4"><label className="block text-[13px] font-medium">Nama tampilan<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} className="input mt-2" placeholder="Nama kasir" /></label><label className="block text-[13px] font-medium">Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="input mt-2" placeholder="staff@contoh.id" /></label><label className="block text-[13px] font-medium">Password awal<input type="password" value={form.initialPassword} onChange={(event) => setForm({ ...form, initialPassword: event.target.value })} className="input mt-2" minLength={12} autoComplete="new-password" placeholder="Minimal 12 karakter" /></label><label className="block text-[13px] font-medium">Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as "operator" | "admin" })} className="input mt-2"><option value="operator">Staff</option><option value="admin">Admin</option></select></label></div><button type="button" onClick={() => void createStaff()} disabled={saving || !form.displayName || !form.email || form.initialPassword.length < 12} className="mt-7 h-12 w-full rounded-2xl bg-[#FDBD2C] text-[15px] font-medium disabled:opacity-40">{saving ? "Membuat…" : "Buat akun"}</button></section></div>}
    </main>
  );
}
