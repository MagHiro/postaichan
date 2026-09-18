"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Download, ExternalLink, QrCode, Sparkles } from "lucide-react";

const tables = Array.from({ length: 8 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return { label: `Table ${number}`, code: `TBL-${number}`, token: `TBL-${number}-preview-token` };
});

export function QrManager() {
  const [selected, setSelected] = useState(tables[3]);
  const [dataUrl, setDataUrl] = useState("");
  const [origin, setOrigin] = useState("http://localhost:3000");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const customerUrl = useMemo(() => `${origin}/order/t/${selected.token}`, [origin, selected]);

  useEffect(() => {
    QRCode.toDataURL(customerUrl, { width: 720, margin: 3, color: { dark: "#211d1a", light: "#ffffff" } })
      .then(setDataUrl)
      .catch(() => setDataUrl(""));
  }, [customerUrl]);

  function downloadQr() {
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `tempat-taichan-${selected.code.toLowerCase()}-qr.png`;
    link.click();
  }

  return <main className="min-h-screen bg-[#f7f6f3] px-5 py-8 text-[#211d1a] lg:px-10"><div className="mx-auto max-w-[1100px]"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-[#a39a92]"><span className="h-2 w-2 rounded-full bg-[#ed5b38]" /> Tempat Taichan · Admin</div><h1 className="mt-2 text-[30px] font-semibold tracking-normal">Table QR codes</h1><p className="mt-1 text-sm font-semibold text-[#918881]">Give each table its own doorway into the guest ordering flow.</p></div><a href="/pos" className="text-[13px] font-semibold text-[#ed5b38]">Back to POS →</a></div><div className="mt-7 grid gap-5 lg:grid-cols-[1fr_380px]"><section className="rounded-[16px] border border-[#e7e3de] bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Choose a table</h2><p className="mt-1 text-[13px] font-semibold text-[#9d948d]">Scan a QR to open the customer menu for that table.</p></div><QrCode size={18} className="text-[#ed5b38]" /></div><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{tables.map((table) => <button key={table.code} onClick={() => setSelected(table)} className={`rounded-[12px] border p-4 text-left transition ${selected.code === table.code ? "border-[#ed5b38] bg-[#fff3ed]" : "border-[#eee8e2] bg-[#fcfbfa] hover:border-[#edb5a4]"}`}><div className={`flex h-9 w-9 items-center justify-center rounded-[9px] ${selected.code === table.code ? "bg-[#ed5b38] text-white" : "bg-[#f1ece7] text-[#80756d]"}`}><QrCode size={17} /></div><p className="mt-3 text-[13px] font-semibold">{table.label}</p><p className="mt-1 text-[13px] font-semibold text-[#aaa099]">{table.code}</p></button>)}</div></section><section className="rounded-[16px] border border-[#e7e3de] bg-white p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-[#a39a92]">Selected table</p><h2 className="mt-1 text-2xl font-semibold tracking-normal">{selected.label}</h2></div><span className="rounded-full bg-[#fff3dd] px-2.5 py-1 text-[13px] font-semibold text-[#a8771b]">Preview token</span></div><div className="mt-5 flex justify-center rounded-[14px] bg-[#faf8f4] p-5">{dataUrl ? <img src={dataUrl} alt={`QR code for ${selected.label}`} className="h-[220px] w-[220px] rounded-[8px]" /> : <div className="flex h-[220px] w-[220px] items-center justify-center text-[13px] font-semibold text-[#9c928a]">Generating QR…</div>}</div><div className="mt-4 rounded-[10px] bg-[#f7f4f0] p-3"><p className="text-xs font-semibold uppercase tracking-wide text-[#aaa099]">Customer URL</p><p className="mt-1 break-all text-[13px] font-semibold text-[#6f655d]">{customerUrl}</p></div><div className="mt-4 flex gap-2"><button onClick={downloadQr} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-[9px] bg-[#ed5b38] text-[13px] font-semibold text-white"><Download size={15} /> Download PNG</button><a href={customerUrl} target="_blank" rel="noreferrer" className="flex h-10 items-center justify-center gap-2 rounded-[9px] border border-[#e5ddd6] px-3 text-[13px] font-semibold text-[#6f655d]"><ExternalLink size={14} /> Test</a></div><div className="mt-5 flex gap-2 rounded-[10px] border border-[#f1dfb3] bg-[#fff9e9] p-3 text-[13px] font-semibold leading-relaxed text-[#8f7435]"><Sparkles size={14} className="mt-0.5 shrink-0" /> This preview QR uses a readable demo token. Before printing for customers, replace it with a server-issued signed or opaque token that can be regenerated from the admin tables screen.</div></section></div></div></main>;
}
