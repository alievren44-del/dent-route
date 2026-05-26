export interface QRPayload {
  type: 'customer' | 'route';
  id: string;
}

/**
 * Generate QR data URL for customer.
 * URL pattern: https://saha.parla.com/clinics/{id}
 *
 * NOT: Şu an `qrcode` npm paketi yok — placeholder olarak Google Charts API URL döner.
 * Production'da `qrcode` paketi eklenip yerel render edilecek.
 */
export function buildQRTargetUrl(payload: QRPayload, baseUrl?: string): string {
  const base = baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : 'https://saha.parla.com');
  switch (payload.type) {
    case 'customer':
      return `${base}/clinics/${encodeURIComponent(payload.id)}`;
    case 'route':
      return `${base}/routes/active/${encodeURIComponent(payload.id)}`;
  }
}

/**
 * Quick-and-dirty QR via Google Charts (deprecated ama hala çalışır).
 * Production: qrcode npm paketi + canvas render.
 */
export function buildQRImageUrl(targetUrl: string, sizePx = 256): string {
  const encoded = encodeURIComponent(targetUrl);
  return `https://api.qrserver.com/v1/create-qr-code/?size=${sizePx}x${sizePx}&data=${encoded}`;
}

/**
 * Tarayıcıdan okunan QR text'i parse eder.
 * Saha URL formatı: .../clinics/{uuid} veya .../routes/active/{uuid}
 */
export function parseQR(text: string): QRPayload | null {
  if (!text) return null;
  // URL form
  try {
    const url = new URL(text);
    const parts = url.pathname.split('/').filter(Boolean);
    // /clinics/{id}
    if (parts[0] === 'clinics' && parts[1]) {
      return { type: 'customer', id: parts[1] };
    }
    // /routes/active/{id}
    if (parts[0] === 'routes' && parts[1] === 'active' && parts[2]) {
      return { type: 'route', id: parts[2] };
    }
  } catch {
    // Direkt uuid mi?
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(text.trim())) {
      return { type: 'customer', id: text.trim() };
    }
  }
  return null;
}
