import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { PosWorkspaceLive } from "@/components/pos-workspace-live";
import { authorizeStaff } from "@/lib/auth/authorize-staff";

export const metadata: Metadata = { title: "Workspace" };

export default async function PosPage() {
  const auth = await authorizeStaff("operator");
  if (!auth.allowed) redirect(auth.authenticated ? "/login?error=inactive" : "/login?next=/pos");
  return <PosWorkspaceLive role={auth.role ?? "operator"} />;
}
