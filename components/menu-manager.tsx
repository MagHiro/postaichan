"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MoreVertical, Plus, Search, X } from "lucide-react";
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
      <div>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <p className="text-[15px] text-neutral-300">
            {showArchived ? `${products.filter((product) => !product.active).length} produk diarsipkan` : `${activeCount} produk aktif · perubahan berlaku saat checkout`}
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#FDBD2C] px-6 text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98]"
          >
            <Plus size={17} strokeWidth={2} /> Tambah
          </button>
        </div>

        <div className="relative mt-6">
          <label htmlFor="menu-manager-search" className="sr-only">Cari menu</label>
          <Search size={20} strokeWidth={1.7} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#aebbd0]" />
          <input
            id="menu-manager-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari menu…"
            className="h-12 w-full rounded-full border border-white/[0.12] bg-[#222d3d] pl-16 pr-12 text-[15px] text-white outline-none placeholder:text-[#aebbd0] focus:border-[#FDBD2C]/70 focus:ring-2 focus:ring-[#FDBD2C]/20"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Hapus pencarian"
              className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-neutral-300 transition hover:bg-white/10"
            >
              <X size={15} />
            </button>
          )}
        </div>

        <div className="mt-4 flex gap-3">
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
                "flex h-11 min-w-[108px] items-center justify-center rounded-full border px-5 text-[13px] transition active:scale-[0.98]",
                showArchived === key ? "border-[#FDBD2C] bg-[#FDBD2C]/10 font-medium text-white" : "border-white/[0.14] font-normal text-neutral-300 hover:bg-white/5",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <div role="alert" className="mt-5 flex flex-col items-center gap-3 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-4 text-center text-[13px] text-red-200"><p>{error}</p><button type="button" onClick={() => void loadMenu()} className="h-10 rounded-full bg-[#FDBD2C] px-4 text-[13px] font-medium text-neutral-900">Coba lagi</button></div>}

        <div className="mt-5 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111720]">
          {loading ? (
            <p className="py-14 text-center text-[13px] text-neutral-400">Memuat menu…</p>
          ) : visibleProducts.length ? (
            <>
              <div className="hidden grid-cols-[minmax(0,1fr)_170px_40px] gap-4 bg-white/[0.04] px-5 py-3 text-[13px] text-neutral-300 sm:grid">
                <span>Menu</span>
                <span>Status</span>
                <span aria-hidden="true" />
              </div>
              <div className="divide-y divide-white/[0.08]">
                {visibleProducts.map((product) => {
                  const statusLabel = product.active ? (product.available ? (product.sellable ? "Manual aktif" : "Stok habis") : "Manual off") : "Diarsipkan";
                  const statusClass = product.active && product.available && product.sellable
                    ? "border-emerald-400/20 bg-emerald-500/15 text-emerald-300"
                    : product.active && product.available
                      ? "border-[#FDBD2C]/25 bg-[#FDBD2C]/12 text-[#FDBD2C]"
                      : "border-white/[0.08] bg-[#232a35] text-neutral-300";
                  return (
                    <div key={product.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-3 py-3.5 sm:grid-cols-[minmax(0,1fr)_170px_40px] sm:items-center sm:gap-4 sm:px-5 sm:py-3">
                      <button
                        type="button"
                        onClick={() => openEdit(product)}
                        className="row-start-1 flex min-w-0 items-center gap-3 rounded-xl text-left transition active:bg-white/5 sm:col-start-1"
                        aria-label={`Ubah ${product.name}`}
                      >
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/[0.12] bg-[#232a35] text-base font-medium text-neutral-400">
                          {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-cover" /> : product.name.slice(0, 1)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-medium text-white">{product.name}</span>
                          <span className="mt-1 block truncate text-[13px] text-neutral-400">
                            {product.categoryName} · {formatCompactIDR(product.priceIdr)}{product.stockTracked ? ` · ${product.stockQuantity} tersisa` : " · unlimited"}
                          </span>
                        </span>
                      </button>
                      {product.active ? (
                        <button
                          type="button"
                          onClick={() => void toggleAvailability(product)}
                          aria-label={`${product.name}: ${product.available ? "tersedia" : "habis"}`}
                          aria-pressed={product.available}
                          className={cn("col-start-1 row-start-2 flex h-10 w-fit items-center gap-2 rounded-full border px-4 text-[13px] font-medium transition active:scale-[0.98] sm:col-start-2 sm:row-start-1", statusClass)}
                        >
                          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-current" />
                          {statusLabel}
                        </button>
                      ) : (
                        <span className={cn("col-start-1 row-start-2 flex h-10 w-fit items-center gap-2 rounded-full border px-4 text-[13px] font-medium sm:col-start-2 sm:row-start-1", statusClass)}>
                          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-current" />
                          {statusLabel}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => openEdit(product)}
                        aria-label={`Buka aksi ${product.name}`}
                        className="col-start-2 row-span-2 row-start-1 flex h-10 w-10 items-center justify-center self-center rounded-full text-neutral-300 transition hover:bg-white/5 active:scale-95 sm:col-start-3 sm:row-span-1 sm:row-start-1"
                      >
                        <MoreVertical size={19} strokeWidth={1.8} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="border-t border-white/[0.08] px-5 py-4 text-[13px] text-neutral-400">
                Menampilkan {visibleProducts.length} dari {showArchived ? products.filter((product) => !product.active).length : activeCount} menu {showArchived ? "arsip" : "aktif"}
              </p>
            </>
          ) : (
            <div className="px-5 py-14 text-center">
              <p className="text-sm font-medium text-white">Tidak ada produk cocok.</p>
              <p className="mt-1 text-[13px] text-neutral-400">Coba kata kunci lain.</p>
            </div>
          )}
        </div>
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
    <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#070a0f]/80 p-0 backdrop-blur-sm sm:items-center sm:p-5" onClick={onClose}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="ord-sheet max-h-[92dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[28px] border border-white/[0.12] bg-[#151a22] p-5 text-white shadow-[0_24px_80px_rgba(0,0,0,0.5)] sm:rounded-[28px] sm:p-6"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-editor-title"
      >
        <div className="mx-auto h-1 w-9 rounded-full bg-white/25 sm:hidden" />
        <div className="mt-2 flex items-start justify-between sm:mt-0">
          <div>
            <p className="text-xs text-neutral-400">{isCreate ? "Produk baru" : "Ubah produk"}</p>
            <h2 id="product-editor-title" className="mt-1 text-lg font-medium tracking-tight">{isCreate ? "Tambah ke menu" : (editor as AdminProduct).name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="flex h-10 w-10 items-center justify-center rounded-full bg-[#232a35] text-neutral-300 active:scale-95">
            <X size={15} />
          </button>
        </div>
        {error && <p role="alert" className="mt-5 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">{error}</p>}

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
              {form.imagePath ? <div className="relative overflow-hidden rounded-2xl bg-[#232a35]"><img src={form.imagePath} alt={`Pratinjau ${form.name || "menu"}`} className="aspect-[16/9] w-full object-cover" /><button type="button" onClick={() => setForm({ ...form, imagePath: "" })} className="absolute right-3 top-3 rounded-full bg-[#151a22]/90 px-3 py-1.5 text-xs font-medium text-white">Hapus foto</button></div> : <div className="flex aspect-[16/9] items-center justify-center rounded-2xl bg-[#232a35] text-[13px] text-neutral-400">Belum ada foto</div>}
              <label className="flex h-11 cursor-pointer items-center justify-center rounded-full border border-white/[0.16] text-[13px] font-medium text-neutral-200 transition hover:bg-white/5">
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
              <label className="flex items-center gap-3 text-[13px] text-neutral-300"><input type="radio" name="stock-mode" checked={!form.stockTracked} onChange={() => setForm({ ...form, stockTracked: false })} /> Unlimited</label>
              <label className="flex items-center gap-3 text-[13px] text-neutral-300"><input type="radio" name="stock-mode" checked={form.stockTracked} onChange={() => setForm({ ...form, stockTracked: true })} /> Track stock</label>
              {form.stockTracked && <input id="product-stock" required type="number" min="0" max="1000000" value={form.stockQuantity} onChange={(event) => setForm({ ...form, stockQuantity: event.target.value })} className="input tabular-nums" aria-label="Jumlah stok" placeholder="24" />}
            </div>
          </fieldset>
          <button
            type="button"
            onClick={() => setForm({ ...form, available: !form.available })}
            className="flex w-full items-center justify-between py-1 text-left"
          >
            <span className="text-[13px] font-medium">Tersedia dipesan</span>
            <span className="text-[13px] font-normal text-neutral-400">{form.available ? "Ya" : "Tidak"}</span>
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
              className="h-11 w-full rounded-full text-[13px] font-normal text-neutral-400 transition hover:bg-white/5"
            >
              Arsipkan produk
            </button>
          )}
          {!isCreate && onRestore && <button type="button" onClick={() => onRestore(editor as AdminProduct)} className="h-11 w-full rounded-full bg-[#FDBD2C] text-[13px] font-medium text-neutral-900 active:scale-[0.98]">Pulihkan produk</button>}
          <button type="button" onClick={onClose} className="h-11 w-full rounded-full text-[13px] font-normal text-neutral-400 transition hover:bg-white/5">
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
