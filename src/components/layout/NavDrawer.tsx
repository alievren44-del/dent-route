/**
 * NavDrawer — Off-canvas navigation drawer, opened from Header hamburger.
 *
 * Tüm sayfaları kategori başlıkları altında listeler. Mobil + masaüstü uyumlu.
 * BottomNav sadece 5 hızlı erişim verir; tam menü buradadır.
 */

import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  X,
  Map,
  Search,
  Users,
  Route,
  ClipboardCheck,
  History as HistoryIcon,
  Bell,
  Gift,
  ShoppingCart,
  ListChecks,
  Receipt,
  CreditCard,
  FileText,
  Wallet,
  LayoutDashboard,
  Radar,
  FileUp,
  Activity,
  MapPinned,
  UserCog,
  ScrollText,
  Compass,
  Sparkles,
  Navigation,
  Banknote,
  Package,
  Target,
  BarChart3,
  TrendingDown,
  TrendingUp,
  ClipboardList,
  CalendarDays,
  Megaphone,
} from 'lucide-react';
import { useRouteBasket } from '@features/routes/store/routeBasketStore';
import { usePermissionCached } from '@core/auth/usePermissions';

const INVOICING_PERM = 'saha:invoicing:access';

interface NavDrawerProps {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
}

interface NavItem {
  to: string;
  label: string;
  Icon: typeof Map;
  badgeKey?: 'basket';
  /** Görünürlük için gerekli izin kodu (admin her zaman görür). */
  permission?: string;
}

interface NavSection {
  title: string;
  adminOnly?: boolean;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    title: 'Saha',
    items: [
      { to: '/harita', label: 'Harita', Icon: Map },
      { to: '/nearby-provinces', label: 'Yakınımdaki İller', Icon: Compass },
      { to: '/clinics/discover', label: 'Çevremdeki Klinikler', Icon: Search },
      { to: '/saha/tara', label: 'Saha Tarama', Icon: Radar },
      { to: '/clinics', label: 'Müşteri Listesi', Icon: Users },
      { to: '/routes/plan', label: 'Rota Planlayıcı', Icon: Route, badgeKey: 'basket' },
      { to: '/routes/auto', label: 'İlçe Otomatik Rota', Icon: Sparkles },
      { to: '/routes/corridor', label: 'Yol Üstü Klinik', Icon: Navigation },
      { to: '/routes/assigned', label: 'Bana Atanan Rotalar', Icon: Bell },
      { to: '/history', label: 'Ziyaret Geçmişi', Icon: HistoryIcon },
      { to: '/takvim', label: 'Takvim', Icon: CalendarDays },
      { to: '/gorevler', label: 'Görevlerim', Icon: ClipboardList },
      { to: '/tahsilatlar', label: 'Tahsilatlar', Icon: Banknote },
      { to: '/samples', label: 'Numune', Icon: Gift },
      { to: '/notifications', label: 'Bildirimler', Icon: Bell },
    ],
  },
  {
    title: 'Satış & Sipariş',
    items: [
      { to: '/sales', label: 'Satış Panosu', Icon: TrendingUp },
      { to: '/orders/new', label: 'Yeni Sipariş', Icon: ShoppingCart },
      { to: '/orders/history', label: 'Sipariş Geçmişi', Icon: ListChecks },
      { to: '/orders/approval', label: 'Onay Bekleyenler', Icon: ClipboardCheck },
      { to: '/invoicing/cari', label: 'Cariler', Icon: Wallet, permission: INVOICING_PERM },
      { to: '/invoicing/fatura/yeni', label: 'Yeni Fatura', Icon: Receipt, permission: INVOICING_PERM },
      { to: '/invoicing/cek-senet', label: 'Çek / Senet', Icon: CreditCard, permission: INVOICING_PERM },
      { to: '/invoicing/odeme/yeni', label: 'Yeni Ödeme', Icon: FileText, permission: INVOICING_PERM },
      { to: '/invoicing/aging', label: 'Alacak Yaşlandırma', Icon: TrendingDown, permission: INVOICING_PERM },
    ],
  },
  {
    title: 'Yönetici',
    adminOnly: true,
    items: [
      { to: '/admin/dashboard', label: 'Yönetici Paneli', Icon: LayoutDashboard },
      { to: '/admin/bi', label: 'BI Panosu', Icon: BarChart3 },
      { to: '/admin/rep-kpi', label: 'Plasiyer KPI', Icon: Target },
      { to: '/takvim', label: 'Plasiyer Takvimleri', Icon: CalendarDays },
      { to: '/admin/stock', label: 'Stok Defteri', Icon: Package },
      { to: '/admin/clinic-scan', label: 'Klinik Tarama', Icon: Radar },
      { to: '/admin/clinics', label: 'CSV / Excel İçe Aktar', Icon: FileUp },
      { to: '/admin/heatmap', label: 'Heatmap', Icon: Activity },
      { to: '/admin/regions', label: 'Bölge Atama', Icon: MapPinned },
      { to: '/admin/users', label: 'Kullanıcı Yönetimi', Icon: UserCog },
      { to: '/admin/audit-logs', label: 'Audit Log', Icon: ScrollText },
      { to: '/admin/broadcast', label: 'Toplu Bildirim', Icon: Megaphone },
    ],
  },
];

export function NavDrawer({ open, onClose, isAdmin }: NavDrawerProps) {
  const basketCount = useRouteBasket((s) => s.items.length);
  // İzin (invoicing) — admin her zaman; rep ise admin grant verdiyse görür.
  const canInvoicing = usePermissionCached(INVOICING_PERM);

  const hasItemPermission = (item: NavItem): boolean => {
    if (!item.permission) return true;
    if (isAdmin) return true;
    if (item.permission === INVOICING_PERM) return canInvoicing === true;
    return false;
  };

  useEffect(() => {
    if (!open) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  if (!open) return null;

  const visibleSections = SECTIONS.filter((s) => !s.adminOnly || isAdmin);

  return (
    <div role="dialog" aria-modal="true" aria-label="Ana menü" className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" aria-hidden="true" onClick={onClose} />
      <aside className="flex h-full w-80 max-w-[85vw] flex-col overflow-y-auto bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-semibold text-foreground">Menü</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Menüyü kapat"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 px-2 py-3">
          {visibleSections.map((section) => {
            const items = section.items.filter(hasItemPermission);
            if (items.length === 0) return null;
            return (
            <div key={section.title} className="mb-4">
              <h3 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {section.title}
              </h3>
              <ul className="space-y-0.5">
                {items.map(({ to, label, Icon, badgeKey }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={to === '/'}
                      onClick={onClose}
                      className={({ isActive }) =>
                        [
                          'flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm',
                          isActive
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-foreground hover:bg-muted',
                        ].join(' ')
                      }
                    >
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{label}</span>
                      </span>
                      {badgeKey === 'basket' && basketCount > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                          {basketCount}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
            );
          })}
        </nav>
      </aside>
    </div>
  );
}
