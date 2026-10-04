import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";
import { query } from "@/lib/db";
import { hashOpaqueToken } from "@/lib/domain/tokens";

export const metadata: Metadata = {
  title: "Bara & Burn",
  description: "Sate taichan panas, sambal fresh, siap bikin nagih.",
};

type SearchParams = { table?: string; g?: string };
type TeaserItem = { id: string; name: string; price: number; imageUrl: string | null };

async function resolveTableLabel(rawToken: string | undefined) {
  if (!rawToken || rawToken.length < 32 || rawToken.length > 240) return { label: null as string | null, valid: false, present: Boolean(rawToken) };
  try {
    const result = await query<{ label: string; active: boolean }>(
      "select label, active from public.restaurant_tables where qr_token_hash = $1 limit 1",
      [hashOpaqueToken(rawToken)],
    );
    const row = result.rows[0];
    if (row?.active) return { label: row.label, valid: true, present: true };
    return { label: null, valid: false, present: true };
  } catch {
    return { label: null, valid: false, present: true };
  }
}

async function resolveGeneralToken(rawToken: string | undefined) {
  if (!rawToken || rawToken.length < 32 || rawToken.length > 240) return { valid: false, present: Boolean(rawToken) };
  try {
    const result = await query<{ active: boolean }>(
      "select active from public.ordering_qr_codes where token_hash = $1 limit 1",
      [hashOpaqueToken(rawToken)],
    );
    const row = result.rows[0];
    return { valid: Boolean(row?.active), present: true };
  } catch {
    return { valid: false, present: true };
  }
}

async function loadTeaser(): Promise<TeaserItem[]> {
  try {
    const result = await query<{ id: string; name: string; price_idr: number; image_path: string | null }>(
      `select p.id, p.name, p.price_idr, p.image_path
       from public.products p join public.categories c on c.id = p.category_id
       where p.active = true and p.archived_at is null and p.available = true and c.active = true
       order by p.popular desc, p.display_order asc, p.name asc
       limit 4`,
    );
    return result.rows.map((row) => ({ id: row.id, name: row.name, price: Number(row.price_idr), imageUrl: row.image_path }));
  } catch {
    return [];
  }
}

async function isCashierOpen() {
  try {
    const result = await query("select id from public.cashier_shifts where closed_at is null limit 1");
    return result.rows.length > 0;
  } catch {
    return true;
  }
}

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const tableToken = typeof params.table === "string" ? params.table : undefined;
  const generalToken = typeof params.g === "string" ? params.g : undefined;
  const [table, general, teaser, cashierOpen] = await Promise.all([
    resolveTableLabel(tableToken),
    resolveGeneralToken(generalToken),
    loadTeaser(),
    isCashierOpen(),
  ]);
  const orderHref =
    table.valid && tableToken ? `/order/t/${tableToken}` : general.valid && generalToken ? `/order/g/${generalToken}` : "/order";
  return (
    <LandingPage
      tableLabel={table.valid ? table.label : null}
      tableInvalid={table.present && !table.valid}
      orderHref={orderHref}
      teaser={teaser}
      cashierOpen={cashierOpen}
    />
  );
}
