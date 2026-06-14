/**
 * reminderAttachments.ts — FAZ D
 *
 * saha_reminder_attachments tablosu + private 'reminder-files' bucket yönetimi.
 * Randevuya fotoğraf/ses eki yükleme ve toplu imzalı URL getirme.
 *
 * Referans patern: VisitFormPage.tsx:452-481 (visit-photos upload).
 * getSupabaseClient() (untyped) kullanılır — saha_reminder_attachments types.ts'de yok.
 */

import { getSupabaseClient } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ReminderAttachment {
  id: string;
  kind: 'photo' | 'audio';
  url: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** blob.type → dosya uzantısı. */
function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'audio/webm':
      return 'webm';
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/ogg':
      return 'ogg';
    default:
      return 'bin';
  }
}

/** crypto.randomUUID yoksa (eski WebView) tarih+random fallback. */
function genUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + 4 random hex segment
  const t = Date.now().toString(36);
  const r = () => Math.random().toString(36).slice(2, 6);
  return `${t}-${r()}-${r()}-${r()}-${r()}`;
}

// ---------------------------------------------------------------------------
// uploadReminderAttachment
// ---------------------------------------------------------------------------

/**
 * Blob'u reminder-files bucket'ına yükler + saha_reminder_attachments satırı ekler.
 *
 * Path konvansiyonu: `{reminderId}/{uuid}.{ext}`
 */
export async function uploadReminderAttachment(
  reminderId: string,
  blob: Blob,
  kind: 'photo' | 'audio',
): Promise<{ ok: boolean; error?: string }> {
  const sb = getSupabaseClient();

  // 1. Path oluştur
  const ext = extensionFor(blob.type);
  const path = `${reminderId}/${genUUID()}.${ext}`;

  // 2. Storage upload
  const { error: uploadError } = await sb.storage
    .from('reminder-files')
    .upload(path, blob, { contentType: blob.type, upsert: false });

  if (uploadError) {
    return { ok: false, error: uploadError.message };
  }

  // 3. Oturum kullanıcısını al
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    // Yetkilendirme yoksa yüklenen dosyayı silmeye çalış (best-effort)
    await sb.storage.from('reminder-files').remove([path]);
    return { ok: false, error: 'Oturum bulunamadı.' };
  }

  // 4. DB satırı ekle
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (sb as any)
    .from('saha_reminder_attachments')
    .insert({
      reminder_id: reminderId,
      kind,
      storage_path: path,
      created_by: user.id,
    });

  if (insertError) {
    // DB insert başarısız — storage'daki dosyayı geri al (best-effort)
    await sb.storage.from('reminder-files').remove([path]);
    return { ok: false, error: insertError.message };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// getReminderAttachmentsMap
// ---------------------------------------------------------------------------

/** DB satırı şekli (untyped tablo). */
interface AttachmentRow {
  id: string;
  reminder_id: string;
  kind: 'photo' | 'audio';
  storage_path: string;
}

/** Supabase createSignedUrls dönüşündeki tek öğe şekli. */
interface SignedUrlResult {
  path: string | null;
  signedUrl: string | null;
  error: string | null;
}

/**
 * Görünür reminder id'leri için ekleri (signed url'li) toplu getir.
 *
 * @returns `{ [reminderId]: [{id, kind, url}] }` — url alınamazsa ek atlanır.
 */
export async function getReminderAttachmentsMap(
  reminderIds: string[],
): Promise<Record<string, ReminderAttachment[]>> {
  if (reminderIds.length === 0) return {};

  const sb = getSupabaseClient();

  // 1. DB'den tüm ekleri çek
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows, error: dbError } = await (sb as any)
    .from('saha_reminder_attachments')
    .select('id, reminder_id, kind, storage_path')
    .in('reminder_id', reminderIds);

  if (dbError || !rows || (rows as AttachmentRow[]).length === 0) {
    return {};
  }

  const typedRows = rows as AttachmentRow[];

  // 2. Tüm storage_path'leri topla → createSignedUrls (tek çağrı)
  const paths = typedRows.map((r) => r.storage_path);

  const { data: signedResults, error: signError } = await sb.storage
    .from('reminder-files')
    .createSignedUrls(paths, 3600);

  if (signError || !signedResults) {
    return {};
  }

  // 3. path → signedUrl eşlemesi oluştur
  // SDK sürümüne göre item.path başında '/' olabilir → normalize (eşleme kaçmasın).
  const norm = (p: string): string => p.replace(/^\/+/, '');
  const pathToUrl = new Map<string, string>();
  for (const item of signedResults as SignedUrlResult[]) {
    if (item.path && item.signedUrl && !item.error) {
      pathToUrl.set(norm(item.path), item.signedUrl);
    }
  }

  // 4. reminderId → ReminderAttachment[] haritasını doldur
  const result: Record<string, ReminderAttachment[]> = {};

  for (const row of typedRows) {
    const url = pathToUrl.get(norm(row.storage_path));
    if (!url) continue; // URL alınamadıysa atla

    if (!result[row.reminder_id]) {
      result[row.reminder_id] = [];
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    result[row.reminder_id]!.push({ id: row.id, kind: row.kind, url });
  }

  return result;
}
