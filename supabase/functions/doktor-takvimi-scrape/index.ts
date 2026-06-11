// deno-lint-ignore-file
// ============================================================================
// doktor-takvimi-scrape — DoktorTakvimi.com dental directory scraper
// ============================================================================
//
// Why a separate function (not embedded in clinic-scan-v3)?
//   - Single responsibility: fetch + parse HTML, return normalized doctor rows.
//   - clinic-scan-v3 calls this via service_role to enrich Google Places data
//     with names/phones DoktorTakvimi exposes (and Google sometimes hides).
//   - Easier to iterate selectors when HTML structure changes upstream.
//
// Body (POST JSON):
//   { provinceSlug: string, districtSlug: string, maxPages?: number }
//
// URL pattern:
//   https://www.doktortakvimi.com/dis-hekimi/<provinceSlug>/<districtSlug>?sayfa=<n>
//
// Auth: optional bearer; service_role OR ADMIN user. verify_jwt = false at
// gateway (see supabase/config.toml).
//
// Hard limits:
//   - max 5 pages per call (override of caller's maxPages)
//   - 1sn delay between pages
//   - 40sn total wall-clock cap (Edge Function timeout 150sn but be polite)
//
// No DB write — pure scrape + return. Idempotent.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { DOMParser, type Element } from 'https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const HARD_MAX_PAGES = 5;
const DEFAULT_MAX_PAGES = 3;
const PAGE_DELAY_MS = 1000;
const TOTAL_WALL_CLOCK_MS = 40_000;

const FETCH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Accept': 'text/html,application/xhtml+xml',
};

// Slug expectation: ASCII lowercase, hyphens allowed, no spaces / no Turkish chars.
// e.g. "malatya", "battalgazi", "kucukcekmece". If caller sends Turkish chars,
// we still try the fetch but flag slug_mismatch.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface ScrapeBody {
  provinceSlug: string;
  districtSlug: string;
  maxPages?: number;
}

interface ScrapedDoctor {
  name: string;
  clinic_name?: string;
  address_hint?: string;
  neighborhood?: string;
  phone?: string;
  specialty?: string;
  source_url: string;
}

interface ScrapeResponse {
  status: 'ok' | 'error';
  pages_fetched: number;
  count: number;
  doctors: ScrapedDoctor[];
  errors?: string[];
}

// Card container selectors, tried in priority order. First selector that yields
// > 0 matches wins. DoktorTakvimi changes markup periodically — keep this list
// broad and defensive.
const CARD_SELECTORS: string[] = [
  '[data-doctor-id]',
  '.doctor-card',
  '.doctor-result',
  'article[itemtype*="Physician"]',
  '.profile-card',
];

const NAME_SELECTORS: string[] = ['h2', 'h3', '.doctor-name', '[itemprop="name"]'];
const CLINIC_SELECTORS: string[] = ['.clinic-name', '.workplace', '.organization'];
const ADDRESS_SELECTORS: string[] = ['.address', '[itemprop="address"]', '.location'];
const PHONE_SELECTORS: string[] = ['a[href^="tel:"]', '[itemprop="telephone"]'];
const SPECIALTY_SELECTORS: string[] = ['.specialty', '.uzmanlik'];

const NEIGHBORHOOD_RE = /([A-Za-zÇĞİÖŞÜçğıöşü\s]+?)\s+Mahallesi/i;

function buildCorsHeaders(reqOrigin: string | null): Record<string, string> {
  const allowed =
    reqOrigin && (ALLOWED_ORIGINS.includes(reqOrigin) || reqOrigin === 'https://localhost' || reqOrigin === 'capacitor://localhost') ? reqOrigin : ALLOWED_ORIGINS[0] ?? 'null';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function firstNonEmpty(root: Element, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (!el) continue;
    const txt = cleanText(el.textContent);
    if (txt) return txt;
  }
  return undefined;
}

