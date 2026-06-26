/**
 * CustomerListPage — Mevcut müşteri (account) listesi.
 *
 * URL: /clinics
 * Sprint: 2, PROMPT-11
 *
 * Yetenekler:
 *  - Debounced arama (name / contact name / phone)
 *  - Filter paneli (tip, il/ilçe, durum, min review, last visit range, rep, has_balance)
 *  - Sort dropdown (Name / Distance / Last Visit / Reviews / Balance)
 *  - Multi-select mode: route basket'a ekle / Excel export / "Bölge ata" stub
 *  - URL params: ?search=&province=&type=
 *  - Sayfalama: pageSize=50 + "Daha Fazla" butonu
 *  - Empty state
 *  - saha_visits ile son ziyaret join (yoksa gracefully fallback)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search,
  CheckSquare,
  Square,
  ArrowUpDown,
  FileSpreadsheet,
  MapPin,
  Plus,
  Users,
} from 'lucide-react';

import { useVertical } from '@core/verticals/useVertical';
import { useAuthStore } from '@core/auth/authStore';
import { getSupabaseClient, getTypedClient } from '@lib/supabase';
import { SupabaseCRMAdapter } from '@core/adapters/builtin/SupabaseCRMAdapter';
import { useGeolocation } from '@features/map/hooks/useGeolocation';
import ClinicCard from '@features/discovery/components/ClinicCard';
import {
  useRouteBasket,
  MAX_BASKET,
  type BasketStop,
} from '@features/routes/store/routeBasketStore';
import CustomerFilters, {
  DEFAULT_CUSTOMER_FILTERS,
  type CustomerFiltersValue,
  type RepOption,
} from '@features/customers/components/CustomerFilters';
import { exportToXlsx, type AccountRow as ExportRow } from '@features/customers/lib/customerExport';

// Built-in CRM adapter — module scope (OrderFormPage/DiscoveryPage ile aynı desen).
const adapter = new SupabaseCRMAdapter();

type SortKey = 'name' | 'distance' | 'last_visit' | 'reviews' | 'balance';

interface VisitRow {
  account_id: string;
  check_in_at: string | null;
  outcome: string | null;
}

interface CustomerListRow {
  id: string;
  name: string;
  type: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  neighborhood: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  reviews: number | null;
  balance: number | null;
  lastVisitAt: string | null;
  lastVisitOutcome: string | null;
  /** Rep'in ziyaret/randevu/not bıraktığı kendi kliniği mi (üstte sabitlenir). */
  isMine?: boolean;
}

const PAGE_SIZE = 50;
/** No-GPS tam-liste için sunucudan tek seferde çekilen sayfa boyutu (range-tabanlı load-more). */
const DATA_PAGE_SIZE = 500;

/**
 * Türkçe accent-fold + lowercase. Aramada "çağdaş" ↔ "cagdas" eşitlemek için.
 */
function foldTr(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/i̇/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u');
}

function digits(s: string): string {
  return s.replace(/\D+/g, '');
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

const CLINIC_COLS =
  'id, name, lat, lng, address, phone, rating, user_ratings_total, types, province_slug, district_slug, raw_payload';

type ClinicSelectRow = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  phone: string | null;
  rating: number | string | null;
  user_ratings_total: number | null;
  types: string[] | null;
  province_slug: string | null;
  district_slug: string | null;
  raw_payload?: Record<string, unknown> | null;
};

function clinicRowToCustomerListRow(c: ClinicSelectRow): CustomerListRow {
  const cf = c.raw_payload ?? {};
  const neighborhood =
    typeof cf['neighborhood'] === 'string'
      ? cf['neighborhood']
      : typeof cf['mahalle'] === 'string'
        ? cf['mahalle']
        : null;
  const balance = typeof cf['balance'] === 'number' ? cf['balance'] : null;
  const ratingNum =
    typeof c.rating === 'number'
      ? c.rating
      : typeof c.rating === 'string'
        ? Number.parseFloat(c.rating)
        : null;
  return {
    id: c.id,
    name: c.name,
    type: c.types?.[0] ?? null,
    phone: c.phone,
    whatsapp: null,
    address: c.address,
    city: c.province_slug,
    district: c.district_slug,
    neighborhood,
    lat: c.lat,
    lng: c.lng,
    rating: ratingNum != null && Number.isFinite(ratingNum) ? ratingNum : null,
    reviews: c.user_ratings_total,
    balance,
    lastVisitAt: null,
    lastVisitOutcome: null,
  };
}

