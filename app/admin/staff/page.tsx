import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { StaffManager } from "@/components/admin/staff-manager";
import { authorizeStaff } from "@/lib/auth/authorize-staff";

export const metadata: Metadata = { title: "Akun staff" };

export default async function StaffPage() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) redirect(auth.authenticated ? "/pos?forbidden=1" : "/login?next=/admin/staff");
  return <StaffManager />;
}
