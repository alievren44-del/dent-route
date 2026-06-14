/**
 * clinicEditAudit — saha_clinic_edit_logs insert helper.
 *
 * saha_clinics üzerindeki manuel düzenlemeleri (create_manual / update /
 * delete) audit trail tablosuna yazar. RLS policy
 * `clinic_edit_logs_authenticated_insert` tüm authenticated kullanıcılara
 * insert izni verir; okuma yalnızca ADMIN rolüne açıktır.
 *
 * Davranış: best-effort logging. UI akışı audit yazımı başarısız olsa bile
 * kesintiye uğramaz — sadece konsola warn düşülür.
 *
 * Sprint: 2 — Phase F (Manual Clinic Edit)
 */

import { getTypedClient } from '@lib/supabase';
import type { Json } from '@/types/database.types';

export type ClinicEditAction = 'create_manual' | 'update' | 'delete';

export interface ClinicEditLogInput {
  /**
   * İlgili klinik kaydı.
   * - update / create_manual → klinik id'si dolu olmalı.
   * - delete → null geçilebilir (clinic FK ON DELETE SET NULL).
   */
  clinicId: string | null;
  action: ClinicEditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * saha_clinic_edit_logs tablosuna bir kayıt ekler. Hata durumunda
 * sessizce log basar; çağıran kod akışı durdurmaz.
 */
export async function logClinicEdit(input: ClinicEditLogInput): Promise<void> {
  const supabase = getTypedClient();

  let userId: string | null = null;
  try {
    const { data: userData } = await supabase.auth.getUser();
    userId = userData?.user?.id ?? null;
  } catch {
    // auth.getUser() reddedilirse logging'i yine de denemeye değer
    // (RLS edited_by'ı zorlamıyor — null geçebiliriz).
  }

  try {
    const { error } = await supabase.from('saha_clinic_edit_logs').insert({
      clinic_id: input.clinicId,
      edited_by: userId,
      action: input.action,
      before: (input.before ?? null) as unknown as Json | null,
      after: (input.after ?? null) as unknown as Json | null,
    });
    if (error) {
      console.warn('clinic edit audit failed:', error.message);
    }
  } catch (e) {
    console.warn('clinic edit audit failed:', (e as Error)?.message ?? e);
  }
}