/**
 * Rep'in etkileşimde olduğu klinik id'leri (ziyaret + randevu + not).
 * GPS'ten BAĞIMSIZ "benim kliniklerim" — uzaktayken bile listede kalsın.
 */
async function fetchMyClinicIds(repId: string): Promise<string[]> {
  const ids = new Set<string>();
  const add = (rows: { account_id: string | null }[] | null | undefined): void => {
    (rows ?? []).forEach((r) => {
      if (r.account_id) ids.add(String(r.account_id));
    });
  };
  const typed = getTypedClient();
  const raw = getSupabaseClient();
  const results = await Promise.allSettled([
    typed.from('saha_visits').select('account_id').eq('rep_id', repId).limit(3000),
    typed.from('saha_account_notes').select('account_id').eq('rep_id', repId).limit(3000),
    raw.from('saha_reminders').select('account_id').eq('rep_id', repId).limit(3000),
  ]);
  for (const r of results) {
    if (r.status === 'fulfilled') add(r.value.data as { account_id: string | null }[] | null);
  }
  return [...ids];
}

/**
 * Klinik listesi — üç kaynak BİRLEŞİMİ (id'ye göre dedup):
 *  1. Coğrafi keşif: GPS varsa saha_search_nearby_clinics (50km), yoksa adapter (ad sırası).
 *  2. Benim kliniklerim: rep'in ziyaret/randevu/not bıraktığı klinikler (GPS'ten bağımsız).
 *  3. Sunucu-tarafı ad araması: yazılan sorgu DB'de ilike (yakın olmayan klinik de bulunsun).
 * Son ziyaret tüm id'ler için tek sorguda eklenir.
 */
