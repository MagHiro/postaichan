"use client";

import type { Category } from "@/lib/types";
import { ALL_CATEGORIES_ID } from "@/components/order/constants";
import { WarmSelect } from "@/components/warm-select";
import { cn } from "@/lib/utils";

export function CategoryDropdown({
  id = "category-filter",
  value,
  categories,
  onChange,
  allLabel = "Semua Menu",
  className,
}: {
  id?: string;
  value: string;
  categories: Category[];
  onChange: (id: string) => void;
  allLabel?: string;
  className?: string;
}) {
  return (
    <WarmSelect
      id={id}
      label="Filter kategori"
      value={value}
      onChange={onChange}
      placeholder={allLabel}
      className={cn("min-w-0", className)}
      options={[
        { value: ALL_CATEGORIES_ID, label: allLabel },
        ...categories.map((category) => ({ value: category.id, label: category.name })),
      ]}
    />
  );
}
