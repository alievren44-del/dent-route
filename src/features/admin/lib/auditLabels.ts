/**
 * auditLabels — admin_audit_logs için okunabilir Türkçe etiketler ve açıklama oluşturucu.
 *
 * Kural: bu dosya saf (pure) + type-safe. DB / Supabase bağımlılığı yok.
 */

/** Action kodu → geçmiş-zaman Türkçe etiket. */
export const ACTION_LABELS: Record<string, string> = {
  change_role: 'Rol değiştirildi',
  activate_user: 'Kullanıcı aktifleştirildi',
  deactivate_user: 'Kullanıcı pasifleştirildi',
  reset_password: 'Parola sıfırlandı',
  create_user: 'Kullanıcı oluşturuldu',
  assign_region: 'Bölge atandı',
  delete_order: 'Satış silindi',
};

/** target_table → okunabilir Türkçe nesne adı. */
export const TABLE_LABELS: Record<string, string> = {
  profiles: 'Kullanıcı',
  orders: 'Sipariş',
  saha_clinics: 'Klinik',
  saha_faturalar: 'Fatura',
  rep_assignments: 'Atama',
};

// ── yardımcı ────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Bir denetim kaydı için okunabilir Türkçe cümle üretir.
 *
 * Örnekler:
 *   describeAudit('change_role',  { role: 'REP' },         'profiles')
 *     → "Rol değiştirildi: REP"
 *   describeAudit('assign_region', { region: 'ankara' },   'rep_assignments')
 *     → "Bölge atandı: ankara"
 *   describeAudit('delete_order',  { order_number: 'SP-0042', total: 1250 }, 'orders')
 *     → "Satış silindi: SP-0042 (1250)"
 *   describeAudit('activate_user', {},                     'profiles')
 *     → "Kullanıcı aktifleştirildi"
 */
export function describeAudit(
  action: string,
  details: unknown,
  _targetTable: string | null,
): string {
  const base = ACTION_LABELS[action] ?? action;

  // --- bilinen şekle özgü açıklamalar ------------------------------------

  if (action === 'change_role' && isRecord(details) && details.role != null) {
    return `${base}: ${String(details.role)}`;
  }

  if (action === 'assign_region' && isRecord(details) && details.region != null) {
    return `${base}: ${String(details.region)}`;
  }

  if (action === 'delete_order' && isRecord(details)) {
    const num = details.order_number != null ? String(details.order_number) : null;
    const total = details.total != null ? String(details.total) : null;
    if (num) {
      return total ? `${base}: ${num} (${total})` : `${base}: ${num}`;
    }
  }

  if (action === 'reset_password' && isRecord(details) && details.email != null) {
    return `${base}: ${String(details.email)}`;
  }

  if (action === 'create_user' && isRecord(details) && details.email != null) {
    return `${base}: ${String(details.email)}`;
  }

  // --- genel geri dönüş: nesne içeriğini "key: value" olarak listele ------

  if (isRecord(details)) {
    const entries = Object.entries(details).filter(([, v]) => v != null);
    if (entries.length > 0) {
      const pairs = entries.map(([k, v]) => `${k}: ${String(v)}`).join(', ');
      return `${base} — ${pairs}`;
    }
  }

  // --- boş / null → sadece etiket ----------------------------------------
  return base;
}
