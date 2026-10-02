"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, Package, Plus, Search, X } from "lucide-react";
import { formatCompactIDR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConfirmSheet, type ConfirmState } from "@/components/pos-confirm-sheet";
import { MetaDot, MetaInline } from "@/components/meta";
import { CategoryDropdown } from "@/components/category-filter";
import { CategoryManager } from "@/components/category-manager";
import { ModifierManager, ProductModifierPicker } from "@/components/modifier-manager";
import { ALL_CATEGORIES_ID } from "@/components/order/constants";
import { useDialogFocus } from "@/components/use-dialog-focus";
import type { Category } from "@/lib/types";

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
  variantGroupIds: string[];
  addonGroupIds: string[];
};
type FormState = { name: string; description: string; imagePath: string; categoryId: string; priceIdr: string; estimatedCostIdr: string; available: boolean; stockTracked: boolean; stockQuantity: string; variantGroupIds: string[]; addonGroupIds: string[] };

const blankForm: FormState = { name: "", description: "", imagePath: "", categoryId: "", priceIdr: "", estimatedCostIdr: "", available: true, stockTracked: false, stockQuantity: "0", variantGroupIds: [], addonGroupIds: [] };

export function MenuManager({ onShowNotice }: { onShowNotice: (message: string) => void }) {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [section, setSection] = useState<"menu" | "categories" | "modifiers">("menu");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_CATEGORIES_ID);
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<"create" | AdminProduct | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const pendingImagePaths = useRef(new Set<string>());

  async function loadMenu() {
    setLoading(true);
    setError(null);
    try {
      const [menuResponse, categoryResponse] = await Promise.all([
        fetch("/api/admin/menu", { cache: "no-store" }),
        fetch("/api/admin/categories", { cache: "no-store" }),
      ]);
      const payload = await menuResponse.json();
      if (!menuResponse.ok) throw new Error(payload.error ?? "Menu belum dapat dimuat.");
      const categoryPayload = await categoryResponse.json().catch(() => null);
      const managedCategories = (categoryPayload?.categories ?? []).map((category: { id: string; name: string; description?: string | null; displayOrder?: number; display_order?: number; active?: boolean }) => ({ id: String(category.id), name: String(category.name), description: category.description ?? null, displayOrder: Number(category.displayOrder ?? category.display_order ?? 0), active: category.active !== false }));
      setCategories(categoryResponse.ok ? managedCategories : (payload.categories ?? []));
      setProducts((payload.products ?? []).map((product: Record<string, unknown>) => ({
        id: String(product.id), name: String(product.name), description: product.description as string | null, imageUrl: (product.image_path as string | null) ?? null,
        categoryId: String(product.category_id), categoryName: Array.isArray(product.categories) ? String((product.categories[0] as { name?: string } | undefined)?.name ?? "") : String((product.categories as { name?: string } | null)?.name ?? ""),
        priceIdr: Number(product.price_idr), estimatedCostIdr: Number(product.estimated_cost_idr), available: Boolean(product.available), sellable: Boolean(product.available) && (!Boolean(product.stock_tracked) || Number(product.stock_quantity ?? 0) > 0), active: Boolean(product.active), stockTracked: Boolean(product.stock_tracked), stockQuantity: Number(product.stock_quantity ?? 0),
        variantGroupIds: Array.isArray(product.variant_group_ids) ? (product.variant_group_ids as unknown[]).map(String) : [],
        addonGroupIds: Array.isArray(product.addon_group_ids) ? (product.addon_group_ids as unknown[]).map(String) : [],
      })));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Menu belum dapat dimuat."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadMenu(); }, []);

  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((product) =>
      product.active === !showArchived &&
      (categoryFilter === ALL_CATEGORIES_ID || product.categoryId === categoryFilter) &&
      (!q || `${product.name} ${product.categoryName}`.toLowerCase().includes(q)),
    );
  }, [products, query, showArchived, categoryFilter]);
  const activeCount = products.filter((product) => product.active).length;

  const activeCategories = categories.filter((category) => category.active !== false);
  function openCreate() {
    void cleanupPendingImages();
    setForm({ ...blankForm, categoryId: (activeCategories[0] ?? categories[0])?.id ?? "" });
    setEditor("create");
  }
  function openEdit(product: AdminProduct) {
    void cleanupPendingImages();
    setForm({ name: product.name, description: product.description ?? "", imagePath: product.imageUrl ?? "", categoryId: product.categoryId, priceIdr: String(product.priceIdr), estimatedCostIdr: String(product.estimatedCostIdr), available: product.available, stockTracked: product.stockTracked, stockQuantity: String(product.stockQuantity), variantGroupIds: product.variantGroupIds, addonGroupIds: product.addonGroupIds });
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
      const productId = isCreate ? String(payload.product?.id ?? "") : (editor as AdminProduct).id;
      if (!productId) throw new Error("Menu belum berhasil disimpan.");
      const modifierResponse = await fetch(`/api/admin/menu/${productId}/modifiers`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ variantGroupIds: form.variantGroupIds, addonGroupIds: form.addonGroupIds }) });
      const modifierPayload = await modifierResponse.json().catch(() => null);
      if (!modifierResponse.ok) throw new Error(modifierPayload?.error ?? "Opsi produk belum tersimpan.");
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

  function requestArchiveProduct(product: AdminProduct) {
    setConfirm({
      title: `Arsipkan ${product.name}?`,
      description: "Produk hilang dari menu tapi riwayat pesanan tetap aman.",
      confirmLabel: "Arsipkan",
      onConfirm: () => void archiveProduct(product),
    });
  }

  async function archiveProduct(product: AdminProduct) {
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
          <p className="text-[13px] text-[#78716C]">
            {section === "categories"
              ? (<>{categories.length} kategori <MetaDot /> urutan tampil mengikuti angka urutan</>)
              : section === "modifiers"
                ? (<>Level pedas & tambahan <MetaDot /> berlaku langsung di checkout</>)
                : showArchived ? `${products.filter((product) => !product.active).length} produk diarsipkan` : (<>{activeCount} produk aktif <MetaDot /> perubahan berlaku saat checkout</>)}
          </p>
          {section === "menu" && (
            <button
              type="button"
              onClick={openCreate}
              className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#FDBD2C] px-6 text-sm font-medium text-[#1C1917] transition hover:bg-[#ECA90F] active:scale-[0.98]"
            >
              <Plus size={17} strokeWidth={2} /> Tambah
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-3" role="group" aria-label="Bagian pengelolaan">
          {(
            [
              { key: "menu", label: "Menu" },
              { key: "categories", label: "Kategori" },
              { key: "modifiers", label: "Opsi" },
            ] as const
          ).map(({ key, label }) => (
            <button
              type="button"
              key={key}
              onClick={() => setSection(key)}
              aria-pressed={section === key}
              className={cn(
                "flex h-11 min-w-[108px] items-center justify-center rounded-full px-5 text-[13px] transition active:scale-[0.98]",
                section === key ? "bg-[#FDBD2C]/20 font-medium text-[#1C1917]" : "bg-[#F3EFE6] font-normal text-[#78716C]",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {section === "menu" ? (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
              <div className="relative">
                <label htmlFor="menu-manager-search" className="sr-only">Cari menu</label>
                <Search size={16} strokeWidth={1.8} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#A8A29E]" />
                <input
                  id="menu-manager-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Cari menu…"
                  className="h-12 w-full rounded-2xl bg-[#F3EFE6] pl-11 pr-11 text-[13px] text-[#1C1917] outline-none transition placeholder:text-[#A8A29E] focus:bg-[#FFFEFB] focus:ring-2 focus:ring-[#FDBD2C]/50"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Hapus pencarian"
                    className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[#A8A29E] active:scale-95"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
              <CategoryDropdown
                id="menu-manager-category"
                value={categoryFilter}
                categories={categories}
                onChange={setCategoryFilter}
                allLabel="Semua kategori"
                dark
              />
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
                    "flex h-11 min-w-[108px] items-center justify-center rounded-full px-5 text-[13px] transition active:scale-[0.98]",
                    showArchived === key ? "bg-[#FDBD2C]/20 font-medium text-[#1C1917]" : "bg-[#F3EFE6] font-normal text-[#78716C]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {error && <div role="alert" className="mt-5 text-center"><p className="text-[13px] text-[#78716C]">{error}</p><button type="button" onClick={() => void loadMenu()} className="mx-auto mt-3 block h-11 rounded-full bg-[#1C1917] px-5 text-[13px] font-medium text-white">Coba lagi</button></div>}

            <div className="mt-5 overflow-hidden rounded-2xl border border-[#EFE7D6] bg-[#FFFEFB] shadow-soft">
          {loading ? (
            <div className="divide-y divide-[#E9E1D1] px-4 sm:px-5" aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-3 py-3.5">
                  <div className="ord-skeleton h-14 w-14 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="ord-skeleton h-3.5 w-2/3 rounded-full" />
                    <div className="ord-skeleton h-3 w-1/2 rounded-full" />
                  </div>
                  <div className="ord-skeleton h-7 w-20 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
          ) : visibleProducts.length ? (
            <>
              <div className="hidden grid-cols-[minmax(0,1fr)_170px] gap-4 bg-[#FFFEFB] px-5 py-3 text-xs text-[#A8A29E] sm:grid">
                <span>Menu</span>
                <span>Status</span>
              </div>
              <div className="divide-y divide-[#E9E1D1]">
                {visibleProducts.map((product) => {
                  const isOn = product.active && product.sellable;
                  const statusLabel = !product.active ? "Diarsipkan" : isOn ? "Aktif" : "Non-aktif";
                  const statusClass = isOn ? "bg-[#FDBD2C]/20 text-[#1C1917]" : "bg-[#F3EFE6] text-[#78716C]";
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => openEdit(product)}
                      aria-label={`Ubah ${product.name}, ${statusLabel}`}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3.5 text-left transition active:bg-[#FAF7F1] sm:grid-cols-[minmax(0,1fr)_170px] sm:gap-4 sm:px-5 sm:py-3"
                    >
                      <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-3 sm:col-start-1">
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#F3EFE6] text-base font-medium text-[#A8A29E]">
                          {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-cover" /> : product.name.slice(0, 1)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-[#1C1917]">{product.name}</span>
                          <span className="mt-1 block truncate text-xs tabular-nums text-[#A8A29E]">
                            <MetaInline parts={[product.categoryName, formatCompactIDR(product.priceIdr), product.stockTracked ? `${product.stockQuantity} tersisa` : null, product.variantGroupIds.length + product.addonGroupIds.length > 0 ? `${product.variantGroupIds.length + product.addonGroupIds.length} opsi` : null]} />
                          </span>
                        </span>
                      </span>
                      <span className={cn("col-start-2 row-start-1 flex h-9 w-fit items-center gap-2 self-center rounded-full px-3.5 text-[11px] font-medium sm:col-start-2", statusClass)}>
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                        {statusLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="border-t border-[#EFE7D6] px-5 py-4 text-[13px] text-[#A8A29E]">
                Menampilkan {visibleProducts.length} dari {showArchived ? products.filter((product) => !product.active).length : activeCount} menu {showArchived ? "arsip" : "aktif"}
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center px-5 py-8 text-center">
              <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F3EFE6]">
                {showArchived
                  ? <Archive size={18} strokeWidth={1.6} className="text-[#A8A29E]" />
                  : <Package size={18} strokeWidth={1.6} className="text-[#A8A29E]" />}
              </span>
              <p className="mt-3 text-sm font-medium text-[#1C1917]">Tidak ada produk cocok.</p>
              <p className="mt-1 text-[13px] text-[#78716C]">Coba kata kunci lain.</p>
            </div>
          )}
        </div>
          </>
        ) : section === "modifiers" ? (
          <div className="mt-5">
            <ModifierManager onChanged={() => void loadMenu()} />
          </div>
        ) : (
          <div className="mt-5">
            <CategoryManager onChanged={() => void loadMenu()} />
          </div>
        )}
      </div>

      <ConfirmSheet confirm={confirm} onClose={() => setConfirm(null)} />

      {editor && (
        <ProductEditor
          editor={editor}
          form={form}
          setForm={setForm}
          categories={activeCategories.length ? activeCategories : categories}
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
                  requestArchiveProduct(product);
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
  const isArchived = !isCreate && onRestore !== undefined;
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, onClose);
  const canSave = !saving && !uploading && form.name.trim() !== "" && form.categoryId !== "" && form.priceIdr !== "" && (!form.stockTracked || form.stockQuantity !== "");
  const activeCategory = categories.find((category) => category.id === form.categoryId)?.name;
  return createPortal(
    <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#1C1917]/30 p-0 sm:items-center sm:p-5" onClick={onClose}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="ord-sheet flex max-h-[92dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-[28px] bg-[#FFFEFB] text-[#1C1917] sm:rounded-[28px] lg:max-w-[560px]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-editor-title"
      >
        <div className="shrink-0 border-b border-[#EFE7D6] px-5 pb-4 pt-3">
          <div className="mx-auto h-1 w-9 rounded-full bg-[#E5DCC8] sm:hidden" aria-hidden="true" />
          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-[#A8A29E]">{isCreate ? "Produk baru" : isArchived ? "Produk arsip" : "Ubah produk"}</p>
              <h2 id="product-editor-title" className="mt-1 truncate text-lg font-medium tracking-tight">{isCreate ? "Tambah ke menu" : (editor as AdminProduct).name}</h2>
              {!isCreate && activeCategory && <p className="mt-0.5 truncate text-[13px] text-[#78716C]">{activeCategory}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Tutup editor" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F3EFE6] text-[#78716C] transition active:scale-95">
              <X size={15} />
            </button>
          </div>
        </div>

        <form onSubmit={(event) => { event.preventDefault(); onSave(); }} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-5 py-5">
            {error && <p role="alert" className="rounded-2xl border border-[#EFE7D6] bg-[#FAF7F1] px-4 py-3 text-center text-[13px] leading-relaxed text-[#78716C]">{error}</p>}

            <EditorSection title="Info dasar" hint="Nama, kategori, dan deskripsi tampil di menu pelanggan.">
              <Field label="Nama produk" htmlFor="product-name">
                <input id="product-name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Sate Taichan 10 Tusuk" maxLength={80} className="input" />
              </Field>
              <Field label="Kategori" htmlFor="product-category">
                <select id="product-category" required value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} className="select">
                  <option value="" disabled>Pilih kategori</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </Field>
              <Field label="Deskripsi" hint={`${form.description.length}/160`} htmlFor="product-description">
                <textarea id="product-description" rows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value.slice(0, 160) })} placeholder="Deskripsi singkat, mis. pedas gurih dengan sambal." maxLength={160} className="input resize-none" />
              </Field>
            </EditorSection>

            <EditorSection title="Foto" hint={<>Opsional <MetaDot /> JPEG, PNG, atau WebP hingga 5 MB.</>}>
              {form.imagePath ? (
                <div className="relative overflow-hidden rounded-2xl bg-[#F3EFE6]">
                  <img src={form.imagePath} alt={`Pratinjau ${form.name || "menu"}`} className="aspect-[16/10] w-full object-cover" />
                  <button type="button" onClick={() => setForm({ ...form, imagePath: "" })} aria-label="Hapus foto" className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-[#FFFEFB]/90 text-[#78716C] backdrop-blur transition active:scale-95">
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <div className="flex aspect-[16/10] items-center justify-center rounded-2xl border border-dashed border-[#E5DCC8] bg-[#F3EFE6] px-4 text-center text-[13px] text-[#A8A29E]">Belum ada foto — menu tetap bisa disimpan.</div>
              )}
              <label className="flex h-11 cursor-pointer items-center justify-center rounded-full bg-[#F3EFE6] px-4 text-[13px] font-medium text-[#1C1917] transition active:scale-[0.98]">
                {uploading ? "Mengunggah…" : form.imagePath ? "Ganti foto" : "Upload foto"}
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = ""; }} className="sr-only" />
              </label>
            </EditorSection>

            <EditorSection title="Harga" hint="Modal hanya untuk internal, tidak tampil ke pelanggan.">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Harga jual" htmlFor="product-price">
                  <input id="product-price" required type="number" min="0" max="100000000" value={form.priceIdr} onChange={(event) => setForm({ ...form, priceIdr: event.target.value })} placeholder="28000" inputMode="numeric" className="input tabular-nums" />
                </Field>
                <Field label="Est. modal" htmlFor="product-cost">
                  <input id="product-cost" type="number" min="0" max="100000000" value={form.estimatedCostIdr} onChange={(event) => setForm({ ...form, estimatedCostIdr: event.target.value })} placeholder="10500" inputMode="numeric" className="input tabular-nums" />
                </Field>
              </div>
            </EditorSection>

            <EditorSection title="Opsi" hint={<>Level pedas & tambahan <MetaDot /> tampil di halaman pesan.</>}>
              <ProductModifierPicker
                variantGroupIds={form.variantGroupIds}
                addonGroupIds={form.addonGroupIds}
                onChange={(next) => setForm({ ...form, variantGroupIds: next.variantGroupIds, addonGroupIds: next.addonGroupIds })}
              />
            </EditorSection>

            <EditorSection title="Ketersediaan" hint="Atur stok dan apakah produk bisa dipesan.">
              <fieldset className="border-0 p-0">
                <legend className="mb-2 text-[13px] font-medium">Mode stok</legend>
                <div className="flex rounded-full bg-[#F3EFE6] p-1" role="group" aria-label="Mode stok">
                  {(
                    [
                      { key: false, label: "Unlimited" },
                      { key: true, label: "Track stok" },
                    ] as const
                  ).map(({ key, label }) => (
                    <button
                      type="button"
                      key={label}
                      onClick={() => setForm({ ...form, stockTracked: key })}
                      aria-pressed={form.stockTracked === key}
                      className={cn(
                        "h-11 flex-1 rounded-full text-center text-[13px] transition active:scale-[0.98]",
                        form.stockTracked === key ? "border border-[#EFE7D6] bg-[#FFFEFB] font-medium text-[#1C1917] shadow-xs" : "font-normal text-[#78716C]",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {form.stockTracked && (
                  <div className="mt-3">
                    <label htmlFor="product-stock" className="mb-2 block text-[13px] font-medium">Sisa stok</label>
                    <input id="product-stock" required type="number" min="0" max="1000000" value={form.stockQuantity} onChange={(event) => setForm({ ...form, stockQuantity: event.target.value })} inputMode="numeric" className="input tabular-nums" placeholder="24" />
                  </div>
                )}
              </fieldset>
              <button
                type="button"
                role="switch"
                aria-checked={form.available}
                aria-label="Tersedia dipesan"
                onClick={() => setForm({ ...form, available: !form.available })}
                className="flex w-full items-center justify-between gap-3 rounded-2xl bg-[#F3EFE6] px-4 py-3 text-left transition active:scale-[0.99]"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">Tersedia dipesan</span>
                  <span className="mt-0.5 block truncate text-xs text-[#A8A29E]">{form.available ? "Tampil dan bisa dipesan" : "Disembunyikan dari checkout"}</span>
                </span>
                <span aria-hidden="true" className={cn("flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition", form.available ? "justify-end bg-[#FDBD2C]" : "justify-start bg-[#EDE8DB]")}>
                  <span className="h-5 w-5 rounded-full bg-[#FFFEFB] shadow-xs" />
                </span>
              </button>
            </EditorSection>
          </div>

          <div className="shrink-0 border-t border-[#EFE7D6] bg-[#FAF7F1]/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            {isArchived && onRestore ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => onRestore(editor as AdminProduct)}
                  className="h-12 w-full rounded-full bg-[#FDBD2C] text-sm font-medium text-[#1C1917] transition hover:bg-[#ECA90F] active:scale-[0.98]"
                >
                  Pulihkan produk
                </button>
                <button type="button" onClick={onClose} className="h-12 w-full rounded-full text-sm text-[#78716C] transition active:scale-[0.98]">
                  Batal
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="submit"
                  disabled={!canSave}
                  className="h-12 w-full rounded-full bg-[#FDBD2C] text-sm font-medium text-[#1C1917] transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
                >
                  {saving ? "Menyimpan…" : isCreate ? "Tambah ke menu" : "Simpan perubahan"}
                </button>
                <div className="flex items-center justify-center gap-1">
                  {!isCreate && onArchive && (
                    <button
                      type="button"
                      onClick={() => onArchive(editor as AdminProduct)}
                      className="h-12 flex-1 rounded-full text-sm text-[#78716C] transition active:scale-[0.98]"
                    >
                      Arsipkan
                    </button>
                  )}
                  <button type="button" onClick={onClose} className="h-12 flex-1 rounded-full text-sm text-[#78716C] transition active:scale-[0.98]">
                    Batal
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}

function EditorSection({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-[#E9E1D1] pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-medium text-[#1C1917]">{title}</h3>
      {hint && <p className="mt-1 text-xs leading-relaxed text-[#A8A29E]">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-[#1C1917]">{label}</label>
        {hint && <span className="shrink-0 text-xs tabular-nums text-[#A8A29E]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