async function fetchAccounts(
  geo: { lat: number; lng: number } | null,
  repId: string | null,
  search: string,
  /** No-GPS tam-liste sayfa indeksi (0-based). 0..dataPage aralığı kümülatif çekilir. */
  dataPage = 0,
): Promise<CustomerListRow[]> {
  const supabase = getTypedClient();

  type RpcRow = ClinicSelectRow & {
    google_place_id: string | null;
    clinic_segment: string | null;
    last_verified_at: string | null;
    distance_m: number | null;
  };

  const byId = new Map<string, CustomerListRow>();
  const merge = (rows: CustomerListRow[]): void => {
    for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);
  };

  // 1. Coğrafi keşif
  if (geo) {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('saha_search_nearby_clinics', {
      _lat: geo.lat,
      _lng: geo.lng,
      _radius_m: 50_000,
      _vertical_key: 'dental',
      _limit: 5000,
    });
    if (!rpcErr && rpcData) {
      merge((rpcData as RpcRow[]).map(clinicRowToCustomerListRow));
    } else if (rpcErr) {
      console.warn('saha_search_nearby_clinics başarısız, fallback:', rpcErr.message);
    }
  } else if (search.trim().length < 2) {
    // No-GPS tam-liste: PostgREST 1000-satır cap'ini aşmak için 0..dataPage sayfalarını
    // range-tabanlı kümülatif çek (her sayfa DATA_PAGE_SIZE). 5641 aktif kliniğin tamamına ulaşılır.
    // Aktif arama varken (>=2 hane) bu ağır liste atlanır; sonuçlar #3 sunucu-ad-araması'ndan gelir.
    for (let p = 0; p <= dataPage; p++) {
      const { items: customers } = await adapter.listCustomers({
        limit: DATA_PAGE_SIZE,
        offset: p * DATA_PAGE_SIZE,
      });
      merge(
        customers.map<CustomerListRow>((c) => {
          const primary = c.addresses?.[0];
          const cf = c.customFields ?? {};
          const ratingRaw = cf['rating'];
          const ratingNum =
            typeof ratingRaw === 'number'
              ? ratingRaw
              : typeof ratingRaw === 'string'
                ? Number.parseFloat(ratingRaw)
                : null;
          const reviews =
            typeof cf['user_ratings_total'] === 'number' ? cf['user_ratings_total'] : null;
          return {
            id: c.id,
            name: c.name,
            type: c.type ?? null,
            phone: c.phone ?? null,
            whatsapp: null,
            address: primary?.addressLine ?? null,
            city: c.region ?? primary?.city ?? null,
            district: primary?.district ?? null,
            neighborhood: null,
            lat: primary?.location?.lat ?? null,
            lng: primary?.location?.lng ?? null,
            rating: ratingNum != null && Number.isFinite(ratingNum) ? ratingNum : null,
            reviews,
            balance: null,
            lastVisitAt: null,
            lastVisitOutcome: null,
          };
        }),
      );
      // Son sayfa dolu gelmediyse daha fazla veri yok → erken çık.
      if (customers.length < DATA_PAGE_SIZE) break;
    }
  }

  // 2. Benim kliniklerim (her zaman, GPS'ten bağımsız)
  const myIdSet = new Set<string>();
  if (repId) {
    for (const id of await fetchMyClinicIds(repId)) myIdSet.add(id);
    const missing = [...myIdSet].filter((id) => !byId.has(id));
    for (let i = 0; i < missing.length; i += 100) {
      const chunk = missing.slice(i, i + 100);
      const { data } = await supabase.from('saha_clinics').select(CLINIC_COLS).in('id', chunk);
      merge(((data ?? []) as ClinicSelectRow[]).map(clinicRowToCustomerListRow));
    }
  }

  // 3. Sunucu-tarafı ad araması — Turkish-diacritic-aware RPC (replaces accent-blind .ilike)
  const q = search.trim();
  if (q.length >= 2) {
    const { data: rpcRows, error: rpcSearchErr } = await supabase.rpc('saha_search_clinics', {
      _q: q,
      _vertical_key: 'dental',
      _limit: 30,
    });
    if (!rpcSearchErr && rpcRows) {
      type SearchClinicRow = {
        id: string;
        name: string;
        lat: number | null;
        lng: number | null;
        address: string | null;
        phone: string | null;
        rating: number | null;
        user_ratings_total: number | null;
        province_slug: string | null;
        district_slug: string | null;
      };
      merge(
        (rpcRows as SearchClinicRow[])
          .map(
            (r): ClinicSelectRow => ({
              id: r.id,
              name: r.name,
              lat: r.lat,
              lng: r.lng,
              address: r.address,
              phone: r.phone,
              rating: r.rating,
              user_ratings_total: r.user_ratings_total,
              types: null,
              province_slug: r.province_slug,
              district_slug: r.district_slug,
              raw_payload: null,
            }),
          )
          .map(clinicRowToCustomerListRow),
      );
    }
  }

  // 4. Son ziyaret + "benim kliniğim" işareti — tüm id'ler için tek sorgu
  const allIds = [...byId.keys()];
  const visitMap = await fetchLastVisitMap(allIds);
  for (const [id, row] of byId) {
    row.isMine = myIdSet.has(id);
    const v = visitMap.get(id);
    if (v) {
      row.lastVisitAt = v.check_in_at;
      row.lastVisitOutcome = v.outcome;
    }
  }
  return [...byId.values()];
}

/**
 * saha_visits son ziyaretlerini accountId → VisitRow map'i olarak döner.
 * Tablo yoksa / RLS engelliyse boş map.
 */
