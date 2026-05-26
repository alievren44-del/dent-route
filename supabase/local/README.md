# Lokal Stack Baseline

Bu dizin **YALNIZCA LOKAL geliştirme** için kullanılır. Prod Supabase'e push edilmez.

## İçerik

- `parla-schema-baseline.sql` — Parla prod Supabase'den dump edilmiş schema (public).
  `supabase db dump --linked --schema public` ile alındı.
  120+ Parla migration'ının nihai durumudur.

## Workflow

```powershell
# Lokal stack reset (Parla baseline + navigasyon saha migration uygular):
npm run db:local-reset
```

Bu komut:
1. Lokal Supabase stack'i durdurur
2. Yeniden başlatır (boş Postgres)
3. `parla-schema-baseline.sql` uygular (Parla şeması)
4. `supabase/migrations/*.sql` sırasıyla uygular (saha extension)
5. `supabase/local/seed.sql` çalıştırır (varsa test kullanıcıları)

## Baseline'ı Yenileme

Parla schema değiştiğinde (örn: Parla web/app developer yeni migration ekledi):

```powershell
npx supabase db dump --linked --schema public -f supabase/local/parla-schema-baseline.sql
```

Sonra commit et. CI workflow bunu kullanır.
