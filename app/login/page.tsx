"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(null);
    const { error: signInError } = await createClient().auth.signInWithPassword({ email, password });
    if (signInError) { setError("Email atau password tidak cocok."); setLoading(false); return; }
    const profileResponse = await fetch("/api/auth/profile", { method: "POST" });
    if (!profileResponse.ok) { setError("Akun masuk, tetapi profil staff belum siap."); setLoading(false); return; }
    router.replace("/pos"); router.refresh();
  }

  return <main className="flex min-h-screen items-center justify-center bg-[#faf8f4] px-5 text-[#211d1a]"><section className="w-full max-w-[420px] rounded-[20px] border border-[#e7e0d9] bg-white p-6 shadow-[0_18px_50px_rgba(54,37,27,0.08)]"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-[#ed5b38] text-xl font-bold text-white">T</div><div><p className="text-sm font-bold">Tempat Taichan</p><p className="text-[10px] uppercase tracking-[0.14em] text-[#aaa099]">Staff workspace</p></div></div><h1 className="mt-10 text-[28px] font-semibold tracking-[-0.05em]">Welcome back.</h1><p className="mt-2 text-sm text-[#91877e]">Sign in to manage today&apos;s orders and close the counter.</p><form onSubmit={submit} className="mt-7 space-y-4"><label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#6d635b]">Email</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="input h-11" placeholder="staff@tempattaichan.id" /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#6d635b]">Password</span><input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="input h-11" placeholder="••••••••" /></label>{error && <p className="rounded-[9px] bg-[#fff0eb] px-3 py-2 text-xs text-[#c95134]">{error}</p>}<button disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-[11px] bg-[#ed5b38] text-sm font-semibold text-white disabled:bg-[#d9cbc2]">{loading ? <Loader2 size={16} className="animate-spin" /> : <>Sign in <ArrowRight size={16} /></>}</button></form></section></main>;
}
