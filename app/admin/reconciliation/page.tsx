import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { ReconciliationManager } from "@/components/admin/reconciliation-manager";

export const metadata: Metadata = { title: "Rekonsiliasi pembayaran" };

export default async function ReconciliationPage() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) redirect(auth.authenticated ? "/pos?forbidden=1" : "/login?next=/admin/reconciliation");
  return <ReconciliationManager />;
}
