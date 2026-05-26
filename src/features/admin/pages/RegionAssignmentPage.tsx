/**
 * RegionAssignmentPage — Admin sayfası.
 *
 * Rep'lerin il/ilçe bölgelerini atar.
 * saha_assignments tablosunda profile_id başına 1 magic record
 * (account_id='__region_meta__') olarak tutulur.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ChevronDown, Save, User } from 'lucide-react';

import { getSupabaseClient } from '@/lib/supabase';
import {
  getProvinces,
  getDistrictsByProvince,
  type Province,
} from '@/data/tr-locations/geo-helpers';

const REGION_META_ACCOUNT_ID = '__region_meta__';

interface RepRow {
  id: string;
  ad_soyad: string | null;
  email: string | null;
  role: string | null;
  region: string | null;
}

interface AssignmentDraft {
  provinces: string[];
  districts: string[];
  rowId: string | null;
}

async function fetchReps(): Promise<RepRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, ad_soyad, email, role, region')
    .ilike('role', '%REP%');
  if (error) throw error;
  return (data ?? ([] as RepRow[])).sort((a, b) =>
    (a.ad_soyad ?? a.email ?? '').localeCompare(
      b.ad_soyad ?? b.email ?? '',
      'tr',
    ),
  );
}

async function fetchAssignment(repId: string): Promise<AssignmentDraft> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('saha_assignments')
    .select('id, profile_id, region_provinces, region_districts, account_id')
    .eq('profile_id', repId);
  if (error) throw error;
  const meta = data?.find((r) => r.account_id === REGION_META_ACCOUNT_ID);
  const first = meta ?? data?.[0];
  return {
    provinces: (first?.region_provinces ?? []) as string[],
    districts: (first?.region_districts ?? []) as string[],
    rowId: first?.id ?? null,
  };
}

async function saveAssignment(
  repId: string,
  provinces: string[],
  districts: string[],
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('saha_assignments').upsert(
    {
      profile_id: repId,
      account_id: REGION_META_ACCOUNT_ID,
      region_provinces: provinces,
      region_districts: districts,
    },
    { onConflict: 'profile_id,account_id' },
  );
  if (error) throw error;
}

function repLabel(rep: RepRow): string {
  return rep.ad_soyad ?? rep.email ?? rep.id.slice(0, 8);
}

export default function RegionAssignmentPage() {
  const queryClient = useQueryClient();
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null);
  const [draftProvinces, setDraftProvinces] = useState<string[]>([]);
  const [draftDistricts, setDraftDistricts] = useState<string[]>([]);
  const [expandedProvinces, setExpandedProvinces] = useState<Set<string>>(
    new Set(),
  );
  const [search, setSearch] = useState('');

  const provinces = useMemo<Province[]>(() => getProvinces(), []);

  const repsQuery = useQuery({
    queryKey: ['admin', 'region-assignment', 'reps'],
    queryFn: fetchReps,
  });

  const assignmentQuery = useQuery({
    queryKey: ['admin', 'region-assignment', 'assignment', selectedRepId],
    queryFn: () =>
      selectedRepId
        ? fetchAssignment(selectedRepId)
        : Promise.resolve({ provinces: [], districts: [], rowId: null }),
    enabled: !!selectedRepId,
  });

  useEffect(() => {
    if (assignmentQuery.data) {
      setDraftProvinces(assignmentQuery.data.provinces);
      setDraftDistricts(assignmentQuery.data.districts);
    } else if (!selectedRepId) {
      setDraftProvinces([]);
      setDraftDistricts([]);
    }
  }, [assignmentQuery.data, selectedRepId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRepId) throw new Error('Rep seçili değil');
      await saveAssignment(selectedRepId, draftProvinces, draftDistricts);
    },
    onSuccess: () => {
      if (selectedRepId) {
        queryClient.invalidateQueries({
          queryKey: [
            'admin',
            'region-assignment',
            'assignment',
            selectedRepId,
          ],
        });
      }
    },
  });

  const provinceSet = useMemo(
    () => new Set(draftProvinces),
    [draftProvinces],
  );
  const districtSet = useMemo(
    () => new Set(draftDistricts),
    [draftDistricts],
  );

  const filteredProvinces = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr');
    if (!q) return provinces;
    return provinces.filter((p) =>
      p.ad.toLocaleLowerCase('tr').includes(q),
    );
  }, [provinces, search]);

  function toggleExpand(provinceAd: string) {
    setExpandedProvinces((prev) => {
      const next = new Set(prev);
      if (next.has(provinceAd)) next.delete(provinceAd);
      else next.add(provinceAd);
      return next;
    });
  }

  function toggleProvince(provinceAd: string) {
    const districts = getDistrictsByProvince(provinceAd);
    const districtKeys = districts.map((d) => `${provinceAd}|${d.ad}`);
    if (provinceSet.has(provinceAd)) {
      setDraftProvinces((prev) => prev.filter((p) => p !== provinceAd));
      setDraftDistricts((prev) =>
        prev.filter((d) => !districtKeys.includes(d)),
      );
    } else {
      setDraftProvinces((prev) => [...prev, provinceAd]);
      setDraftDistricts((prev) => {
        const merged = new Set([...prev, ...districtKeys]);
        return Array.from(merged);
      });
    }
  }

  function toggleDistrict(provinceAd: string, districtAd: string) {
    const key = `${provinceAd}|${districtAd}`;
    setDraftDistricts((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      return [...prev, key];
    });
    // İl checkbox sync — en az 1 ilçe seçili ise il'i ekle
    setDraftProvinces((prev) => {
      const willHaveAny = districtSet.has(key)
        ? Array.from(districtSet).filter((k) => k !== key).some((k) =>
            k.startsWith(`${provinceAd}|`),
          )
        : true;
      if (willHaveAny && !prev.includes(provinceAd)) {
        return [...prev, provinceAd];
      }
      if (!willHaveAny && prev.includes(provinceAd)) {
        return prev.filter((p) => p !== provinceAd);
      }
      return prev;
    });
  }

  const reps = repsQuery.data ?? [];
  const selectedRep = reps.find((r) => r.id === selectedRepId) ?? null;
  const isDirty = useMemo(() => {
    if (!assignmentQuery.data) return false;
    const a = new Set(assignmentQuery.data.provinces);
    const b = new Set(draftProvinces);
    if (a.size !== b.size) return true;
    for (const v of a) if (!b.has(v)) return true;
    const da = new Set(assignmentQuery.data.districts);
    const db = new Set(draftDistricts);
    if (da.size !== db.size) return true;
    for (const v of da) if (!db.has(v)) return true;
    return false;
  }, [assignmentQuery.data, draftProvinces, draftDistricts]);

  return (
    <div className="flex h-full min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Bölge Atama</h1>
          <p className="text-xs text-slate-500">
            Rep başına il / ilçe bölgesi tanımla.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedRep && (
            <span className="text-sm text-slate-600">
              {repLabel(selectedRep)} —{' '}
              <span className="font-medium">
                {draftProvinces.length} il / {draftDistricts.length} ilçe
              </span>
            </span>
          )}
          <button
            type="button"
            disabled={
              !selectedRepId || saveMutation.isPending || !isDirty
            }
            onClick={() => saveMutation.mutate()}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Save className="h-4 w-4" />
            {saveMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </header>

      {saveMutation.isError && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          Kayıt başarısız:{' '}
          {(saveMutation.error as Error | null)?.message ?? 'bilinmeyen hata'}
        </div>
      )}
      {saveMutation.isSuccess && !isDirty && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          Kaydedildi.
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 p-4 md:flex-row">
        {/* Sol panel — Rep listesi */}
        <aside className="md:w-80 flex-shrink-0 rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-700">
              Saha Rep'leri
            </h2>
            <p className="text-xs text-slate-500">
              {repsQuery.isLoading
                ? 'Yükleniyor...'
                : `${reps.length} rep`}
            </p>
          </div>
          <ul className="max-h-[70vh] overflow-y-auto">
            {repsQuery.isError && (
              <li className="px-3 py-4 text-sm text-rose-600">
                Rep listesi yüklenemedi.
              </li>
            )}
            {!repsQuery.isLoading && reps.length === 0 && (
              <li className="px-3 py-4 text-sm text-slate-500">
                Rep bulunamadı.
              </li>
            )}
            {reps.map((rep) => {
              const isSelected = rep.id === selectedRepId;
              return (
                <li key={rep.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedRepId(rep.id)}
                    className={`flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm transition ${
                      isSelected
                        ? 'bg-emerald-50 text-emerald-900'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <User
                      className={`h-4 w-4 ${
                        isSelected ? 'text-emerald-600' : 'text-slate-400'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {repLabel(rep)}
                      </div>
                      <div className="truncate text-xs text-slate-500">
                        {rep.email ?? '—'}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Sağ panel — il/ilçe matrisi */}
        <section className="flex-1 rounded-lg border border-slate-200 bg-white shadow-sm">
          {!selectedRepId && (
            <div className="flex h-full min-h-[300px] items-center justify-center px-4 py-12 text-center text-sm text-slate-500">
              Soldan bir rep seç.
            </div>
          )}
          {selectedRepId && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                <h2 className="text-sm font-semibold text-slate-700">
                  İl / İlçe Seçimi
                </h2>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="İl ara..."
                  className="w-48 rounded border border-slate-300 px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>
              {assignmentQuery.isLoading ? (
                <div className="px-3 py-6 text-sm text-slate-500">
                  Yükleniyor...
                </div>
              ) : (
                <ul className="max-h-[70vh] overflow-y-auto">
                  {filteredProvinces.map((province) => {
                    const expanded = expandedProvinces.has(province.ad);
                    const provinceChecked = provinceSet.has(province.ad);
                    const districts = expanded
                      ? getDistrictsByProvince(province.ad)
                      : [];
                    const selectedDistrictCount = Array.from(
                      districtSet,
                    ).filter((k) =>
                      k.startsWith(`${province.ad}|`),
                    ).length;
                    return (
                      <li
                        key={province.plaka}
                        className="border-b border-slate-100"
                      >
                        <div className="flex items-center gap-2 px-3 py-2">
                          <button
                            type="button"
                            onClick={() => toggleExpand(province.ad)}
                            className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
                            aria-label={
                              expanded ? 'Daralt' : 'İlçeleri göster'
                            }
                          >
                            {expanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                          <label className="flex flex-1 cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={provinceChecked}
                              onChange={() => toggleProvince(province.ad)}
                              className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                            />
                            <span className="text-sm font-medium text-slate-800">
                              {province.ad}
                            </span>
                            {selectedDistrictCount > 0 && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                {selectedDistrictCount} ilçe
                              </span>
                            )}
                            <span className="ml-auto text-xs text-slate-400">
                              {province.bolge}
                            </span>
                          </label>
                        </div>
                        {expanded && (
                          <ul className="grid grid-cols-1 gap-1 bg-slate-50 px-10 py-2 sm:grid-cols-2 lg:grid-cols-3">
                            {districts.map((district) => {
                              const key = `${province.ad}|${district.ad}`;
                              const checked = districtSet.has(key);
                              return (
                                <li key={district.slug}>
                                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-white">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() =>
                                        toggleDistrict(
                                          province.ad,
                                          district.ad,
                                        )
                                      }
                                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                    />
                                    <span>{district.ad}</span>
                                  </label>
                                </li>
                              );
                            })}
                            {districts.length === 0 && (
                              <li className="px-2 py-1 text-xs text-slate-400">
                                İlçe bulunamadı.
                              </li>
                            )}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                  {filteredProvinces.length === 0 && (
                    <li className="px-3 py-6 text-center text-sm text-slate-500">
                      Eşleşen il yok.
                    </li>
                  )}
                </ul>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
