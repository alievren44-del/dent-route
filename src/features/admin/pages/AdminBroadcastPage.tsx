/**
 * AdminBroadcastPage — Toplu bildirim gönderme (broadcast).
 *
 * URL: /admin/broadcast
 *
 * Admin, tüm plasiyerlere veya tüm kullanıcılara tek tıkla bildirim gönderir.
 * RPC: saha_broadcast(p_title, p_body, p_target) → gönderilen kişi sayısı
 */

import { useState } from 'react';
import { Megaphone, Send } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase';

type Target = 'reps' | 'all';

const TARGET_OPTIONS: { value: Target; label: string }[] = [
  { value: 'reps', label: 'Plasiyerler (REP / SALES_REP / MANAGER)' },
  { value: 'all', label: 'Tüm Kullanıcılar' },
];

export default function AdminBroadcastPage() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState<Target>('reps');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;

    setLoading(true);
    setFeedback(null);

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await (supabase as ReturnType<typeof getSupabaseClient>).rpc(
        'saha_broadcast' as never,
        { p_title: title.trim(), p_body: body.trim(), p_target: target } as never,
      );

      if (error) throw error;

      const count = typeof data === 'number' ? data : 0;
      setFeedback({ type: 'success', text: `${count} kişiye gönderildi.` });
      setTitle('');
      setBody('');
      setTarget('reps');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
      setFeedback({ type: 'error', text: msg });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      {/* Başlık */}
      <div className="mb-6 flex items-center gap-3">
        <Megaphone className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Toplu Bildirim</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Başlık alanı */}
        <div className="space-y-1.5">
          <label htmlFor="bc-title" className="block text-sm font-medium text-foreground">
            Başlık <span className="text-destructive">*</span>
          </label>
          <input
            id="bc-title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Bildirim başlığı"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {/* Mesaj alanı */}
        <div className="space-y-1.5">
          <label htmlFor="bc-body" className="block text-sm font-medium text-foreground">
            Mesaj <span className="text-destructive">*</span>
          </label>
          <textarea
            id="bc-body"
            required
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Bildirim metni…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
          />
        </div>

        {/* Hedef seçimi */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Hedef</legend>
          {TARGET_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex cursor-pointer items-center gap-2.5">
              <input
                type="radio"
                name="bc-target"
                value={opt.value}
                checked={target === opt.value}
                onChange={() => setTarget(opt.value)}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">{opt.label}</span>
            </label>
          ))}
        </fieldset>

        {/* Geri bildirim */}
        {feedback && (
          <p
            className={[
              'rounded-md px-3 py-2 text-sm',
              feedback.type === 'success'
                ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                : 'bg-destructive/10 text-destructive',
            ].join(' ')}
          >
            {feedback.text}
          </p>
        )}

        {/* Gönder butonu */}
        <button
          type="submit"
          disabled={loading || !title.trim() || !body.trim()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {loading ? 'Gönderiliyor…' : 'Gönder'}
        </button>
      </form>
    </div>
  );
}
