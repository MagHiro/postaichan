import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Flame, Store } from "lucide-react";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminLogoutButton } from "@/components/admin/admin-logout-button";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) redirect(auth.authenticated ? "/pos?forbidden=1" : "/login?next=/admin");

  return (
    <div className="modern-admin-main min-h-screen bg-[#FAF7F1] text-[#1C1917] lg:pl-[288px]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden h-screen w-[288px] flex-col overflow-y-auto bg-[#F4EDE0] px-6 py-9 lg:flex">
        <Link href="/admin" className="flex items-center gap-3" data-motion-stagger>
          <span className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-[#FDBD2C]"><Flame size={22} fill="#1C1917" /></span>
          <div><p className="text-[16px] font-semibold tracking-[-.04em]">Tempat Taichan</p><p className="text-[12px] text-[#84786A]">Workspace admin</p></div>
        </Link>
        <div className="modern-side-nav mt-12"><AdminNav variant="sidebar" /></div>
        <div className="mt-auto pt-10">
          <Link href="/pos" className="flex items-center justify-between rounded-[20px] bg-[#FFFEFB] px-4 py-4 text-[13px] font-medium shadow-[0_12px_34px_-22px_rgba(90,55,16,.3)]">
            <span className="flex items-center gap-2"><Store size={18} strokeWidth={1.8} />Buka kasir</span>
            <ArrowUpRight size={18} />
          </Link>
          <div className="mt-4"><AdminLogoutButton /></div>
        </div>
      </aside>
      <div className="px-5 pb-12 pt-6 sm:px-9 lg:px-12 lg:pt-11 xl:px-16">
        <div className="mb-7 lg:hidden" data-motion-stagger>
          <div className="flex items-center justify-between gap-4">
            <div><p className="text-[12px] text-[#897E70]">Tempat Taichan</p><h1 className="mt-1 text-[27px] font-semibold tracking-[-.06em]">Pengaturan</h1></div>
            <Link href="/pos" aria-label="Buka kasir" className="flex h-11 w-11 items-center justify-center rounded-[15px] bg-[#FDBD2C]"><Store size={18} /></Link>
          </div>
          <div className="mt-6"><AdminNav variant="top" /></div>
        </div>
        <main className="mx-auto w-full max-w-[1180px]" data-motion-card>{children}</main>
      </div>
    </div>
  );
}
