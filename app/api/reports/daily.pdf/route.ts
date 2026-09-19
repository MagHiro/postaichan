import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { getReport } from "@/lib/reports";
import { formatIDR } from "@/lib/format";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

function makePdf(report: Awaited<ReturnType<typeof getReport>>) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Tempat Taichan Sales Report ${report.from} - ${report.to}` } });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    const orange = "#FDBD2C";
    document.fillColor("#211d1a").fontSize(22).font("Helvetica-Bold").text("Tempat Taichan");
    document.fillColor("#7e7770").fontSize(10).font("Helvetica").text("Daily operations report · Asia/Jakarta");
    document.moveDown(0.4).fillColor(orange).fontSize(13).font("Helvetica-Bold").text(report.from === report.to ? report.from : `${report.from} — ${report.to}`);
    document.moveDown(1).fillColor("#211d1a").fontSize(12).font("Helvetica-Bold").text("Summary");
    const summary = [
      ["Gross sales", formatIDR(report.grossRevenueIdr)],
      ["Refunds", formatIDR(report.refundsIdr)],
      ["Net sales", formatIDR(report.netRevenueIdr)],
      ["Paid orders", String(report.orderCount)],
      ["Average order value", formatIDR(report.averageOrderValueIdr)],
      ["Estimated COGS", formatIDR(report.estimatedCogsIdr)],
      ["Payment fees", formatIDR(report.paymentFeesIdr)],
      ["Estimated gross profit", formatIDR(report.estimatedGrossProfitIdr)],
    ];
    summary.forEach(([label, value]) => { document.moveDown(0.35).fillColor("#7e7770").font("Helvetica").fontSize(10).text(label, 56, document.y, { continued: true }).fillColor("#211d1a").font("Helvetica-Bold").text(`  ${value}`); });
    document.moveDown(1).fillColor("#211d1a").fontSize(12).font("Helvetica-Bold").text("Order mix");
    document.moveDown(0.35).fillColor("#7e7770").font("Helvetica").fontSize(10).text(`Dine in: ${formatIDR(report.dineInRevenueIdr)}    Takeaway: ${formatIDR(report.takeawayRevenueIdr)}`);
    document.moveDown(1).fillColor("#211d1a").fontSize(12).font("Helvetica-Bold").text("Best sellers");
    report.bestSellers.forEach((item, index) => { document.moveDown(0.3).fillColor("#211d1a").font("Helvetica").fontSize(10).text(`${index + 1}. ${item.name} — ${item.quantity} portions — ${formatIDR(item.revenueIdr)}`); });
    document.moveDown(1).fillColor("#211d1a").fontSize(12).font("Helvetica-Bold").text("Paid orders");
    report.orders.forEach((order) => { document.moveDown(0.3).fillColor("#7e7770").font("Helvetica").fontSize(9).text(`${order.orderNumber}  ${order.type.replace("_", " ")}  ${formatIDR(order.totalIdr)}  ${order.status}`); });
    document.moveDown(1.5).fillColor("#9b9189").font("Helvetica-Oblique").fontSize(8).text("Period uses payment settlement time in Asia/Jakarta. Refunds use their processed time. Estimated gross profit is not accounting net profit.");
    document.end();
  });
}

export async function GET(request: Request) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  try {
    const params = new URL(request.url).searchParams;
    const date = params.get("date") ?? undefined;
    const from = params.get("from") ?? date;
    const to = params.get("to") ?? date;
    const report = await getReport(from ?? undefined, to ?? undefined);
    const pdf = await makePdf(report);
    return new Response(new Uint8Array(pdf), { headers: { ...noStoreHeaders(), "content-type": "application/pdf", "content-disposition": `attachment; filename="tempat-taichan-report-${report.from}-${report.to}.pdf"` } });
  } catch (error) {
    if (error instanceof Error && ["INVALID_REPORT_DATE", "REPORT_RANGE_LIMIT"].includes(error.message)) return NextResponse.json({ error: error.message === "REPORT_RANGE_LIMIT" ? "Rentang laporan maksimal 31 hari." : "Tanggal laporan tidak valid." }, { status: 400, headers: noStoreHeaders() });
    console.error("daily_pdf_failed", error);
    return NextResponse.json({ error: "Daily PDF could not be generated." }, { status: 503, headers: noStoreHeaders() });
  }
}
