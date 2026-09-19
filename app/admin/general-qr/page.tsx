import { redirect } from "next/navigation";
import { GeneralQrManager } from "@/components/admin/general-qr-manager";
import { authorizeStaff } from "@/lib/auth/authorize-staff";

export default async function GeneralQrPage() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) redirect(auth.authenticated ? "/pos?forbidden=1" : "/login?next=/admin/general-qr");
  return <GeneralQrManager />;
}
