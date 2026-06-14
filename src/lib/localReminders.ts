/**
 * Yerel hatırlatma bildirimleri (Capacitor LocalNotifications).
 *
 * Neden: Remote FCM push (send-push EF) Android'de bildirim-İÇİ aksiyon butonu
 * (Ara / WhatsApp / Ertele) gösteremez (Capacitor PushNotifications sınırı).
 * LocalNotifications DESTEKLER ve uygulama kapalıyken de tetiklenir. Bu modül,
 * plasiyerin yaklaşan açık hatırlatmalarını (saha_reminders) cihazda zamanlanmış
 * yerel bildirim olarak kurar — her biri Ara/WhatsApp/1 saat ertele butonlu.
 *
 * Akış: uygulama açılışında + ziyaret kaydından sonra `syncReminderNotifications()`
 * çağrılır → mevcut zamanlanmışlar iptal → DB'den yaklaşan reminder'lar çekilir →
 * due_at'a zamanlanır. Tap/aksiyon `handleReminderAction` + `handleTapNavigation`
 * (push.ts ile paylaşılan) ile işlenir.
 */

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { getSupabaseClient } from '@lib/supabase';
import { handleReminderAction, handleTapNavigation } from '@lib/push';
import { pushDebug } from '@/lib/debugLog';

const ACTION_TYPE_ID = 'VISIT_REMINDER';
let initialized = false;
let syncing = false;

interface ReminderRow {
  id: string;
  account_id: string | null;
  type: string;
  title: string | null;
  note: string | null;
  due_at: string;
}

/** uuid → stabil pozitif int (LocalNotifications id number ister). */
function uuidToInt(uuid: string): number {
  let h = 0;
  for (let i = 0; i < uuid.length; i++) {
    h = (h * 31 + uuid.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 2_000_000_000;
}

/** Yaklaşan açık hatırlatmaları cihaza yerel bildirim olarak (yeniden) kur. */
export async function syncReminderNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (syncing) return;        // hızlı çift-çağrı cancel/schedule race'ini önle
  syncing = true;
  try {
    try {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') {
        const req = await LocalNotifications.requestPermissions();
        if (req.display !== 'granted') return;
      }

      const sb = getSupabaseClient();
      // Yalnız OTURUMDAKİ kullanıcının reminder'ları — aksi halde admin (RLS geniş)
      // tüm plasiyerlerin kaydını çeker, notified_at'ı set edip cron FCM'ini susturur.
      const { data: userRes } = await sb.auth.getUser();
      const userId = userRes.user?.id;
      if (!userId) return;
      const nowIso = new Date().toISOString();
      const { data, error } = await sb
        .from('saha_reminders')
        .select('id, account_id, type, title, note, due_at')
        .eq('rep_id', userId)
        .eq('status', 'open')
        .gt('due_at', nowIso)
        .order('due_at', { ascending: true })
        .limit(50);
      if (error) {
        pushDebug('error', 'push', `local reminder fetch: ${error.message}`);
        return;
      }
      const reminders = (data ?? []) as ReminderRow[];

      // Klinik ad + telefon (aksiyon butonları için).
      const accountIds = [...new Set(reminders.map((r) => r.account_id).filter(Boolean))] as string[];
      const phoneById: Record<string, { name: string; phone: string | null }> = {};
      if (accountIds.length > 0) {
        const { data: clinics } = await sb
          .from('saha_clinics')
          .select('id, name, phone')
          .in('id', accountIds);
        ((clinics ?? []) as { id: string; name: string; phone: string | null }[]).forEach((c) => {
          phoneById[c.id] = { name: c.name, phone: c.phone };
        });
      }

      // Önce eski zamanlanmışları temizle (id çakışmasını ve bayatları önler).
      try {
        const pending = await LocalNotifications.getPending();
        if (pending.notifications.length > 0) {
          await LocalNotifications.cancel({
            notifications: pending.notifications.map((n) => ({ id: n.id })),
          });
        }
      } catch {
        /* yut */
      }

      if (reminders.length === 0) return;

      const notifications = reminders.map((r) => {
        const clinic = r.account_id ? phoneById[r.account_id] : undefined;
        const isAppt = r.type === 'appointment';
        return {
          id: uuidToInt(r.id),
          title: isAppt ? 'Randevu hatırlatması' : 'Ziyaret hatırlatması',
          body:
            (clinic?.name ?? 'Klinik') +
            (r.note ? ` · ${r.note}` : isAppt ? '' : ' · 1 ay önce ziyaret edildi'),
          schedule: { at: new Date(r.due_at), allowWhileIdle: true },
          actionTypeId: ACTION_TYPE_ID,
          extra: {
            kind: 'visit_reminder',
            reminder_id: r.id,
            account_id: r.account_id,
            clinic_name: clinic?.name ?? null,
            clinic_phone: clinic?.phone ?? null,
            route: '/takvim',
          },
        };
      });

      await LocalNotifications.schedule({ notifications });

      // Çift bildirim önle: cihazda yerel (butonlu) zamanlandı → sunucu cron'u (FCM,
      // butonsuz) bu reminder'ları PUSH'lamasın. notified_at sadece cron kapısı; takvim
      // gösterimi status'a baktığı için etkilenmez. (Uygulamayı hiç açmayan kullanıcıda
      // notified_at NULL kalır → FCM fallback yine çalışır.)
      const scheduledIds = reminders.map((r) => r.id);
      if (scheduledIds.length > 0) {
        await sb
          .from('saha_reminders')
          .update({ notified_at: new Date().toISOString() })
          .in('id', scheduledIds)
          .is('notified_at', null);
      }
      pushDebug('info', 'push', `${notifications.length} yerel hatırlatma zamanlandı`);
    } catch (e) {
      pushDebug(
        'error',
        'push',
        `local reminder sync: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } finally {
    syncing = false;
  }
}

/** Aksiyon tipleri + tap/aksiyon dinleyicisi. Bir kez kurulur. */
export async function initLocalReminders(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (initialized) return;
  initialized = true;

  try {
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: ACTION_TYPE_ID,
          actions: [
            { id: 'call', title: 'Ara' },
            { id: 'whatsapp', title: 'WhatsApp' },
            { id: 'snooze1h', title: '1 saat ertele' },
          ],
        },
      ],
    });
  } catch (e) {
    pushDebug('error', 'push', `local action types: ${e instanceof Error ? e.message : String(e)}`);
  }

  await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const data = action.notification.extra as Record<string, unknown> | undefined;
    // handleReminderAction artık async (snooze DB-update'i await eder) → re-sync
    // ANCAK commit sonrası çalışsın, aksi halde bildirim eski saate yeniden kurulur.
    void handleReminderAction(action.actionId, data).then((handled) => {
      if (handled) {
        if (action.actionId === 'snooze1h') void syncReminderNotifications();
        return;
      }
      handleTapNavigation(data);
    });
  });

  await syncReminderNotifications();
}
