"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Category } from "@/lib/types";

type ManagedCategory = Category & { product_count?: number };

const PAGE_SIZE = 8;

export function CategoryManager({ onChanged }: { onChanged?: () => void }) {
  const [categories, setCategories] = useState<ManagedCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [displayOrder, setDisplayOrder] = useState("0");
  const [editing, setEditing] = useState<ManagedCategory | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/categories", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Kategori belum dapat dimuat.");
      setCategories(payload.categories ?? []);
      setNotice(null);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Kategori belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function create() {
    if (name.trim().length < 2) { setNotice("Nama kategori minimal 2 huruf."); return; }
    setWorking("create");
    try {
      const response = await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, displayOrder: Number(displayOrder) || 0 }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Kategori belum berhasil dibuat.");
      setName(""); setDescription(""); setDisplayOrder("0");
      await load(); onChanged?.();
      setNotice("Kategori dibuat.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Kategori belum berhasil dibuat.");
    } finally {
      setWorking(null);
    }
  }

  function openEdit(category: ManagedCategory) {
    setEditing(category);
    setName(category.name);
    setDescription(category.description ?? "");
    setDisplayOrder(String(category.displayOrder ?? 0));
  }

  function closeEdit() {
    setEditing(null);
    setName(""); setDescription(""); setDisplayOrder("0");
  }

  async function save() {
    if (!editing) return;
    if (name.trim().length < 2) { setNotice("Nama kategori minimal 2 huruf."); return; }
    setWorking(editing.id);
    try {
      const response = await fetch(`/api/admin/categories/${editing.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, displayOrder: Number(displayOrder) || 0 }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Perubahan kategori belum tersimpan.");
      closeEdit(); await load(); onChanged?.();
      setNotice("Kategori diperbarui.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Perubahan kategori belum tersimpan.");
    } finally {
      setWorking(null);
    }
  }

  async function toggle(category: ManagedCategory) {
    const action = category.active === false ? "aktifkan" : "nonaktifkan";
    if (!window.confirm(`${action === "aktifkan" ? "Aktifkan" : "Nonaktifkan"} kategori "${category.name}"?${category.active !== false ? " Produk dalam kategori ini akan disembunyikan dari menu." : ""}`)) return;
    setWorking(category.id);
    try {
      const response = await fetch(`/api/admin/categories/${category.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: category.active === false }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Kategori belum berhasil diubah.");
      await load(); onChanged?.();
      setNotice(`Kategori ${action}.`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Kategori belum berhasil diubah.");
    } finally {
      setWorking(null);
    }
  }

  async function remove(category: ManagedCategory) {
    if (!window.confirm(`Hapus kategori "${category.name}"? Produk dalam kategori ini akan disembunyikan dari menu. Produk dan riwayat pesanan tetap tersimpan.`)) return;
    setWorking(category.id);
    try {
      const response = await fetch(`/api/admin/categories/${category.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Kategori belum berhasil dihapus.");
      if (editing?.id === category.id) closeEdit();
      await load(); onChanged?.();
      setNotice("Kategori berhasil dihapus.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Kategori belum berhasil dihapus.");
    } finally {
      setWorking(null);
    }
  }

  const query = search.trim().toLowerCase();
  const filtered = query
    ? categories.filter((category) => `${category.name} ${category.description ?? ""}`.toLowerCase().includes(query))
    : categories;
  const visible = expanded ? filtered : filtered.slice(0, PAGE_SIZE);
  const hiddenCount = filtered.length - visible.length;

  return (
    <div className="rounded-2xl border border-[#EFE7D6] bg-[#FFFEFB] p-5 shadow-soft sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-[#1C1917]">
            Kategori menu{" "}
            <span className="font-normal tabular-nums text-[#A8A29E]">({categories.length})</span>
          </h3>
          <p className="mt-1 text-[13px] text-[#78716C]">Sumber tunggal dari database. Urutan tampil mengikuti angka urutan.</p>
        </div>
        {editing && (
          <button type="button" onClick={closeEdit} aria-label="Batal ubah kategori" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F3EFE6] text-[#78716C]">
            <X size={15} />
          </button>
        )}
      </div>

      {notice && <p role={notice.includes("berhasil") || notice.includes("dibuat") || notice.includes("diperbarui") ? "status" : "alert"} className="mt-3 text-[13px] text-[#78716C]">{notice}</p>}

          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
            <label className="block text-[13px] font-medium text-[#1C1917]">
              Nama kategori
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Minuman Segar" maxLength={80} className="input mt-2" />
            </label>
            <label className="block text-[13px] font-medium text-[#1C1917]">
              Urutan
              <input value={displayOrder} onChange={(event) => setDisplayOrder(event.target.value)} type="number" min={0} max={1000000} inputMode="numeric" className="input mt-2 tabular-nums" />
            </label>
          </div>
          <label className="mt-3 block text-[13px] font-medium text-[#1C1917]">
            Deskripsi <span className="font-normal text-[#A8A29E]">opsional</span>
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Tampil sebagai info internal" maxLength={500} className="input mt-2" />
          </label>
          <button
            type="button"
            onClick={() => void (editing ? save() : create())}
            disabled={working !== null}
            className="mt-4 flex h-11 items-center justify-center gap-2 rounded-full bg-[#FDBD2C] px-6 text-sm font-medium text-[#1C1917] transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
          >
            {editing ? <Pencil size={15} /> : <Plus size={15} />}
            {working ? "Menyimpan…" : editing ? "Simpan perubahan" : "Tambah kategori"}
          </button>

          {categories.length > 4 && (
            <div className="relative mt-5">
              <label htmlFor="category-manager-search" className="sr-only">Cari kategori</label>
              <input
                id="category-manager-search"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setExpanded(false); }}
                placeholder={`Cari dari ${categories.length} kategori…`}
                className="input"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Hapus pencarian kategori"
                  className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[#A8A29E] active:scale-95"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          )}

          <div className="mt-2 max-h-[320px] divide-y divide-[#E9E1D1] overflow-y-auto overscroll-contain border-t border-[#EFE7D6]">
            {loading ? (
              <p className="py-6 text-center text-[13px] text-[#78716C]">Memuat kategori…</p>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-[#78716C]">
                {categories.length === 0 ? "Belum ada kategori. Tambahkan kategori pertama di atas." : `Tidak ada kategori cocok untuk "${search}".`}
              </p>
            ) : (
              visible.map((category) => (
                <div key={category.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-[#1C1917]">{category.name}</p>
                    <p className="mt-0.5 truncate text-xs tabular-nums text-[#A8A29E]">
                      Urutan {category.displayOrder ?? 0} · {category.product_count ?? 0} produk · {category.active === false ? "Nonaktif" : "Aktif"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEdit(category)}
                    aria-label={`Ubah ${category.name}`}
                    disabled={working !== null}
                    className="flex h-9 items-center rounded-full bg-[#F3EFE6] px-3.5 text-xs font-medium text-[#78716C] active:scale-95"
                  >
                    Ubah
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={category.active !== false}
                    aria-label={`${category.active === false ? "Aktifkan" : "Nonaktifkan"} ${category.name}`}
                    onClick={() => void toggle(category)}
                    disabled={working !== null}
                    className={cn(
                      "flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition disabled:opacity-40",
                      category.active === false ? "justify-start bg-[#EDE8DB]" : "justify-end bg-[#FDBD2C]",
                    )}
                  >
                    <span className="h-5 w-5 rounded-full bg-[#FFFEFB] shadow-xs" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(category)}
                    disabled={working !== null}
                    aria-label={`Hapus ${category.name}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F3EFE6] text-[#B91C1C] active:scale-95 disabled:opacity-40"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="mt-2 h-10 w-full rounded-full bg-[#F3EFE6] text-[13px] font-medium text-[#1C1917] active:scale-[0.99]"
            >
              Tampilkan {hiddenCount} lainnya ({filtered.length} total)
            </button>
          )}
          {expanded && filtered.length > PAGE_SIZE && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="mt-2 h-10 w-full rounded-full text-[13px] text-[#78716C] active:scale-[0.99]"
            >
              Tampilkan lebih sedikit
            </button>
          )}
    </div>
  );
}
