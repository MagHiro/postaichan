import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Tags } from "lucide-react";
import { AdminHeader } from "@/components/admin/admin-header";
import { CategoryManager } from "@/components/category-manager";
import { authorizeStaff } from "@/lib/auth/authorize-staff";

export const metadata: Metadata = { title: "Kategori menu" };

export default async function CategoriesPage() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) redirect(auth.authenticated ? "/pos?forbidden=1" : "/login?next=/admin/categories");
  return (
    <>
      <AdminHeader
        icon={<Tags size={20} strokeWidth={1.8} aria-hidden="true" />}
        title="Kategori menu"
        description="Kategori tersimpan di database dan dipakai menu pelanggan, kasir, dan editor produk."
      />
      <div className="mt-6">
        <CategoryManager />
      </div>
    </>
  );
}
