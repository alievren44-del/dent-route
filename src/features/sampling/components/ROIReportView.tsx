import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, BarChart3 } from 'lucide-react';
import { computeROI } from '@core/sampling/roi';

export default function ROIReportView() {
  const [windowDays, setWindowDays] = useState<number>(90);
  const endDate = new Date().toISOString();
  const startDate = new Date(Date.now() - windowDays * 86400000).toISOString();

  const { data, isLoading } = useQuery({
    queryKey: ['sample-roi', windowDays],
    queryFn: () => computeROI({ startDate, endDate, conversionWindowDays: windowDays }),
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Pencere:</span>
        <div className="flex gap-1">
          {[30, 60, 90, 180].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setWindowDays(d)}
              className={`rounded-lg px-3 h-9 text-sm font-medium border ${
                windowDays === d ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border'
              }`}
            >
              {d}g
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground">Hesaplanıyor...</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card icon={<BarChart3 className="h-4 w-4" />} label="Toplam Numune" value={data.totalSampleCount.toString()} />
            <Card icon={<TrendingUp className="h-4 w-4" />} label="Dönüşüm" value={`%${data.conversionRatePct.toFixed(1)}`} />
            <Card icon={<BarChart3 className="h-4 w-4" />} label="Maliyet" value={`₺${data.totalSampleCostTl.toLocaleString('tr-TR')}`} />
            <Card icon={<TrendingUp className="h-4 w-4" />} label="ROI" value={`%${data.roiPct.toFixed(1)}`} highlight={data.roiPct > 0} />
          </div>

          <h2 className="text-lg font-semibold mt-4">Ürün Bazlı</h2>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-2">Ürün</th>
                  <th className="text-right p-2">Numune</th>
                  <th className="text-right p-2">Dönüşüm</th>
                  <th className="text-right p-2">ROI</th>
                </tr>
              </thead>
              <tbody>
                {data.byProduct.map((p) => (
                  <tr key={p.productName} className="border-t border-border">
                    <td className="p-2">{p.productName}</td>
                    <td className="text-right p-2">{p.sampleCount}</td>
                    <td className="text-right p-2">{p.convertedCount}</td>
                    <td className="text-right p-2">%{p.roiPct.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Card({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'border-green-300 bg-green-50' : 'border-border bg-card'}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}<span>{label}</span></div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}
