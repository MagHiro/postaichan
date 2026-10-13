import type { ReactNode } from "react";

export function AdminHeader({
  icon, eyebrow, title, description, actions,
}: {
  icon: ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-center" data-motion-stagger>
      <div className="flex min-w-0 items-start gap-4">
        <span aria-hidden="true" className="flex h-13 w-13 shrink-0 items-center justify-center rounded-[18px] bg-[#FDBD2C] text-[#1C1917] shadow-[0_12px_30px_-19px_rgba(191,116,13,.5)]">
          {icon}
        </span>
        <div className="min-w-0">
          {eyebrow && eyebrow !== "Administrator" && <p className="mb-1 text-[12px] text-[#958878]">{eyebrow}</p>}
          <h1 className="text-[27px] font-semibold leading-[1.15] tracking-[-.06em] sm:text-[36px]">{title}</h1>
          {description && <p className="mt-2 max-w-[650px] text-[13px] leading-[1.8] text-[#85776A]">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
