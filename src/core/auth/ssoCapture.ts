/**
 * SSO hand-off hash yakalama — React/BrowserRouter MOUNT ETMEDEN ÖNCE.
 *
 * Parla e-ticaret rep login'i saha portalına `#sso=base64{a,r}` ile yönlendirir.
 * Sorun: BrowserRouter redirect'i (/ → /login|/takvim) window.location.hash'i
 * SİLER; consumeSsoHandoff useEffect içinde (authStore.initialize) GEÇ çalışınca
 * hash gitmiş oluyordu → çift-login. Çözüm: bu modül yüklenince (main.tsx'in EN
 * başında, createRoot'tan ÖNCE = router daha mount olmadan) hash'i yakala + URL'den
 * hemen temizle (token URL/history'de kalmasın). consumeSsoHandoff bunu okur.
 */
export const capturedSsoHash: string = typeof window !== 'undefined' ? window.location.hash : '';

if (typeof window !== 'undefined' && /[#&]sso=/.test(window.location.hash)) {
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    /* yutulur */
  }
}
