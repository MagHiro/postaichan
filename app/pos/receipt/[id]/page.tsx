import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { loadReceipt } from "@/lib/receipt-data";
import { uuidParamSchema } from "@/lib/schemas";
import { formatIDR } from "@/lib/format";
import { ReceiptActions } from "@/components/receipt-actions";

export const metadata: Metadata = { title: "Cetak struk" };
export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff();
  if (!auth.allowed) redirect("/login?next=/pos");
  const { id } = await params;
  if (!uuidParamSchema.safeParse(id).success) notFound();
  const receipt = await loadReceipt(id);
  if (!receipt) notFound();
  const date = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }).format(new Date(receipt.createdAt));
  return (
    <main className="receipt-page min-h-screen bg-[#FAF7F1] py-5 text-[#1C1917] print:bg-white print:p-0">
      <ReceiptActions receipt={receipt} />
      <article className="receipt-paper mx-auto bg-white px-4 py-6 font-mono text-[12px] leading-[1.6] text-black shadow-lg print:mx-0 print:shadow-none"
        style={{ width: receipt.settings.paper_width_mm === 80 ? "80mm" : "58mm", maxWidth: "100%" }}>
        <header className="border-b border-dashed border-black pb-3 text-center">
          <p className="break-words text-[15px] font-bold">{receipt.settings.merchant_name}</p>
          {receipt.settings.address && <p className="mt-1 whitespace-pre-wrap break-words">{receipt.settings.address}</p>}
        </header>
        <section className="space-y-1 border-b border-dashed border-black py-3">
          <p className="font-bold">{receipt.orderNumber}</p>
          <p>{date} WIB</p>
          {receipt.customerName && <p className="break-words">Nama: {receipt.customerName}</p>}
          {receipt.tableLabel && <p>Meja: {receipt.tableLabel}</p>}
        </section>
        <section className="space-y-3 border-b border-dashed border-black py-3">
          {receipt.lines.map((line, i) => (
            <div key={i}>
              <p className="break-words font-semibold">{line.quantity} × {line.name}</p>
              {line.modifiers.map((option, k) => <p className="break-words pl-2" key={k}>+ {option}</p>)}
              {line.note && <p className="break-words pl-2">Catatan: {line.note}</p>}
              <div className="flex justify-between gap-2"><span>{formatIDR(line.unitPriceIdr)} /pc</span><span>{formatIDR(line.lineTotalIdr)}</span></div>
            </div>
          ))}
        </section>
        <section className="space-y-1 py-3">
          <div className="flex justify-between gap-2"><span>Subtotal</span><span>{formatIDR(receipt.subtotalIdr)}</span></div>
          <div className="flex justify-between gap-2 text-[13px] font-bold"><span>TOTAL</span><span>{formatIDR(receipt.totalIdr)}</span></div>
          <p>Bayar: {receipt.paymentLabel}</p>
          <p>Status: {receipt.paymentStatus === "settled" ? "Lunas" : "Belum lunas"}</p>
        </section>
        {receipt.settings.footer && <footer className="border-t border-dashed border-black pt-3 text-center whitespace-pre-wrap break-words">{receipt.settings.footer}</footer>}
      </article>
    </main>
  );
}
