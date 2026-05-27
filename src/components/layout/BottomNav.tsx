import { NavLink } from 'react-router-dom';
import { Map, Users, Route, BarChart3, Gift } from 'lucide-react';
import { usePermissions } from '@core/auth/usePermissions';
import { useRouteBasket } from '@features/routes/store/routeBasketStore';

interface NavItem {
  to: string;
  label: string;
  Icon: typeof Map;
  adminOnly?: boolean;
  showBasketBadge?: boolean;
}

const items: NavItem[] = [
  { to: '/', label: 'Harita', Icon: Map },
  { to: '/clinics/discover', label: 'Klinikler', Icon: Users },
  { to: '/routes/plan', label: 'Rota', Icon: Route, showBasketBadge: true },
  { to: '/samples', label: 'Numune', Icon: Gift },
  { to: '/admin/dashboard', label: 'Yönetici', Icon: BarChart3, adminOnly: true },
];

export function BottomNav() {
  const { isAdmin } = usePermissions();
  const basketCount = useRouteBasket((s) => s.items.length);
  const visible = items.filter((i) => !i.adminOnly || isAdmin);

  return (
    <nav
      aria-label="Ana navigasyon"
      className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-background pb-safe"
    >
      {visible.map(({ to, label, Icon, showBasketBadge }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            [
              'flex min-h-tap-min flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px]',
              isActive ? 'text-primary' : 'text-muted-foreground',
            ].join(' ')
          }
        >
          <div className="relative">
            <Icon className="h-5 w-5" />
            {showBasketBadge && basketCount > 0 && (
              <span
                aria-label={`${basketCount} durak sepette`}
                className="absolute -top-1 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
              >
                {basketCount}
              </span>
            )}
          </div>
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
