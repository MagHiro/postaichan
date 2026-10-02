"use client";

import type { Category } from "@/lib/types";
import { ALL_CATEGORIES_ID } from "@/components/order/constants";
import { cn } from "@/lib/utils";

export function CategoryDropdown({
  id = "category-filter",
  value,
  categories,
  onChange,
  allLabel = "Semua Menu",
  className,
  dark = false,
}: {
  id?: string;
  value: string;
  categories: Category[];
  onChange: (id: string) => void;
  allLabel?: string;
  className?: string;
  dark?: boolean;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={id} className="sr-only">
        Filter kategori
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={
          dark
            ? "select mt-0 h-12 w-full rounded-2xl bg-[#F3EFE6] text-[#1C1917]"
            : "h-12 w-full appearance-none rounded-2xl bg-neutral-100 px-4 pr-10 text-[13px] text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:bg-white focus:ring-2 focus:ring-[#FDBD2C]/50"
        }
        style={
          dark
            ? undefined
            : {
                backgroundImage:
                  "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5 6 6.5 11 1.5' fill='none' stroke='%23A8A29E' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 1rem center",
                backgroundSize: "12px 8px",
              }
        }
      >
        <option value={ALL_CATEGORIES_ID}>{allLabel}</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </div>
  );
}
