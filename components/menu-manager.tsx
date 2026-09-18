"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Archive, Edit3, Loader2, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { formatCompactIDR } from "@/lib/format";
import { cn } from "@/lib/utils";

type AdminProduct = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  categoryId: string;
  categoryName: string;
  priceIdr: number;
  estimatedCostIdr: number;
  available: boolean;
  active: boolean;
};
type Category = { id: string; name: string };
type FormState = { name: string; description: string; imageUrl: string; categoryId: string; priceIdr: string; estimatedCostIdr: string; available: boolean };

const blankForm: FormState = { name: "", description: "", imageUrl: "", categoryId: "", priceIdr: "", estimatedCostIdr: "", available: true };

export function MenuManager({ onShowNotice }: { onShowNotice: (message: string) => void }) {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<"create" | AdminProduct | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMenu() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/menu", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Menu belum dapat dimuat.");
      setCategories(payload.categories ?? []);
      setProducts((payload.products ?? []).map((product: Record<string, unknown>) => ({
        id: String(product.id), name: String(product.name), description: product.description as string | null, imageUrl: (product.image_path as string | null) ?? null,
        categoryId: String(product.category_id), categoryName: Array.isArray(product.categories) ? String((product.categories[0] as { name?: string } | undefined)?.name ?? "") : String((product.categories as { name?: string } | null)?.name ?? ""),
        priceIdr: Number(product.price_idr), estimatedCostIdr: Number(product.estimated_cost_idr), available: Boolean(product.available), active: Boolean(product.active),
      })));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Menu belum dapat dimuat."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadMenu(); }, []);

  const visibleProducts = useMemo(() => products.filter((product) => product.active === !showArchived && `${product.name} ${product.categoryName}`.toLowerCase().includes(query.toLowerCase())), [products, query, showArchived]);

  function openCreate() {
    setForm({ ...blankForm, categoryId: categories[0]?.id ?? "" });
    setEditor("create");
  }
  function openEdit(product: AdminProduct) {
    setForm({ name: product.name, description: product.description ?? "", imageUrl: product.imageUrl ?? "", categoryId: product.categoryId, priceIdr: String(product.priceIdr), estimatedCostIdr: String(product.estimatedCostIdr), available: product.available });
    setEditor(product);
  }

  async function saveProduct() {
    setSaving(true); setError(null);
    const body = { name: form.name, description: form.description || null, imageUrl: form.imageUrl || null, categoryId: form.categoryId, priceIdr: Number(form.priceIdr), estimatedCostIdr: Number(form.estimatedCostIdr), available: form.available };
    try {
      const isCreate = editor === "create";
      const response = await fetch(isCreate ? "/api/admin/menu" : `/api/admin/menu/${(editor as AdminProduct).id}`, { method: isCreate ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Menu belum berhasil disimpan.");
      setEditor(null); await loadMenu(); onShowNotice(isCreate ? "Produk dibuat." : "Produk diperbarui.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Menu belum berhasil disimpan."); }
    finally { setSaving(false); }
  }

  async function toggleAvailability(product: AdminProduct) {
    setProducts((current) => current.map((item) => item.id === product.id ? { ...item, available: !item.available } : item));
    const response = await fetch(`/api/admin/menu/${product.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ available: !product.available }) });
    if (!response.ok) { setProducts((current) => current.map((item) => item.id === product.id ? { ...item, available: product.available } : item)); onShowNotice("Ketersediaan gagal disimpan."); return; }
    onShowNotice(`${product.name} ditandai ${product.available ? "habis" : "tersedia"}.`);
  }

  async function archiveProduct(product: AdminProduct) {
    if (!window.confirm(`Arsipkan ${product.name}? Pesanan lama tetap tersimpan.`)) return;
    const response = await fetch(`/api/admin/menu/${product.id}`, { method: "DELETE" });
    if (!response.ok) { onShowNotice("Produk gagal diarsipkan."); return; }
    await loadMenu(); onShowNotice(`${product.name} diarsipkan.`);
  }

  return <div className="space-y-5"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><p className="text-[13px] font-bold uppercase tracking-wider text-stone-600">Katalog / Menu</p><h2 className="mt-1.5 text-2xl font-extrabold tracking-normal text-[#18181B] sm:text-[28px]">Menu & ketersediaan</h2><p className="mt-1 text-[13px] font-semibold leading-relaxed text-stone-600">Perubahan tersimpan ke Supabase dan berlaku saat checkout.</p></div><button onClick={openCreate} className="pos-press flex h-10 items-center justify-center gap-2 rounded-xl bg-[#FF381E] px-3.5 text-[13px] font-bold text-white shadow-md hover:bg-[#e03018]"><Plus size={15} /> Tambah produk</button></div><div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white shadow-xs"><div className="flex flex-col justify-between gap-3 border-b border-stone-100 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5"><div><h3 className="text-sm font-black uppercase tracking-wider text-[#18181B]">{showArchived ? "Produk arsip" : "Produk aktif"}</h3><p className="mt-0.5 text-[13px] font-semibold text-stone-600">{products.filter((product) => product.active).length} produk aktif · {categories.length} kategori</p></div><div className="flex gap-2"><div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-stone-600" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari menu" className="h-9 w-44 rounded-lg bg-[#FAF8F5] pl-8 pr-3 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#FF381E]" /></div><button onClick={() => setShowArchived(!showArchived)} className={cn("pos-press rounded-lg px-3 py-2 text-xs font-bold", showArchived ? "bg-[#18181B] text-white" : "bg-[#FAF8F5] text-stone-600")}>{showArchived ? "Aktif" : "Arsip"}</button></div></div>{error && <div className="pos-rise mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-600">{error}</div>}{loading ? <div className="flex items-center justify-center gap-2 py-16 text-[13px] font-semibold text-stone-600"><Loader2 size={16} className="animate-spin text-[#FF381E]" /> Memuat menu dari Supabase…</div> : <div className="divide-y divide-stone-100">{visibleProducts.map((product, i) => <div key={product.id} style={{ "--d": `${Math.min(i, 8) * 40}ms` } as CSSProperties} className="pos-rise flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-stone-50 sm:flex-row sm:items-center"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#FF381E]/10 text-sm font-black text-[#FF381E]">{product.name.slice(0, 1)}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-sm font-bold text-[#18181B]">{product.name}</p>{!product.available && product.active && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-extrabold uppercase tracking-wider text-stone-600">Habis</span>}</div><p className="mt-1 text-[13px] font-semibold text-stone-600">{product.categoryName} · {product.description || "Tanpa deskripsi"}</p></div><div className="flex items-center justify-between gap-5 sm:justify-end"><div><p className="text-[13px] font-semibold text-stone-600">Harga jual</p><p className="mt-1 text-[13px] font-black">{formatCompactIDR(product.priceIdr)}</p></div><div><p className="text-[13px] font-semibold text-stone-600">Est. modal</p><p className="mt-1 text-[13px] font-bold text-stone-600">{formatCompactIDR(product.estimatedCostIdr)}</p></div>{product.active && <button aria-label={`Toggle ${product.name}`} onClick={() => void toggleAvailability(product)} className={cn("pos-press relative h-7 w-[52px] rounded-full transition", product.available ? "bg-[#2f8062]" : "bg-stone-300")}><span className={cn("absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition", product.available ? "right-1" : "left-1")} /></button>}<button onClick={() => openEdit(product)} className="pos-press flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 text-stone-600 hover:border-[#FF381E]" aria-label={`Edit ${product.name}`}><Edit3 size={14} /></button>{product.active && <button onClick={() => void archiveProduct(product)} className="pos-press flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 text-stone-600 hover:border-[#FF381E]" aria-label={`Archive ${product.name}`}><Archive size={14} /></button>}<MoreHorizontal size={17} className="hidden text-stone-300 sm:block" /></div></div>)}{visibleProducts.length === 0 && <div className="px-5 py-14 text-center text-sm font-semibold text-stone-600">Tidak ada produk yang cocok.</div>}</div>}</div>{editor && <ProductEditor editor={editor} form={form} setForm={setForm} categories={categories} saving={saving} onClose={() => setEditor(null)} onSave={() => void saveProduct()} />}</div>;
}

function ProductEditor({ editor, form, setForm, categories, saving, onClose, onSave }: { editor: "create" | AdminProduct; form: FormState; setForm: (form: FormState) => void; categories: Category[]; saving: boolean; onClose: () => void; onSave: () => void }) { const isCreate = editor === "create"; return <div className="pos-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#18181B]/30 sm:items-center sm:p-5"><section className="pos-panel max-h-[92dvh] w-full max-w-[520px] overflow-y-auto rounded-t-[20px] bg-[#FAF8F5] p-5 shadow-2xl sm:rounded-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-stone-600">{isCreate ? "Produk baru" : "Ubah produk"}</p><h2 className="mt-1 text-2xl font-extrabold tracking-normal text-[#18181B]">{isCreate ? "Tambah ke menu" : (editor as AdminProduct).name}</h2></div><button onClick={onClose} className="pos-press flex h-8 w-8 items-center justify-center rounded-full bg-white text-stone-600 shadow-xs"><X size={16} /></button></div><div className="mt-6 space-y-4"><Field label="Nama produk"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Sate Taichan 10 Tusuk" className="input" /></Field><Field label="Kategori"><select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} className="input">{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field><Field label="Image URL"><input value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} placeholder="https://… (opsional)" className="input" /></Field><Field label="Deskripsi"><textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Deskripsi singkat menu" className="input resize-none" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Harga jual (IDR)"><input type="number" min="0" value={form.priceIdr} onChange={(event) => setForm({ ...form, priceIdr: event.target.value })} placeholder="28000" className="input" /></Field><Field label="Estimasi modal (IDR)"><input type="number" min="0" value={form.estimatedCostIdr} onChange={(event) => setForm({ ...form, estimatedCostIdr: event.target.value })} placeholder="10500" className="input" /></Field></div><label className="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-3 py-3"><span><span className="block text-[13px] font-bold">Tersedia dipesan</span><span className="mt-0.5 block text-[13px] font-semibold text-stone-600">Matikan untuk item habis.</span></span><input type="checkbox" checked={form.available} onChange={(event) => setForm({ ...form, available: event.target.checked })} className="h-4 w-4 accent-[#FF381E]" /></label></div><div className="mt-6 flex gap-2"><button onClick={onClose} className="pos-press h-11 flex-1 rounded-xl border border-stone-200 text-[13px] font-bold text-stone-600">Batal</button><button onClick={onSave} disabled={saving || !form.name || !form.categoryId || !form.priceIdr} className="pos-press flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#FF381E] text-[13px] font-bold text-white shadow-md hover:bg-[#e03018] disabled:bg-stone-200 disabled:shadow-none">{saving && <Loader2 size={14} className="animate-spin" />} {isCreate ? "Buat produk" : "Simpan perubahan"}</button></div></section></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-stone-600">{label}</span>{children}</label>; }
