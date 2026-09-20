import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { authorizeStaff } from "@/lib/auth/authorize-staff";

export const metadata: Metadata = { title: "Admin & pengaturan" };

export default async function AdminPage() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) redirect(auth.authenticated ? "/pos?forbidden=1" : "/login?next=/admin");
  return (
    <main className="min-h-screen bg-white px-5 py-8 text-neutral-900 lg:px-10">
      <div className="mx-auto max-w-[820px]">
        <p className="text-xs text-neutral-400">Administrator</p>
        <h1 className="mt-1 text-[22px] font-medium tracking-tight">Admin / Pengaturan</h1>
        <p className="mt-1 text-[13px] text-neutral-500">Kelola akses, meja, dan QR pemesanan. Perubahan sensitif dicatat.</p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <AdminLink href="/admin/tables" title="Meja & QR" description="Meja, kode, status, dan QR meja." />
          <AdminLink href="/admin/general-qr" title="QR umum" description="QR non-meja untuk area kasir atau promosi." />
          <AdminLink href="/admin/staff" title="Akun staff" description="Buat akun, role, dan status aktif." />
          <AdminLink href="/pos" title="Kembali ke workspace" description="Ringkasan operasional dan pesanan." />
        </div>
      </div>
    </main>
  );
}

function AdminLink({ href, title, description }: { href: string; title: string; description: string }) {
  return <Link href={href} className="rounded-2xl border border-neutral-100 p-5 transition hover:border-neutral-200 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-[#FDBD2C]/60"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-[13px] leading-relaxed text-neutral-500">{description}</p></Link>;
}
