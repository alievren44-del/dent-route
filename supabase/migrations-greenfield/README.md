# Greenfield Migration Reference

Bu dizin **yeni tenant deployment'ları için referans** içerir. Production'da uygulanmaz.

## Parla Diş Deposu (mevcut tek tenant)

Parla'nın Supabase projesini (`rranpzicmhgfupgabgbi`) navigasyon, Parla web ve Parla mobil app paylaşır. Bu projede `0001_initial_schema.sql` UYGULANMAZ — şema çakışır.

Uygulanan migration: `supabase/migrations/0001_parla_saha_extension.sql` (additive, Parla'nın mevcut tablolarını genişletir).

## Yeni Tenant (Faz 2+)

Sıfırdan Supabase projesi açan yeni tenant için:

```bash
cp supabase/migrations-greenfield/0001_initial_schema.sql supabase/migrations/0001_initial_schema.sql
supabase db push
```

Sonra `supabase/migrations-greenfield/` içeriği rebrand edilirken `supabase/migrations/` aktif kalır.
