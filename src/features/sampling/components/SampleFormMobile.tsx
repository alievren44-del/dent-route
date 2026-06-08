/**
 * SampleFormMobile — Saha numune verme formu (mobile-first).
 *
 * Sahada eldivenle bile kullanılabilmesi için büyük tap target'lar ve sticky
 * primary submit. Vertical-aware: kategori dropdown'u aktif vertical'ın
 * `samplePolicy.categories` map'inden üretilir.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Eraser,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getSupabaseClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';
import { mapParlaToSahaRole } from '@core/auth/types';
import { useVertical } from '@core/verticals/useVertical';
import { validateCanGiveSample } from '@core/sampling/policies';
import { currentYearMonth, getQuota, getRemainingBudget } from '@core/sampling/quotas';
import type {
  NewSampleLine,
  SampleValidationIssue,
  SampleValidationResult,
} from '@core/sampling/types';

const KVKK_TEXT =
  'Bu numune teslim alındığı klinik tarafından, yalnızca tanıtım/değerlendirme amacıyla kullanılmak üzere alınmıştır. ' +
  'Kişisel ve kurumsal veriler 6698 sayılı KVKK kapsamında işlenmektedir. Detaylı bilgi için aydınlatma metnine başvurunuz.';

const KVKK_VERSION = 'v1';

const UNIT_OPTIONS = ['adet', 'paket', 'kutu'] as const;
type UnitOption = (typeof UNIT_OPTIONS)[number];

export interface SampleFormMobileProps {
  preselectedAccountId?: string;
  onSubmitted?: (sampleId: string) => void;
}

interface AccountRow {
  id: string;
  name: string;
  type?: string | null;
}

interface VariantLite {
  id: string;
  sku?: string | null;
  price_try?: number | null;
  attributes?: Record<string, unknown> | null;
}

interface ProductRow {
  id: string;
  name: string;
  sale_price?: number | null;
  base_price?: number | null;
  brand?: string | null;
  category_id?: string | null;
  product_variants?: VariantLite[] | null;
}

/** Varyant için kısa etiket: iso / size / shade / sku + grit/shaft. */
function variantLabel(v: VariantLite): string {
  const a = (v.attributes ?? {}) as Record<string, unknown>;
  const pick = (k: string): string | undefined => {
    const val = a[k];
    return val == null || val === '' ? undefined : String(val);
  };
  const primary =
    pick('iso') ??
    pick('size_label') ??
    pick('shade_code') ??
    pick('tipSize') ??
    (v.sku ?? undefined) ??
    'Standart';
  const extra = [pick('grit'), pick('shaft'), pick('package_type')]
    .filter(Boolean)
    .join(' ');
  return [primary, extra].filter(Boolean).join(' · ');
}

interface FormLine extends NewSampleLine {
  uid: string;
  productQuery: string;
  showProductResults: boolean;
}

