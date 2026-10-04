"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { formatCompactIDR } from "@/lib/format";
import { cn } from "@/lib/utils";

type OptionRow = {
  id: string;
  groupId: string;
  name: string;
  priceAdjustmentIdr: number;
  costAdjustmentIdr: number;
  available: boolean;
  displayOrder: number;
};

type GroupRow = {
  id: string;
  kind: "variant" | "addon";
  name: string;
  required: boolean;
  productCount: number;
  options: OptionRow[];
};

export function ProductOptionsEditor({ productId, onChanged }: { productId: string; onChanged?: () => void }) {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newVariantName, setNewVariantName] = useState("");
  const [newAddonName, setNewAddonName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [optionDrafts, setOptionDrafts] = useState<Record<string, { name: string; price: string }>>({});
  const [editingOption, setEditingOption] = useState<OptionRow | null>(null);

  function draftFor(groupId: string) {
    return optionDrafts[groupId] ?? { name: "", price: "" };
  }

  async function load() {
    setLoading(true);
    try {
      const [modifiersResponse, assignmentResponse] = await Promise.all([
        fetch("/api/admin/modifiers", { cache: "no-store" }),
        fetch(`/api/admin/menu/${productId}/modifiers`, { cache: "no-store" }),
      ]);
      const modifiersPayload = await modifiersResponse.json().catch(() => null);
      if (!modifiersResponse.ok) throw new Error(modifiersPayload?.error ?? "Opsi belum dapat dimuat.");
      const assignmentPayload = await assignmentResponse.json().catch(() => null);
      const variantIds: string[] = assignmentResponse.ok
        ? (assignmentPayload?.variantGroupIds ?? []).map(String)
        : [];
      const addonIds: string[] = assignmentResponse.ok
        ? (assignmentPayload?.addonGroupIds ?? []).map(String)
        : [];
      const wanted = new Set([...variantIds, ...addonIds]);
      const all: GroupRow[] = [
        ...(modifiersPayload.variantGroups ?? []).map((group: Record<string, unknown>) => ({
          id: String(group.id),
          kind: "variant" as const,
          name: String(group.name),
          required: Boolean(group.required),
          productCount: Number(group.productCount ?? 0),
          options: ((group.options ?? []) as Record<string, unknown>[]).map((option) => ({
            id: String(option.id),
            groupId: String(option.groupId ?? group.id),
            name: String(option.name),
            priceAdjustmentIdr: Number(option.priceAdjustmentIdr ?? 0),
            costAdjustmentIdr: Number(option.costAdjustmentIdr ?? 0),
            available: option.available !== false,
            displayOrder: Number(option.displayOrder ?? 0),
          })),
        })),
        ...(modifiersPayload.addonGroups ?? []).map((group: Record<string, unknown>) => ({
          id: String(group.id),
          kind: "addon" as const,
          name: String(group.name),
          required: Boolean(group.required),
          productCount: Number(group.productCount ?? 0),
          options: ((group.options ?? []) as Record<string, unknown>[]).map((option) => ({
            id: String(option.id),
            groupId: String(option.groupId ?? group.id),
            name: String(option.name),
            priceAdjustmentIdr: Number(option.priceAdjustmentIdr ?? 0),
            costAdjustmentIdr: Number(option.costAdjustmentIdr ?? 0),
            available: option.available !== false,
            displayOrder: Number(option.displayOrder ?? 0),
          })),
        })),
      ];
      setGroups(all.filter((group) => wanted.has(group.id)));
      setNotice(null);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Opsi belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // Reload when the edited product changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  async function attachGroup(kind: "variant" | "addon", groupId: string) {
    const variantIds = groups.filter((group) => group.kind === "variant").map((group) => group.id);
    const addonIds = groups.filter((group) => group.kind === "addon").map((group) => group.id);
    if (kind === "variant") variantIds.push(groupId);
    else addonIds.push(groupId);
    const response = await fetch(`/api/admin/menu/${productId}/modifiers`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantGroupIds: variantIds, addonGroupIds: addonIds }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error ?? "Opsi produk belum tersimpan.");
    }
  }

  async function detachGroup(group: GroupRow) {
    const variantIds = groups.filter((candidate) => candidate.kind === "variant" && candidate.id !== group.id).map((candidate) => candidate.id);
    const addonIds = groups.filter((candidate) => candidate.kind === "addon" && candidate.id !== group.id).map((candidate) => candidate.id);
    const response = await fetch(`/api/admin/menu/${productId}/modifiers`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantGroupIds: variantIds, addonGroupIds: addonIds }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error ?? "Grup belum berhasil dilepas.");
    }
  }

  async function createGroup(kind: "variant" | "addon", name: string) {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNotice("Nama grup minimal 2 huruf.");
      return;
    }
    setWorking(`create-${kind}`);
    try {
      const response = await fetch("/api/admin/modifiers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          kind === "variant"
            ? { kind, name: trimmed, selection: "single", required: false, minSelection: 0, maxSelection: 1, displayOrder: 0 }
            : { kind, name: trimmed, required: false, minSelection: 0, maxSelection: 99, displayOrder: 0 },
        ),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Grup opsi belum berhasil dibuat.");
      const groupId = String(payload.groupId ?? "");
      if (!groupId) throw new Error("Grup opsi belum berhasil dibuat.");
      await attachGroup(kind, groupId);
      if (kind === "variant") setNewVariantName("");
      else setNewAddonName("");
      setOpenGroupId(groupId);
      await load();
      onChanged?.();
      setNotice(`“${trimmed}” ditambahkan untuk produk ini.`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Grup opsi belum berhasil dibuat.");
    } finally {
      setWorking(null);
    }
  }

  async function saveGroupName(group: GroupRow) {
    const trimmed = editingGroupName.trim();
    if (trimmed.length < 2) {
      setNotice("Nama grup minimal 2 huruf.");
      return;
    }
    setWorking(group.id);
    try {
      const response = await fetch(`/api/admin/modifiers/${group.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: group.kind, name: trimmed }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Nama grup belum tersimpan.");
      setEditingGroupId(null);
      await load();
      onChanged?.();
      setNotice("Nama grup diperbarui.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Nama grup belum tersimpan.");
    } finally {
      setWorking(null);
    }
  }

  async function toggleRequired(group: GroupRow) {
    setWorking(group.id);
    try {
      const response = await fetch(`/api/admin/modifiers/${group.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: group.kind, required: !group.required }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Pengaturan wajib belum tersimpan.");
      await load();
      onChanged?.();
      setNotice(group.required ? "Grup jadi opsional." : "Grup jadi wajib dipilih.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Pengaturan wajib belum tersimpan.");
    } finally {
      setWorking(null);
    }
  }

  async function deleteGroup(group: GroupRow) {
    if (!window.confirm(`Hapus “${group.name}” dari produk ini? Riwayat pesanan tetap aman.`)) return;
    setWorking(group.id);
    try {
      await detachGroup(group);
      const response = await fetch(`/api/admin/modifiers/${group.id}?kind=${group.kind}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Grup belum berhasil dihapus.");
      if (openGroupId === group.id) setOpenGroupId(null);
      await load();
      onChanged?.();
      setNotice("Grup dihapus.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Grup belum berhasil dihapus.");
      await load().catch(() => undefined);
    } finally {
      setWorking(null);
    }
  }

  async function createOption(group: GroupRow) {
    const draft = draftFor(group.id);
    const trimmed = draft.name.trim();
    if (trimmed.length < 1) {
      setNotice("Nama opsi wajib diisi.");
      return;
    }
    setWorking(`create-option-${group.id}`);
    try {
      const response = await fetch("/api/admin/modifiers/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: group.kind,
          groupId: group.id,
          name: trimmed,
          priceAdjustmentIdr: Number(draft.price) || 0,
          costAdjustmentIdr: 0,
          available: true,
          displayOrder: group.options.length,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Opsi belum berhasil dibuat.");
      setOptionDrafts((current) => ({ ...current, [group.id]: { name: "", price: "" } }));
      await load();
      onChanged?.();
      setNotice(`“${trimmed}” ditambahkan.`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Opsi belum berhasil dibuat.");
    } finally {
      setWorking(null);
    }
  }

  async function saveOption(group: GroupRow) {
    if (!editingOption) return;
    const trimmed = editingOption.name.trim();
    if (trimmed.length < 1) {
      setNotice("Nama opsi wajib diisi.");
      return;
    }
    setWorking(editingOption.id);
    try {
      const response = await fetch(`/api/admin/modifiers/options/${editingOption.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: group.kind,
          name: trimmed,
          priceAdjustmentIdr: Number(editingOption.priceAdjustmentIdr) || 0,
          costAdjustmentIdr: Number(editingOption.costAdjustmentIdr) || 0,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Opsi belum tersimpan.");
      setEditingOption(null);
      await load();
      onChanged?.();
      setNotice("Opsi diperbarui.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Opsi belum tersimpan.");
    } finally {
      setWorking(null);
    }
  }

  async function toggleOption(group: GroupRow, option: OptionRow) {
    setWorking(option.id);
    try {
      const response = await fetch(`/api/admin/modifiers/options/${option.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: group.kind, available: !option.available }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Opsi belum berhasil diubah.");
      await load();
      onChanged?.();
      setNotice(`“${option.name}” ${!option.available ? "tersedia" : "dihabiskan"}.`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Opsi belum berhasil diubah.");
    } finally {
      setWorking(null);
    }
  }

  async function deleteOption(group: GroupRow, option: OptionRow) {
    if (!window.confirm(`Hapus opsi “${option.name}”? Riwayat pesanan tetap aman.`)) return;
    setWorking(option.id);
    try {
      const response = await fetch(`/api/admin/modifiers/options/${option.id}?kind=${group.kind}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Opsi belum berhasil dihapus.");
      await load();
      onChanged?.();
      setNotice("Opsi dihapus.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Opsi belum berhasil dihapus.");
    } finally {
      setWorking(null);
    }
  }

  const variants = groups.filter((group) => group.kind === "variant");
  const addons = groups.filter((group) => group.kind === "addon");

  function renderGroup(group: GroupRow) {
    const open = openGroupId === group.id;
    const editingName = editingGroupId === group.id;
    return (
      <div key={group.id} className="rounded-2xl border border-[#EFE7D6] bg-[#FFFEFB] p-4">
        <button
          type="button"
          onClick={() => {
            setOpenGroupId(open ? null : group.id);
            setEditingOption(null);
          }}
          aria-expanded={open}
          className="flex w-full items-center gap-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-[#1C1917]">
              {group.name}{" "}
              <span className="font-normal text-[#A8A29E]">
                · {group.options.length} opsi · {group.required ? "Wajib" : "Opsional"}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-xs text-[#A8A29E]">
              {group.kind === "variant" ? "Pelanggan pilih satu" : "Bisa pilih banyak"} · hanya produk ini
            </span>
          </span>
          <span className={cn("text-xs font-medium", open ? "text-[#1C1917]" : "text-[#A8A29E]")}>
            {open ? "Tutup" : "Kelola"}
          </span>
        </button>

        <div className="mt-2 flex flex-wrap gap-2">
          {editingName ? (
            <span className="flex w-full gap-2">
              <input
                value={editingGroupName}
                onChange={(event) => setEditingGroupName(event.target.value)}
                maxLength={80}
                aria-label="Nama grup"
                className="input h-10 flex-1"
              />
              <button
                type="button"
                onClick={() => void saveGroupName(group)}
                disabled={working === group.id}
                className="flex h-10 items-center rounded-full bg-[#FDBD2C] px-4 text-xs font-medium text-[#1C1917] disabled:opacity-40"
              >
                Simpan
              </button>
              <button
                type="button"
                onClick={() => setEditingGroupId(null)}
                aria-label="Batal ubah nama"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F3EFE6] text-[#78716C]"
              >
                <X size={14} />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingGroupId(group.id);
                setEditingGroupName(group.name);
              }}
              className="flex h-9 items-center gap-1.5 rounded-full bg-[#F3EFE6] px-3.5 text-xs font-medium text-[#78716C] active:scale-95"
            >
              <Pencil size={12} /> Ubah nama
            </button>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={group.required}
            onClick={() => void toggleRequired(group)}
            disabled={working === group.id}
            className={cn(
              "flex h-9 items-center rounded-full px-3.5 text-xs font-medium active:scale-95 disabled:opacity-40",
              group.required ? "bg-[#FDBD2C]/20 text-[#1C1917]" : "bg-[#F3EFE6] text-[#78716C]",
            )}
          >
            {group.required ? "Wajib" : "Opsional"}
          </button>
          <button
            type="button"
            onClick={() => void deleteGroup(group)}
            disabled={working === group.id}
            className="flex h-9 items-center gap-1.5 rounded-full bg-[#F3EFE6] px-3.5 text-xs font-medium text-[#78716C] active:scale-95 disabled:opacity-40"
          >
            <Trash2 size={13} /> Hapus
          </button>
        </div>

        {open && (
          <div className="mt-3 rounded-2xl bg-[#FAF7F1] p-4">
            {editingOption && editingOption.groupId === group.id ? (
              <div className="rounded-2xl border border-[#EFE7D6] bg-[#FFFEFB] p-4">
                <p className="text-[13px] font-medium text-[#1C1917]">Ubah opsi</p>
                <div className="mt-3 grid gap-3">
                  <label className="block text-[13px] font-medium text-[#1C1917]">
                    Nama opsi
                    <input
                      value={editingOption.name}
                      onChange={(event) => setEditingOption({ ...editingOption, name: event.target.value })}
                      maxLength={120}
                      className="input mt-2"
                    />
                  </label>
                  <label className="block text-[13px] font-medium text-[#1C1917]">
                    + Harga (Rp)
                    <input
                      value={String(editingOption.priceAdjustmentIdr)}
                      onChange={(event) => setEditingOption({ ...editingOption, priceAdjustmentIdr: Number(event.target.value) || 0 })}
                      type="number"
                      min={0}
                      max={100000000}
                      inputMode="numeric"
                      className="input mt-2 tabular-nums"
                    />
                  </label>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void saveOption(group)}
                    disabled={working !== null}
                    className="flex h-10 flex-1 items-center justify-center rounded-full bg-[#FDBD2C] px-4 text-[13px] font-medium text-[#1C1917] disabled:opacity-40"
                  >
                    Simpan opsi
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingOption(null)}
                    className="flex h-10 items-center justify-center rounded-full px-4 text-[13px] text-[#78716C]"
                  >
                    Batal
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-2">
                <input
                  value={draftFor(group.id).name}
                  onChange={(event) => {
                    const value = event.target.value;
                    setOptionDrafts((current) => ({ ...current, [group.id]: { name: value, price: current[group.id]?.price ?? "" } }));
                  }}
                  onFocus={() => setOpenGroupId(group.id)}
                  placeholder="Nama opsi, mis. Level 3"
                  maxLength={120}
                  aria-label={`Nama opsi baru di ${group.name}`}
                  className="input h-11"
                />
                <input
                  value={draftFor(group.id).price}
                  onChange={(event) => {
                    const value = event.target.value;
                    setOptionDrafts((current) => ({ ...current, [group.id]: { name: current[group.id]?.name ?? "", price: value } }));
                  }}
                  onFocus={() => setOpenGroupId(group.id)}
                  placeholder="+Rp, mis. 5000"
                  type="number"
                  min={0}
                  max={100000000}
                  inputMode="numeric"
                  aria-label="Tambah harga dalam rupiah"
                  className="input h-11 tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => void createOption(group)}
                  disabled={working !== null}
                  className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-[#1C1917] px-5 text-[13px] font-medium text-white disabled:opacity-40"
                >
                  <Plus size={14} /> Tambah
                </button>
              </div>
            )}

            <div className="mt-2 divide-y divide-[#E9E1D1]">
              {group.options.length === 0 ? (
                <p className="py-4 text-center text-[13px] text-[#78716C]">Belum ada opsi di grup ini.</p>
              ) : (
                group.options.map((option) => (
                  <div key={option.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-[#1C1917]">{option.name}</p>
                      <p className="mt-0.5 truncate text-xs tabular-nums text-[#A8A29E]">
                        {option.priceAdjustmentIdr > 0 ? `+${formatCompactIDR(option.priceAdjustmentIdr)}` : "Gratis"} · {option.available ? "Tersedia" : "Habis"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingOption(option)}
                      aria-label={`Ubah ${option.name}`}
                      className="flex h-8 items-center rounded-full bg-[#FFFEFB] px-3 text-xs font-medium text-[#78716C] active:scale-95"
                    >
                      Ubah
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={option.available}
                      aria-label={`${option.available ? "Habiskan" : "Sediakan"} ${option.name}`}
                      onClick={() => void toggleOption(group, option)}
                      disabled={working === option.id}
                      className={cn(
                        "flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition disabled:opacity-40",
                        option.available ? "justify-end bg-[#FDBD2C]" : "justify-start bg-[#EDE8DB]",
                      )}
                    >
                      <span className="h-5 w-5 rounded-full bg-[#FFFEFB] shadow-xs" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteOption(group, option)}
                      aria-label={`Hapus ${option.name}`}
                      disabled={working === option.id}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FFFEFB] text-[#78716C] active:scale-95 disabled:opacity-40"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {notice && (
        <p role="alert" className="text-[13px] text-[#78716C]">
          {notice}{" "}
          <button type="button" onClick={() => void load()} className="underline">
            Muat ulang
          </button>
        </p>
      )}
      {loading ? (
        <p className="text-[13px] text-[#A8A29E]">Memuat opsi produk…</p>
      ) : (
        <div className="space-y-10">
          <div>
            <p className="mb-2 text-[13px] font-medium text-[#1C1917]">Pilihan — pelanggan pilih satu</p>
            <p className="mb-4 text-xs leading-relaxed text-[#A8A29E]">Mis. Level pedas. Hanya berlaku untuk produk ini.</p>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={newVariantName}
                onChange={(event) => setNewVariantName(event.target.value)}
                placeholder="Nama pilihan, mis. Level pedas"
                maxLength={80}
                aria-label="Nama pilihan baru"
                className="input h-11"
              />
              <button
                type="button"
                onClick={() => void createGroup("variant", newVariantName)}
                disabled={working !== null}
                className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-[#FDBD2C] px-5 text-[13px] font-medium text-[#1C1917] disabled:opacity-40"
              >
                <Plus size={14} /> Tambah pilihan
              </button>
            </div>
            {variants.length === 0 ? (
              <p className="mt-4 text-xs text-[#A8A29E]">Belum ada pilihan untuk produk ini.</p>
            ) : (
              <div className="mt-4 space-y-3">{variants.map(renderGroup)}</div>
            )}
          </div>

          <div className="border-t border-[#E9E1D1] pt-10">
            <p className="mb-2 text-[13px] font-medium text-[#1C1917]">Tambahan — bisa pilih banyak +Rp</p>
            <p className="mb-4 text-xs leading-relaxed text-[#A8A29E]">Mis. Extra topping. Harga tambahan tampil di kasir.</p>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={newAddonName}
                onChange={(event) => setNewAddonName(event.target.value)}
                placeholder="Nama tambahan, mis. Topping ekstra"
                maxLength={80}
                aria-label="Nama tambahan baru"
                className="input h-11"
              />
              <button
                type="button"
                onClick={() => void createGroup("addon", newAddonName)}
                disabled={working !== null}
                className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-[#FDBD2C] px-5 text-[13px] font-medium text-[#1C1917] disabled:opacity-40"
              >
                <Plus size={14} /> Tambah tambahan
              </button>
            </div>
            {addons.length === 0 ? (
              <p className="mt-4 text-xs text-[#A8A29E]">Belum ada tambahan untuk produk ini.</p>
            ) : (
              <div className="mt-4 space-y-3">{addons.map(renderGroup)}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
