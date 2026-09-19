import { redirect } from "next/navigation";
import { TableManager } from "@/components/table-manager";
import { authorizeStaff } from "@/lib/auth/authorize-staff";

export default async function TablesPage() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) redirect(auth.authenticated ? "/pos?forbidden=1" : "/login?next=/admin/tables");
  return <TableManager />;
}
