#!/usr/bin/env tsx
/**
 * Saha Bootstrap Admin CLI
 *
 * Yeni bir Supabase projesinde ilk admin kullanıcısını oluşturur.
 *   npm run saha:create-admin
 *
 * Akış:
 *  1. .env dosyasını okur (Node 20.6+ loadEnvFile, fallback manuel parse)
 *  2. Email, ad soyad, parola sorar (readline/promises)
 *  3. supabase.auth.admin.createUser ile auth user yaratır
 *  4. profiles tablosuna upsert (role = ADMIN)
 *  5. Login URL + bilgi yazdırır
 *
 * EXIT CODES:
 *   0  → başarı
 *   1  → hata
 */
export {};
