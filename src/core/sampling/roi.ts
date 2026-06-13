import { getTypedClient } from '@lib/supabase';

export interface ROIQuery {
  startDate: string; // ISO
  endDate: string; // ISO
  conversionWindowDays?: number; // default 90
  filterRepId?: string;
  filterAccountId?: string;
  filterCategoryKey?: string;
}

export interface ROIMetrics {
  totalSampleCount: number;
  totalSampleCostTl: number;
  convertedSampleCount: number;
  conversionRatePct: number; // converted / total * 100
  totalOrderRevenueTl: number; // sipariş tutarları (eşleşmiş)
  roiPct: number; // (revenue - cost) / cost * 100  (cost=0 → 0)
  byProduct: ProductROI[];
  byRep: RepROI[];
}

export interface ProductROI {
  productId?: string;
  productName: string;
  sampleCount: number;
  costTl: number;
  convertedCount: number;
  revenueTl: number;
  roiPct: number;
}

export interface RepROI {
  repId: string;
  sampleCount: number;
  costTl: number;
  convertedCount: number;
  revenueTl: number;
  roiPct: number;
}

interface SampleLineRow {
  id: string;
  sample_id: string;
  product_id?: string | null;
  product_name: string;
  qty: number;
  unit: string;
  unit_cost_tl?: number | null;
  category_key?: string | null;
}

interface SampleRow {
  id: string;
  rep_id: string;
  account_id: string;
  given_at: string;
  converted_order_id?: string | null;
  saha_sample_lines: SampleLineRow[];
}

interface OrderRow {
  id: string;
  total_amount: number;
}

function pctOf(num: number, den: number): number {
  if (!den || den === 0) return 0;
  return (num / den) * 100;
}

function roiPctOf(revenue: number, cost: number): number {
  if (!cost || cost === 0) return 0;
  return ((revenue - cost) / cost) * 100;
}

function lineCost(line: SampleLineRow): number {
  const unit = typeof line.unit_cost_tl === 'number' ? line.unit_cost_tl : 0;
  const qty = typeof line.qty === 'number' ? line.qty : 0;
  return unit * qty;
}

export async function computeROI(query: ROIQuery): Promise<ROIMetrics> {
  const supabase = getTypedClient();

  let q = supabase
    .from('saha_samples')
    .select('id, rep_id, account_id, given_at, converted_order_id, saha_sample_lines(*)')
    .gte('given_at', query.startDate)
    .lte('given_at', query.endDate);

  if (query.filterRepId) q = q.eq('rep_id', query.filterRepId);
  if (query.filterAccountId) q = q.eq('account_id', query.filterAccountId);

  const { data: samplesRaw, error: samplesErr } = await q;
  if (samplesErr) throw samplesErr;

  const samples: SampleRow[] = ((samplesRaw ?? []) as unknown as SampleRow[]).map((s) => ({
    ...s,
    saha_sample_lines: Array.isArray(s.saha_sample_lines) ? s.saha_sample_lines : [],
  }));

  // Kategori filtresi: sample'da en az 1 line filterCategoryKey ile eşleşmeli
  const filtered: SampleRow[] = query.filterCategoryKey
    ? samples.filter((s) =>
        s.saha_sample_lines.some((l) => l.category_key === query.filterCategoryKey),
      )
    : samples;

  // Revenue çek
  const orderIds: string[] = filtered
    .filter((s) => !!s.converted_order_id)
    .map((s) => s.converted_order_id as string);

  const revenueById = new Map<string, number>();
  if (orderIds.length > 0) {
    const { data: orders, error: ordersErr } = await supabase
      .from('orders')
      .select('id, total_amount')
      .in('id', orderIds);
    if (ordersErr) throw ordersErr;
    for (const o of (orders ?? []) as unknown as OrderRow[]) {
      const amt = typeof o.total_amount === 'number' ? o.total_amount : 0;
      revenueById.set(o.id, amt);
    }
  }

  // Aggregate totals
  let totalSampleCount = 0;
  let totalSampleCostTl = 0;
  let convertedSampleCount = 0;
  let totalOrderRevenueTl = 0;

  const productAcc = new Map<string, ProductROI>();
  const repAcc = new Map<string, RepROI>();

  for (const s of filtered) {
    totalSampleCount += 1;

    const lines = query.filterCategoryKey
      ? s.saha_sample_lines.filter((l) => l.category_key === query.filterCategoryKey)
      : s.saha_sample_lines;

    const sampleCost = lines.reduce((acc, l) => acc + lineCost(l), 0);
    totalSampleCostTl += sampleCost;

    const converted = !!s.converted_order_id;
    const revenue = converted ? (revenueById.get(s.converted_order_id as string) ?? 0) : 0;

    if (converted) {
      convertedSampleCount += 1;
      totalOrderRevenueTl += revenue;
    }

    // Rep aggregate
    const repKey = s.rep_id;
    const repEntry = repAcc.get(repKey) ?? {
      repId: repKey,
      sampleCount: 0,
      costTl: 0,
      convertedCount: 0,
      revenueTl: 0,
      roiPct: 0,
    };
    repEntry.sampleCount += 1;
    repEntry.costTl += sampleCost;
    if (converted) {
      repEntry.convertedCount += 1;
      repEntry.revenueTl += revenue;
    }
    repAcc.set(repKey, repEntry);

    // Product aggregate — line bazlı (cost line'dan, revenue sample bazlı pro-rata)
    const lineCostSum = sampleCost > 0 ? sampleCost : 0;
    for (const l of lines) {
      const pKey = l.product_id ?? `name:${l.product_name}`;
      const c = lineCost(l);
      const proRataRevenue = converted && lineCostSum > 0 ? revenue * (c / lineCostSum) : 0;

      const pEntry = productAcc.get(pKey) ?? {
        productId: l.product_id ?? undefined,
        productName: l.product_name,
        sampleCount: 0,
        costTl: 0,
        convertedCount: 0,
        revenueTl: 0,
        roiPct: 0,
      };
      pEntry.sampleCount += 1;
      pEntry.costTl += c;
      if (converted) {
        pEntry.convertedCount += 1;
        pEntry.revenueTl += proRataRevenue;
      }
      productAcc.set(pKey, pEntry);
    }
  }

  const byProduct: ProductROI[] = Array.from(productAcc.values()).map((p) => ({
    ...p,
    roiPct: roiPctOf(p.revenueTl, p.costTl),
  }));

  const byRep: RepROI[] = Array.from(repAcc.values()).map((r) => ({
    ...r,
    roiPct: roiPctOf(r.revenueTl, r.costTl),
  }));

  return {
    totalSampleCount,
    totalSampleCostTl,
    convertedSampleCount,
    conversionRatePct: pctOf(convertedSampleCount, totalSampleCount),
    totalOrderRevenueTl,
    roiPct: roiPctOf(totalOrderRevenueTl, totalSampleCostTl),
    byProduct,
    byRep,
  };
}
