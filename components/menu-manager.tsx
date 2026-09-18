"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
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
  const activeCount = products.filter((product) => product.active).length;

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
    if (!window.confirm(`Arsipkan ${product.name}?`)) return;
    const response = await fetch(`/api/admin/menu/${product.id}`, { method: "DELETE" });
    if (!response.ok) { onShowNotice("Produk gagal diarsipkan."); return; }
    await loadMenu(); onShowNotice(`${product.name} diarsipkan.`);
  }

  return (
    <div>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <h2 className="hidden text-[22px] font-medium leading-snug tracking-tight lg:block">Menu</h2>
          <p className="text-[13px] text-neutral-500 lg:mt-1">{activeCount} produk aktif · perubahan berlaku saat checkout</p>
        </div>
        <button
          onClick={openCreate}
          className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#FDBD2C] px-5 text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98]"
        >
          <Plus size={15} /> Tambah
        </button>
      </div>

      <div className="relative mt-6">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari menu…"
          className="w-full rounded-full bg-neutral-100 py-2.5 pl-10 pr-10 text-sm outline-none placeholder:text-neutral-400 focus:bg-white focus:ring-2 focus:ring-[#FDBD2C]/50"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            aria-label="Hapus pencarian"
            className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        {(
          [
            { key: false, label: "Aktif" },
            { key: true, label: "Arsip" },
          ] as const
        ).map(({ key, label }) => (
          <button
            key={label}
            onClick={() => setShowArchived(key)}
            aria-pressed={showArchived === key}
            className={cn(
              "flex h-10 items-center rounded-full border px-4 text-[13px] transition active:scale-[0.98]",
              showArchived === key ? "border-neutral-900 bg-neutral-900 font-medium text-white" : "border-neutral-200 font-normal text-neutral-500",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="mt-6 text-center text-[13px] text-neutral-500">{error}</p>}

      <div className="mt-2">
        {loading ? (
          <p className="py-14 text-center text-[13px] text-neutral-500">Memuat menu…</p>
        ) : visibleProducts.length ? (
          <div className="divide-y divide-neutral-100">
            {visibleProducts.map((product) => (
              <div key={product.id} className="flex items-center gap-3 py-2">
                <button
                  onClick={() => openEdit(product)}
                  className="min-w-0 flex-1 rounded-2xl px-2 py-2.5 text-left active:bg-neutral-50"
                  aria-label={`Ubah ${product.name}`}
                >
                  <p className="truncate text-[14px] font-medium">
                    {product.name}
                    {!product.available && product.active ? <span className="font-normal text-neutral-400"> · Habis</span> : ""}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-neutral-400">
                    {product.categoryName} · {formatCompactIDR(product.priceIdr)}
                  </p>
                </button>
                {product.active ? (
                  <button
                    onClick={() => void toggleAvailability(product)}
                    aria-label={`${product.name}: ${product.available ? "tersedia" : "habis"}`}
                    aria-pressed={product.available}
                    className={cn(
                      "flex h-11 shrink-0 items-center rounded-full px-5 text-[13px] font-medium active:scale-[0.98]",
                      product.available ? "bg-neutral-100 text-neutral-900" : "bg-neutral-900 text-white",
                    )}
                  >
                    {product.available ? "Tersedia" : "Habis"}
                  </button>
                ) : (
                  <button
                    onClick={() => openEdit(product)}
                    className="flex h-11 shrink-0 items-center rounded-full px-5 text-[13px] font-medium text-neutral-900 active:bg-neutral-50"
                  >
                    Ubah
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-5 py-14 text-center">
            <p className="text-sm font-medium">Tidak ada produk cocok.</p>
            <p className="mt-1 text-[13px] text-neutral-500">Coba kata kunci lain.</p>
          </div>
        )}
      </div>

      {editor && (
        <ProductEditor
          editor={editor}
          form={form}
          setForm={setForm}
          categories={categories}
          saving={saving}
          onClose={() => setEditor(null)}
          onSave={() => void saveProduct()}
          onArchive={
            editor === "create" || !(editor as AdminProduct).active
              ? undefined
              : (product) => {
                  setEditor(null);
                  void archiveProduct(product);
                }
          }
        />
      )}
    </div>
  );
}

function ProductEditor({ editor, form, setForm, categories, saving, onClose, onSave, onArchive }: { editor: "create" | AdminProduct; form: FormState; setForm: (form: FormState) => void; categories: Category[]; saving: boolean; onClose: () => void; onSave: () => void; onArchive?: (product: AdminProduct) => void }) {
  const isCreate = editor === "create";
  return (
    <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/30 sm:items-center sm:p-5" onClick={onClose}>
      <section
        className="ord-sheet max-h-[92vh] w-full max-w-[520px] overflow-y-auto rounded-t-[28px] bg-white p-5 sm:rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mx-auto h-1 w-9 rounded-full bg-neutral-200 sm:hidden" />
        <div className="mt-2 flex items-start justify-between sm:mt-0">
          <div>
            <p className="text-xs text-neutral-400">{isCreate ? "Produk baru" : "Ubah produk"}</p>
            <h2 className="mt-1 text-lg font-medium tracking-tight">{isCreate ? "Tambah ke menu" : (editor as AdminProduct).name}</h2>
          </div>
          <button onClick={onClose} aria-label="Tutup" className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 active:scale-95">
            <X size={15} />
          </button>
        </div>

        <div className="mt-6 space-y-7">
          <Field label="Nama produk">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Sate Taichan 10 Tusuk" className="input" />
          </Field>
          <Field label="Kategori">
            <select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} className="input">
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </Field>
          <Field label="URL gambar · opsional">
            <input value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} placeholder="https://…" className="input" />
          </Field>
          <Field label="Deskripsi">
            <textarea rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Deskripsi singkat" className="input resize-none" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Harga jual">
              <input type="number" min="0" value={form.priceIdr} onChange={(event) => setForm({ ...form, priceIdr: event.target.value })} placeholder="28000" className="input tabular-nums" />
            </Field>
            <Field label="Est. modal">
              <input type="number" min="0" value={form.estimatedCostIdr} onChange={(event) => setForm({ ...form, estimatedCostIdr: event.target.value })} placeholder="10500" className="input tabular-nums" />
            </Field>
          </div>
          <button
            onClick={() => setForm({ ...form, available: !form.available })}
            className="flex w-full items-center justify-between py-1 text-left"
          >
            <span className="text-[13px] font-medium">Tersedia dipesan</span>
            <span className="text-[13px] font-normal text-neutral-500">{form.available ? "Ya" : "Tidak"}</span>
          </button>
        </div>

        <div className="mt-8 space-y-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <button
            onClick={onSave}
            disabled={saving || !form.name || !form.categoryId || !form.priceIdr}
            className="h-[52px] w-full rounded-2xl bg-[#FDBD2C] text-[15px] font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
          >
            {saving ? "Menyimpan…" : isCreate ? "Tambah" : "Simpan"}
          </button>
          {!isCreate && onArchive && (
            <button
              onClick={() => onArchive(editor as AdminProduct)}
              className="h-11 w-full rounded-full text-[13px] font-normal text-neutral-400 active:bg-neutral-50"
            >
              Arsipkan produk
            </button>
          )}
          <button onClick={onClose} className="h-11 w-full rounded-full text-[13px] font-normal text-neutral-500 active:bg-neutral-50">
            Batal
          </button>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-3 block text-[13px] font-medium">{label}</span>{children}</label>;
}
