"use client";

import { useEffect, useMemo, useState } from "react";
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
      setEditor(null); await loadMenu(); onShowNotice(isCreate ? "Product created." : "Product updated.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Menu belum berhasil disimpan."); }
    finally { setSaving(false); }
  }

  async function toggleAvailability(product: AdminProduct) {
    setProducts((current) => current.map((item) => item.id === product.id ? { ...item, available: !item.available } : item));
    const response = await fetch(`/api/admin/menu/${product.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ available: !product.available }) });
    if (!response.ok) { setProducts((current) => current.map((item) => item.id === product.id ? { ...item, available: product.available } : item)); onShowNotice("Availability could not be saved."); return; }
    onShowNotice(`${product.name} marked ${product.available ? "unavailable" : "available"}.`);
  }

  async function archiveProduct(product: AdminProduct) {
    if (!window.confirm(`Archive ${product.name}? Historical orders will keep their snapshot.`)) return;
    const response = await fetch(`/api/admin/menu/${product.id}`, { method: "DELETE" });
    if (!response.ok) { onShowNotice("Product could not be archived."); return; }
    await loadMenu(); onShowNotice(`${product.name} archived.`);
  }

  return <div className="space-y-6"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><p className="text-xs font-medium text-[#8b827b]">Catalog / Menu</p><h2 className="mt-2 text-[28px] font-semibold tracking-[-0.05em]">Menu & availability</h2><p className="mt-1 text-sm text-[#918982]">Changes save to Supabase and become authoritative at checkout.</p></div><button onClick={openCreate} className="flex h-10 items-center justify-center gap-2 rounded-[9px] bg-[#ed5b38] px-3.5 text-xs font-semibold text-white"><Plus size={15} /> Add product</button></div><div className="rounded-[14px] border border-[#e7e3de] bg-white"><div className="flex flex-col justify-between gap-3 border-b border-[#eeeae5] px-5 py-4 sm:flex-row sm:items-center"><div><h3 className="text-sm font-semibold">{showArchived ? "Archived products" : "Active products"}</h3><p className="mt-0.5 text-[11px] text-[#99908a]">{products.filter((product) => product.active).length} active products · {categories.length} categories</p></div><div className="flex gap-2"><div className="relative"><Search size={14} className="absolute left-3 top-2.5 text-[#aaa19a]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search menu" className="h-9 w-44 rounded-[8px] bg-[#f7f6f3] pl-8 pr-3 text-[11px] outline-none focus:ring-1 focus:ring-[#edb5a4]" /></div><button onClick={() => setShowArchived(!showArchived)} className={cn("rounded-[8px] px-3 text-[10px] font-semibold", showArchived ? "bg-[#211d1a] text-white" : "bg-[#f7f6f3] text-[#847a72]")}>{showArchived ? "Active" : "Archived"}</button></div></div>{error && <div className="mx-5 mt-4 rounded-[9px] border border-[#f0c8bc] bg-[#fff3ef] px-3 py-2 text-xs text-[#c65035]">{error}</div>}{loading ? <div className="flex items-center justify-center gap-2 py-16 text-xs text-[#978d85]"><Loader2 size={16} className="animate-spin" /> Loading menu from Supabase…</div> : <div className="divide-y divide-[#f0ece8]">{visibleProducts.map((product) => <div key={product.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[9px] bg-[#fff0e9] text-sm font-bold text-[#ed5b38]">{product.name.slice(0, 1)}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-sm font-semibold">{product.name}</p>{!product.available && product.active && <span className="rounded-full bg-[#f2eeeb] px-2 py-0.5 text-[9px] font-semibold text-[#8e847c]">Sold out</span>}</div><p className="mt-1 text-[10px] text-[#9c938b]">{product.categoryName} · {product.description || "No description"}</p></div><div className="flex items-center justify-between gap-5 sm:justify-end"><div><p className="text-[10px] text-[#aaa19a]">Selling price</p><p className="mt-1 text-xs font-semibold">{formatCompactIDR(product.priceIdr)}</p></div><div><p className="text-[10px] text-[#aaa19a]">Est. cost</p><p className="mt-1 text-xs font-semibold text-[#7c736c]">{formatCompactIDR(product.estimatedCostIdr)}</p></div>{product.active && <button aria-label={`Toggle ${product.name}`} onClick={() => void toggleAvailability(product)} className={cn("relative h-7 w-[52px] rounded-full transition", product.available ? "bg-[#2f8062]" : "bg-[#d9d3ce]")}><span className={cn("absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition", product.available ? "right-1" : "left-1")} /></button>}<button onClick={() => openEdit(product)} className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#e6dfd8] text-[#776d65] hover:border-[#edb5a4]" aria-label={`Edit ${product.name}`}><Edit3 size={14} /></button>{product.active && <button onClick={() => void archiveProduct(product)} className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#e6dfd8] text-[#a16654] hover:border-[#dca795]" aria-label={`Archive ${product.name}`}><Archive size={14} /></button>}<MoreHorizontal size={17} className="text-[#aaa19a]" /></div></div>)}{visibleProducts.length === 0 && <div className="px-5 py-14 text-center text-sm text-[#918881]">No products match this view.</div>}</div>}</div>{editor && <ProductEditor editor={editor} form={form} setForm={setForm} categories={categories} saving={saving} onClose={() => setEditor(null)} onSave={() => void saveProduct()} />}</div>;
}

function ProductEditor({ editor, form, setForm, categories, saving, onClose, onSave }: { editor: "create" | AdminProduct; form: FormState; setForm: (form: FormState) => void; categories: Category[]; saving: boolean; onClose: () => void; onSave: () => void }) { const isCreate = editor === "create"; return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#251b16]/30 sm:items-center sm:p-5"><section className="w-full max-w-[520px] rounded-t-[20px] bg-[#faf8f4] p-5 shadow-2xl sm:rounded-[18px]"><div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a49b92]">{isCreate ? "New product" : "Edit product"}</p><h2 className="mt-1 text-2xl font-semibold tracking-[-0.05em]">{isCreate ? "Add to menu" : (editor as AdminProduct).name}</h2></div><button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#7b7169]"><X size={16} /></button></div><div className="mt-6 space-y-4"><Field label="Product name"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Sate Taichan 10 Tusuk" className="input" /></Field><Field label="Category"><select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} className="input">{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field><Field label="Image URL"><input value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} placeholder="https://… (optional)" className="input" /></Field><Field label="Description"><textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Short menu description" className="input resize-none" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Selling price (IDR)"><input type="number" min="0" value={form.priceIdr} onChange={(event) => setForm({ ...form, priceIdr: event.target.value })} placeholder="28000" className="input" /></Field><Field label="Estimated cost (IDR)"><input type="number" min="0" value={form.estimatedCostIdr} onChange={(event) => setForm({ ...form, estimatedCostIdr: event.target.value })} placeholder="10500" className="input" /></Field></div><label className="flex items-center justify-between rounded-[10px] border border-[#e7dfd8] bg-white px-3 py-3"><span><span className="block text-xs font-semibold">Available for ordering</span><span className="mt-0.5 block text-[10px] text-[#9c938b]">Turn off for sold-out items.</span></span><input type="checkbox" checked={form.available} onChange={(event) => setForm({ ...form, available: event.target.checked })} className="h-4 w-4 accent-[#ed5b38]" /></label></div><div className="mt-6 flex gap-2"><button onClick={onClose} className="h-11 flex-1 rounded-[10px] border border-[#e1d9d2] text-xs font-semibold text-[#756b63]">Cancel</button><button onClick={onSave} disabled={saving || !form.name || !form.categoryId || !form.priceIdr} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[10px] bg-[#ed5b38] text-xs font-semibold text-white disabled:bg-[#e3d9d2]">{saving && <Loader2 size={14} className="animate-spin" />} {isCreate ? "Create product" : "Save changes"}</button></div></section></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.1em] text-[#938980]">{label}</span>{children}</label>; }
