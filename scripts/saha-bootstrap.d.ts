#!/usr/bin/env tsx
/**
 * Saha Bootstrap CLI
 *
 * Yeni bir tenant kurulumunda veya doğrulama amacıyla çalıştırılır.
 *   npm run saha:bootstrap
 *
 * Yaptıkları:
 *  1. config/.saha-config.json okur
 *  2. Vertical template'in valid olduğunu doğrular
 *  3. Supabase URL/key erişilebilir mi test eder
 *  4. CRM tipi 'supabase' ise schema check yapar
 *  5. CRM tipi 'custom_rest' ise endpoint test eder
 *  6. Rapor yazdırır
 *
 * EXIT CODES:
 *   0  → tüm checkler ✓
 *   1  → config eksik veya invalid
 *   2  → vertical invalid
 *   3  → Supabase erişimi başarısız
 *   4  → CRM bağlantı problemi
 */
export {};
