/**
 * FeedbackReportsList.tsx — Kayıtlı raporlar paneli: listele / gör / sil / paylaş / upload-retry.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  listReports,
  deleteReport,
  shareReport,
  retryUploads,
  getReport,
  type StoredMeta,
} from './storage';
import type { FeedbackReport } from './capture';

interface SupabaseLike {
  from(t: string): { insert(row: unknown): Promise<{ error: unknown }> };
}

export function FeedbackReportsList({
  supabase,
  onClose,
}: {
  supabase: SupabaseLike;
  onClose: () => void;
}) {
  const [items, setItems] = useState<StoredMeta[]>([]);
  const [detail, setDetail] = useState<{ report: FeedbackReport; shot: string | null } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    setItems(await listReports());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const fmt = (ts: number) => new Date(ts).toLocaleString('tr-TR');

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483601,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          background: '#fff',
          margin: 'auto',
          width: '94%',
          maxWidth: 520,
          maxHeight: '86vh',
          borderRadius: 14,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 14px',
            borderBottom: '1px solid #eee',
          }}
        >
          <strong style={{ color: '#111', fontSize: 15 }}>
            📋 Kayıtlı bug raporları ({items.length})
          </strong>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={() => {
                void retryUploads(supabase).then(refresh);
              }}
              style={btn()}
              aria-label="Upload retry"
            >
              ↻ Upload
            </button>
            <button type="button" onClick={onClose} style={btn()} aria-label="Kapat">
              ✕
            </button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: 8 }}>
          {items.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
              Henüz rapor yok.
            </div>
          )}
          {items.map((it) => (
            <div
              key={it.id}
              style={{ border: '1px solid #eee', borderRadius: 10, padding: 10, marginBottom: 8 }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: '#6b7280',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  {fmt(it.ts)} · {it.route}
                </span>
                <span style={{ color: it.uploaded ? '#16a34a' : '#d97706' }}>
                  {it.uploaded ? '☁ yüklendi' : '⌛ local'}
                </span>
              </div>
              <div
                style={{ fontSize: 14, color: '#111', margin: '4px 0 8px', whiteSpace: 'pre-wrap' }}
              >
                {it.description || '(açıklama yok)'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => setDetail(await getReport(it.id)))();
                  }}
                  style={btn('#2563eb')}
                >
                  Gör
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void shareReport(it.id);
                  }}
                  style={btn('#0891b2')}
                >
                  Paylaş
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void deleteReport(it.id).then(refresh);
                  }}
                  style={btn('#dc2626')}
                >
                  Sil
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {detail && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2147483602,
            background: 'rgba(0,0,0,0.7)',
            overflow: 'auto',
            padding: 12,
          }}
          onClick={() => setDetail(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 12,
              maxWidth: 560,
              margin: '0 auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setDetail(null)}
              style={{ ...btn(), float: 'right' }}
            >
              ✕
            </button>
            <div style={{ fontSize: 13, color: '#111', marginBottom: 8 }}>
              <b>{detail.report.route}</b> · {fmt(detail.report.ts)} ·{' '}
              {detail.report.userRole || '—'}
            </div>
            <div style={{ fontSize: 14, color: '#111', marginBottom: 8, whiteSpace: 'pre-wrap' }}>
              {detail.report.description}
            </div>
            {detail.shot && (
              <img
                alt="screenshot"
                src={`data:image/jpeg;base64,${detail.shot}`}
                style={{ width: '100%', borderRadius: 8, border: '1px solid #eee' }}
              />
            )}
            <pre
              style={{
                fontSize: 10,
                color: '#374151',
                background: '#f9fafb',
                padding: 8,
                borderRadius: 8,
                overflow: 'auto',
                maxHeight: 220,
                marginTop: 8,
              }}
            >
              {JSON.stringify(detail.report.breadcrumbs, null, 1)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function btn(color = '#374151'): React.CSSProperties {
  return {
    background: 'none',
    border: `1px solid ${color}`,
    color,
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 13,
    cursor: 'pointer',
  };
}
