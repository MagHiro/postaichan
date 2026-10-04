import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { Store } from "lucide-react";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminLogoutButton } from "@/components/admin/admin-logout-button";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) redirect(auth.authenticated ? "/pos?forbidden=1" : "/login?next=/admin");

  return (
    <div className="min-h-screen bg-[#FAF7F1] text-[#1C1917] antialiased lg:pl-[266px]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden h-screen w-[266px] flex-col overflow-y-auto border-r border-[#EFE7D6] bg-[#FAF7F1] px-5 py-8 lg:flex">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium tracking-tight">Tempat Taichan</p>
          <p className="mt-1 text-xs text-[#A8A29E]">Administrator</p>
        </div>
        <div className="mt-10">
          <AdminNav variant="sidebar" />
        </div>
        <Link
          href="/pos"
          className="mt-4 flex w-full items-center gap-3 rounded-full px-3.5 py-2 text-[13px] font-normal text-[#78716C] transition active:scale-[0.98]"
        >
          <Store size={17} strokeWidth={1.6} aria-hidden="true" className="text-[#A8A29E]" />
          <span className="flex-1 text-left">Kembali ke workspace</span>
        </Link>
        <AdminLogoutButton />
      </aside>

      <div className="px-5 py-6 lg:px-10 lg:py-8">
        {/* Mobile top nav — horizontally scrollable pills */}
        <div className="mb-6 lg:hidden">
          <p className="text-xs text-[#A8A29E]">Administrator</p>
          <h1 className="mt-1 text-[22px] font-medium tracking-tight">Admin / Pengaturan</h1>
          <div className="mt-4">
            <AdminNav variant="top" />
          </div>
        </div>
        <div className="mx-auto max-w-[820px]">{children}</div>
      </div>
    </div>
  );
}
