import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Clock3, Flame, MapPin, QrCode, Sparkles } from "lucide-react";
import { formatCompactIDR } from "@/lib/format";

type TeaserItem = { id: string; name: string; price: number; imageUrl: string | null };

export function LandingPage({
  tableLabel, tableInvalid = false, orderHref, teaser, cashierOpen = true,
}: {
  tableLabel: string | null;
  tableInvalid?: boolean;
  orderHref: string;
  teaser: TeaserItem[];
  cashierOpen?: boolean;
}) {
  return (
    <main className="min-h-dvh bg-[#FAF7F1] text-[#1C1917]">
      <div className="mx-auto max-w-[1440px] px-5 pb-14 sm:px-9 lg:px-16">
        <header className="flex items-center justify-between gap-4 py-6 sm:py-8" data-motion-stagger>
          <Link href="/" aria-label="Bara & Burn — Beranda" className="flex items-center gap-3">
            <Image src="/logo.png" alt="Bara & Burn" width={192} height={48} priority className="h-10 w-auto max-w-[175px] object-contain" />
          </Link>
          <div className="flex items-center gap-3">
            {tableLabel && <span className="hidden items-center gap-2 rounded-full bg-[#F1EBDC] px-4 py-2 text-[12px] font-medium sm:inline-flex"><MapPin size={15} />{tableLabel}</span>}
            <Link href={orderHref} className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#1C1917] px-5 text-[13px] font-semibold text-white hover:bg-[#423529]">
              Lihat menu <ArrowUpRight size={16} />
            </Link>
          </div>
        </header>

        <section className="relative grid items-center gap-8 pt-6 lg:grid-cols-[.92fr_1.08fr] lg:gap-16 lg:pb-12 lg:pt-10">
          <div className="order-2 pb-3 lg:order-1" data-motion-hero>
            <span className="inline-flex items-center gap-2 rounded-full bg-[#F5EAD1] px-4 py-2 text-[12px] font-medium text-[#6A4B1B]">
              <Flame size={15} fill="#FDBD2C" /> Fresh from the grill
            </span>
            <h1 className="mt-6 max-w-[700px] text-[clamp(43px,5.6vw,86px)] font-semibold leading-[1.02] tracking-[-.075em]">
              Sedapnya<br />dimulai dari <span className="text-[#E5A417]">bara.</span>
            </h1>
            <p className="mt-6 max-w-[480px] text-[15px] leading-[1.9] text-[#71675C] lg:text-[17px]">
              Sate taichan yang selalu dibakar fresh, sambal yang bikin balik lagi, dan pesanan yang sampai tanpa ribet.
            </p>
            {tableInvalid && <p role="alert" className="mt-4 rounded-2xl bg-[#F5EAD1] p-4 text-[13px] text-[#6A4B1B]">QR meja sudah tidak aktif. Minta QR terbaru dari kasir atau lanjut tanpa meja.</p>}
            {!cashierOpen && <p role="status" className="mt-4 rounded-2xl bg-[#F5EAD1] p-4 text-[13px] text-[#6A4B1B]">Kasir sedang tutup. Menu masih bisa dilihat, tetapi pesanan belum dapat dibuat.</p>}
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href={orderHref} className="modern-action min-w-[210px]">
                {tableLabel ? `Pesan dari ${tableLabel}` : "Mulai pesan"} <ArrowRight size={19} />
              </Link>
              <span className="flex items-center gap-2 text-[13px] text-[#71675C]"><QrCode size={18} /> Bayar mudah dengan QRIS</span>
            </div>
            <div className="mt-12 flex items-center gap-8 border-t border-[#EDE5D7] pt-7 text-[#71675C]">
              <span className="flex items-center gap-2 text-[12px] sm:text-[13px]"><Flame size={16} className="text-[#D49B24]" /> Dibakar fresh</span>
              <span className="flex items-center gap-2 text-[12px] sm:text-[13px]"><Clock3 size={16} className="text-[#D49B24]" /> Cepat & praktis</span>
            </div>
          </div>
          <div className="relative order-1 lg:order-2" data-motion-hero>
            <div className="absolute -right-4 -top-4 h-48 w-48 rounded-full bg-[#FDBD2C]/30 blur-3xl lg:h-80 lg:w-80" aria-hidden="true" />
            <div className="relative overflow-hidden rounded-[30px] bg-[#E9DAC0] shadow-[0_35px_95px_-30px_rgba(96,55,12,.3)] lg:rounded-[44px]">
              <Image src="/landing/sate-taichan-hero.png" alt="Sate taichan panggang segar dengan sambal" width={1000} height={1100} priority sizes="(max-width: 1024px) 100vw, 56vw" className="aspect-[1.2/1] w-full object-cover lg:aspect-[.9/1]" />
              <div className="absolute bottom-5 left-5 flex items-center gap-3 rounded-[19px] bg-[#FFFEFB]/95 px-4 py-3 shadow-[0_13px_36px_rgba(45,32,13,.15)] backdrop-blur-sm sm:bottom-7 sm:left-7">
                <span className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-[#FDBD2C]"><Sparkles size={20} /></span>
                <div><p className="text-[13px] font-semibold">Selalu fresh</p><p className="text-[11px] text-[#78716C]">Dibuat saat kamu pesan</p></div>
              </div>
            </div>
          </div>
        </section>

        {teaser.length > 0 && (
          <section className="mt-16 lg:mt-24" aria-label="Menu populer" data-motion-reveal>
            <div className="mb-7 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-[30px] font-semibold leading-tight tracking-[-.06em] sm:text-[44px]">Favorit semua orang.</h2>
                <p className="mt-2 text-[13px] leading-relaxed text-[#78716C]">Pilihan yang paling sering bikin nambah lagi.</p>
              </div>
              <Link href={orderHref} className="hidden items-center gap-2 rounded-full bg-[#F0E8D9] px-5 py-3 text-[13px] font-medium hover:bg-[#E5DBC9] sm:inline-flex">Semua menu <ArrowUpRight size={16} /></Link>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 lg:gap-6" data-motion-stagger>
              {teaser.slice(0, 8).map((item) => (
                <Link key={item.id} href={orderHref} className="group modern-tile overflow-hidden p-2.5 sm:p-3" aria-label={`Pesan ${item.name}`}>
                  <div className="aspect-[1.06/1] overflow-hidden rounded-[17px] bg-[#EFE5D5] sm:rounded-[20px]">
                    {item.imageUrl ? <img src={item.imageUrl} alt={item.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" /> :
                      <div className="flex h-full items-center justify-center"><Flame size={32} strokeWidth={1.4} className="text-[#D5A243]" /></div>}
                  </div>
                  <div className="flex items-start justify-between gap-2 px-1 pb-2 pt-4">
                    <div className="min-w-0"><h3 className="truncate text-[13px] font-semibold sm:text-[15px]">{item.name}</h3><p className="mt-1 text-[12px] text-[#78716C] sm:text-[13px]">{formatCompactIDR(item.price)}</p></div>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F7EDDB] transition-colors group-hover:bg-[#FDBD2C]"><ArrowUpRight size={16} /></span>
                  </div>
                </Link>
              ))}
            </div>
            <Link href={orderHref} className="modern-action mt-7 w-full sm:hidden">Jelajahi menu <ArrowRight size={17} /></Link>
          </section>
        )}
        <footer className="mt-20 flex flex-col justify-between gap-4 border-t border-[#ECE4D5] pt-7 text-[12px] text-[#928778] sm:flex-row">
          <span className="font-medium text-[#605449]">Bara &amp; Burn</span>
          <span>Fresh off the grill. Made for the moment.</span>
        </footer>
      </div>
    </main>
  );
}
