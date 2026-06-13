/**
 * AssignRouteModal — Admin için rota atama formu.
 *
 * Plasiyer dropdown + atama notu + Submit.
 * onSubmit: saha_routes insert (profile_id=assigned_to, status='assigned',
 * assigned_by=admin) + saha_notifications insert.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Send, Loader2, Users } from 'lucide-react';
import { toast } from 'sonner';

import { getTypedClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';

interface RepProfile {
  id: string;
  email: string;
  ad_soyad: string | null;
  role: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Atanacak rota verisi (sepet + optimize sonucu) */
  payload: {
    account_ids: string[];
    total_distance_km: number;
    total_duration_min: number;
    name?: string;
  };
}

export function AssignRouteModal({ open, onClose, payload }: Props) {
  const navigate = useNavigate();
  const adminId = useAuthStore((s) => s.session?.userId);
  const [reps, setReps] = useState<RepProfile[]>([]);
  const [selectedRep, setSelectedRep] = useState('');
  const [note, setNote] = useState('');
  const [routeName, setRouteName] = useState(payload.name ?? '');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      setLoading(true);
      try {
        const supabase = getTypedClient();
        const { data, error } = await supabase
          .from('profiles')
          .select('id, email, ad_soyad, role')
          .order('email');
        if (error) throw error;
        const list = (data ?? []) as RepProfile[];
        // Sadece saha rep/admin/manager rolleri
        const filtered = list.filter((p) =>
          ['REP', 'SALES_REP', 'ADMIN', 'MANAGER', 'sales_rep', 'admin', 'manager'].includes(
            p.role,
          ),
        );
        setReps(filtered);
      } catch (e) {
        toast.error('Kullanıcı listesi alınamadı: ' + (e instanceof Error ? e.message : String(e)));
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!selectedRep) {
      toast.error('Plasiyer seç');
      return;
    }
    setSubmitting(true);
    try {
      const supabase = getTypedClient();
      const nowIso = new Date().toISOString();

      // 1. saha_routes insert
      const { data: routeRow, error: routeErr } = await supabase
        .from('saha_routes')
        .insert({
          profile_id: selectedRep,
          assigned_to: selectedRep,
          assigned_by: adminId ?? null,
          assignment_note: note.trim() || null,
          assigned_at: nowIso,
          name: routeName.trim() || null,
          status: 'assigned' as const,
          account_ids: payload.account_ids,
          optimized: true,
          total_distance_km: payload.total_distance_km,
          total_duration_min: payload.total_duration_min,
        })
        .select('id')
        .single();
      if (routeErr) throw routeErr;
      const routeId = (routeRow as { id: string }).id;

      // 2. saha_notifications insert
      const rep = reps.find((r) => r.id === selectedRep);
      const repLabel = rep?.ad_soyad?.trim() || rep?.email || 'Plasiyer';
      await supabase.from('saha_notifications').insert({
        user_id: selectedRep,
        type: 'route_assigned',
        title: 'Yeni rota atandı',
        body:
          (routeName.trim() ? `"${routeName.trim()}" rotası` : 'Yeni rota') +
          ` (${payload.account_ids.length} durak, ${payload.total_distance_km.toFixed(1)} km)` +
          (note.trim() ? ` — Not: ${note.trim()}` : ''),
        payload: { route_id: routeId, account_count: payload.account_ids.length },
      });

      toast.success(`Rota ${repLabel}'a atandı + bildirim gönderildi`);
      onClose();
      navigate('/routes/active/' + routeId);
    } catch (e) {
      toast.error(`Atama başarısız: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="w-full max-w-md rounded-xl bg-background p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Users size={16} />
            Plasiyere Rota Ata
          </h3>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Kapat">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-600">Rota Adı (opsiyonel)</span>
            <input
              type="text"
              value={routeName}
              onChange={(e) => setRouteName(e.target.value)}
              placeholder="örn. Etimesgut Salı Rotası"
              className="h-10 rounded-lg border border-slate-200 px-2"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-600">Plasiyer</span>
            {loading ? (
              <span className="text-slate-500 inline-flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Yükleniyor…
              </span>
            ) : (
              <select
                value={selectedRep}
                onChange={(e) => setSelectedRep(e.target.value)}
                className="h-10 rounded-lg border border-slate-200 px-2"
              >
                <option value="">Seç…</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {(r.ad_soyad?.trim() || r.email) + ` (${r.role})`}
                  </option>
                ))}
              </select>
            )}
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-600">Not (opsiyonel)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Plasiyere mesaj, öncelik, vb."
              rows={4}
              className="rounded-lg border border-slate-200 p-2"
            />
          </label>

          <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
            <strong>{payload.account_ids.length} durak</strong> ·{' '}
            {payload.total_distance_km.toFixed(1)} km · {payload.total_duration_min} dk
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!selectedRep || submitting}
          className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Send size={14} />
          {submitting ? 'Atanıyor…' : 'Ata + Bildir'}
        </button>
      </div>
    </div>
  );
}
