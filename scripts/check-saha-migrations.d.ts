#!/usr/bin/env tsx
/**
 * Saha Migration Guard
 *
 * Navigasyon repo'nun Parla paylaşımlı Supabase'i ile karışmamasını sağlar.
 *
 * Kurallar:
 *   1. supabase/migrations/ altındaki her dosyanın adı `<timestamp>_saha_*.sql`
 *      formatında olmalı (greenfield ref hariç — migrations-greenfield/ ayrı).
 *   2. SQL içeriği yalnızca:
 *      - CREATE TABLE saha_* (saha prefix tablolar)
 *      - ALTER TABLE allowlist (Sprint 1 izinli ALTER'lar)
 *      - CREATE INDEX saha_*
 *      - CREATE/DROP POLICY (RLS — saha_* veya allowlist tablolar)
 *      - CREATE OR REPLACE FUNCTION saha_*
 *      - INSERT INTO permissions/role_permissions (RBAC seed)
 *      - CREATE EXTENSION
 *      içerebilir.
 *   3. Allowlist dışı tablo CREATE/DROP yasak.
 *
 * Bu guard sayesinde navigasyon'un yanlışlıkla Parla'nın `orders`,
 * `customer_accounts`, `products` gibi tablolarını ALTER etmesi engellenir.
 */
export {};
