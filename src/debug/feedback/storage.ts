/**
 * storage.ts — Raporu local (Capacitor Filesystem, Directory.External) + Supabase'e kaydeder.
 * Local: kablo ile `adb pull /storage/emulated/0/Android/data/<pkg>/files/debug-reports/`.
 * Supabase: debug_reports tablosu + 'debug-reports' Storage bucket (merkezi, kablosuz).
 * Web fallback: localStorage.
 */
import type { FeedbackReport } from './capture';

const DIR = 'debug-reports';
const LS_KEY = 'debug_reports_web';

export interface StoredMeta {
  id: string;
  ts: number;
  route: string;
  description: string;
  uploaded: boolean;
}

function isNative(): boolean {
  try {
    return !!(
      window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
    ).Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}
function b64encode(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decode(b: string): string {
  return decodeURIComponent(escape(atob(b)));
}

interface FsApi {
  Filesystem: {
    writeFile(o: {
      path: string;
      data: string;
      directory: string;
      recursive?: boolean;
    }): Promise<{ uri: string }>;
    readFile(o: { path: string; directory: string }): Promise<{ data: string }>;
    deleteFile(o: { path: string; directory: string }): Promise<void>;
  };
  Directory: { External: string; Documents: string; Data: string; Cache: string };
}
async function fsApi(): Promise<FsApi> {
  const m = await import('@capacitor/filesystem');
  return {
    Filesystem: m.Filesystem as FsApi['Filesystem'],
    Directory: m.Directory as unknown as FsApi['Directory'],
  };
}

// ── Index (rapor listesi metası) ─────────────────────────────────────────────
async function readIndex(): Promise<StoredMeta[]> {
  if (!isNative()) {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    } catch {
      return [];
    }
  }
  try {
    const { Filesystem, Directory } = await fsApi();
    const r = await Filesystem.readFile({
      path: `${DIR}/index.json`,
      directory: Directory.External,
    });
    return JSON.parse(b64decode(r.data));
  } catch {
    return [];
  }
}
async function writeIndex(list: StoredMeta[]): Promise<void> {
  if (!isNative()) {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
    return;
  }
  const { Filesystem, Directory } = await fsApi();
  await Filesystem.writeFile({
    path: `${DIR}/index.json`,
    data: b64encode(JSON.stringify(list)),
    directory: Directory.External,
    recursive: true,
  });
}

// ── Local kaydet ─────────────────────────────────────────────────────────────
export async function saveLocal(report: FeedbackReport, shotB64: string | null): Promise<void> {
  if (!isNative()) {
    // Web: index + report birlikte localStorage (screenshot dahil, küçük tut)
    const list = await readIndex();
    list.unshift({
      id: report.id,
      ts: report.ts,
      route: report.route,
      description: report.description,
      uploaded: false,
    });
    localStorage.setItem(`${LS_KEY}:${report.id}`, JSON.stringify({ report, shot: shotB64 }));
    await writeIndex(list);
    return;
  }
  const { Filesystem, Directory } = await fsApi();
  await Filesystem.writeFile({
    path: `${DIR}/report-${report.id}.json`,
    data: b64encode(JSON.stringify(report)),
    directory: Directory.External,
    recursive: true,
  });
  if (shotB64)
    await Filesystem.writeFile({
      path: `${DIR}/shot-${report.id}.jpg`,
      data: shotB64,
      directory: Directory.External,
      recursive: true,
    });
  const list = await readIndex();
  list.unshift({
    id: report.id,
    ts: report.ts,
    route: report.route,
    description: report.description,
    uploaded: false,
  });
  await writeIndex(list);
}

async function markUploaded(id: string): Promise<void> {
  const list = await readIndex();
  const e = list.find((x) => x.id === id);
  if (e) {
    e.uploaded = true;
    await writeIndex(list);
  }
}

// ── Supabase upload (best-effort) ────────────────────────────────────────────
// Screenshot artık DB'ye base64 yazılmaz (DB bloat + egress). Edge Function
// 'debug-report-create' JSON alır (binary DEĞİL → CapacitorHttp-safe), b64'ü server-side
// decode edip 'debug-reports' Storage bucket'ına gerçek JPEG yükler + LEAN satır insert eder
// (screenshot_path). EF erişilemezse eski b64-insert'e düşülür (görsel kaybolmasın).
interface SupabaseLike {
  from(t: string): { insert(row: unknown): Promise<{ error: unknown }> };
  functions?: {
    invoke(name: string, opts: { body: unknown }): Promise<{ data: unknown; error: unknown }>;
  };
}
export async function uploadSupabase(
  supabase: SupabaseLike,
  report: FeedbackReport,
  shotB64: string | null,
): Promise<boolean> {
  // 1) Tercih: Edge Function (DB-lean, görsel Storage'a)
  try {
    if (supabase.functions?.invoke) {
      const { data, error } = await supabase.functions.invoke('debug-report-create', {
        body: {
          app: report.app,
          description: report.description,
          route: report.route,
          app_version: report.appVersion,
          user_id: report.userId || null,
          user_role: report.userRole || null,
          device: report.device,
          online: report.online,
          breadcrumbs: report.breadcrumbs,
          shot_b64: shotB64 || null,
        },
      });
      if (!error && (data as { ok?: boolean } | null)?.ok) {
        await markUploaded(report.id);
        return true;
      }
    }
  } catch {
    /* EF erişilemedi → fallback */
  }
  // 2) Fallback: eski b64-insert (EF yoksa/hata → görsel kaybolmasın)
  try {
    const { error } = await supabase.from('debug_reports').insert({
      app: report.app,
      description: report.description,
      route: report.route,
      app_version: report.appVersion,
      user_id: report.userId || null,
      user_role: report.userRole || null,
      device: report.device,
      online: report.online,
      breadcrumbs: report.breadcrumbs,
      screenshot_b64: shotB64 || null,
    });
    if (error) return false;
    await markUploaded(report.id);
    return true;
  } catch {
    return false;
  }
}

// ── Liste / getir / sil / paylaş / retry ─────────────────────────────────────
export async function listReports(): Promise<StoredMeta[]> {
  return readIndex();
}

export async function getReport(
  id: string,
): Promise<{ report: FeedbackReport; shot: string | null } | null> {
  if (!isNative()) {
    try {
      return JSON.parse(localStorage.getItem(`${LS_KEY}:${id}`) || 'null');
    } catch {
      return null;
    }
  }
  try {
    const { Filesystem, Directory } = await fsApi();
    const r = await Filesystem.readFile({
      path: `${DIR}/report-${id}.json`,
      directory: Directory.External,
    });
    const report = JSON.parse(b64decode(r.data)) as FeedbackReport;
    let shot: string | null = null;
    try {
      shot = (
        await Filesystem.readFile({ path: `${DIR}/shot-${id}.jpg`, directory: Directory.External })
      ).data;
    } catch {
      /* foto yok */
    }
    return { report, shot };
  } catch {
    return null;
  }
}

export async function deleteReport(id: string): Promise<void> {
  const list = (await readIndex()).filter((x) => x.id !== id);
  await writeIndex(list);
  if (!isNative()) {
    localStorage.removeItem(`${LS_KEY}:${id}`);
    return;
  }
  try {
    const { Filesystem, Directory } = await fsApi();
    await Filesystem.deleteFile({
      path: `${DIR}/report-${id}.json`,
      directory: Directory.External,
    }).catch(() => {});
    await Filesystem.deleteFile({
      path: `${DIR}/shot-${id}.jpg`,
      directory: Directory.External,
    }).catch(() => {});
  } catch {
    /* yut */
  }
}

export async function shareReport(id: string): Promise<void> {
  const data = await getReport(id);
  if (!data) return;
  const text = `Bug raporu (${data.report.app})\nRoute: ${data.report.route}\n\n${data.report.description}\n\n${JSON.stringify(data.report.breadcrumbs).slice(0, 1500)}`;
  if (!isNative()) {
    await navigator.clipboard?.writeText(text).catch(() => {});
    return;
  }
  const m = await import('@capacitor/share');
  await m.Share.share({ title: 'Bug raporu', text, dialogTitle: 'Bug raporunu gönder' }).catch(
    () => {},
  );
}

/** Yüklenmemiş raporları tekrar dene (app açılışında / online olunca). */
export async function retryUploads(supabase: SupabaseLike): Promise<void> {
  if (!navigator.onLine) return;
  const list = await readIndex();
  for (const meta of list.filter((x) => !x.uploaded)) {
    const data = await getReport(meta.id);
    if (data) await uploadSupabase(supabase, data.report, data.shot);
  }
}