function extractPhone(root: Element): string | undefined {
  // Prefer tel: href to keep digits intact.
  const telA = root.querySelector('a[href^="tel:"]') as Element | null;
  if (telA) {
    const href = telA.getAttribute('href') ?? '';
    const raw = href.replace(/^tel:/i, '').trim();
    if (raw) return raw;
    const txt = cleanText(telA.textContent);
    if (txt) return txt;
  }
  for (const sel of PHONE_SELECTORS) {
    const el = root.querySelector(sel);
    if (!el) continue;
    const content = el.getAttribute('content') ?? el.textContent;
    const txt = cleanText(content);
    if (txt) return txt;
  }
  return undefined;
}

function extractNeighborhood(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const m = address.match(NEIGHBORHOOD_RE);
  if (!m) return undefined;
  return cleanText(m[1]);
}

function pickCards(doc: ReturnType<DOMParser['parseFromString']>): Element[] {
  if (!doc) return [];
  for (const sel of CARD_SELECTORS) {
    const list = doc.querySelectorAll(sel);
    if (list.length > 0) {
      return Array.from(list) as Element[];
    }
  }
  return [];
}

function parseCard(card: Element, sourceUrl: string): ScrapedDoctor | null {
  const name = firstNonEmpty(card, NAME_SELECTORS);
  if (!name) return null;

  const clinic_name = firstNonEmpty(card, CLINIC_SELECTORS);
  const address_hint = firstNonEmpty(card, ADDRESS_SELECTORS);
  const phone = extractPhone(card);
  const specialty = firstNonEmpty(card, SPECIALTY_SELECTORS);
  const neighborhood = extractNeighborhood(address_hint);

  const out: ScrapedDoctor = { name, source_url: sourceUrl };
  if (clinic_name) out.clinic_name = clinic_name;
  if (address_hint) out.address_hint = address_hint;
  if (neighborhood) out.neighborhood = neighborhood;
  if (phone) out.phone = phone;
  if (specialty) out.specialty = specialty;
  return out;
}

