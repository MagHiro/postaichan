"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { formatCompactIDR } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ManagedModifierOption = {
  id: string;
  groupId: string;
  name: string;
  priceAdjustmentIdr: number;
  costAdjustmentIdr: number;
  available: boolean;
  displayOrder: number;
};

export type ManagedModifierGroup = {
  id: string;
  kind: "variant" | "addon";
  name: string;
  selection: "single" | "multiple";
  required: boolean;
  minSelection: number;
  maxSelection: number;
  displayOrder: number;
  active: boolean;
  productCount: number;
  options: ManagedModifierOption[];
};

type GroupForm = { name: string; selection: "single" | "multiple"; required: boolean; minSelection: string; maxSelection: string; displayOrder: string };
type OptionForm = { name: string; price: string; cost: string; available: boolean; displayOrder: string };

const blankGroupForm: GroupForm = { name: "", selection: "single", required: false, minSelection: "0", maxSelection: "1", displayOrder: "0" };
const blankOptionForm: OptionForm = { name: "", price: "", cost: "", available: true, displayOrder: "0" };

export function ModifierManager({ onChanged }: { onChanged?: () => void }) {
  const [variantGroups, setVariantGroups] = useState<ManagedModifierGroup[]>([]);
  const [addonGroups, setAddonGroups] = useState<ManagedModifierGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [kind, setKind] = useState<"variant" | "addon">("variant");
  const [groupForm, setGroupForm] = useState<GroupForm>(blankGroupForm);
  const [editingGroup, setEditingGroup] = useState<ManagedModifierGroup | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [optionForm, setOptionForm] = useState<OptionForm>(blankOptionForm);
  const [editingOption, setEditingOption] = useState<ManagedModifierOption | null>(null);
  const [optionGroupId, setOptionGroupId] = useState<string | null>(null);

  const groups = kind === "variant" ? variantGroups : addonGroups;

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/modifiers", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Opsi belum dapat dimuat.");
      setVariantGroups(payload.variantGroups ?? []);
      setAddonGroups(payload.addonGroups ?? []);
      setNotice(null);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Opsi belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function openCreateGroup() {
    setEditingGroup(null);
    setGroupForm({ ...blankGroupForm, selection: kind === "addon" ? "multiple" : "single" });
  }

  function openEditGroup(group: ManagedModifierGroup) {
    setEditingGroup(group);
    setGroupForm({
      name: group.name,
      selection: group.selection,
      required: group.required,
      minSelection: String(group.minSelection),
      maxSelection: String(group.maxSelection),
      displayOrder: String(group.displayOrder ?? 0),
    });
  }

  async function saveGroup() {
    if (groupForm.name.trim().length < 2) { setNotice("Nama grup minimal 2 huruf."); return; }
    setWorking(editingGroup ? editingGroup.id : "create-group");
    try {
      const body = {
        kind,
        name: groupForm.name.trim(),
        selection: kind === "variant" ? groupForm.selection : "multiple",
        required: groupForm.required,
        minSelection: Number(groupForm.minSelection) || 0,
        maxSelection: Number(groupForm.maxSelection) || 1,
        displayOrder: Number(groupForm.displayOrder) || 0,
      };
      const response = await fetch(editingGroup ? `/api/admin/modifiers/${editingGroup.id}` : "/api/admin/modifiers", {
        method: editingGroup ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Grup opsi belum tersimpan.");
      setEditingGroup(null); setGroupForm({ ...blankGroupForm, selection: kind === "addon" ? "multiple" : "single" });
      await load(); onChanged?.();
      setNotice(editingGroup ? "Grup opsi diperbarui." : "Grup opsi dibuat.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Grup opsi belum tersimpan.");
    } finally {
      setWorking(null);
    }
  }

  async function toggleGroup(group: ManagedModifierGroup) {
    const next = group.active === false;
    if (!next && group.productCount > 0) {
      if (!window.confirm(`Nonaktifkan "${group.name}"? Grup hilang dari checkout selama nonaktif.`)) return;
    } else if (!window.confirm(`${next ? "Aktifkan" : "Nonaktifkan"} grup "${group.name}"?`)) {
      return;
    }
    setWorking(group.id);
    try {
      const response = await fetch(`/api/admin/modifiers/${group.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: group.kind, active: next }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Grup belum berhasil diubah.");
      await load(); onChanged?.();
      setNotice(`Grup ${next ? "diaktifkan" : "dinonaktifkan"}.`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Grup belum berhasil diubah.");
    } finally {
      setWorking(null);
    }
  }

  async function deleteGroup(group: ManagedModifierGroup) {
    if (!window.confirm(`Hapus grup "${group.name}" beserta semua opsinya? Riwayat pesanan tetap aman.`)) return;
    setWorking(group.id);
    try {
      const response = await fetch(`/api/admin/modifiers/${group.id}?kind=${group.kind}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Grup belum berhasil dihapus.");
      if (expandedId === group.id) setExpandedId(null);
      await load(); onChanged?.();
      setNotice("Grup dihapus.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Grup belum berhasil dihapus.");
    } finally {
      setWorking(null);
    }
  }

  function openCreateOption(groupId: string) {
    setEditingOption(null);
    setOptionGroupId(groupId);
    setOptionForm({ ...blankOptionForm });
  }

  function openEditOption(groupId: string, option: ManagedModifierOption) {
    setEditingOption(option);
    setOptionGroupId(groupId);
    setOptionForm({
      name: option.name,
      price: String(option.priceAdjustmentIdr),
      cost: String(option.costAdjustmentIdr),
      available: option.available,
      displayOrder: String(option.displayOrder ?? 0),
    });
  }

  async function saveOption() {
    if (!optionGroupId) return;
    if (optionForm.name.trim().length < 1) { setNotice("Nama opsi wajib diisi."); return; }
    const targetGroup = [...variantGroups, ...addonGroups].find((group) => group.id === optionGroupId);
    if (!targetGroup) return;
    setWorking(editingOption ? editingOption.id : `create-option-${optionGroupId}`);
    try {
      const body = {
        kind: targetGroup.kind,
        groupId: optionGroupId,
        name: optionForm.name.trim(),
        priceAdjustmentIdr: Number(optionForm.price) || 0,
        costAdjustmentIdr: Number(optionForm.cost) || 0,
        available: optionForm.available,
        displayOrder: Number(optionForm.displayOrder) || 0,
      };
      const response = await fetch(editingOption ? `/api/admin/modifiers/options/${editingOption.id}` : "/api/admin/modifiers/options", {
        method: editingOption ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editingOption ? { ...body, groupId: undefined } : body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Opsi belum tersimpan.");
      setEditingOption(null); setOptionGroupId(null); setOptionForm({ ...blankOptionForm });
      await load(); onChanged?.();
      setNotice(editingOption ? "Opsi diperbarui." : "Opsi dibuat.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Opsi belum tersimpan.");
    } finally {
      setWorking(null);
    }
  }

  async function toggleOption(group: ManagedModifierGroup, option: ManagedModifierOption) {
    setWorking(option.id);
    try {
      const response = await fetch(`/api/admin/modifiers/options/${option.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: group.kind, available: !option.available }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Opsi belum berhasil diubah.");
      await load(); onChanged?.();
      setNotice(`Opsi ${!option.available ? "tersedia" : "dihabiskan"}.`);
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Opsi belum berhasil diubah.");
    } finally {
      setWorking(null);
    }
  }

  async function deleteOption(group: ManagedModifierGroup, option: ManagedModifierOption) {
    if (!window.confirm(`Hapus opsi "${option.name}"? Riwayat pesanan tetap aman.`)) return;
    setWorking(option.id);
    try {
      const response = await fetch(`/api/admin/modifiers/options/${option.id}?kind=${group.kind}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Opsi belum berhasil dihapus.");
      await load(); onChanged?.();
      setNotice("Opsi dihapus.");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Opsi belum berhasil dihapus.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="rounded-2xl border border-[#EFE7D6] bg-[#FFFEFB] p-5 shadow-soft sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-[#1C1917]">
            Opsi menu{" "}
            <span className="font-normal tabular-nums text-[#A8A29E]">({variantGroups.length + addonGroups.length})</span>
          </h3>
          <p className="mt-1 text-[13px] text-[#78716C]">Tingkat pedas, pilihan karbo, dan tambahan. Berlaku langsung di checkout.</p>
        </div>
        {(editingGroup || editingOption) && (
          <button
            type="button"
            onClick={() => { setEditingGroup(null); setEditingOption(null); setOptionGroupId(null); setGroupForm({ ...blankGroupForm, selection: kind === "addon" ? "multiple" : "single" }); setOptionForm({ ...blankOptionForm }); }}
            aria-label="Batal ubah opsi"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F3EFE6] text-[#78716C]"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {notice && <p role="alert" className="mt-3 text-[13px] text-[#78716C]">{notice}</p>}

      <div className="mt-4 flex gap-3" role="group" aria-label="Jenis opsi">
        {(
          [
            { key: "variant", label: `Pilihan (${variantGroups.length})` },
            { key: "addon", label: `Tambahan (${addonGroups.length})` },
          ] as const
        ).map(({ key, label }) => (
          <button
            type="button"
            key={key}
            onClick={() => { setKind(key); setEditingGroup(null); setGroupForm({ ...blankGroupForm, selection: key === "addon" ? "multiple" : "single" }); }}
            aria-pressed={kind === key}
            className={cn(
              "flex h-11 min-w-[108px] items-center justify-center rounded-full px-5 text-[13px] transition active:scale-[0.98]",
              kind === key ? "bg-[#FDBD2C]/20 font-medium text-[#1C1917]" : "bg-[#F3EFE6] font-normal text-[#78716C]",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
        <label className="block text-[13px] font-medium text-[#1C1917]">
          Nama grup
          <input value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} placeholder={kind === "variant" ? "Level pedas" : "Tambahan"} maxLength={80} className="input mt-2" />
        </label>
        <label className="block text-[13px] font-medium text-[#1C1917]">
          Urutan
          <input value={groupForm.displayOrder} onChange={(event) => setGroupForm({ ...groupForm, displayOrder: event.target.value })} type="number" min={0} max={1000000} inputMode="numeric" className="input mt-2 tabular-nums" />
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {kind === "variant" && (
          <label className="block text-[13px] font-medium text-[#1C1917]">
            Mode pilih
            <select value={groupForm.selection} onChange={(event) => setGroupForm({ ...groupForm, selection: event.target.value as "single" | "multiple" })} className="select mt-2">
              <option value="single">Pilih satu</option>
              <option value="multiple">Pilih banyak</option>
            </select>
          </label>
        )}
        <label className="block text-[13px] font-medium text-[#1C1917]">
          Min. pilih
          <input value={groupForm.minSelection} onChange={(event) => setGroupForm({ ...groupForm, minSelection: event.target.value })} type="number" min={0} max={99} inputMode="numeric" className="input mt-2 tabular-nums" />
        </label>
        <label className="block text-[13px] font-medium text-[#1C1917]">
          Maks. pilih
          <input value={groupForm.maxSelection} onChange={(event) => setGroupForm({ ...groupForm, maxSelection: event.target.value })} type="number" min={1} max={99} inputMode="numeric" disabled={kind === "variant" && groupForm.selection === "single"} className="input mt-2 tabular-nums disabled:opacity-40" />
        </label>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={groupForm.required}
        aria-label="Grup wajib dipilih"
        onClick={() => setGroupForm({ ...groupForm, required: !groupForm.required })}
        className="mt-3 flex w-full items-center justify-between gap-3 rounded-2xl bg-[#F3EFE6] px-4 py-3 text-left transition active:scale-[0.99]"
      >
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">Wajib dipilih</span>
          <span className="mt-0.5 block truncate text-xs text-[#A8A29E]">{groupForm.required ? "Pelanggan harus memilih sebelum tambah" : "Opsional, bisa dilewati"}</span>
        </span>
        <span aria-hidden="true" className={cn("flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition", groupForm.required ? "justify-end bg-[#FDBD2C]" : "justify-start bg-[#EDE8DB]")}>
          <span className="h-5 w-5 rounded-full bg-[#FFFEFB] shadow-xs" />
        </span>
      </button>

      <button
        type="button"
        onClick={() => void saveGroup()}
        disabled={working !== null}
        className="mt-4 flex h-11 items-center justify-center gap-2 rounded-full bg-[#FDBD2C] px-6 text-sm font-medium text-[#1C1917] transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
      >
        {editingGroup ? <Pencil size={15} /> : <Plus size={15} />}
        {working ? "Menyimpan…" : editingGroup ? "Simpan grup" : "Tambah grup"}
      </button>

      <div className="mt-5 divide-y divide-[#E9E1D1] border-t border-[#EFE7D6]">
        {loading ? (
          <p className="py-6 text-center text-[13px] text-[#78716C]">Memuat opsi…</p>
        ) : groups.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[#78716C]">
            {kind === "variant" ? "Belum ada grup pilihan. Buat mis. “Level pedas” di atas." : "Belum ada grup tambahan. Buat mis. “Tambahan” di atas."}
          </p>
        ) : (
          groups.map((group) => {
            const expanded = expandedId === group.id;
            return (
              <div key={group.id} className="py-3">
                <button
                  type="button"
                  onClick={() => { setExpandedId(expanded ? null : group.id); if (!expanded) { setEditingOption(null); setOptionGroupId(null); } }}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-[#1C1917]">
                      {group.name}{" "}
                      <span className="font-normal text-[#A8A29E]">
                        · {group.options.length} opsi · {group.productCount} produk · {group.active === false ? "Nonaktif" : group.required ? "Wajib" : "Opsional"}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs tabular-nums text-[#A8A29E]">
                      {group.kind === "variant" ? (group.selection === "single" ? "Pilih satu" : `Pilih ${group.minSelection}–${group.maxSelection}`) : `Maks. ${group.maxSelection}`} · Urutan {group.displayOrder ?? 0}
                    </span>
                  </span>
                  <span className={cn("text-xs font-medium", expanded ? "text-[#1C1917]" : "text-[#A8A29E]")}>{expanded ? "Tutup" : "Kelola"}</span>
                </button>

                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openEditGroup(group)}
                    aria-label={`Ubah ${group.name}`}
                    className="flex h-9 items-center rounded-full bg-[#F3EFE6] px-3.5 text-xs font-medium text-[#78716C] active:scale-95"
                  >
                    Ubah
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={group.active !== false}
                    aria-label={`${group.active === false ? "Aktifkan" : "Nonaktifkan"} ${group.name}`}
                    onClick={() => void toggleGroup(group)}
                    disabled={working === group.id}
                    className={cn(
                      "flex h-9 items-center rounded-full px-3.5 text-xs font-medium active:scale-95 disabled:opacity-40",
                      group.active === false ? "bg-[#F3EFE6] text-[#78716C]" : "bg-[#FDBD2C]/20 text-[#1C1917]",
                    )}
                  >
                    {group.active === false ? "Aktifkan" : "Aktif"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteGroup(group)}
                    aria-label={`Hapus ${group.name}`}
                    disabled={working === group.id}
                    className="flex h-9 items-center gap-1.5 rounded-full bg-[#F3EFE6] px-3.5 text-xs font-medium text-[#78716C] active:scale-95 disabled:opacity-40"
                  >
                    <Trash2 size={13} /> Hapus
                  </button>
                </div>

                {expanded && (
                  <div className="mt-3 rounded-2xl bg-[#FAF7F1] p-4">
                    {(optionGroupId === group.id || editingOption) && (
                      <div className="rounded-2xl border border-[#EFE7D6] bg-[#FFFEFB] p-4">
                        <p className="text-[13px] font-medium text-[#1C1917]">{editingOption ? `Ubah “${editingOption.name}”` : `Opsi baru di “${group.name}”`}</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className="block text-[13px] font-medium text-[#1C1917] sm:col-span-2">
                            Nama opsi
                            <input value={optionForm.name} onChange={(event) => setOptionForm({ ...optionForm, name: event.target.value })} placeholder="Mild" maxLength={120} className="input mt-2" />
                          </label>
                          <label className="block text-[13px] font-medium text-[#1C1917]">
                            Tambah harga
                            <input value={optionForm.price} onChange={(event) => setOptionForm({ ...optionForm, price: event.target.value })} type="number" min={0} max={100000000} inputMode="numeric" placeholder="0" className="input mt-2 tabular-nums" />
                          </label>
                          <label className="block text-[13px] font-medium text-[#1C1917]">
                            Est. modal
                            <input value={optionForm.cost} onChange={(event) => setOptionForm({ ...optionForm, cost: event.target.value })} type="number" min={0} max={100000000} inputMode="numeric" placeholder="0" className="input mt-2 tabular-nums" />
                          </label>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void saveOption()}
                            disabled={working !== null}
                            className="flex h-10 flex-1 items-center justify-center rounded-full bg-[#FDBD2C] px-4 text-[13px] font-medium text-[#1C1917] active:scale-[0.98] disabled:opacity-40"
                          >
                            {working ? "Menyimpan…" : editingOption ? "Simpan opsi" : "Tambah opsi"}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditingOption(null); setOptionGroupId(null); setOptionForm({ ...blankOptionForm }); }}
                            className="flex h-10 items-center justify-center rounded-full px-4 text-[13px] text-[#78716C] active:scale-95"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    )}

                    {optionGroupId !== group.id && !editingOption && (
                      <button
                        type="button"
                        onClick={() => openCreateOption(group.id)}
                        className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[#F3EFE6] text-[13px] font-medium text-[#1C1917] active:scale-[0.99]"
                      >
                        <Plus size={14} /> Tambah opsi
                      </button>
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
                              onClick={() => openEditOption(group.id, option)}
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
          })
        )}
      </div>
    </div>
  );
}

export function ProductModifierPicker({
  variantGroupIds,
  addonGroupIds,
  onChange,
}: {
  variantGroupIds: string[];
  addonGroupIds: string[];
  onChange: (next: { variantGroupIds: string[]; addonGroupIds: string[] }) => void;
}) {
  const [groups, setGroups] = useState<ManagedModifierGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/admin/modifiers", { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? "Opsi belum dapat dimuat.");
        if (!cancelled) {
          setGroups([...(payload.variantGroups ?? []), ...(payload.addonGroups ?? [])]);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Opsi belum dapat dimuat.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function toggle(list: string[], id: string, all: string[]) {
    const next = list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
    return next.filter((value) => all.includes(value));
  }

  if (loading) return <p className="text-[13px] text-[#A8A29E]">Memuat opsi…</p>;
  if (error) return <p role="alert" className="text-[13px] text-[#78716C]">{error}</p>;

  const variants = groups.filter((group) => group.kind === "variant" && group.active !== false);
  const addons = groups.filter((group) => group.kind === "addon" && group.active !== false);
  const allVariantIds = variants.map((group) => group.id);
  const allAddonIds = addons.map((group) => group.id);

  function renderGroup(group: ManagedModifierGroup, selected: string[], onToggle: (id: string) => void) {
    const active = selected.includes(group.id);
    return (
      <button
        type="button"
        key={group.id}
        onClick={() => onToggle(group.id)}
        aria-pressed={active}
        className={cn(
          "min-h-14 rounded-2xl border px-3 py-2.5 text-left transition active:scale-[0.98]",
          active ? "border-[#FDBD2C] bg-[#FDBD2C]/15 font-medium text-[#1C1917]" : "border-[#EFE7D6] bg-[#FFFEFB] text-[#78716C]",
        )}
      >
        <span className="block truncate text-[13px]">{group.name}</span>
        <span className="mt-0.5 block truncate text-xs text-[#A8A29E]">
          {group.options.length} opsi{group.required ? " · wajib" : ""}
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-[13px] font-medium text-[#1C1917]">Pilihan (mis. level pedas)</p>
        {variants.length === 0 ? (
          <p className="text-xs text-[#A8A29E]">Belum ada grup pilihan aktif. Buat dulu di tab Opsi.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {variants.map((group) => renderGroup(group, variantGroupIds, (id) => onChange({ variantGroupIds: toggle(variantGroupIds, id, allVariantIds), addonGroupIds })))}
          </div>
        )}
      </div>
      <div>
        <p className="mb-2 text-[13px] font-medium text-[#1C1917]">Tambahan (add-on)</p>
        {addons.length === 0 ? (
          <p className="text-xs text-[#A8A29E]">Belum ada grup tambahan aktif. Buat dulu di tab Opsi.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {addons.map((group) => renderGroup(group, addonGroupIds, (id) => onChange({ variantGroupIds, addonGroupIds: toggle(addonGroupIds, id, allAddonIds) })))}
          </div>
        )}
      </div>
    </div>
  );
}
