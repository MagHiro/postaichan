"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

export function AdminLogoutButton() {
  const [loggingOut, setLoggingOut] = useState(false);

  async function doLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* revoke failed — still bounce to login; session cookie stays httpOnly */
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <button
      type="button"
      onClick={() => void doLogout()}
      disabled={loggingOut}
      className="mt-1 flex w-full items-center gap-3 rounded-full px-3.5 py-2 text-[13px] font-normal text-[#78716C] transition active:scale-[0.98] disabled:opacity-50"
    >
      <LogOut size={17} strokeWidth={1.6} aria-hidden="true" className="text-[#A8A29E]" />
      <span className="flex-1 text-left">{loggingOut ? "Keluar…" : "Keluar"}</span>
    </button>
  );
}
