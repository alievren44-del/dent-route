import type { VisitOutcomeOption } from '@core/verticals/types';

export const MARKER_COLORS = {
  visited_hot: '#16a34a',
  follow_up_due: '#eab308',
  pending: '#ef4444',
  declined: '#6b7280',
  public_institution: '#2563eb',
  home_office: '#a855f7',
  unknown: '#94a3b8',
} as const;

export type MarkerColorKey = keyof typeof MARKER_COLORS;

const LABELS: Record<MarkerColorKey, string> = {
  visited_hot: 'Ziyaret edildi',
  follow_up_due: 'Tekrar zamanı',
  pending: 'Bekleyen',
  declined: 'Kapalı',
  public_institution: 'Kamu kurumu',
  home_office: 'Başlangıç noktası',
  unknown: 'Bilinmiyor',
};

export interface MarkerSubjectVisit {
  kind: 'visit';
  outcomeKey?: string;
  lastVisitDaysAgo?: number;
}

export interface MarkerSubjectCustomer {
  kind: 'customer';
  customerType?: string;
  lastVisitDaysAgo?: number;
  isPending?: boolean;
}

export interface MarkerSubjectFixed {
  kind: 'fixed';
  role: 'home' | 'office' | 'start' | 'end';
}

export type MarkerSubject = MarkerSubjectVisit | MarkerSubjectCustomer | MarkerSubjectFixed;

export interface MarkerColorResult {
  hex: string;
  key: MarkerColorKey;
  label: string;
}

const DEFAULT_FOLLOW_UP_THRESHOLD_DAYS = 30;

export function followUpDays(
  lastVisitDaysAgo: number,
  threshold = DEFAULT_FOLLOW_UP_THRESHOLD_DAYS,
): boolean {
  return Number.isFinite(lastVisitDaysAgo) && lastVisitDaysAgo > threshold;
}

function buildResult(key: MarkerColorKey): MarkerColorResult {
  return {
    hex: MARKER_COLORS[key],
    key,
    label: LABELS[key],
  };
}

function isPublicCustomerType(customerType: string | undefined): boolean {
  if (!customerType) return false;
  const lower = customerType.toLowerCase();
  return lower.includes('public') || lower.includes('hospital');
}

function mapOutcomeColorToKey(color: string | undefined): MarkerColorKey {
  if (!color) return 'unknown';
  switch (color.toLowerCase()) {
    case 'green':
      return 'visited_hot';
    case 'amber':
    case 'yellow':
      return 'follow_up_due';
    case 'red':
      return 'declined';
    case 'blue':
      return 'public_institution';
    case 'purple':
      return 'home_office';
    case 'gray':
    case 'grey':
      return 'declined';
    default:
      return 'unknown';
  }
}

function findOutcome(
  outcomeKey: string | undefined,
  outcomes: VisitOutcomeOption[] | undefined,
): VisitOutcomeOption | undefined {
  if (!outcomeKey || !outcomes) return undefined;
  return outcomes.find((o) => o.key === outcomeKey);
}

export function resolveMarkerColor(
  subject: MarkerSubject,
  vertical?: { visitOutcomes: VisitOutcomeOption[] },
  config?: { followUpThresholdDays?: number },
): MarkerColorResult {
  const threshold = config?.followUpThresholdDays ?? DEFAULT_FOLLOW_UP_THRESHOLD_DAYS;

  if (subject.kind === 'fixed') {
    return buildResult('home_office');
  }

  if (subject.kind === 'customer') {
    if (isPublicCustomerType(subject.customerType)) {
      return buildResult('public_institution');
    }
    if (subject.isPending) {
      return buildResult('pending');
    }
    if (typeof subject.lastVisitDaysAgo === 'number' && Number.isFinite(subject.lastVisitDaysAgo)) {
      if (followUpDays(subject.lastVisitDaysAgo, threshold)) {
        return buildResult('follow_up_due');
      }
      return buildResult('visited_hot');
    }
    return buildResult('unknown');
  }

  const outcome = findOutcome(subject.outcomeKey, vertical?.visitOutcomes);
  if (!outcome) {
    return buildResult('unknown');
  }
  const key = mapOutcomeColorToKey(outcome.color);
  return buildResult(key);
}
