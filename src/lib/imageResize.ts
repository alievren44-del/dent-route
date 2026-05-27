/**
 * imageResize — Tarayıcı içi resim küçültme.
 *
 * Saha fotoğraflarının yüklenmeden önce client'ta resize edilmesi için.
 * Kullanım örneği:
 *   const blob = await resizeImage(file, { maxDimension: 1600, quality: 0.8 });
 *   await supabase.storage.from('visit-photos').upload(path, blob, { contentType: 'image/jpeg' });
 *
 * Notlar:
 * - createImageBitmap → Canvas → toBlob pipeline.
 * - Hem landscape hem portrait için tek tarafı maxDimension'a sabitler,
 *   diğer tarafı oranlı küçültür. Kaynak zaten küçükse upscale yapılmaz.
 * - HEIC vb. browser'ın desteklemediği formatlarda createImageBitmap throw eder;
 *   caller catch edip orijinal File'ı upload edebilir.
 * - Caller (eğer önizleme için URL.createObjectURL kullandıysa)
 *   revokeObjectURL ile temizlemeli.
 */

export interface ResizeOptions {
  /** Hem en hem boy bu pikselden büyük olamaz. Varsayılan 1600. */
  maxDimension?: number;
  /** JPEG kalite 0-1. Varsayılan 0.8. */
  quality?: number;
  /** Çıktı MIME tipi. Varsayılan 'image/jpeg'. */
  mimeType?: 'image/jpeg' | 'image/webp' | 'image/png';
}

const DEFAULTS: Required<ResizeOptions> = {
  maxDimension: 1600,
  quality: 0.8,
  mimeType: 'image/jpeg',
};

function computeTargetSize(
  srcW: number,
  srcH: number,
  maxDim: number,
): { width: number; height: number } {
  if (srcW <= 0 || srcH <= 0) return { width: srcW, height: srcH };
  if (srcW <= maxDim && srcH <= maxDim) {
    return { width: srcW, height: srcH };
  }
  const ratio = srcW >= srcH ? maxDim / srcW : maxDim / srcH;
  return {
    width: Math.round(srcW * ratio),
    height: Math.round(srcH * ratio),
  };
}

async function loadBitmap(source: Blob | File): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('createImageBitmap desteklenmiyor.');
  }
  return await createImageBitmap(source);
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Canvas.toBlob boş döndü.'));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

/**
 * Bir Blob/File alır, küçültülmüş JPEG/WebP/PNG Blob döner.
 *
 * Hata durumları:
 * - createImageBitmap desteklenmiyorsa → throw.
 * - Kaynak okunamıyorsa (corrupt, HEIC vb.) → createImageBitmap throw eder,
 *   bu fonksiyon hatayı yukarı fırlatır.
 *
 * @example
 * const small = await resizeImage(file, { maxDimension: 1600, quality: 0.8 });
 */
export async function resizeImage(
  source: Blob | File,
  options?: ResizeOptions,
): Promise<Blob> {
  const opts = { ...DEFAULTS, ...(options ?? {}) };

  const bitmap = await loadBitmap(source);
  try {
    const target = computeTargetSize(bitmap.width, bitmap.height, opts.maxDimension);
    const canvas =
      typeof document !== 'undefined'
        ? document.createElement('canvas')
        : null;
    if (!canvas) {
      throw new Error('Canvas oluşturulamadı (DOM yok).');
    }
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context alınamadı.');
    }
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    return await canvasToBlob(canvas, opts.mimeType, opts.quality);
  } finally {
    if (typeof bitmap.close === 'function') {
      bitmap.close();
    }
  }
}

/**
 * Dosya uzantısını çıktı MIME tipine göre üretir.
 */
export function extensionFor(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/png') return 'png';
  return 'bin';
}