function todayIso(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function defaultFollowUpDate(givenAt: string): string {
  const d = new Date(givenAt);
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

function newLineUid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyLine(): FormLine {
  return {
    uid: newLineUid(),
    productId: undefined,
    productName: '',
    qty: 1,
    unit: 'adet',
    unitCostTl: undefined,
    categoryKey: undefined,
    productQuery: '',
    showProductResults: false,
  };
}

function SampleFormMobile({
  preselectedAccountId,
  onSubmitted,
}: SampleFormMobileProps): JSX.Element {
  const vertical = useVertical();
  const customerLabel = vertical.labels.customer.singular;
  const supabase = getSupabaseClient();

  // Yönetici/admin: numune bütçe limitini bypass eder (onay gerekmez).
  const profile = useAuthStore((s) => s.profile);
  const isAdmin = mapParlaToSahaRole(profile?.role) === 'admin';

  // Hangi satır için varyant seçimi açık (productId ürün/varyant id'si).
  const [variantPickFor, setVariantPickFor] = useState<{ uid: string; product: ProductRow } | null>(
    null,
  );

  // ----- Account selector state
  const [selectedAccount, setSelectedAccount] = useState<AccountRow | null>(null);
  const [accountQuery, setAccountQuery] = useState<string>('');
  const [showAccountResults, setShowAccountResults] = useState<boolean>(false);

  // ----- Auth user (rep) — query
  const repQuery = useQuery({
    queryKey: ['auth-user'],
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
  });
  const repId = repQuery.data ?? null;

  // ----- Preselected account fetch
  useEffect(() => {
    if (!preselectedAccountId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('saha_clinics')
        .select('id, name, types')
        .eq('id', preselectedAccountId)
        .maybeSingle();
      if (cancelled) return;
      if (!error && data) {
        const row = data as { id: string; name: string; types: string[] | null };
        setSelectedAccount({ id: row.id, name: row.name, type: row.types?.[0] ?? null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preselectedAccountId, supabase]);

  // ----- Account search query (saha_clinics)
  const accountSearchQuery = useQuery({
    queryKey: ['account-search', accountQuery],
    enabled: accountQuery.trim().length >= 2 && !preselectedAccountId,
    queryFn: async (): Promise<AccountRow[]> => {
      const { data, error } = await supabase
        .from('saha_clinics')
        .select('id, name, types')
        .ilike('name', `%${accountQuery.trim()}%`)
        .eq('status', 'active')
        .limit(10);
      if (error) throw error;
      return (
        (data ?? []) as Array<{
          id: string;
          name: string;
          types: string[] | null;
        }>
      ).map((r) => ({ id: r.id, name: r.name, type: r.types?.[0] ?? null }));
    },
  });

  // ----- Dates
  const [givenAt, setGivenAt] = useState<string>(() => todayIso());
  const [followUpAt, setFollowUpAt] = useState<string>(() => defaultFollowUpDate(todayIso()));
  const [followUpTouched, setFollowUpTouched] = useState<boolean>(false);

  useEffect(() => {
    if (!followUpTouched) {
      setFollowUpAt(defaultFollowUpDate(givenAt));
    }
  }, [givenAt, followUpTouched]);

  // ----- Lines
  const [lines, setLines] = useState<FormLine[]>(() => [emptyLine()]);

  function updateLine(uid: string, patch: Partial<FormLine>): void {
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  }

  function addLine(): void {
    setLines((prev) => [...prev, emptyLine()]);
  }

  /** Ürün (+ opsiyonel varyant) seçimini satıra yazar. */
  function finalizeLine(uid: string, product: ProductRow, variant?: VariantLite): void {
    const price =
      variant?.price_try ??
      (product.sale_price ?? product.base_price) ??
      undefined;
    const name = variant ? `${product.name} · ${variantLabel(variant)}` : product.name;
    updateLine(uid, {
      productId: variant?.id ?? product.id,
      productName: name,
      productQuery: '',
      showProductResults: false,
      unitCostTl: price != null ? Number(price) : undefined,
    });
    setVariantPickFor(null);
  }

  /** Ürün tıklandı: ≥2 varyant varsa seçici aç, değilse direkt bitir. */
  function handleProductPick(uid: string, product: ProductRow): void {
    const variants = product.product_variants ?? [];
    if (variants.length >= 2) {
      setVariantPickFor({ uid, product });
      updateLine(uid, { showProductResults: false });
    } else {
      finalizeLine(uid, product, variants[0]);
    }
  }

  function removeLine(uid: string): void {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.uid !== uid)));
  }

  // ----- KVKK
  const [kvkkChecked, setKvkkChecked] = useState<boolean>(false);

  // ----- Notes
  const [notes, setNotes] = useState<string>('');

  // ----- Photo
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const photoPreviewUrl = useMemo<string | null>(() => {
    if (!photoFile) return null;
    return URL.createObjectURL(photoFile);
  }, [photoFile]);
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  // ----- Signature canvas
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<boolean>(false);
  const [signatureEmpty, setSignatureEmpty] = useState<boolean>(true);

  function getCanvasCtx(): CanvasRenderingContext2D | null {
    const c = canvasRef.current;
    if (!c) return null;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    return ctx;
  }

  function pointerPos(e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * c.width,
      y: ((e.clientY - rect.top) / rect.height) * c.height,
    };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>): void {
    const ctx = getCanvasCtx();
    if (!ctx) return;
    drawingRef.current = true;
    const { x, y } = pointerPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!drawingRef.current) return;
    const ctx = getCanvasCtx();
    if (!ctx) return;
    const { x, y } = pointerPos(e);
    ctx.lineTo(x, y);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
    ctx.stroke();
    if (signatureEmpty) setSignatureEmpty(false);
  }

  function handlePointerUp(): void {
    drawingRef.current = false;
  }

  function clearSignature(): void {
    const c = canvasRef.current;
    const ctx = getCanvasCtx();
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    setSignatureEmpty(true);
  }

  // ----- Blacklist check
  const blacklistQuery = useQuery({
    queryKey: ['blacklist', selectedAccount?.id ?? null],
    enabled: Boolean(selectedAccount?.id),
    queryFn: async (): Promise<{ banned: boolean }> => {
      if (!selectedAccount?.id) return { banned: false };
      const { data, error } = await supabase
        .from('saha_blacklist')
        .select('account_id')
        .eq('account_id', selectedAccount.id)
        .maybeSingle();
      if (error) return { banned: false };
      return { banned: Boolean(data) };
    },
  });
  const isBlacklisted = blacklistQuery.data?.banned ?? false;

  // ----- Quota
  const quotaQuery = useQuery({
    queryKey: ['quota', repId ?? null],
    enabled: Boolean(repId),
    queryFn: async () => {
      if (!repId) return null;
      return await getQuota(repId);
    },
  });
  const remainingBudget = getRemainingBudget(quotaQuery.data ?? null);

  // ----- Estimated total cost
  const totalCost = useMemo<number>(() => {
    return lines.reduce((s, l) => s + (l.unitCostTl ?? 0) * (l.qty || 0), 0);
  }, [lines]);

  // ----- Per-line validation
  const validationResults = useMemo<SampleValidationResult[]>(() => {
    return lines.map((line) =>
      validateCanGiveSample({
        line: {
          productId: line.productId,
          productName: line.productName,
          qty: line.qty,
          unit: line.unit,
          unitCostTl: line.unitCostTl,
          categoryKey: line.categoryKey,
        },
        verticalKey: vertical.id,
        policy: vertical.samplePolicy,
        overrides: [],
        // TODO Sprint 5.5+: previousSamplesThisAccount RPC ile çekilecek
        isBlacklisted,
        previousSamplesThisAccount: [],
        // Admin/yönetici bütçe limitine takılmaz.
        remainingBudgetTl: isAdmin ? Number.POSITIVE_INFINITY : remainingBudget,
        estimatedLineCostTl: (line.unitCostTl ?? 0) * (line.qty || 0),
      }),
    );
  }, [lines, vertical.id, vertical.samplePolicy, isBlacklisted, remainingBudget, isAdmin]);

  const hasBlockingIssue = validationResults.some((r) => !r.ok);
  const budgetExceeded = !isAdmin && totalCost > remainingBudget && remainingBudget > 0;

  // ----- Product search per line
  const activeProductLine = lines.find(
    (l) => l.showProductResults && l.productQuery.trim().length >= 2,
  );
  const productSearchQuery = useQuery({
    queryKey: [
      'product-search',
      activeProductLine?.uid ?? null,
      activeProductLine?.productQuery ?? '',
    ],
    enabled: Boolean(activeProductLine && activeProductLine.productQuery.trim().length >= 2),
    queryFn: async (): Promise<ProductRow[]> => {
      if (!activeProductLine) return [];
      // Birleşik katalog view'i — public.products + Fanta + Olident (v_saha_products).
      // Gerçek ürünler markaya özel şemalarda; bu view 3 kaynağı tek listede toplar.
      const { data, error } = await supabase
        .from('v_saha_products')
        .select('id, name, sale_price, brand, main_image, product_variants')
        .ilike('name', `%${activeProductLine.productQuery.trim()}%`)
        .limit(8);
      if (error) throw error;
      return (data ?? []) as ProductRow[];
    },
  });

  // ----- Category options from samplePolicy
  const categoryOptions = useMemo<{ key: string; label: string }[]>(() => {
    const cats = vertical.samplePolicy?.categories;
    if (!cats) return [];
    return Object.entries(cats).map(([key, cat]) => ({ key, label: cat.label }));
  }, [vertical.samplePolicy]);

  // ----- Submit
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canSubmit =
    !submitting &&
    Boolean(selectedAccount) &&
    lines.length > 0 &&
    lines.every((l) => l.productName.trim().length > 0 && l.qty > 0) &&
    kvkkChecked &&
    !hasBlockingIssue &&
    Boolean(repId);

  // "Numune Ver" neden pasif — kullanıcıya eksikleri göster.
  const submitBlockers = useMemo<string[]>(() => {
    const out: string[] = [];
    if (!selectedAccount) out.push(`${customerLabel} seçilmedi`);
    if (lines.length === 0 || !lines.every((l) => l.productName.trim().length > 0 && l.qty > 0)) {
      out.push('Her satırda ürün + miktar olmalı');
    }
    if (!kvkkChecked) out.push('KVKK onay kutusu işaretlenmeli');
    if (hasBlockingIssue) {
      for (const r of validationResults) {
        for (const iss of r.issues) {
          if (!r.ok) out.push(iss.message);
        }
      }
    }
    if (!repId) out.push('Oturum bulunamadı (tekrar giriş yapın)');
    return [...new Set(out)];
  }, [selectedAccount, customerLabel, lines, kvkkChecked, hasBlockingIssue, validationResults, repId]);

  async function handleSubmit(): Promise<void> {
    setSubmitError(null);
    if (!canSubmit || !selectedAccount || !repId) return;
    setSubmitting(true);
    try {
      // 1. Photo upload (opsiyonel)
      let photoUrl: string | undefined;
      if (photoFile) {
        const path = `${repId}/${Date.now()}-${photoFile.name}`;
        const { data, error } = await supabase.storage.from('saha-samples').upload(path, photoFile);
        if (!error && data) {
          const row = data as { path: string };
          photoUrl = row.path;
        }
      }

      // 2. Signature upload (opsiyonel)
      let signatureUrl: string | undefined;
      const canvas = canvasRef.current;
      if (canvas && !signatureEmpty) {
        const dataUrl = canvas.toDataURL('image/png');
        const blob = await (await fetch(dataUrl)).blob();
        const path = `${repId}/${Date.now()}-signature.png`;
        const { data } = await supabase.storage.from('saha-samples').upload(path, blob);
        if (data) {
          const row = data as { path: string };
          signatureUrl = row.path;
        }
      }

      // 3. Insert sample
      const insertPayload: Record<string, unknown> = {
        account_id: selectedAccount.id,
        rep_id: repId,
        given_at: givenAt,
        follow_up_at: followUpAt,
        status: 'verildi',
        kvkk_consent_version: KVKK_VERSION,
      };
      if (photoUrl) insertPayload.photo_url = photoUrl;
      if (signatureUrl) insertPayload.signature_url = signatureUrl;
      if (notes.trim()) insertPayload.notes = notes.trim();

      const { data: sample, error: sampleErr } = await supabase
        .from('saha_samples')
        .insert(insertPayload)
        .select('id')
        .single();

      if (sampleErr || !sample) {
        throw sampleErr ?? new Error('Numune kaydı oluşturulamadı.');
      }
      const sampleId = (sample as { id: string }).id;

      // 4. Insert lines
      const linesPayload = lines.map((l) => ({
        sample_id: sampleId,
        product_id: l.productId ?? null,
        product_name: l.productName.trim(),
        qty: l.qty,
        unit: l.unit ?? 'adet',
        unit_cost_tl: l.unitCostTl ?? null,
      }));
      const { error: linesErr } = await supabase.from('saha_sample_lines').insert(linesPayload);
      if (linesErr) throw linesErr;

      // 5. Increment quota
      if (totalCost > 0) {
        try {
          await supabase.rpc('saha_increment_sample_spent', {
            _rep_id: repId,
            _year_month: currentYearMonth(),
            _amount: totalCost,
          });
        } catch (rpcErr) {
          // RPC yoksa şimdilik sessiz geç
          console.warn('saha_increment_sample_spent RPC missing', rpcErr);
        }
      }

      onSubmitted?.(sampleId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Numune kaydı sırasında hata oluştu.';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // ----- Render
  return (
    <div className="flex flex-col gap-5 pb-28">
      {/* 1. Klinik seçici */}
      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground">{customerLabel}</label>
        {selectedAccount && (preselectedAccountId || !showAccountResults) ? (
          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-3">
            <div className="min-w-0">
              <div className="font-semibold truncate">{selectedAccount.name}</div>
              {selectedAccount.type && (
                <div className="text-xs text-muted-foreground truncate">{selectedAccount.type}</div>
              )}
            </div>
            {!preselectedAccountId && (
              <button
                type="button"
                onClick={() => {
                  setSelectedAccount(null);
                  setAccountQuery('');
                }}
                className="inline-flex items-center justify-center rounded-lg border border-border h-11 min-h-tap-min min-w-tap-min px-3 text-sm"
                aria-label={`${customerLabel} sıfırla`}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        ) : (
          <div className="relative">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="text"
                value={accountQuery}
                onChange={(e) => {
                  setAccountQuery(e.target.value);
                  setShowAccountResults(true);
                }}
                onFocus={() => setShowAccountResults(true)}
                placeholder={`${customerLabel} ara…`}
                className="w-full rounded-xl border border-border bg-background pl-9 pr-3 h-12 min-h-tap-min text-base"
              />
            </div>
            {showAccountResults && accountQuery.trim().length >= 2 && (
              <div className="mt-1 rounded-xl border border-border bg-background shadow-lg overflow-hidden">
                {accountSearchQuery.isLoading && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">Aranıyor…</div>
                )}
                {!accountSearchQuery.isLoading && (accountSearchQuery.data?.length ?? 0) === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">Sonuç yok</div>
                )}
                {(accountSearchQuery.data ?? []).map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => {
                      setSelectedAccount(a);
                      setShowAccountResults(false);
                      setAccountQuery('');
                    }}
                    className="w-full text-left px-3 py-3 min-h-tap-min hover:bg-muted border-b border-border last:border-b-0"
                  >
                    <div className="font-medium">{a.name}</div>
                    {a.type && <div className="text-xs text-muted-foreground">{a.type}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {isBlacklisted && selectedAccount && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>Bu {customerLabel.toLocaleLowerCase('tr')} kara listede. Numune verilemez.</span>
          </div>
        )}
      </section>

      {/* 2. Tarihler */}
      <section className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="given-at">
            Teslim Tarihi
          </label>
          <input
            id="given-at"
            type="date"
            value={givenAt}
            onChange={(e) => setGivenAt(e.target.value)}
            className="rounded-xl border border-border bg-background px-3 h-12 min-h-tap-min text-base"
          />
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="follow-up-at">
            Takip Tarihi
          </label>
          <input
            id="follow-up-at"
            type="date"
            value={followUpAt}
            onChange={(e) => {
              setFollowUpAt(e.target.value);
              setFollowUpTouched(true);
            }}
            className="rounded-xl border border-border bg-background px-3 h-12 min-h-tap-min text-base"
          />
        </div>
      </section>

      {/* 3. Ürün satırları */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Ürünler</h3>
          <button
            type="button"
            onClick={addLine}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 h-11 min-h-tap-min text-sm font-medium text-primary-foreground"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Ürün Ekle
          </button>
        </div>
        {lines.map((line, idx) => {
          const lineValidation = validationResults[idx];
          const lineIssues: SampleValidationIssue[] = lineValidation?.issues ?? [];
          return (
            <div
              key={line.uid}
              className="rounded-2xl border border-border bg-card p-3 flex flex-col gap-3"
            >
              {/* Product name + search */}
              <div className="relative">
                <label className="text-xs text-muted-foreground">Ürün Adı</label>
                <input
                  type="text"
                  value={line.productName}
                  onChange={(e) => {
                    updateLine(line.uid, {
                      productName: e.target.value,
                      productQuery: e.target.value,
                      showProductResults: true,
                      productId: undefined,
                    });
                  }}
                  onFocus={() => updateLine(line.uid, { showProductResults: true })}
                  placeholder="Ürün adı yaz…"
                  className="w-full rounded-xl border border-border bg-background px-3 h-12 min-h-tap-min text-base"
                />
                {/* Varyant seçimi — ürün ≥2 varyantlı seçilince */}
                {variantPickFor?.uid === line.uid && (
                  <div className="mt-1 rounded-xl border border-border bg-background shadow-lg overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
                      <span className="text-xs font-medium truncate">
                        {variantPickFor.product.name} — varyant seç
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setVariantPickFor(null);
                          updateLine(line.uid, { showProductResults: true });
                        }}
                        className="text-xs text-primary shrink-0 ml-2"
                      >
                        ← Geri
                      </button>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {(variantPickFor.product.product_variants ?? []).map((v) => (
                        <button
                          type="button"
                          key={v.id}
                          onClick={() => finalizeLine(line.uid, variantPickFor.product, v)}
                          className="w-full text-left px-3 py-3 min-h-tap-min hover:bg-muted border-b border-border last:border-b-0"
                        >
                          <div className="font-medium">{variantLabel(v)}</div>
                          <div className="text-xs text-muted-foreground">
                            {v.sku ? `${v.sku} · ` : ''}
                            {v.price_try != null ? `${Number(v.price_try).toFixed(2)} TL` : 'Fiyat —'}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ürün arama sonuçları */}
                {variantPickFor?.uid !== line.uid &&
                  line.showProductResults &&
                  line.productQuery.trim().length >= 2 && (
                    <div className="mt-1 rounded-xl border border-border bg-background shadow-lg overflow-hidden">
                      {productSearchQuery.isLoading && activeProductLine?.uid === line.uid && (
                        <div className="px-3 py-2 text-sm text-muted-foreground">Aranıyor…</div>
                      )}
                      {activeProductLine?.uid === line.uid &&
                        !productSearchQuery.isLoading &&
                        (productSearchQuery.data?.length ?? 0) === 0 && (
                          <div className="px-3 py-2 text-sm text-muted-foreground">Sonuç yok</div>
                        )}
                      {activeProductLine?.uid === line.uid &&
                        (productSearchQuery.data ?? []).map((p) => {
                          const variantCount = p.product_variants?.length ?? 0;
                          return (
                            <button
                              type="button"
                              key={p.id}
                              onClick={() => handleProductPick(line.uid, p)}
                              className="w-full text-left px-3 py-3 min-h-tap-min hover:bg-muted border-b border-border last:border-b-0"
                            >
                              <div className="font-medium">{p.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {p.brand ? `${p.brand} · ` : ''}
                                {(p.sale_price ?? p.base_price) != null
                                  ? `${Number(p.sale_price ?? p.base_price).toFixed(2)} TL`
                                  : 'Fiyat —'}
                                {variantCount >= 2 ? ` · ${variantCount} varyant ›` : ''}
                              </div>
                            </button>
                          );
                        })}
                    </div>
                  )}
              </div>

              {/* Qty + unit */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Miktar</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={line.qty}
                    onChange={(e) =>
                      updateLine(line.uid, { qty: Math.max(0, Number(e.target.value) || 0) })
                    }
                    className="w-full rounded-xl border border-border bg-background px-3 h-12 min-h-tap-min text-base"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Birim</label>
                  <select
                    value={line.unit ?? 'adet'}
                    onChange={(e) => updateLine(line.uid, { unit: e.target.value as UnitOption })}
                    className="w-full rounded-xl border border-border bg-background px-3 h-12 min-h-tap-min text-base"
                  >
                    {UNIT_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Cost + Category */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Birim Maliyet (TL)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    value={line.unitCostTl ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateLine(line.uid, {
                        unitCostTl: v === '' ? undefined : Number(v),
                      });
                    }}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-border bg-background px-3 h-12 min-h-tap-min text-base"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Kategori</label>
                  <select
                    value={line.categoryKey ?? ''}
                    onChange={(e) =>
                      updateLine(line.uid, {
                        categoryKey: e.target.value === '' ? undefined : e.target.value,
                      })
                    }
                    className="w-full rounded-xl border border-border bg-background px-3 h-12 min-h-tap-min text-base"
                    disabled={categoryOptions.length === 0}
                  >
                    <option value="">Seç…</option>
                    {categoryOptions.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Line issues */}
              {lineIssues.length > 0 && (
                <div className="flex flex-col gap-1">
                  {lineIssues.map((issue, i) => (
                    <div
                      key={`${line.uid}-issue-${i}`}
                      className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs ${
                        issue.code === 'no_policy'
                          ? 'bg-amber-50 text-amber-800'
                          : 'bg-red-50 text-red-700'
                      }`}
                    >
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                      <span>{issue.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Remove line */}
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLine(line.uid)}
                  className="self-end inline-flex items-center gap-1.5 rounded-xl border border-border h-11 min-h-tap-min px-3 text-sm text-red-700"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Satır Sil
                </button>
              )}
            </div>
          );
        })}
      </section>

      {/* 4. Politika ve kota uyarı paneli */}
      <section className="rounded-2xl border border-border bg-muted/30 p-3 flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Bütçe & Politika</h3>
        <div
          className={`flex items-center justify-between text-sm rounded-lg px-2 py-1.5 ${
            budgetExceeded ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
          }`}
        >
          <span>Bu ay kalan bütçe</span>
          <span className="font-semibold">{remainingBudget.toFixed(2)} TL</span>
        </div>
        <div className="flex items-center justify-between text-sm rounded-lg px-2 py-1.5 bg-background border border-border">
          <span>Bu numunenin tahmini maliyeti</span>
          <span className="font-semibold">{totalCost.toFixed(2)} TL</span>
        </div>
        {budgetExceeded && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-700">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              Bütçe aşılacak: {(totalCost - remainingBudget).toFixed(2)} TL fazla. Admin onayı
              gerekebilir.
            </span>
          </div>
        )}
      </section>

      {/* 5. KVKK */}
      <section className="rounded-2xl border border-border bg-card p-3 flex flex-col gap-2">
        <h3 className="text-sm font-semibold">KVKK Onayı</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">{KVKK_TEXT}</p>
        <label className="flex items-start gap-2 mt-1 cursor-pointer">
          <input
            type="checkbox"
            checked={kvkkChecked}
            onChange={(e) => setKvkkChecked(e.target.checked)}
            className="mt-1 h-5 w-5"
          />
          <span className="text-sm">
            {customerLabel} teslim aldığını ve KVKK metnini onayladığını beyan ederim.
          </span>
        </label>
      </section>

      {/* 6. Notlar */}
      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor="notes">
          Notlar
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Opsiyonel açıklama…"
          className="rounded-xl border border-border bg-background px-3 py-2 text-base"
        />
      </section>

      {/* 7. Foto */}
      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium">Teslim Fotoğrafı</label>
        <label className="inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background h-12 min-h-tap-min cursor-pointer">
          <Camera className="h-5 w-5" aria-hidden="true" />
          <span className="text-sm">
            {photoFile ? 'Fotoğrafı değiştir' : 'Fotoğraf çek / yükle'}
          </span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setPhotoFile(f);
            }}
          />
        </label>
        {photoPreviewUrl && (
          <div className="relative w-32 h-32 rounded-xl overflow-hidden border border-border">
            <img src={photoPreviewUrl} alt="önizleme" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => setPhotoFile(null)}
              className="absolute top-1 right-1 inline-flex items-center justify-center rounded-full bg-background/90 h-7 w-7"
              aria-label="Fotoğrafı kaldır"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </section>

      {/* 8. İmza */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">İmza</label>
          <button
            type="button"
            onClick={clearSignature}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border h-9 px-2 text-xs"
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
            Temizle
          </button>
        </div>
        <div className="rounded-xl border border-border bg-background p-2">
          <canvas
            ref={canvasRef}
            width={500}
            height={200}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className="w-full touch-none bg-white rounded-md"
            style={{ height: 100 }}
          />
        </div>
        {signatureEmpty && (
          <p className="text-xs text-muted-foreground">
            İmza opsiyonel; alıyorsanız parmak/kalem ile çizebilirsiniz.
          </p>
        )}
      </section>

      {/* Submit error */}
      {submitError && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{submitError}</span>
        </div>
      )}

      {/* Sticky submit */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background/95 backdrop-blur px-4 py-3 safe-area-inset">
        {!canSubmit && submitBlockers.length > 0 && (
          <ul className="mb-2 flex flex-col gap-0.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {submitBlockers.map((b, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => {
            void handleSubmit();
          }}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground font-semibold h-14 min-h-tap-min text-base disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              Kaydediliyor…
            </>
          ) : (
            <>
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              Numune Ver
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default SampleFormMobile;
