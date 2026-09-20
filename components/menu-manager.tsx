"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { formatCompactIDR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDialogFocus } from "@/components/use-dialog-focus";

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
  sellable: boolean;
  active: boolean;
  stockTracked: boolean;
  stockQuantity: number;
};
type Category = { id: string; name: string };
type FormState = { name: string; description: string; imagePath: string; categoryId: string; priceIdr: string; estimatedCostIdr: string; available: boolean; stockTracked: boolean; stockQuantity: string };

const blankForm: FormState = { name: "", description: "", imagePath: "", categoryId: "", priceIdr: "", estimatedCostIdr: "", available: true, stockTracked: false, stockQuantity: "0" };

export function MenuManager({ onShowNotice }: { onShowNotice: (message: string) => void }) {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<"create" | AdminProduct | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingImagePaths = useRef(new Set<string>());

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
        priceIdr: Number(product.price_idr), estimatedCostIdr: Number(product.estimated_cost_idr), available: Boolean(product.available), sellable: Boolean(product.available) && (!Boolean(product.stock_tracked) || Number(product.stock_quantity ?? 0) > 0), active: Boolean(product.active), stockTracked: Boolean(product.stock_tracked), stockQuantity: Number(product.stock_quantity ?? 0),
      })));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Menu belum dapat dimuat."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadMenu(); }, []);

  const visibleProducts = useMemo(() => products.filter((product) => product.active === !showArchived && `${product.name} ${product.categoryName}`.toLowerCase().includes(query.toLowerCase())), [products, query, showArchived]);
  const activeCount = products.filter((product) => product.active).length;

  function openCreate() {
    void cleanupPendingImages();
    setForm({ ...blankForm, categoryId: categories[0]?.id ?? "" });
    setEditor("create");
  }
  function openEdit(product: AdminProduct) {
    void cleanupPendingImages();
    setForm({ name: product.name, description: product.description ?? "", imagePath: product.imageUrl ?? "", categoryId: product.categoryId, priceIdr: String(product.priceIdr), estimatedCostIdr: String(product.estimatedCostIdr), available: product.available, stockTracked: product.stockTracked, stockQuantity: String(product.stockQuantity) });
    setEditor(product);
  }

  async function cleanupPendingImages() {
    const paths = [...pendingImagePaths.current];
    await Promise.all(paths.map(async (imagePath) => {
      try {
        const response = await fetch("/api/admin/menu/upload", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ imagePath }) });
        if (response.ok) pendingImagePaths.current.delete(imagePath);
      } catch {
        // A later close or save can retry cleanup without risking a referenced file.
      }
    }));
  }

  function closeEditor() {
    if (saving || uploading) return;
    void cleanupPendingImages();
    setEditor(null);
  }

  async function saveProduct() {
    setSaving(true); setError(null);
    const body = { name: form.name, description: form.description || null, imagePath: form.imagePath || null, categoryId: form.categoryId, priceIdr: Number(form.priceIdr), estimatedCostIdr: Number(form.estimatedCostIdr), available: form.available, stockTracked: form.stockTracked, stockQuantity: form.stockTracked ? Number(form.stockQuantity) : 0 };
    try {
      const isCreate = editor === "create";
      const response = await fetch(isCreate ? "/api/admin/menu" : `/api/admin/menu/${(editor as AdminProduct).id}`, { method: isCreate ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Menu belum berhasil disimpan.");
      await cleanupPendingImages();
      setEditor(null); await loadMenu(); onShowNotice(isCreate ? "Produk dibuat." : "Produk diperbarui.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Menu belum berhasil disimpan."); }
    finally { setSaving(false); }
  }

  async function uploadImage(file: File) {
    setUploading(true); setError(null);
    try {
      const body = new FormData();
      body.append("image", file);
      const response = await fetch("/api/admin/menu/upload", { method: "POST", body });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Gambar belum dapat diunggah.");
      const nextPath = String(payload.imagePath);
      pendingImagePaths.current.add(nextPath);
      setForm((current) => ({ ...current, imagePath: nextPath }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Gambar belum dapat diunggah.");
    } finally { setUploading(false); }
  }

  async function toggleAvailability(product: AdminProduct) {
    setProducts((current) => current.map((item) => item.id === product.id ? { ...item, available: !item.available, sellable: !item.available && (!item.stockTracked || item.stockQuantity > 0) } : item));
    try {
      const response = await fetch(`/api/admin/menu/${product.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ available: !product.available }) });
      if (!response.ok) throw new Error("Ketersediaan gagal disimpan.");
      onShowNotice(`${product.name} ditandai ${product.available ? "habis" : "tersedia"}.`);
    } catch {
      setProducts((current) => current.map((item) => item.id === product.id ? { ...item, available: product.available, sellable: product.sellable } : item));
      onShowNotice("Koneksi terputus. Ketersediaan belum berubah.");
    }
  }

  async function archiveProduct(product: AdminProduct) {
    if (!window.confirm(`Hapus ${product.name} dari menu? Produk tidak akan mengubah riwayat pesanan.`)) return;
    try {
      const response = await fetch(`/api/admin/menu/${product.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Produk gagal diarsipkan.");
      await loadMenu(); onShowNotice(`${product.name} diarsipkan.`);
    } catch {
      onShowNotice("Koneksi terputus. Produk belum diarsipkan.");
    }
  }

  async function restoreProduct(product: AdminProduct) {
    try {
      const response = await fetch(`/api/admin/menu/${product.id}`, { method: "POST" });
      if (!response.ok) throw new Error("Produk gagal dipulihkan.");
      await loadMenu(); onShowNotice(`${product.name} dipulihkan.`);
    } catch {
      onShowNotice("Koneksi terputus. Produk belum dipulihkan.");
    }
  }

  return (
    <div>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <h2 className="hidden text-[22px] font-medium leading-snug tracking-tight lg:block">Menu</h2>
          <p className="text-[13px] text-neutral-500 lg:mt-1">{activeCount} produk aktif · perubahan berlaku saat checkout</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#FDBD2C] px-5 text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98]"
        >
          <Plus size={15} /> Tambah
        </button>
      </div>

      <div className="relative mt-6">
        <label htmlFor="menu-manager-search" className="sr-only">Cari menu</label>
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          id="menu-manager-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari menu…"
          className="w-full rounded-full bg-neutral-100 py-2.5 pl-10 pr-10 text-sm outline-none placeholder:text-neutral-400 focus:bg-white focus:ring-2 focus:ring-[#FDBD2C]/50"
        />
        {query && (
          <button
            type="button"
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
            type="button"
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

      {error && <div role="alert" className="mt-6 flex flex-col items-center gap-3 rounded-2xl bg-neutral-50 px-4 py-4 text-center text-[13px] text-neutral-600"><p>{error}</p><button type="button" onClick={() => void loadMenu()} className="h-10 rounded-full bg-neutral-900 px-4 text-[13px] font-medium text-white">Coba lagi</button></div>}

      <div className="mt-2">
        {loading ? (
          <p className="py-14 text-center text-[13px] text-neutral-500">Memuat menu…</p>
        ) : visibleProducts.length ? (
          <div className="divide-y divide-neutral-100">
            {visibleProducts.map((product) => (
              <div key={product.id} className="flex items-center gap-3 py-2">
                <button
                  type="button"
                  onClick={() => openEdit(product)}
                  className="min-w-0 flex-1 rounded-2xl px-2 py-2.5 text-left active:bg-neutral-50"
                  aria-label={`Ubah ${product.name}`}
                >
                  <p className="truncate text-[14px] font-medium">
                    {product.name}
                    {product.active && product.stockTracked && product.stockQuantity <= 0 ? <span className="font-normal text-neutral-400"> · Habis</span> : product.active && !product.available ? <span className="font-normal text-neutral-400"> · Manual off</span> : ""}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-neutral-400">
                    {product.categoryName} · {formatCompactIDR(product.priceIdr)}{product.stockTracked ? ` · ${product.stockQuantity} tersisa` : " · unlimited"}
                  </p>
                </button>
                {product.active ? (
                  <button
                    type="button"
                    onClick={() => void toggleAvailability(product)}
                    aria-label={`${product.name}: ${product.available ? "tersedia" : "habis"}`}
                    aria-pressed={product.available}
                    className={cn(
                      "flex h-11 shrink-0 items-center rounded-full px-5 text-[13px] font-medium active:scale-[0.98]",
                      product.available ? "bg-neutral-100 text-neutral-900" : "bg-neutral-900 text-white",
                    )}
                  >
                    {product.available ? (product.sellable ? "Manual aktif" : "Stok habis") : "Manual off"}
                  </button>
                ) : (
                  <button
                    type="button"
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
          error={error}
          saving={saving}
          uploading={uploading}
          onClose={closeEditor}
          onSave={() => void saveProduct()}
          onUpload={(file) => void uploadImage(file)}
          onArchive={
            editor === "create" || !(editor as AdminProduct).active
              ? undefined
              : (product) => {
                  void cleanupPendingImages();
                  setEditor(null);
                  void archiveProduct(product);
                }
          }
          onRestore={
            editor !== "create" && !(editor as AdminProduct).active
              ? (product) => { void cleanupPendingImages(); setEditor(null); void restoreProduct(product); }
              : undefined
          }
        />
      )}
    </div>
  );
}

function ProductEditor({ editor, form, setForm, categories, error, saving, uploading, onClose, onSave, onUpload, onArchive, onRestore }: { editor: "create" | AdminProduct; form: FormState; setForm: (form: FormState) => void; categories: Category[]; error: string | null; saving: boolean; uploading: boolean; onClose: () => void; onSave: () => void; onUpload: (file: File) => void; onArchive?: (product: AdminProduct) => void; onRestore?: (product: AdminProduct) => void }) {
  const isCreate = editor === "create";
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, onClose);
  return (
    <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/30 sm:items-center sm:p-5" onClick={onClose}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="ord-sheet max-h-[92vh] w-full max-w-[520px] overflow-y-auto rounded-t-[28px] bg-white p-5 sm:rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-editor-title"
      >
        <div className="mx-auto h-1 w-9 rounded-full bg-neutral-200 sm:hidden" />
        <div className="mt-2 flex items-start justify-between sm:mt-0">
          <div>
            <p className="text-xs text-neutral-400">{isCreate ? "Produk baru" : "Ubah produk"}</p>
            <h2 id="product-editor-title" className="mt-1 text-lg font-medium tracking-tight">{isCreate ? "Tambah ke menu" : (editor as AdminProduct).name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 active:scale-95">
            <X size={15} />
          </button>
        </div>
        {error && <p role="alert" className="mt-5 rounded-xl bg-neutral-50 px-4 py-3 text-[13px] text-neutral-600">{error}</p>}

        <form onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <div className="mt-6 space-y-7">
          <Field label="Nama produk">
            <input id="product-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Sate Taichan 10 Tusuk" className="input" />
          </Field>
          <Field label="Kategori">
            <select id="product-category" required value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} className="input">
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </Field>
          <Field label="Foto menu · opsional">
            <div className="space-y-3">
              {form.imagePath ? <div className="relative overflow-hidden rounded-2xl bg-neutral-100"><img src={form.imagePath} alt={`Pratinjau ${form.name || "menu"}`} className="aspect-[16/9] w-full object-cover" /><button type="button" onClick={() => setForm({ ...form, imagePath: "" })} className="absolute right-3 top-3 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-neutral-900">Hapus foto</button></div> : <div className="flex aspect-[16/9] items-center justify-center rounded-2xl bg-neutral-100 text-[13px] text-neutral-400">Belum ada foto</div>}
              <label className="flex h-11 cursor-pointer items-center justify-center rounded-full border border-neutral-200 text-[13px] font-medium text-neutral-900">
                {uploading ? "Mengunggah…" : form.imagePath ? "Ganti foto" : "Upload foto"}
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = ""; }} className="sr-only" />
              </label>
              <p className="text-xs text-neutral-400">JPEG, PNG, atau WebP · maksimal 5 MB. File disimpan di server aplikasi.</p>
            </div>
          </Field>
          <Field label="Deskripsi">
            <textarea id="product-description" rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Deskripsi singkat" className="input resize-none" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Harga jual">
              <input id="product-price" required type="number" min="0" value={form.priceIdr} onChange={(event) => setForm({ ...form, priceIdr: event.target.value })} placeholder="28000" className="input tabular-nums" />
            </Field>
            <Field label="Est. modal">
              <input id="product-cost" type="number" min="0" value={form.estimatedCostIdr} onChange={(event) => setForm({ ...form, estimatedCostIdr: event.target.value })} placeholder="10500" className="input tabular-nums" />
            </Field>
          </div>
          <fieldset className="border-0 p-0">
            <legend className="mb-3 text-[13px] font-medium">Stok</legend>
            <div className="space-y-2">
              <label className="flex items-center gap-3 text-[13px] text-neutral-600"><input type="radio" name="stock-mode" checked={!form.stockTracked} onChange={() => setForm({ ...form, stockTracked: false })} /> Unlimited</label>
              <label className="flex items-center gap-3 text-[13px] text-neutral-600"><input type="radio" name="stock-mode" checked={form.stockTracked} onChange={() => setForm({ ...form, stockTracked: true })} /> Track stock</label>
              {form.stockTracked && <input id="product-stock" required type="number" min="0" max="1000000" value={form.stockQuantity} onChange={(event) => setForm({ ...form, stockQuantity: event.target.value })} className="input tabular-nums" aria-label="Jumlah stok" placeholder="24" />}
            </div>
          </fieldset>
          <button
            type="button"
            onClick={() => setForm({ ...form, available: !form.available })}
            className="flex w-full items-center justify-between py-1 text-left"
          >
            <span className="text-[13px] font-medium">Tersedia dipesan</span>
            <span className="text-[13px] font-normal text-neutral-500">{form.available ? "Ya" : "Tidak"}</span>
          </button>
        </div>

        <div className="mt-8 space-y-2.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <button
            type="submit"
            disabled={saving || uploading || !form.name || !form.categoryId || form.priceIdr === "" || (form.stockTracked && form.stockQuantity === "")}
            className="h-[52px] w-full rounded-2xl bg-[#FDBD2C] text-[15px] font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
          >
            {saving ? "Menyimpan…" : isCreate ? "Tambah" : "Simpan"}
          </button>
          {!isCreate && onArchive && (
            <button
              type="button"
              onClick={() => onArchive(editor as AdminProduct)}
              className="h-11 w-full rounded-full text-[13px] font-normal text-neutral-400 active:bg-neutral-50"
            >
              Arsipkan produk
            </button>
          )}
          {!isCreate && onRestore && <button type="button" onClick={() => onRestore(editor as AdminProduct)} className="h-11 w-full rounded-full bg-neutral-900 text-[13px] font-medium text-white active:scale-[0.98]">Pulihkan produk</button>}
          <button type="button" onClick={onClose} className="h-11 w-full rounded-full text-[13px] font-normal text-neutral-500 active:bg-neutral-50">
            Batal
          </button>
        </div>
        </form>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-3 block text-[13px] font-medium">{label}</span>{children}</label>;
}
