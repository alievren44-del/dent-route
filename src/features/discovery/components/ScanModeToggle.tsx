/**
 * ScanModeToggle — DB / Taze tarama toggle (2 buton).
 */

import { Database, Sparkles } from 'lucide-react';

interface Props {
  mode: 'db' | 'fresh';
  onChange: (m: 'db' | 'fresh') => void;
  freshDisabled?: boolean;
  remainingFresh?: number;
}

export function ScanModeToggle({ mode, onChange, freshDisabled, remainingFresh }: Props) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <button
        type="button"
        onClick={() => onChange('db')}
        className={`flex h-11 flex-col items-center justify-center rounded-lg border text-xs font-medium transition ${
          mode === 'db'
            ? 'border-blue-600 bg-blue-600 text-white'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <Database size={14} />
          <span>Mevcut Veri</span>
        </div>
        <span className="mt-0.5 text-[10px] opacity-75">Hızlı + ücretsiz</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('fresh')}
        disabled={freshDisabled}
        className={`flex h-11 flex-col items-center justify-center rounded-lg border text-xs font-medium transition disabled:opacity-40 ${
          mode === 'fresh'
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} />
          <span>Yeni Tarama</span>
        </div>
        <span className="mt-0.5 text-[10px] opacity-75">
          {remainingFresh != null ? `Kalan: ${remainingFresh}/gün` : 'Google API'}
        </span>
      </button>
    </div>
  );
}
