import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { getDailyReport } from "@/lib/reports";
import { formatIDR } from "@/lib/format";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

function makePdf(report: Awaited<ReturnType<typeof getDailyReport>>) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Tempat Taichan Daily Report ${report.date}` } });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    const orange = "#ed5b38";
    document.fillColor("#211d1a").fontSize(22).font("Helvetica-Bold").text("Tempat Taichan");
    document.fillColor("#7e7770").fontSize(10).font("Helvetica").text("Daily operations report · Asia/Jakarta");
    document.moveDown(0.4).fillColor(orange).fontSize(13).font("Helvetica-Bold").text(report.date);
    document.moveDown(1).fillColor("#211d1a").fontSize(12).font("Helvetica-Bold").text("Summary");
    const summary = [
      ["Gross revenue", formatIDR(report.revenueIdr)],
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
    document.moveDown(1.5).fillColor("#9b9189").font("Helvetica-Oblique").fontSize(8).text("Estimated gross profit = revenue − snapshot COGS − known payment fees. This is not accounting net profit.");
    document.end();
  });
}

export async function GET(request: Request) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: "Staff authorization required." }, { status: 401, headers: noStoreHeaders() });
  try {
    const date = new URL(request.url).searchParams.get("date") ?? undefined;
    const pdf = await makePdf(await getDailyReport(createAdminClient(), date));
    return new Response(new Uint8Array(pdf), { headers: { ...noStoreHeaders(), "content-type": "application/pdf", "content-disposition": `attachment; filename="tempat-taichan-daily-${date ?? "report"}.pdf"` } });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_REPORT_DATE") return NextResponse.json({ error: "Tanggal laporan tidak valid." }, { status: 400, headers: noStoreHeaders() });
    console.error("daily_pdf_failed", error);
    return NextResponse.json({ error: "Daily PDF could not be generated." }, { status: 503, headers: noStoreHeaders() });
  }
}
