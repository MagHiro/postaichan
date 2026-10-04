"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Users, X } from "lucide-react";
import { useDialogFocus } from "@/components/use-dialog-focus";
import { AdminHeader } from "@/components/admin/admin-header";
import { WarmSelect } from "@/components/warm-select";

type Staff = { id: string; display_name: string; email: string; role: "operator" | "admin"; active: boolean; created_at: string };

export function StaffManager() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ displayName: "", email: "", initialPassword: "", role: "operator" as "operator" | "admin" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch("/api/admin/staff", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (response.ok) setStaff(payload.staff ?? []);
      else { setLoadError(true); setNotice(payload?.error ?? "Akun staff belum dapat dimuat."); }
    } catch {
      setLoadError(true);
      setNotice("Koneksi terputus. Coba muat akun staff lagi.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, () => setShowForm(false), showForm);

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
    if (change.active === false && !window.confirm(`Nonaktifkan ${target.display_name} dan cabut seluruh sesinya?`)) return;
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

  async function revokeSessions(member: Staff) {
    if (!window.confirm(`Cabut semua sesi aktif milik ${member.display_name}?`)) return;
    setSaving(true); setNotice(null);
    try {
      const response = await fetch(`/api/admin/staff/${member.id}/sessions`, { method: "POST" });
      const payload = await response.json().catch(() => null);
      setNotice(response.ok ? `${payload?.revokedCount ?? 0} sesi dicabut.` : payload?.error ?? "Sesi belum dapat dicabut.");
    } catch { setNotice("Koneksi terputus. Sesi belum dapat dicabut."); }
    finally { setSaving(false); }
  }

  async function resetPassword(member: Staff) {
    const newPassword = window.prompt(`Password baru untuk ${member.display_name} (minimal 12 karakter):`);
    if (newPassword === null) return;
    setSaving(true); setNotice(null);
    try {
      const response = await fetch(`/api/admin/staff/${member.id}/password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newPassword }) });
      const payload = await response.json().catch(() => null);
      setNotice(response.ok ? `Password ${member.display_name} diubah dan semua sesinya dicabut.` : payload?.error ?? "Password belum dapat direset.");
    } catch { setNotice("Koneksi terputus. Password belum dapat direset."); }
    finally { setSaving(false); }
  }

  async function changeOwnPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setNotice(null);
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(passwordForm) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) { setNotice(payload?.error ?? "Password belum dapat diubah."); return; }
      setPasswordForm({ currentPassword: "", newPassword: "" });
      setNotice("Password diubah. Sesi aktif lain sudah dicabut.");
    } catch { setNotice("Koneksi terputus. Password belum dapat diubah."); }
    finally { setSaving(false); }
  }

  return (
    <>
      <AdminHeader
        icon={<Users size={20} strokeWidth={1.8} aria-hidden="true" />}
        title="Akun staff"
        description="Password awal hanya dimasukkan saat pembuatan dan tidak ditampilkan kembali."
        actions={<button type="button" onClick={() => setShowForm(true)} className="flex h-11 items-center justify-center gap-2 rounded-full bg-[#FDBD2C] px-5 text-[13px] font-medium"><Plus size={15} />Tambah staff</button>}
      />
        <form onSubmit={changeOwnPassword} className="mt-6 rounded-2xl border border-[#EFE7D6] bg-white p-4 shadow-soft sm:p-5">
          <h2 className="text-[13px] font-medium">Ubah password saya</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs text-neutral-500">Password saat ini<input required type="password" autoComplete="current-password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} className="input mt-1" /></label><label className="text-xs text-neutral-500">Password baru<input required minLength={12} type="password" autoComplete="new-password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} className="input mt-1" /></label></div>
          <button type="submit" disabled={saving || passwordForm.newPassword.length < 12} className="mt-3 h-10 rounded-full bg-[#1C1917] px-4 text-xs text-white disabled:opacity-50">Ubah password</button>
        </form>
        {notice && <div role="alert" className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 shadow-soft text-[13px] text-neutral-500"><span>{notice}</span>{loadError && <button type="button" onClick={() => { setNotice(null); void load(); }} className="h-9 rounded-full bg-neutral-900 px-4 text-xs font-medium text-white">Coba lagi</button>}</div>}
        {loading ? <p className="py-14 text-center text-[13px] text-neutral-500">Memuat akun…</p> : staff.length ? <div className="mt-8 divide-y divide-neutral-100">{staff.map((member) => <div key={member.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="truncate text-[14px] font-medium">{member.display_name}</p><p className="mt-1 truncate text-xs text-neutral-400">{member.email || "Email tidak tersedia"}</p></div><WarmSelect id={`role-${member.id}`} label={`Role ${member.display_name}`} value={member.role} onChange={(next) => void update(member.id, { role: next as "operator" | "admin" })} disabled={saving} className="sm:w-auto" options={[{ value: "operator", label: "Staff" }, { value: "admin", label: "Admin" }]} /><button type="button" onClick={() => void resetPassword(member)} disabled={saving} className="h-10 rounded-full border border-neutral-200 px-3 text-xs disabled:opacity-50">Reset password</button><button type="button" onClick={() => void revokeSessions(member)} disabled={saving} className="h-10 rounded-full border border-neutral-200 px-3 text-xs disabled:opacity-50">Cabut sesi</button><button type="button" onClick={() => void update(member.id, { active: !member.active })} disabled={saving} className="h-10 rounded-full border border-neutral-200 px-4 text-[13px] font-medium disabled:opacity-50">{member.active ? "Nonaktifkan" : "Aktifkan"}</button><span className="text-xs text-neutral-400">{member.active ? "Aktif" : "Nonaktif"}</span></div>)}</div> : <p className="py-14 text-center text-[13px] text-neutral-500">Belum ada akun staff. Tambahkan akun pertama di atas.</p>}
      {showForm && <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/30 sm:items-center sm:p-5" onClick={() => setShowForm(false)}><section ref={dialogRef} tabIndex={-1} className="ord-sheet w-full max-w-[500px] rounded-t-[28px] bg-white p-5 sm:rounded-[28px]" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="staff-form-title"><div className="flex items-start justify-between"><div><p className="text-xs text-neutral-400">Akun baru</p><h2 id="staff-form-title" className="mt-1 text-lg font-medium">Tambah staff</h2></div><button type="button" onClick={() => setShowForm(false)} aria-label="Tutup form tambah staff" className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-500"><X size={15} /></button></div>{notice && <p role="alert" className="mt-5 rounded-xl bg-white px-4 py-3 shadow-soft text-[13px] text-neutral-500">{notice}</p>}<form onSubmit={(event) => { event.preventDefault(); void createStaff(); }} className="mt-6 space-y-4"><label htmlFor="staff-display-name" className="block text-[13px] font-medium">Nama tampilan<input id="staff-display-name" required value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} className="input mt-2" placeholder="Nama kasir" /></label><label htmlFor="staff-email" className="block text-[13px] font-medium">Email<input id="staff-email" required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="input mt-2" placeholder="staff@contoh.id" autoComplete="email" /></label><label htmlFor="staff-password" className="block text-[13px] font-medium">Password awal<input id="staff-password" required type="password" value={form.initialPassword} onChange={(event) => setForm({ ...form, initialPassword: event.target.value })} className="input mt-2" minLength={12} autoComplete="new-password" placeholder="Minimal 12 karakter" /></label><div className="block text-[13px] font-medium"><span id="staff-role-label">Role</span><WarmSelect id="staff-role" label="Role" value={form.role} onChange={(next) => setForm({ ...form, role: next as "operator" | "admin" })} className="mt-2" options={[{ value: "operator", label: "Staff" }, { value: "admin", label: "Admin" }]} /></div><button type="submit" disabled={saving || !form.displayName || !form.email || form.initialPassword.length < 12} className="mt-3 h-12 w-full rounded-2xl bg-[#FDBD2C] text-[15px] font-medium disabled:opacity-40">{saving ? "Membuat…" : "Buat akun"}</button></form></section></div>}
    </>
  );
}
