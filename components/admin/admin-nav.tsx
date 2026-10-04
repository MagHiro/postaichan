"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Armchair, QrCode, Tags, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ADMIN_NAV = [
  { href: "/admin/tables", label: "Meja & QR", icon: Armchair },
  { href: "/admin/general-qr", label: "QR umum", icon: QrCode },
  { href: "/admin/staff", label: "Akun staff", icon: Users },
  { href: "/admin/categories", label: "Kategori menu", icon: Tags },
] as const;

export function AdminNav({ variant = "sidebar" }: { variant?: "sidebar" | "top" }) {
  const pathname = usePathname();
  if (variant === "top") {
    return (
      <nav aria-label="Navigasi admin" className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max gap-1.5">
          {ADMIN_NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[13px] transition active:scale-[0.98]",
                  active ? "bg-[#FDBD2C]/20 font-medium text-[#1C1917]" : "font-normal text-[#78716C]",
                )}
              >
                <Icon size={15} strokeWidth={active ? 2 : 1.6} aria-hidden="true" className={active ? "text-[#1C1917]" : "text-[#A8A29E]"} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    );
  }
  return (
    <nav aria-label="Navigasi admin" className="space-y-1">
      {ADMIN_NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-full px-3.5 py-2 text-[13px] transition active:scale-[0.98]",
              active ? "bg-[#FDBD2C]/20 font-medium text-[#1C1917]" : "font-normal text-[#78716C]",
            )}
          >
            <Icon size={17} strokeWidth={active ? 2 : 1.6} aria-hidden="true" className={active ? "text-[#1C1917]" : "text-[#A8A29E]"} />
            <span className="flex-1 text-left">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