async function fetchLastVisitMap(ids: string[]): Promise<Map<string, VisitRow>> {
  const result = new Map<string, VisitRow>();
  if (ids.length === 0) return result;
  // device-test 400 fix: tüm id'leri tek .in() URL'i çok uzun → PostgREST "Bad Request".
  // IN listesini parçala (her account_id tek batch'te olduğundan per-account en-yeni doğru).
  const CHUNK = 80;
  try {
    const supabase = getTypedClient();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from('saha_visits')
        .select('account_id, check_in_at, outcome')
        .in('account_id', batch)
        .order('check_in_at', { ascending: false });
      if (error) {
        console.warn('saha_visits join atlandı (batch):', error.message);
        continue;
      }
      for (const v of (data ?? []) as VisitRow[]) {
        if (!result.has(v.account_id)) {
          result.set(v.account_id, v);
        }
      }
    }
  } catch (e) {
    console.warn('saha_visits exception:', (e as Error).message);
  }
  return result;
}

async function fetchReps(): Promise<RepOption[]> {
  const supabase = getTypedClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, ad_soyad, email, role')
    .ilike('role', '%REP%');
  if (error) {
    console.warn('reps fetch failed:', error.message);
    return [];
  }
  return (
    (data ?? []) as Array<{
      id: string;
      ad_soyad: string | null;
      email: string | null;
      role: string | null;
    }>
  )
    .map((r) => ({
      id: r.id,
      label: r.ad_soyad ?? r.email ?? r.id.slice(0, 8),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'tr'));
}

/** Toplam aktif klinik sayısı (head-only exact count). Hata olursa null. */
async function fetchActiveClinicCount(): Promise<number | null> {
  const supabase = getTypedClient();
  const { count, error } = await supabase
    .from('saha_clinics')
    .select('id', { head: true, count: 'exact' })
    .eq('status', 'active');
  if (error) {
    console.warn('aktif klinik sayımı başarısız:', error.message);
    return null;
  }
  return count ?? null;
}

function CustomerListPage(): JSX.Element {
  const vertical = useVertical();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const profile = useAuthStore((s) => s.profile);
  const selfId = useAuthStore((s) => s.session?.userId ?? null);
  const role = (profile?.role ?? '').toUpperCase();
  const isAdmin = role === 'ADMIN';
  const isManager = role === 'MANAGER';
  const canSeeRepFilter = isAdmin || isManager;

  // URL'den initial state
  const initialSearch = searchParams.get('search') ?? '';
  const initialProvince = searchParams.get('province') ?? '';
  const initialType = searchParams.get('type') ?? '';

  const [searchInput, setSearchInput] = useState<string>(initialSearch);
  const debouncedSearch = useDebounced(searchInput, 300);

  const [filters, setFilters] = useState<CustomerFiltersValue>(() => ({
    ...DEFAULT_CUSTOMER_FILTERS,
    province: initialProvince,
    types: initialType ? [initialType] : [],
  }));

  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [page, setPage] = useState(1);
  /** No-GPS tam-liste: sunucudan kaç sayfa (DATA_PAGE_SIZE) çekildiği (range load-more). */
  const [dataPage, setDataPage] = useState(0);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // GPS — sort=distance açıldığında otomatik request
  const { position, status: geoStatus, request: requestGeo } = useGeolocation();
  useEffect(() => {
    if (sortKey === 'distance' && !position && geoStatus === 'idle') {
      requestGeo();
    }
  }, [sortKey, position, geoStatus, requestGeo]);

  // URL sync
  const isFirstSync = useRef(true);
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (debouncedSearch) next.set('search', debouncedSearch);
    else next.delete('search');
    if (filters.province) next.set('province', filters.province);
    else next.delete('province');
    if (filters.types[0]) next.set('type', filters.types[0]);
    else next.delete('type');
    // İlk render'da sadece URL'den state'i okuduk; sonraki değişikliklerde push
    if (isFirstSync.current) {
      isFirstSync.current = false;
      // initial URL zaten doğru; gereksiz replace yapma
      return;
    }
    setSearchParams(next, { replace: true });
  }, [debouncedSearch, filters.province, filters.types, searchParams, setSearchParams]);

  // Veri — GPS varsa lat/lng dahil zenginleştirilmiş veri çekilir
  const geoKey = position ? `${position.lat.toFixed(3)}|${position.lng.toFixed(3)}` : 'no-geo';
  const accountsQuery = useQuery({
    queryKey: ['customers', 'list', geoKey, selfId ?? 'anon', debouncedSearch, dataPage],
    queryFn: () =>
      fetchAccounts(
        position ? { lat: position.lat, lng: position.lng } : null,
        selfId,
        debouncedSearch,
        dataPage,
      ),
    // Range load-more: yeni dataPage çekilirken eski liste görünmeye devam etsin (boş ekran flicker'ı yok).
    placeholderData: (prev) => prev,
    // Yeni ziyaret edilen/notlanan klinik anında listede görünsün (persisted-rq bayatlık fix).
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const repsQuery = useQuery({
    queryKey: ['customers', 'reps'],
    queryFn: fetchReps,
    enabled: canSeeRepFilter,
    staleTime: 5 * 60_000,
  });

  // Toplam aktif klinik sayısı (head-only count) — "X / 5641" göstergesi için.
  const totalCountQuery = useQuery({
    queryKey: ['customers', 'active-count'],
    queryFn: fetchActiveClinicCount,
    staleTime: 5 * 60_000,
  });

  const basketAdd = useRouteBasket((s) => s.add);
  const basketItems = useRouteBasket((s) => s.items);
  const basketCount = basketItems.length;

  // İstemci tarafı filtre + sıralama
  const filtered = useMemo<CustomerListRow[]>(() => {
    const all = accountsQuery.data ?? [];
    const rawQ = debouncedSearch.trim();
    const q = foldTr(rawQ);
    const qDigits = digits(rawQ);

    const fromTs = filters.lastVisitFrom ? new Date(filters.lastVisitFrom).getTime() : null;
    const toTs = filters.lastVisitTo
      ? new Date(filters.lastVisitTo).getTime() + 24 * 60 * 60 * 1000 - 1
      : null;

    const result = all.filter((r) => {
      // Akıllı arama: ad + telefon + whatsapp + adres + il + ilçe + mahalle
      // Türkçe accent-fold, case-insensitive. Telefon için ayrıca digits-only match.
      if (q) {
        const hay = foldTr(
          [
            r.name ?? '',
            r.phone ?? '',
            r.whatsapp ?? '',
            r.address ?? '',
            r.city ?? '',
            r.district ?? '',
            r.neighborhood ?? '',
          ].join(' '),
        );
        const phoneHay = digits(`${r.phone ?? ''} ${r.whatsapp ?? ''}`);
        const matchText = hay.includes(q);
        const matchPhone = qDigits.length >= 3 && phoneHay.includes(qDigits);
        if (!matchText && !matchPhone) return false;
      }
      // Tipler
      if (filters.types.length > 0 && (!r.type || !filters.types.includes(r.type))) {
        return false;
      }
      // İl
      if (
        filters.province &&
        (r.city ?? '').toLocaleLowerCase('tr') !== filters.province.toLocaleLowerCase('tr')
      ) {
        return false;
      }
      // İlçe
      if (
        filters.district &&
        (r.district ?? '').toLocaleLowerCase('tr') !== filters.district.toLocaleLowerCase('tr')
      ) {
        return false;
      }
      // Durum
      if (filters.status === 'visited' && !r.lastVisitAt) return false;
      if (filters.status === 'not_visited' && r.lastVisitAt) return false;
      if (filters.status === 'hot' || filters.status === 'cold') {
        const wantHot = filters.status === 'hot';
        const out = (r.lastVisitOutcome ?? '').toLowerCase();
        const isHot = out === 'hot' || out === 'sicak' || out === 'sıcak';
        if (wantHot && !isHot) return false;
        if (!wantHot && isHot) return false;
      }
      if (filters.status === 'due') {
        // basit kural: lastVisit > 90 gün önce veya hiç ziyaret yok
        if (!r.lastVisitAt) return true;
        const days = (Date.now() - new Date(r.lastVisitAt).getTime()) / (1000 * 60 * 60 * 24);
        if (days < 90) return false;
      }
      // Min review
      if (filters.minReviewCount > 0 && (r.reviews ?? 0) < filters.minReviewCount) {
        return false;
      }
      // Date range
      if (fromTs !== null) {
        const t = r.lastVisitAt ? new Date(r.lastVisitAt).getTime() : 0;
        if (t < fromTs) return false;
      }
      if (toTs !== null) {
        const t = r.lastVisitAt ? new Date(r.lastVisitAt).getTime() : 0;
        if (t > toTs) return false;
      }
      // hasBalance
      if (filters.hasBalance && (r.balance ?? 0) <= 0) return false;
      return true;
    });

    // Sort
    const arr = [...result];
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return (a.name ?? '').localeCompare(b.name ?? '', 'tr');
        case 'distance': {
          if (!position) return 0;
          const da =
            a.lat !== null && a.lng !== null
              ? haversineMeters(position.lat, position.lng, a.lat, a.lng)
              : Number.POSITIVE_INFINITY;
          const db =
            b.lat !== null && b.lng !== null
              ? haversineMeters(position.lat, position.lng, b.lat, b.lng)
              : Number.POSITIVE_INFINITY;
          return da - db;
        }
        case 'last_visit': {
          const ta = a.lastVisitAt ? new Date(a.lastVisitAt).getTime() : 0;
          const tb = b.lastVisitAt ? new Date(b.lastVisitAt).getTime() : 0;
          return tb - ta; // yeni → eski
        }
        case 'reviews':
          return (b.reviews ?? 0) - (a.reviews ?? 0);
        case 'balance':
          return (b.balance ?? 0) - (a.balance ?? 0);
      }
    });
    // "Benim kliniklerim" (ziyaret/randevu/not) üstte sabit — 1000+ alfabetik
    // klinik arasında gömülmesin. Mevcut sıralama içlerinde korunur (stable).
    const mine = arr.filter((r) => r.isMine);
    const rest = arr.filter((r) => !r.isMine);
    return [...mine, ...rest];
  }, [accountsQuery.data, debouncedSearch, filters, sortKey, position]);

  // Page reset, filtre/sıralama değişince başa al
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, filters, sortKey]);

  // Arama değişince sunucu-veri sayfasını da sıfırla (aktif aramada tam-liste çekilmez).
  useEffect(() => {
    setDataPage(0);
  }, [debouncedSearch]);

  const visible = useMemo(() => filtered.slice(0, page * PAGE_SIZE), [filtered, page]);

  function toggleSelected(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearFilters(): void {
    setFilters(DEFAULT_CUSTOMER_FILTERS);
    setSearchInput('');
  }

  function addSelectedToBasket(): void {
    if (selectedIds.size === 0) return;
    const remaining = MAX_BASKET - basketCount;
    if (remaining <= 0) {
      toast.error(`Sepet dolu (maks ${MAX_BASKET} durak)`);
      return;
    }
    let added = 0;
    let skipped = 0;
    for (const id of selectedIds) {
      if (added >= remaining) {
        skipped++;
        continue;
      }
      const row = filtered.find((r) => r.id === id);
      if (!row || row.lat === null || row.lng === null) {
        skipped++;
        continue;
      }
      const stop: Omit<BasketStop, 'addedAt'> = {
        id: row.id,
        name: row.name,
        lat: row.lat,
        lng: row.lng,
        source: 'saha',
        customerType: row.type ?? undefined,
        address: row.address ?? undefined,
        phone: row.phone ?? undefined,
      };
      const res = basketAdd(stop);
      if (res.ok) {
        added++;
      } else {
        skipped++;
      }
    }
    if (added > 0) {
      toast.success(`${added} durak sepete eklendi`, {
        action: { label: 'Rota', onClick: () => navigate('/routes/plan') },
      });
    }
    if (skipped > 0) {
      toast.info(`${skipped} durak eklenmedi (zaten sepette / kapasite / konum yok)`);
    }
    setSelectedIds(new Set());
  }

  function exportSelected(): void {
    const rows: ExportRow[] = (
      selectedIds.size > 0 ? filtered.filter((r) => selectedIds.has(r.id)) : filtered
    ).map<ExportRow>((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      phone: r.phone,
      address: r.address,
      neighborhood: r.neighborhood,
      city: r.city,
      district: r.district,
      lastVisitAt: r.lastVisitAt,
      lastVisitOutcome: r.lastVisitOutcome,
    }));
    if (rows.length === 0) {
      toast.info('Aktarılacak kayıt yok');
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    exportToXlsx(rows, `musteriler-${today}.xlsx`);
    toast.success(`${rows.length} kayıt Excel'e aktarıldı`);
  }

  function assignRegionStub(): void {
    toast.info('Sprint X — bölge ata henüz yapılmadı', {
      description: `${selectedIds.size} kayıt seçili.`,
    });
  }

  const customerLabelPlural = vertical.labels.customer.plural;
  const isLoading = accountsQuery.isLoading;
  const isError = accountsQuery.isError;
  const totalFiltered = filtered.length;
  const loadedCount = accountsQuery.data?.length ?? 0;
  const isFetchingMore = accountsQuery.isFetching && !accountsQuery.isLoading;

  // Aktif arama: sonuçlar sunucu-ad-araması'ndan gelir, range load-more uygulanmaz.
  const isSearching = debouncedSearch.trim().length >= 2;
  // No-GPS tam-listede sunucudan daha fazla veri çekilebilir mi?
  //  - GPS yok (range yolu) + arama yok
  //  - son dataPage tam doldu (loadedCount, çekilen tavana ulaştı) → sunucuda daha var olabilir
  const serverHasMore =
    !position &&
    !isSearching &&
    loadedCount >= (dataPage + 1) * DATA_PAGE_SIZE &&
    (totalCountQuery.data == null || loadedCount < totalCountQuery.data);
  // Render'da gösterilmeyen yüklü kayıt var mı?
  const renderHasMore = visible.length < totalFiltered;
  const hasMore = renderHasMore || serverHasMore;

  function loadMore(): void {
    if (renderHasMore) {
      // Önce yüklü kayıtların kalanını göster (50'şer).
      setPage((p) => p + 1);
    } else if (serverHasMore) {
      // Yüklü kayıtların hepsi gösterildi → sunucudan bir sonraki sayfayı çek
      // ve gelen yeni kayıtların görünür olması için render sayfasını da büyüt.
      setDataPage((d) => d + 1);
      setPage((p) => p + Math.ceil(DATA_PAGE_SIZE / PAGE_SIZE));
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 space-y-2 border-b border-border bg-background px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Users className="h-5 w-5" aria-hidden="true" />
            {customerLabelPlural}
          </h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMultiSelectMode((m) => !m);
                if (multiSelectMode) setSelectedIds(new Set());
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium min-h-tap-min ${
                multiSelectMode
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted'
              }`}
              aria-pressed={multiSelectMode}
            >
              {multiSelectMode ? (
                <CheckSquare className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Square className="h-4 w-4" aria-hidden="true" />
              )}
              Çoklu Seçim
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Akıllı arama: ad, telefon, adres, il, ilçe, mahalle…"
            className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm focus:border-primary focus:outline-none"
          />
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <label className="sr-only" htmlFor="sort-key">
            Sırala
          </label>
          <select
            id="sort-key"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
          >
            <option value="name">Ad (A–Z)</option>
            <option value="distance">Mesafe (Konum gerekli)</option>
            <option value="last_visit">Son Ziyaret</option>
            <option value="reviews">Değerlendirme</option>
            <option value="balance">Bakiye</option>
          </select>
          {sortKey === 'distance' && !position && (
            <span className="text-xs text-muted-foreground">
              {geoStatus === 'denied' ? 'İzin yok' : 'Konum alınıyor…'}
            </span>
          )}
        </div>

        {/* Filters */}
        <CustomerFilters
          value={filters}
          onChange={setFilters}
          customerTypes={vertical.customerTypes}
          reps={canSeeRepFilter ? (repsQuery.data ?? []) : []}
          enableHasBalance={false}
          onClear={clearFilters}
        />

        <p className="text-xs text-muted-foreground">
          {isLoading
            ? 'Yükleniyor…'
            : `${visible.length} / ${
                totalCountQuery.data != null && !isSearching ? totalCountQuery.data : totalFiltered
              } gösteriliyor`}
        </p>
      </div>

      {/* List */}
      <div className="flex-1 space-y-3 px-4 py-3 pb-32">
        {isError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Veri yüklenemedi: {(accountsQuery.error as Error | null)?.message ?? 'bilinmiyor'}
          </div>
        )}

        {!isLoading && totalFiltered === 0 && (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            <MapPin className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium text-foreground">Kayıt bulunamadı.</p>
            <p className="mt-1">
              Filtreleri temizle veya{' '}
              <button
                type="button"
                onClick={() => navigate('/clinics/discover')}
                className="font-medium text-primary underline"
              >
                yeni müşteri keşfet
              </button>
              .
            </p>
          </div>
        )}

        {visible.map((r) => {
          const distanceM =
            position && r.lat !== null && r.lng !== null
              ? haversineMeters(position.lat, position.lng, r.lat, r.lng)
              : undefined;
          const inBasket = basketItems.some((s) => s.id === r.id);
          const selected = selectedIds.has(r.id);
          return (
            <div key={r.id} className="relative">
              {multiSelectMode && (
                <label className="absolute left-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-background/90 shadow">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSelected(r.id)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    aria-label={`${r.name} seç`}
                  />
                </label>
              )}
              <div className={multiSelectMode ? 'pl-8' : ''}>
                <ClinicCard
                  name={r.name}
                  address={r.address ?? undefined}
                  phone={r.phone ?? undefined}
                  whatsapp={r.whatsapp ?? undefined}
                  {...(distanceM !== undefined ? { distanceM } : {})}
                  {...(r.rating !== null ? { rating: r.rating } : {})}
                  userRatingsTotal={r.reviews}
                  isExistingCustomer={!!r.isMine}
                  isInBasket={inBasket}
                  onAdd={() => {
                    if (r.lat === null || r.lng === null) {
                      toast.error('Bu kaydın konumu yok');
                      return;
                    }
                    const stop: Omit<BasketStop, 'addedAt'> = {
                      id: r.id,
                      name: r.name,
                      lat: r.lat,
                      lng: r.lng,
                      source: 'saha',
                      customerType: r.type ?? undefined,
                      address: r.address ?? undefined,
                      phone: r.phone ?? undefined,
                    };
                    const res = basketAdd(stop);
                    if (res.ok) {
                      toast.success(`${r.name} sepete eklendi`, {
                        action: {
                          label: 'Rota',
                          onClick: () => navigate('/routes/plan'),
                        },
                      });
                    } else if (res.reason === 'duplicate') {
                      toast.info('Bu durak zaten sepette');
                    } else if (res.reason === 'full') {
                      toast.error('Sepet dolu (maks 12 durak)');
                    }
                  }}
                  onOpenDetail={() => navigate(`/clinics/${r.id}`)}
                />
              </div>
            </div>
          );
        })}

        {hasMore && (
          <button
            type="button"
            onClick={loadMore}
            disabled={isFetchingMore}
            className="mx-auto block rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isFetchingMore
              ? 'Yükleniyor…'
              : renderHasMore
                ? `Daha Fazla (${totalFiltered - visible.length})`
                : 'Daha Fazla Yükle'}
          </button>
        )}
      </div>

      {/* Multi-select action bar */}
      {multiSelectMode && (
        <div className="fixed bottom-16 left-0 right-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">{selectedIds.size}</span> seçili
              (sepet: {basketCount}/{MAX_BASKET})
            </span>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-muted-foreground underline"
              >
                Temizle
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addSelectedToBasket}
              disabled={selectedIds.size === 0}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Rotaya Ekle
            </button>
            <button
              type="button"
              onClick={exportSelected}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              Excel
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={assignRegionStub}
                disabled={selectedIds.size === 0}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                <MapPin className="h-4 w-4" aria-hidden="true" />
                Bölge Ata
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CustomerListPage;
