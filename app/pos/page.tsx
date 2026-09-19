import { redirect } from "next/navigation";
import { PosWorkspaceLive } from "@/components/pos-workspace-live";
import { authorizeStaff } from "@/lib/auth/authorize-staff";

export default async function PosPage() {
  const auth = await authorizeStaff("operator");
  if (!auth.allowed) redirect(auth.authenticated ? "/login?error=inactive" : "/login?next=/pos");
  return <PosWorkspaceLive role={auth.role ?? "operator"} />;
}
