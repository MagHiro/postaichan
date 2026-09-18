import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { z } from "zod";

export const runtime = "nodejs";
const statusSchema = z.object({ status: z.enum(["accepted", "processing", "ready", "completed", "cancelled"]) });
const transitions: Record<string, string[]> = { paid: ["accepted", "processing", "cancelled"], accepted: ["processing", "cancelled"], processing: ["ready", "cancelled"], ready: ["completed"], completed: [] };

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: "Staff authorization required." }, { status: 401 });
  const parsed = statusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid order status." }, { status: 400 });
  const { id } = await params;
  try {
    const supabase = createAdminClient();
    const { data: current, error: currentError } = await supabase.from("orders").select("status").eq("id", id).single();
    if (currentError) throw currentError;
    if (!(transitions[current.status] ?? []).includes(parsed.data.status)) return NextResponse.json({ error: "Order cannot move to that status." }, { status: 409 });
    const { error } = await supabase.from("orders").update({ status: parsed.data.status }).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true, status: parsed.data.status });
  } catch (error) {
    console.error("pos_order_status_failed", error);
    return NextResponse.json({ error: "Order status could not be updated." }, { status: 503 });
  }
}
