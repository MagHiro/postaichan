import type { ReactNode } from "react";

export function AdminHeader({
  icon,
  eyebrow = "Administrator",
  title,
  description,
  actions,
}: {
  icon: ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0">
        <p className="text-xs text-[#A8A29E]">{eyebrow}</p>
        <h1 className="mt-1 flex items-center gap-2 text-[22px] font-medium tracking-tight">
          <span aria-hidden="true" className="text-[#A8A29E]">
            {icon}
          </span>
          {title}
        </h1>
        {description && <p className="mt-1 text-[13px] text-[#78716C]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
