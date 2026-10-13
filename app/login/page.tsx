"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowRight, Flame, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const loginResponse = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (!loginResponse.ok) {
        const payload = await loginResponse.json().catch(() => null);
        setError(payload?.error ?? "Email atau password tidak cocok.");
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/pos");
      router.refresh();
    } catch {
      setError("Koneksi terputus. Periksa jaringan lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-dvh bg-[#FAF7F1] text-[#1C1917] lg:grid-cols-2">
      <aside className="relative hidden min-h-dvh overflow-hidden bg-[#E9D7B8] lg:block">
        <Image src="/landing/sate-taichan-hero.png" alt="Sate taichan segar" fill priority sizes="50vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#271707]/75 via-[#271707]/5 to-transparent" />
        <div className="absolute bottom-14 left-14 max-w-[520px] text-white" data-motion-hero>
          <span className="flex h-12 w-12 items-center justify-center rounded-[17px] bg-[#FDBD2C] text-[#1C1917]"><Flame size={24} /></span>
          <h2 className="mt-6 text-[clamp(40px,4.5vw,68px)] font-semibold leading-[1.06] tracking-[-.07em]">Good food.<br />Smooth operations.</h2>
          <p className="mt-4 text-[14px] leading-relaxed text-white/80">Semua pesanan, pembayaran, dan operasional dalam satu ruang kerja.</p>
        </div>
      </aside>
      <section className="flex min-h-dvh items-center justify-center px-6 py-14 sm:px-12" data-motion-card>
        <div className="w-full max-w-[430px]">
          <div className="flex items-center gap-3 lg:hidden"><span className="flex h-11 w-11 items-center justify-center rounded-[15px] bg-[#FDBD2C]"><Flame size={22} /></span><span className="text-[16px] font-semibold">Tempat Taichan</span></div>
          <div className="mb-10 hidden items-center gap-2.5 text-[#71675C] lg:flex"><ShieldCheck size={18} /> Staff workspace</div>
          <h1 id="login-title" className="mt-14 text-[42px] font-semibold leading-[1.1] tracking-[-.07em] sm:text-[50px] lg:mt-0">Selamat datang<br />kembali.</h1>
          <p className="mt-4 text-[14px] leading-relaxed text-[#827568]">Masuk untuk melanjutkan pekerjaan hari ini.</p>
          <form onSubmit={submit} className="mt-10 space-y-5" aria-labelledby="login-title">
            <label htmlFor="login-email" className="block"><span className="mb-2 block text-[13px] font-medium">Email staff</span><input id="login-email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="input h-[54px]" placeholder="nama@tempattaichan.id" /></label>
            <label htmlFor="login-password" className="block"><span className="mb-2 block text-[13px] font-medium">Password</span><input id="login-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="input h-[54px]" placeholder="Masukkan password" /></label>
            {error && <p id="login-error" role="alert" className="rounded-[17px] bg-[#FCE5D8] px-4 py-3 text-[13px] text-[#924929]">{error}</p>}
            <button type="submit" disabled={loading} aria-busy={loading} aria-describedby={error ? "login-error" : undefined} className="modern-action mt-3 h-[56px] w-full disabled:opacity-50">
              {loading ? "Memeriksa…" : "Masuk ke workspace"}
              {loading ? <Loader2 aria-hidden="true" size={17} className="animate-spin" /> : <ArrowRight aria-hidden="true" size={18} />}
            </button>
          </form>
          <p className="mt-11 flex items-center gap-2 text-[12px] text-[#978B7D]"><LockKeyhole size={15} /> Akses khusus staff yang terdaftar.</p>
        </div>
      </section>
    </main>
  );
}
