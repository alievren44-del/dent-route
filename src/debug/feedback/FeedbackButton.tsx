/**
 * FeedbackButton.tsx — Sabit FAB + bug açıklama modalı.
 * Tap → modal; Kaydet → ekran fotosu (FAB+modal gizlenir) + bağlam → local + Supabase.
 * Uzun-bas (📋) → kayıtlı raporlar listesi.
 */
import { useRef, useState, useCallback } from 'react';
import { captureReport, type FeedbackUser } from './capture';
import { saveLocal, uploadSupabase } from './storage';
import { FeedbackReportsList } from './FeedbackReportsList';

interface SupabaseLike {
  from(t: string): { insert(row: unknown): Promise<{ error: unknown }> };
}

export interface FeedbackButtonProps {
  app: string;
  appVersion: string;
  getUser: () => FeedbackUser;
  supabase: SupabaseLike;
  toast?: (msg: string, kind?: 'success' | 'error') => void;
}

export function FeedbackButton({ app, appVersion, getUser, supabase, toast }: FeedbackButtonProps) {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const notify = useCallback((m: string, k: 'success' | 'error' = 'success') => {
    if (toast) toast(m, k); else if (k === 'error') console.warn('[feedback]', m);
  }, [toast]);

  const handleSave = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { report, screenshotBase64 } = await captureReport({
        app, appVersion, description: desc.trim(), user: getUser(),
        hideEls: () => { if (rootRef.current) rootRef.current.style.visibility = 'hidden'; },
        showEls: () => { if (rootRef.current) rootRef.current.style.visibility = 'visible'; },
      });
      await saveLocal(report, screenshotBase64);
      // Supabase upload best-effort — bloklamadan
      uploadSupabase(supabase, report, screenshotBase64).catch(() => {});
      notify('Bug kaydedildi ✓');
      setDesc('');
      setOpen(false);
    } catch (e) {
      notify('Kaydedilemedi: ' + (e instanceof Error ? e.message : 'hata'), 'error');
    } finally {
      setBusy(false);
    }
  }, [app, appVersion, desc, getUser, supabase, busy, notify]);

  const FAB_BG = '#dc2626';

  return (
    <div ref={rootRef}>
      {/* FAB */}
      {!open && (
        <button
          type="button"
          aria-label="Bug bildir"
          onClick={() => setOpen(true)}
          onContextMenu={(e) => { e.preventDefault(); setListOpen(true); }}
          style={{
            position: 'fixed', right: 14, bottom: 88, zIndex: 2147483600,
            width: 52, height: 52, borderRadius: 26, border: 'none', cursor: 'pointer',
            background: FAB_BG, color: '#fff', fontSize: 22, boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
          }}
        >🐞</button>
      )}

      {/* Modal */}
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2147483600, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: '#fff', width: '100%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 15, color: '#111' }}>🐞 Bug / Düzeltme bildir</strong>
              <button type="button" onClick={() => setListOpen(true)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }} aria-label="Kayıtlı raporlar">📋</button>
            </div>
            <textarea
              autoFocus value={desc} onChange={(e) => setDesc(e.target.value)}
              placeholder="Ne hatalı / ne eksik / ne düzeltilmeli? (ekran fotosu + loglar otomatik eklenir)"
              rows={4}
              style={{ width: '100%', boxSizing: 'border-box', padding: 10, fontSize: 14, border: '1px solid #d1d5db', borderRadius: 8, resize: 'vertical', color: '#111' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" onClick={() => { setOpen(false); setDesc(''); }} disabled={busy}
                style={{ flex: 1, padding: 12, borderRadius: 8, border: '1px solid #d1d5db', background: '#f9fafb', color: '#374151', fontWeight: 600, cursor: 'pointer' }}>İptal</button>
              <button type="button" onClick={handleSave} disabled={busy || !desc.trim()}
                style={{ flex: 2, padding: 12, borderRadius: 8, border: 'none', background: busy || !desc.trim() ? '#fca5a5' : FAB_BG, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                {busy ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {listOpen && <FeedbackReportsList supabase={supabase} onClose={() => setListOpen(false)} />}
    </div>
  );
}
