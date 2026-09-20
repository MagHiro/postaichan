import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { GeneralQrManager } from "@/components/admin/general-qr-manager";
import { authorizeStaff } from "@/lib/auth/authorize-staff";

export const metadata: Metadata = { title: "QR umum" };

export default async function GeneralQrPage() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) redirect(auth.authenticated ? "/pos?forbidden=1" : "/login?next=/admin/general-qr");
  return <GeneralQrManager />;
}
