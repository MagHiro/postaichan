import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Gift } from "lucide-react";

export function LandingPage() {
  return (
    <main className="flex h-[100dvh] w-full justify-center overflow-hidden bg-[#FAFAFA] text-neutral-900 antialiased selection:bg-[#FDBD2C] selection:text-neutral-900">
      <div className="flex h-full min-h-0 w-full max-w-[440px] flex-col overflow-hidden bg-[#FAFAFA]">
        <section className="relative min-h-0 flex-1 overflow-hidden bg-neutral-900 text-white">
          <Image
            src="/landing/sate-taichan-hero.png"
            alt="Sate taichan panggang dengan sambal dan jeruk limau"
            fill
            priority
            sizes="(max-width: 440px) 100vw, 440px"
            className="object-cover"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-neutral-900/40 via-neutral-900/5 to-neutral-900/80"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-r from-neutral-900/50 via-neutral-900/10 to-transparent"
          />

          <div className="relative z-10 flex h-full flex-col px-5 pb-12 pt-[calc(1.25rem+env(safe-area-inset-top))]">
            <div className="mt-auto max-w-[320px]">
              <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-white/70">
                Bara &amp; Burn
              </p>
              <h1 className="mt-3 text-[44px] font-medium leading-[0.95] tracking-tight">
                HAI,
                <br />
                KAMU.
              </h1>
              <p className="mt-4 max-w-[280px] text-[13px] leading-relaxed text-white/90">
                Sate taichan panas, sambal fresh, siap bikin nagih.
              </p>
            </div>
          </div>
        </section>

        <section
          aria-label="Tentang Bara & Burn"
          className="flex shrink-0 items-center justify-between gap-4 border-b border-neutral-100 px-5 py-5"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Gift aria-hidden="true" size={20} strokeWidth={2} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">Bara &amp; Burn</p>
              <p className="mt-0.5 truncate text-xs text-neutral-400">
                Grilled satay &amp; smash burger
              </p>
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-2 text-[11px] font-medium text-neutral-900">
            <BadgeCheck aria-hidden="true" size={16} strokeWidth={2} />
            Fresh dibakar
          </span>
        </section>

        <section className="shrink-0 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-6">
          <Link
            href="/order"
            className="group shadow-soft flex h-12 w-full items-center justify-between rounded-full bg-[#FDBD2C] px-5 text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98]"
          >
            <span>Pesan sekarang</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-white transition group-hover:bg-neutral-800">
              <ArrowRight aria-hidden="true" size={18} strokeWidth={2} />
            </span>
          </Link>
        </section>
      </div>
    </main>
  );
}