function buildPageUrl(provinceSlug: string, districtSlug: string, page: number): string {
  return `https://www.doktortakvimi.com/dis-hekimi/${encodeURIComponent(provinceSlug)}/${encodeURIComponent(districtSlug)}?sayfa=${page}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req.headers.get('Origin'));

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') {
    return jsonResponse(
      { status: 'error', pages_fetched: 0, count: 0, doctors: [], errors: ['method_not_allowed'] },
      405,
      cors,
    );
  }

  const startedAt = Date.now();

  try {
    // ── Optional auth: bearer must be service_role OR ADMIN user. ─────────────
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (authHeader) {
      if (!authHeader.toLowerCase().startsWith('bearer ')) {
        return jsonResponse(
          {
            status: 'error',
            pages_fetched: 0,
            count: 0,
            doctors: [],
            errors: ['invalid_authorization_format'],
          },
          401,
          cors,
        );
      }
      const token = authHeader.slice(7).trim();
      const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;
      if (!isServiceRole) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userData?.user) {
          return jsonResponse(
            { status: 'error', pages_fetched: 0, count: 0, doctors: [], errors: ['invalid_token'] },
            401,
            cors,
          );
        }
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', userData.user.id)
          .maybeSingle();
        const role: string = (profile as { role?: string } | null)?.role ?? '';
        if (!role || role.toUpperCase() !== 'ADMIN') {
          return jsonResponse(
            { status: 'error', pages_fetched: 0, count: 0, doctors: [], errors: ['forbidden'] },
            403,
            cors,
          );
        }
      }
    }
    // If no auth header → still allow (clinic-scan-v3 may invoke without one
    // via the gateway with verify_jwt=false; tighten later if abuse seen).

    // ── Body validation ───────────────────────────────────────────────────────
    let body: ScrapeBody;
    try {
      body = (await req.json()) as ScrapeBody;
    } catch {
      return jsonResponse(
        { status: 'error', pages_fetched: 0, count: 0, doctors: [], errors: ['invalid_json'] },
        400,
        cors,
      );
    }

    const provinceSlug = typeof body?.provinceSlug === 'string' ? body.provinceSlug.trim() : '';
    const districtSlug = typeof body?.districtSlug === 'string' ? body.districtSlug.trim() : '';
    if (!provinceSlug) {
      return jsonResponse(
        {
          status: 'error',
          pages_fetched: 0,
          count: 0,
          doctors: [],
          errors: ['missing_province_slug'],
        },
        400,
        cors,
      );
    }
    if (!districtSlug) {
      return jsonResponse(
        {
          status: 'error',
          pages_fetched: 0,
          count: 0,
          doctors: [],
          errors: ['missing_district_slug'],
        },
        400,
        cors,
      );
    }

    const requestedMax =
      typeof body.maxPages === 'number' && Number.isFinite(body.maxPages) && body.maxPages > 0
        ? Math.floor(body.maxPages)
        : DEFAULT_MAX_PAGES;
    const maxPages = Math.min(requestedMax, HARD_MAX_PAGES);

    const errors: string[] = [];

    // Slug sanity — non-blocking; we still try the fetch.
    if (!SLUG_RE.test(provinceSlug) || !SLUG_RE.test(districtSlug)) {
      errors.push('slug_mismatch');
    }

    // ── Scrape loop ───────────────────────────────────────────────────────────
    const allDoctors: ScrapedDoctor[] = [];
    let pagesFetched = 0;
    let parseFailed = false;

    for (let page = 1; page <= maxPages; page++) {
      if (Date.now() - startedAt > TOTAL_WALL_CLOCK_MS) {
        errors.push(`timeout_before_page${page}`);
        break;
      }

      if (page > 1) {
        await sleep(PAGE_DELAY_MS);
      }

      const url = buildPageUrl(provinceSlug, districtSlug, page);

      let html: string;
      try {
        const resp = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow' });
        if (!resp.ok) {
          errors.push(`http_${resp.status}_page${page}`);
          break;
        }
        html = await resp.text();
      } catch (e) {
        errors.push(`fetch_failed_page${page}_${(e as Error).message?.slice(0, 60) ?? 'unknown'}`);
        break;
      }

      pagesFetched++;

      let doc: ReturnType<DOMParser['parseFromString']>;
      try {
        doc = new DOMParser().parseFromString(html, 'text/html');
      } catch (e) {
        errors.push(`parse_failed_page${page}_${(e as Error).message?.slice(0, 60) ?? 'unknown'}`);
        parseFailed = true;
        break;
      }
      if (!doc) {
        errors.push(`parse_failed_page${page}_null_doc`);
        parseFailed = true;
        break;
      }

      const cards = pickCards(doc);
      if (cards.length === 0) {
        errors.push(`no_cards_found_page${page}`);
        break;
      }

      let pageHadAny = false;
      for (const card of cards) {
        try {
          const doctor = parseCard(card, url);
          if (doctor) {
            allDoctors.push(doctor);
            pageHadAny = true;
          }
        } catch (e) {
          errors.push(`card_parse_error_page${page}_${(e as Error).message?.slice(0, 40) ?? 'unknown'}`);
        }
      }

      // If cards existed but none parseable → likely selector drift; stop pagination.
      if (!pageHadAny) {
        errors.push(`no_parseable_cards_page${page}`);
        break;
      }
    }

    // ── Build response ────────────────────────────────────────────────────────
    // Page-1 parse failure with zero doctors → status=error.
    // Page-1 OK then later page failure → status=ok (we still got page 1 data).
    const status: 'ok' | 'error' =
      parseFailed && allDoctors.length === 0 ? 'error' : 'ok';

    const response: ScrapeResponse = {
      status,
      pages_fetched: pagesFetched,
      count: allDoctors.length,
      doctors: allDoctors,
    };
    if (errors.length > 0) response.errors = errors;

    return jsonResponse(response, 200, cors);
  } catch (e) {
    return jsonResponse(
      {
        status: 'error',
        pages_fetched: 0,
        count: 0,
        doctors: [],
        errors: [`unhandled_${(e as Error).message?.slice(0, 80) ?? 'unknown'}`],
      },
      500,
      cors,
    );
  }
});
