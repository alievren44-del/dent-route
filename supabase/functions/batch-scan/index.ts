// deno-lint-ignore-file
// ============================================================================
// Saha Navigasyon — batch-scan Edge Function
// ============================================================================
// Body : { jobId: string }
// Auth : Bearer token; ADMIN veya MANAGER rolü zorunlu.
//
// İş Akışı
// --------
// 1. Job kaydını yükle.
// 2. saha_scan_job_items boşsa → expandScope() ile materialize et.
// 3. Pending item'ları sırayla işle:
//      - Job status 'cancelled' / 'paused' → break.
//      - Item 'running' → clinic-scan internal call → sonuçları yaz.
//      - increment_scan_job_progress RPC.
//      - 3sn bekle (rate limit).
// 4. Pending kalmadıysa → job 'completed'.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  getDistrictsByProvinceSlug,
  getDistrictBySlugs,
  getProvincesByRegion,
  PROVINCES_BY_REGION,
  isRegion,
  type RegionSlug,
} from './tr-data.ts';

export type ScopeType =
  | 'single_district'
  | 'whole_province'
  | 'region'
  | 'whole_country';

export interface ExpandedItem {
  province_slug: string;
  district_slug: string | null;
  lat: number;
  lng: number;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const RATE_DELAY_MS = 3000;
const MAX_ITEMS_PER_INVOCATION = 200; // savunma: tek invocation'da bu kadar ilçe işle, kalanı bir sonraki call'a bırak

function buildCorsHeaders(reqOrigin: string | null): Record<string, string> {
  const allowed = reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : ALLOWED_ORIGINS[0] ?? 'null';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ----------------------------------------------------------------------------
// expandScope — scope_type + scope_params'tan ilçe listesi üretir.
// ----------------------------------------------------------------------------
function expandScopeLocal(
  scopeType: string,
  scopeParams: Record<string, unknown>,
): ExpandedItem[] {
  if (scopeType === 'single_district') {
    const province = String(scopeParams.province ?? '');
    const district = String(scopeParams.district ?? '');
    if (!province || !district) return [];
    const d = getDistrictBySlugs(province, district);
    if (!d) return [];
    return [{ province_slug: province, district_slug: d.slug, lat: d.lat, lng: d.lng }];
  }

  if (scopeType === 'whole_province') {
    const province = String(scopeParams.province ?? '');
    if (!province) return [];
    const districts = getDistrictsByProvinceSlug(province);
    return districts.map((d) => ({
      province_slug: province,
      district_slug: d.slug,
      lat: d.lat,
      lng: d.lng,
    }));
  }

  if (scopeType === 'region') {
    const region = String(scopeParams.region ?? '');
    if (!isRegion(region)) return [];
    const provs = getProvincesByRegion(region as RegionSlug);
    const out: ExpandedItem[] = [];
    for (const p of provs) {
      const districts = getDistrictsByProvinceSlug(p.slug);
      for (const d of districts) {
        out.push({ province_slug: p.slug, district_slug: d.slug, lat: d.lat, lng: d.lng });
      }
    }
    return out;
  }

  if (scopeType === 'whole_country') {
    const out: ExpandedItem[] = [];
    for (const provinceSlugs of Object.values(PROVINCES_BY_REGION)) {
      for (const slug of provinceSlugs) {
        const districts = getDistrictsByProvinceSlug(slug);
        for (const d of districts) {
          out.push({ province_slug: slug, district_slug: d.slug, lat: d.lat, lng: d.lng });
        }
      }
    }
    return out;
  }

  return [];
}

// ----------------------------------------------------------------------------
// callClinicScan — clinic-scan Edge Function internal call.
// ----------------------------------------------------------------------------
interface ClinicScanResult {
  status: string;
  scanned: number;
  new: number;
  updated: number;
  filtered_out?: number;
  google_count?: number;
  osm_count?: number;
  errors?: string[];
}

async function callClinicScan(payload: {
  lat: number;
  lng: number;
  radiusM: number;
  provinceSlug: string;
  districtSlug: string | null;
  types: string[];
  source: 'google' | 'osm' | 'both';
  vertical: string;
  intensity?: 'standard' | 'high' | 'max';
}): Promise<ClinicScanResult> {
  const body: Record<string, unknown> = {
    lat: payload.lat,
    lng: payload.lng,
    radiusM: payload.radiusM,
    provinceSlug: payload.provinceSlug,
    types: payload.types,
    source: payload.source,
    vertical: payload.vertical,
    intensity: payload.intensity ?? 'standard',
  };
  if (payload.districtSlug) body.districtSlug = payload.districtSlug;

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/clinic-scan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return {
      status: 'error',
      scanned: 0,
      new: 0,
      updated: 0,
      errors: [`clinic_scan_http_${resp.status}`, text.slice(0, 200)],
    };
  }

  const json: any = await resp.json().catch(() => ({}));
  return {
    status: typeof json?.status === 'string' ? json.status : 'unknown',
    scanned: Number(json?.scanned ?? 0),
    new: Number(json?.new ?? 0),
    updated: Number(json?.updated ?? 0),
    filtered_out: typeof json?.filtered_out === 'number' ? json.filtered_out : undefined,
    google_count: typeof json?.google_count === 'number' ? json.google_count : undefined,
    osm_count: typeof json?.osm_count === 'number' ? json.osm_count : undefined,
    errors: Array.isArray(json?.errors) ? json.errors : undefined,
  };
}

// ----------------------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------------------
Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req.headers.get('Origin'));

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ status: 'error', error: 'method_not_allowed' }, 405, cors);
  }

  try {
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse({ status: 'error', error: 'unauthorized' }, 401, cors);
    }
    const token = authHeader.slice(7).trim();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonResponse({ status: 'error', error: 'invalid_token' }, 401, cors);
    }
    const userId = userData.user.id;

    // Admin / Manager role check
    const { data: profileData, error: profileErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (profileErr) {
      console.error('profile fetch error:', profileErr.message);
      return jsonResponse({ status: 'error', error: 'profile_lookup_failed' }, 500, cors);
    }
    const role = String((profileData as any)?.role ?? '').toUpperCase();
    if (role !== 'ADMIN' && role !== 'MANAGER') {
      return jsonResponse({ status: 'error', error: 'forbidden' }, 403, cors);
    }

    let body: { jobId?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ status: 'error', error: 'invalid_json' }, 400, cors);
    }

    const jobId = body?.jobId;
    if (!jobId || typeof jobId !== 'string') {
      return jsonResponse({ status: 'error', error: 'invalid_job_id' }, 400, cors);
    }

    // ------------------------------------------------------------------------
    // 1. Job kaydını yükle.
    // ------------------------------------------------------------------------
    const { data: job, error: jobErr } = await supabase
      .from('saha_scan_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle();

    if (jobErr || !job) {
      return jsonResponse({ status: 'error', error: 'job_not_found' }, 404, cors);
    }

    if (job.status === 'completed' || job.status === 'cancelled') {
      return jsonResponse({ status: 'noop', reason: `job_${job.status}`, jobId }, 200, cors);
    }

    // ------------------------------------------------------------------------
    // 2. Item materialization (eğer henüz oluşturulmadıysa).
    // ------------------------------------------------------------------------
    const { count: existingItemsCount, error: countErr } = await supabase
      .from('saha_scan_job_items')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId);

    if (countErr) {
      console.error('items count error:', countErr.message);
      return jsonResponse({ status: 'error', error: 'items_count_failed' }, 500, cors);
    }

    if (!existingItemsCount || existingItemsCount === 0) {
      const items = expandScopeLocal(
        String(job.scope_type),
        (job.scope_params ?? {}) as Record<string, unknown>,
      );

      if (items.length === 0) {
        await supabase
          .from('saha_scan_jobs')
          .update({
            status: 'failed',
            last_error: 'scope_expanded_to_zero_items',
            completed_at: new Date().toISOString(),
          })
          .eq('id', jobId);
        return jsonResponse(
          { status: 'error', error: 'scope_expanded_to_zero_items', jobId },
          400,
          cors,
        );
      }

      const insertRows = items.map((it) => ({
        job_id: jobId,
        province_slug: it.province_slug,
        district_slug: it.district_slug,
        lat: it.lat,
        lng: it.lng,
        status: 'pending',
      }));

      const { error: insErr } = await supabase
        .from('saha_scan_job_items')
        .insert(insertRows);
      if (insErr) {
        console.error('items insert error:', insErr.message);
        return jsonResponse({ status: 'error', error: 'items_insert_failed' }, 500, cors);
      }

      await supabase
        .from('saha_scan_jobs')
        .update({
          total_items: items.length,
          status: 'running',
          started_at: job.started_at ?? new Date().toISOString(),
        })
        .eq('id', jobId);

      job.total_items = items.length;
      job.status = 'running';
    } else if (job.status === 'pending') {
      await supabase
        .from('saha_scan_jobs')
        .update({ status: 'running', started_at: job.started_at ?? new Date().toISOString() })
        .eq('id', jobId);
      job.status = 'running';
    }

    // ------------------------------------------------------------------------
    // 3. Pending item'ları sırayla işle.
    // ------------------------------------------------------------------------
    const radiusM = Math.max(1, Math.min(50000, Number(job.radius_km ?? 10) * 1000));
    const scanTypes: string[] = Array.isArray(job.scan_types) && job.scan_types.length > 0
      ? job.scan_types
      : ['dentist'];
    const scanSource: 'google' | 'osm' | 'both' =
      job.scan_source === 'google' || job.scan_source === 'osm' || job.scan_source === 'both'
        ? job.scan_source
        : 'both';
    const verticalKey = typeof job.vertical_key === 'string' && job.vertical_key.length > 0
      ? job.vertical_key
      : 'dental';
    const scanIntensity: 'standard' | 'high' | 'max' =
      job.scan_intensity === 'high' || job.scan_intensity === 'max' ? job.scan_intensity : 'standard';

    let processedThisRun = 0;
    let breakReason: string | null = null;

    while (processedThisRun < MAX_ITEMS_PER_INVOCATION) {
      // Job status freshness check
      const { data: jobFresh, error: jobFreshErr } = await supabase
        .from('saha_scan_jobs')
        .select('status')
        .eq('id', jobId)
        .maybeSingle();

      if (jobFreshErr || !jobFresh) {
        breakReason = 'job_lookup_failed';
        break;
      }
      if (jobFresh.status === 'cancelled' || jobFresh.status === 'paused') {
        breakReason = `job_${jobFresh.status}`;
        break;
      }

      // Pull next pending item (FIFO)
      const { data: nextItems, error: nextErr } = await supabase
        .from('saha_scan_job_items')
        .select('*')
        .eq('job_id', jobId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1);

      if (nextErr) {
        console.error('next item fetch error:', nextErr.message);
        breakReason = 'next_item_fetch_failed';
        break;
      }
      if (!nextItems || nextItems.length === 0) {
        breakReason = 'no_pending_items';
        break;
      }

      const item = nextItems[0] as {
        id: string;
        province_slug: string;
        district_slug: string | null;
        lat: number;
        lng: number;
      };

      // Mark running
      const startedIso = new Date().toISOString();
      const { error: setRunningErr } = await supabase
        .from('saha_scan_job_items')
        .update({ status: 'running', started_at: startedIso })
        .eq('id', item.id);

      if (setRunningErr) {
        console.warn('set running error:', setRunningErr.message);
      }

      // Call clinic-scan
      let result: ClinicScanResult;
      try {
        result = await callClinicScan({
          lat: item.lat,
          lng: item.lng,
          radiusM,
          provinceSlug: item.province_slug,
          districtSlug: item.district_slug,
          types: scanTypes,
          source: scanSource,
          vertical: verticalKey,
          intensity: scanIntensity,
        });
      } catch (e) {
        const msg = (e as Error)?.message ?? 'unknown';
        result = {
          status: 'error',
          scanned: 0,
          new: 0,
          updated: 0,
          errors: [`fetch_error_${msg}`],
        };
      }

      const completedIso = new Date().toISOString();
      const itemStatus = result.status === 'ok' ? 'completed' : 'failed';
      const errorMsg = result.status === 'ok'
        ? null
        : (result.errors && result.errors.length > 0
          ? result.errors.join(',').slice(0, 500)
          : 'scan_failed');

      const { error: setDoneErr } = await supabase
        .from('saha_scan_job_items')
        .update({
          status: itemStatus,
          completed_at: completedIso,
          scanned_count: result.scanned,
          new_count: result.new,
          updated_count: result.updated,
          filtered_out_count: result.filtered_out ?? 0,
          google_count: result.google_count ?? null,
          osm_count: result.osm_count ?? null,
          error_message: errorMsg,
        })
        .eq('id', item.id);

      if (setDoneErr) {
        console.warn('set done error:', setDoneErr.message);
      }

      if (itemStatus === 'failed') {
        await supabase
          .from('saha_scan_jobs')
          .update({
            failed_items: (job.failed_items ?? 0) + 1,
            last_error: errorMsg,
            updated_at: completedIso,
          })
          .eq('id', jobId);
        job.failed_items = (job.failed_items ?? 0) + 1;
      }

      // Atomic progress increment (only counts completed scanning)
      const { error: rpcErr } = await supabase.rpc('increment_scan_job_progress', {
        p_job_id: jobId,
        p_new_clinics: result.new,
        p_total_found: result.scanned,
      });
      if (rpcErr) {
        console.warn('increment rpc error:', rpcErr.message);
      }

      processedThisRun++;

      // Rate-limit pause between districts
      if (processedThisRun < MAX_ITEMS_PER_INVOCATION) {
        await sleep(RATE_DELAY_MS);
      }
    }

    // ------------------------------------------------------------------------
    // 4. Pending kaldı mı? Hayırsa job 'completed'.
    // ------------------------------------------------------------------------
    const { count: pendingLeft } = await supabase
      .from('saha_scan_job_items')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .in('status', ['pending', 'running']);

    if ((pendingLeft ?? 0) === 0) {
      await supabase
        .from('saha_scan_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    }

    return jsonResponse(
      {
        status: 'ok',
        jobId,
        processed: processedThisRun,
        pending_left: pendingLeft ?? 0,
        break_reason: breakReason,
      },
      200,
      cors,
    );
  } catch (e) {
    const msg = (e as Error)?.message ?? 'unknown_error';
    console.error('batch-scan fatal:', msg);
    return jsonResponse({ status: 'error', error: msg }, 500, cors);
  }
});

// ----------------------------------------------------------------------------
// Re-export expandScope ile uyumluluk için (plan PROMPT-6 step 2'deki isim).
// ----------------------------------------------------------------------------
export const expandScope = expandScopeLocal;
