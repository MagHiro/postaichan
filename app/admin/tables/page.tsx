import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { TableManager } from "@/components/table-manager";
import { authorizeStaff } from "@/lib/auth/authorize-staff";

export const metadata: Metadata = { title: "Meja & QR" };

export default async function TablesPage() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) redirect(auth.authenticated ? "/pos?forbidden=1" : "/login?next=/admin/tables");
  return <TableManager />;
}
