import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { CategoryManager } from "@/components/category-manager";
import { authorizeStaff } from "@/lib/auth/authorize-staff";

export const metadata: Metadata = { title: "Kategori menu" };

export default async function CategoriesPage() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) redirect(auth.authenticated ? "/pos?forbidden=1" : "/login?next=/admin/categories");
  return (
    <main className="min-h-screen bg-[#FAF7F1] px-5 py-8 text-[#1C1917] lg:px-10">
      <div className="mx-auto max-w-[820px]">
        <p className="text-xs text-[#A8A29E]">Administrator</p>
        <h1 className="mt-1 text-[22px] font-medium tracking-tight">Kategori menu</h1>
        <p className="mt-1 text-[13px] text-[#78716C]">Kategori tersimpan di database dan dipakai menu pelanggan, kasir, dan editor produk.</p>
        <div className="mt-6">
          <CategoryManager />
        </div>
      </div>
    </main>
  );
}
