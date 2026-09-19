"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(null);
    const loginResponse = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    if (!loginResponse.ok) { const payload = await loginResponse.json().catch(() => null); setError(payload?.error ?? "Email atau password tidak cocok."); setLoading(false); return; }
    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/pos"); router.refresh();
  }

  return <main className="flex min-h-screen items-center justify-center bg-white px-5 text-neutral-900"><section className="w-full max-w-[420px] border border-neutral-100 bg-white p-6"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-[#FDBD2C] text-xl font-medium text-neutral-900">T</div><div><p className="text-sm font-medium">Tempat Taichan</p><p className="text-xs uppercase tracking-wide text-neutral-400">Staff workspace</p></div></div><h1 className="mt-10 text-[22px] font-medium tracking-tight">Masuk ke workspace.</h1><p className="mt-2 text-[13px] text-neutral-500">Gunakan akun staff yang sudah diprovisioning administrator.</p><form onSubmit={submit} className="mt-7 space-y-4"><label className="block"><span className="mb-1.5 block text-[13px] font-medium text-neutral-600">Email</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="input h-11" placeholder="staff@tempattaichan.id" /></label><label className="block"><span className="mb-1.5 block text-[13px] font-medium text-neutral-600">Password</span><input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" className="input h-11" placeholder="••••••••" /></label>{error && <p className="text-[13px] text-neutral-500">{error}</p>}<button disabled={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#FDBD2C] text-sm font-medium text-neutral-900 disabled:opacity-50">{loading ? <Loader2 size={16} className="animate-spin" /> : <>Masuk <ArrowRight size={16} /></>}</button></form></section></main>;
}
