import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const acquiring = pool.connect().then((client) => {
    if (timedOut) client.release();
    return client;
  });
  try {
    const client = await Promise.race([
      acquiring,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error("readiness_timeout"));
        }, 2_000);
      }),
    ]);
    if (timer) clearTimeout(timer);
    timer = undefined;
    let queryTimedOut = false;
    try {
      await Promise.race([
        client.query("select 1"),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            queryTimedOut = true;
            reject(new Error("readiness_query_timeout"));
          }, 1_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      timer = undefined;
      client.release(queryTimedOut ? new Error("readiness_query_timeout") : undefined);
    }
    return NextResponse.json({ status: "ready" }, {
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ status: "not_ready" }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Retry-After": "3" },
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
