import type { Metadata } from "next";
import { Printer } from "lucide-react";
import { AdminHeader } from "@/components/admin/admin-header";
import { ReceiptSettingsManager } from "@/components/admin/receipt-settings-manager";

export const metadata: Metadata = { title: "Struk & printer" };
export default function ReceiptSettingsPage() {
  return (
    <>
      <AdminHeader icon={<Printer size={20} />} title="Struk & printer"
        description="Atur tampilan struk dan UUID untuk printer thermal Bluetooth LE ESC/POS. Pengaturan berlaku untuk semua kasir." />
      <ReceiptSettingsManager />
    </>
  );
}
