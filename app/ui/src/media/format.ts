// Slice 6A (ms6-trash-media §11, AP-560): sizes as `844 bytes` below 1,000 bytes, else base-1,000 KB / MB with one
// decimal (as Finder); `2 pages · 844 bytes` on a PDF card.
import { t } from '../i18n/catalog';

export function sizeText(bytes: number): string {
  if (bytes < 1000) return t('media.bytes', { count: bytes });
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function pdfMeta(pages: number | null, size: number | null): string {
  return [pages !== null ? t('media.pages', { count: pages }) : null, size !== null ? sizeText(size) : null].filter(Boolean).join(' · ');
}

const IMAGE = /\.(png|jpe?g|gif|webp|heic|svg)$/i;
export const isImageFile = (path: string) => IMAGE.test(path);
export const isPdfFile = (path: string) => /\.pdf$/i.test(path);
