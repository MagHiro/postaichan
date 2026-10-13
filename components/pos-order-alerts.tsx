"use client";
import { Bell, BellRing, Volume2, VolumeX } from "lucide-react";

export type AlertPrefs = { muted: boolean; voice: boolean; notifications: boolean };
export function PosOrderAlerts({
  prefs, onMute, onVoice, onNotifications, notificationAvailable, notificationPermission,
}: {
  prefs: AlertPrefs;
  onMute: (next: boolean) => void;
  onVoice: (next: boolean) => void;
  onNotifications: () => void;
  notificationAvailable: boolean;
  notificationPermission: NotificationPermission | "unsupported";
}) {
  return (
    <details className="group relative z-50">
      <summary className="flex h-10 min-w-10 cursor-pointer list-none items-center justify-center gap-1.5 rounded-full bg-[#F3EFE6] px-3 text-[12px] font-medium text-[#1C1917] marker:hidden [&::-webkit-details-marker]:hidden">
        {prefs.notifications || prefs.voice ? <BellRing size={18} /> : <Bell size={18} />}
        <span className="hidden xl:inline">Notifikasi</span>
        <span className="sr-only">Pengaturan notifikasi pesanan</span>
      </summary>
      <section className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(310px,calc(100vw-2rem))] rounded-[22px] border border-[#EFE7D6] bg-[#FFFEFB] p-4 shadow-xl" aria-label="Notifikasi pesanan">
        <p className="mb-1 text-[14px] font-semibold">Pemberitahuan pesanan</p>
        <p className="mb-3 text-xs leading-relaxed text-[#78716C]">Berlaku di browser ini selama kasir dibuka.</p>
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 border-t border-[#EFE7D6] py-2 text-[13px]">
          <span className="inline-flex items-center gap-2">{prefs.muted ? <VolumeX size={16} /> : <Volume2 size={16} />} Bunyi pesanan</span>
          <input type="checkbox" checked={!prefs.muted} onChange={e => onMute(!e.target.checked)} className="h-5 w-5 accent-[#C58B1B]" />
        </label>
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 border-t border-[#EFE7D6] py-2 text-[13px]">
          <span>Narasi suara Bahasa Indonesia</span>
          <input type="checkbox" checked={prefs.voice} onChange={e => onVoice(e.target.checked)} className="h-5 w-5 accent-[#C58B1B]" />
        </label>
        <div className="border-t border-[#EFE7D6] py-3">
          <button type="button" onClick={onNotifications} disabled={!notificationAvailable || notificationPermission === "denied"}
            className="min-h-10 w-full rounded-xl bg-[#FDBD2C] px-3 text-xs font-semibold disabled:opacity-50">
            {prefs.notifications ? "Matikan notifikasi browser" : "Aktifkan notifikasi browser"}
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[#78716C]">
            {!notificationAvailable ? "Browser ini tidak mendukung notifikasi langsung. iPhone biasanya memerlukan web app terpasang." :
              notificationPermission === "denied" ? "Izin notifikasi diblokir; aktifkan di pengaturan browser." :
              "Notifikasi hanya dikirim saat halaman kasir masih terbuka. Tidak termasuk push saat aplikasi ditutup."}
          </p>
        </div>
      </section>
    </details>
  );
}
