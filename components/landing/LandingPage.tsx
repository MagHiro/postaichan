import Image from "next/image";
import Link from "next/link";
import { formatCompactIDR } from "@/lib/format";

type TeaserItem = { id: string; name: string; price: number; imageUrl: string | null };

export function LandingPage({
  tableLabel,
  tableInvalid = false,
  orderHref,
  teaser,
  cashierOpen = true,
}: {
  tableLabel: string | null;
  tableInvalid?: boolean;
  orderHref: string;
  teaser: TeaserItem[];
  cashierOpen?: boolean;
}) {
  return (
    <main className="flex min-h-dvh justify-center bg-[#FAF7F1] text-[#1C1917] antialiased selection:bg-[#FDBD2C] selection:text-[#1C1917]">
      <div className="w-full max-w-[440px] bg-[#FAF7F1] px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
        <header className="sticky top-0 z-30 -mx-5 border-b border-[#E9E1D1] bg-[#FAF7F1]/90 px-5 pb-3 pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur-md">
          <div className="relative flex items-center justify-center">
            <Image
              src="/logo.png"
              alt="Bara & Burn"
              width={240}
              height={44}
              priority
              className="h-11 w-auto max-w-[240px] object-contain"
            />
            {tableLabel && (
              <p className="absolute right-0 max-w-[110px] truncate text-xs text-[#A8A29E]">
                {tableLabel}
              </p>
            )}
          </div>
        </header>

        <div className="ord-rise">
          <section aria-label="Sate taichan Bara & Burn" className="mt-6 overflow-hidden rounded-2xl bg-[#F3EFE6]">
            <Image
              src="/landing/sate-taichan-hero.png"
              alt="Sate taichan panggang dengan sambal dan jeruk limau"
              width={800}
              height={500}
              priority
              sizes="(max-width: 440px) 100vw, 440px"
              className="aspect-[16/10] w-full object-cover"
            />
          </section>

          <h1 className="mt-6 text-[22px] font-medium leading-snug tracking-tight">
            Sate taichan panas, sambal fresh.
          </h1>
          <p className="mt-1 text-[13px] text-[#78716C]">
            Siap bikin nagih — dibakar fresh saat dipesan.
          </p>

          {tableLabel ? (
            <section
              aria-label="Meja kamu"
              className="mt-6 rounded-2xl border border-[#EFE7D6] bg-[#FFFEFB] p-4 shadow-soft"
            >
              <p className="text-xs text-[#A8A29E]">Kamu di</p>
              <p className="mt-0.5 truncate text-[15px] font-medium tabular-nums">
                {tableLabel}
                <span className="text-[#A8A29E]"> · Dine in</span>
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-[#78716C]">
                Tetap di mejamu — pesanan diantar ke sini.
              </p>
            </section>
          ) : tableInvalid ? (
            <p role="alert" className="mt-6 text-center text-[13px] leading-relaxed text-[#78716C]">
              QR meja sudah tidak aktif. Minta QR terbaru dari kasir, atau lanjut sebagai takeaway.
            </p>
          ) : null}

          {!cashierOpen && (
            <p role="status" className="mt-6 rounded-2xl bg-[#F3EFE6] p-4 text-center text-[13px] leading-relaxed text-[#78716C]">
              Kasir sedang tutup. Menu bisa dilihat, tapi pesanan belum bisa dibuat.
            </p>
          )}

          <div className="mt-6">
            <Link
              href={orderHref}
              className="flex h-12 w-full items-center justify-center rounded-full bg-[#FDBD2C] text-sm font-medium text-[#1C1917] transition hover:bg-[#ECA90F] active:scale-[0.98]"
            >
              {tableLabel ? `Mulai pesan · ${tableLabel}` : "Pesan sekarang"}
            </Link>
            <p className="mt-3 text-center text-xs text-[#A8A29E]">Bayar via QRIS</p>
          </div>

          {teaser.length > 0 && (
            <section aria-label="Menu populer" className="mt-10">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-medium">Populer saat ini</h2>
                <span className="text-xs text-[#A8A29E]">{teaser.length} menu</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-7">
                {teaser.map((item) => (
                  <Link
                    key={item.id}
                    href={orderHref}
                    aria-label={`Pesan ${item.name}`}
                    className="flex min-w-0 flex-col active:scale-[0.98]"
                  >
                    <span className="relative aspect-square w-full overflow-hidden rounded-2xl bg-[#F3EFE6]">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span aria-hidden="true" className="flex h-full w-full items-center justify-center text-lg font-medium text-[#A8A29E]">
                          {item.name.charAt(0)}
                        </span>
                      )}
                    </span>
                    <span className="mt-2 truncate text-[13px] font-medium leading-snug">
                      {item.name}
                    </span>
                    <span className="mt-0.5 text-[13px] tabular-nums text-[#78716C]">
                      {formatCompactIDR(item.price)}
                    </span>
                  </Link>
                ))}
              </div>
              <Link
                href={orderHref}
                className="mt-8 flex h-12 w-full items-center justify-center rounded-full text-sm text-[#78716C] transition active:scale-[0.98]"
              >
                Lihat semua menu
              </Link>
            </section>
          )}

          <p className="mt-10 text-center text-xs text-[#A8A29E]">
            Bara &amp; Burn · Grilled satay &amp; smash burger
          </p>
        </div>
      </div>
    </main>
  );
}
