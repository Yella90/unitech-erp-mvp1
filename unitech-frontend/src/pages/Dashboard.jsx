import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { getAnimationCascadeClass } from '../utils/animations';
import {
  ArrowTrendingDownIcon,
  ArrowTrendingUpIcon,
  BanknotesIcon,
  BuildingLibraryIcon,
  ChartBarIcon,
  PresentationChartLineIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { PageLoadingState, usePageLoadingVisibility } from '../components/PageState';

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('fr-FR')} FCFA`;
}

function formatSignedMoney(value) {
  const amount = Number(value || 0);
  const prefix = amount > 0 ? '+' : '';
  return `${prefix}${amount.toLocaleString('fr-FR')} FCFA`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('fr-FR');
}

function formatSubscriptionBadge(subscription) {
  if (!subscription) return '';
  if (subscription.accessBlocked) return 'Acces coupe';
  if (subscription.status === 'pending') return 'En attente';
  if (subscription.status === 'active') return 'Actif';
  if (subscription.status === 'suspended') return 'Suspendu';
  if (subscription.status === 'expired') return 'Expire';
  return subscription.status || '';
}

function formatSubscriptionRemaining(subscription) {
  if (!subscription) return '-';
  if (subscription.status !== 'active') return '-';
  if (subscription.remainingLabel) return subscription.remainingLabel;

  if (subscription.monthsRemaining !== null && subscription.monthsRemaining > 0) {
    return `${subscription.monthsRemaining} mois`;
  }

  if (subscription.daysRemaining !== null) {
    return `${Math.max(1, subscription.daysRemaining)} jour(s)`;
  }

  return '-';
}

function MetricCard({ label, value, hint, icon: Icon, color, tone = 'bg-white', className = '' }) {
  return (
    <div className={`rounded-xl p-5 shadow-sm ring-1 ring-slate-200 ${tone} ${className}`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-600">{label}</p>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <Icon className={`h-8 w-8 ${color}`} />
        </div>
      </div>
    </div>
  );
}

function Panel({ title, badge, children }) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {badge ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{badge}</span> : null}
      </div>
      {children}
    </div>
  );
}

function EmptyChartState({ message }) {
  return (
    <div className="grid h-72 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
      {message}
    </div>
  );
}

function Legend({ items }) {
  return (
    <div className="mb-4 flex flex-wrap gap-4 text-xs font-medium text-slate-600">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function GroupedBarChart({ rows, leftKey, rightKey, leftLabel, rightLabel, leftColor, rightColor }) {
  if (!rows.length) {
    return <EmptyChartState message="Aucune donnee disponible pour ce graphe." />;
  }

  const values = rows.flatMap((row) => [Number(row[leftKey] || 0), Number(row[rightKey] || 0)]);
  const maxValue = Math.max(1, ...values);
  const chartHeight = 220;

  return (
    <div>
      <Legend items={[{ label: leftLabel, color: leftColor }, { label: rightLabel, color: rightColor }]} />
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
          {rows.map((row) => {
            const leftValue = Number(row[leftKey] || 0);
            const rightValue = Number(row[rightKey] || 0);
            const leftHeight = Math.max((leftValue / maxValue) * chartHeight, 6);
            const rightHeight = Math.max((rightValue / maxValue) * chartHeight, 6);

            return (
              <div key={row.key} className="flex flex-col gap-2">
                <div className="flex h-56 items-end justify-center gap-3 rounded-lg bg-white px-3 pt-4">
                  <div className="flex flex-1 flex-col items-center justify-end gap-2">
                    <div className="text-center text-[10px] text-slate-500">{formatMoney(leftValue)}</div>
                    <div className="w-full rounded-t-lg" style={{ height: `${leftHeight}px`, backgroundColor: leftColor }} />
                  </div>
                  <div className="flex flex-1 flex-col items-center justify-end gap-2">
                    <div className="text-center text-[10px] text-slate-500">{formatMoney(rightValue)}</div>
                    <div className="w-full rounded-t-lg" style={{ height: `${rightHeight}px`, backgroundColor: rightColor }} />
                  </div>
                </div>
                <div className="text-center text-[11px] font-medium text-slate-600">{row.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StackedComparisonChart({ rows, revenueKey, stackSeries }) {
  if (!rows.length) {
    return <EmptyChartState message="Aucune donnee disponible pour ce graphe." />;
  }

  const totals = rows.flatMap((row) => [
    Number(row[revenueKey] || 0),
    ...stackSeries.map((series) => Number(row[series.key] || 0)),
  ]);
  const maxValue = Math.max(1, ...totals);
  const chartHeight = 220;

  return (
    <div>
      <Legend items={[{ label: 'Revenus', color: '#10b981' }, ...stackSeries.map((series) => ({ label: series.label, color: series.color }))]} />
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
          {rows.map((row) => {
            const revenueValue = Number(row[revenueKey] || 0);
            const stackValues = stackSeries.map((series) => ({
              ...series,
              value: Number(row[series.key] || 0),
            }));
            const sortieTotal = stackValues.reduce((sum, item) => sum + item.value, 0);
            const revenueHeight = Math.max((revenueValue / maxValue) * chartHeight, 6);
            const sortieHeight = Math.max((sortieTotal / maxValue) * chartHeight, 6);

            return (
              <div key={row.key} className="flex flex-col gap-2">
                <div className="flex h-56 items-end justify-center gap-4 rounded-lg bg-white px-3 pt-4">
                  <div className="flex flex-1 flex-col items-center justify-end gap-2">
                    <div className="text-center text-[10px] text-slate-500">{formatMoney(revenueValue)}</div>
                    <div className="w-full rounded-t-lg" style={{ height: `${revenueHeight}px`, backgroundColor: '#10b981' }} />
                  </div>
                  <div className="flex flex-1 flex-col items-center justify-end gap-2">
                    <div className="text-center text-[10px] text-slate-500">{formatMoney(sortieTotal)}</div>
                    <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-lg bg-slate-100" style={{ height: `${sortieHeight}px` }}>
                      {stackValues.map((series) => {
                        const segmentHeight = sortieTotal > 0 ? Math.max((series.value / sortieTotal) * sortieHeight, 1) : 0;
                        return (
                          <div
                            key={series.key}
                            title={`${series.label}: ${formatMoney(series.value)}`}
                            className="w-full"
                            style={{ height: `${segmentHeight}px`, backgroundColor: series.color }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="text-center text-[11px] font-medium text-slate-600">{row.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function LineAreaChart({ rows, dataKey, lineColor, areaColor }) {
  if (!rows.length) {
    return <EmptyChartState message="Aucune donnee disponible pour ce graphe." />;
  }

  const width = 760;
  const height = 260;
  const padding = 28;
  const values = rows.map((row) => Number(row[dataKey] || 0));
  const maxValue = Math.max(1, ...values);
  const minValue = Math.min(0, ...values);
  const range = Math.max(maxValue - minValue, 1);
  const stepX = rows.length > 1 ? (width - padding * 2) / (rows.length - 1) : 0;
  const baselineY = height - padding - ((0 - minValue) / range) * (height - padding * 2);
  const points = rows.map((row, index) => {
    const value = Number(row[dataKey] || 0);
    const x = padding + index * stepX;
    const y = height - padding - ((value - minValue) / range) * (height - padding * 2);
    return { x, y, value, label: row.label };
  });

  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${baselineY} L ${points[0].x} ${baselineY} Z`;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-72 w-full">
        {[0, 1, 2, 3, 4].map((tick) => {
          const y = padding + ((height - padding * 2) / 4) * tick;
          return (
            <line key={tick} x1={padding} y1={y} x2={width - padding} y2={y} stroke="#e2e8f0" strokeDasharray="4 4" />
          );
        })}
        <line x1={padding} y1={baselineY} x2={width - padding} y2={baselineY} stroke="#94a3b8" strokeWidth="1.5" />
        <path d={areaPath} fill={areaColor} />
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="4" fill={lineColor} />
            <text x={point.x} y={height - 8} textAnchor="middle" fontSize="11" fill="#64748b">{point.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function DoughnutChart({ values }) {
  const total = values.reduce((sum, item) => sum + Number(item.value || 0), 0);

  if (!total) {
    return <EmptyChartState message="Aucune sortie disponible pour ce graphe." />;
  }

  const slices = values.reduce((acc, item) => {
    const pct = (Number(item.value || 0) / total) * 100;
    const previousEnd = acc.length ? acc[acc.length - 1].end : 0;
    const end = previousEnd + pct;
    return [...acc, { color: item.color, start: previousEnd, end }];
  }, []).map((slice) => `${slice.color} ${slice.start}% ${slice.end}%`);

  return (
    <div className="grid h-72 place-items-center rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col items-center gap-5">
        <div
          className="grid h-44 w-44 place-items-center rounded-full"
          style={{ background: `conic-gradient(${slices.join(', ')})` }}
        >
          <div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center shadow-inner">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Sorties</p>
              <p className="text-sm font-bold text-slate-900">{formatMoney(total)}</p>
            </div>
          </div>
        </div>
        <Legend items={values.map((item) => ({ label: item.label, color: item.color }))} />
      </div>
    </div>
  );
}

function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const showLoading = usePageLoadingVisibility(loading);
  const month = searchParams.get('month') || '';

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const suffix = month ? `?month=${encodeURIComponent(month)}` : '';
        const response = await api.get(`/system/dashboard/summary${suffix}`);
        setSummary(response.data);
      } catch (err) {
        if (err.response?.status === 401) {
          localStorage.removeItem('token');
          window.location.href = '/login';
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [month]);

  const finances = summary?.finances || {};
  const timeline = summary?.timeline || [];
  const forecast = summary?.forecast || {};
  const avgSorties = timeline.length
    ? timeline.reduce((sum, item) => sum + Number(item.sorties || 0), 0) / timeline.length
    : 0;
  const activeTimeline = forecast.active || timeline[timeline.length - 1] || {};
  const forecastCompareRows = [
    {
      key: 'revenus',
      label: 'Revenus hors inscription',
      prevision: Number(forecast.totalMensuelPrevu || 0),
      reel: Number(activeTimeline.revenus_hors_inscription ?? activeTimeline.revenus ?? 0),
    },
    {
      key: 'sorties',
      label: 'Sorties',
      prevision: Number(forecast.sortieMensuellePrevue ?? avgSorties ?? 0),
      reel: Number(activeTimeline.sorties || 0),
    },
  ];
  const forecastGapRows = forecastCompareRows.map((row) => {
    const ecart = Number(row.reel || 0) - Number(row.prevision || 0);
    const base = Math.max(Number(row.prevision || 0), 1);
    return {
      ...row,
      ecart,
      ecartPct: (ecart / base) * 100,
    };
  });
  const averageDepenses6M = Number(forecast.moyenneDepenses6M || 0);
  const salairesPrevus = Number(forecast.sortieMensuelleSalaires || 0);
  const fraisInscriptionPrevus = Number(forecast.totalFraisInscriptionPrevu || 0);
  const expenseSplit = [
    { label: 'Depenses', value: Number(activeTimeline.depenses || 0), color: '#ef4444' },
    { label: 'Salaires', value: Number(activeTimeline.salaires || 0), color: '#0ea5e9' },
    { label: 'Retraits', value: Number(activeTimeline.retraits || 0), color: '#f59e0b' },
  ];
  const revenueVsSortiesRows = timeline.reduce(
    (acc, row) => {
      const previous = acc.length ? acc[acc.length - 1] : {
        revenus: Math.max(Number(finances.totalRevenus || 0) - timeline.reduce((sum, item) => sum + Number(item.revenus || 0), 0), 0),
        depenses: Math.max(Number(finances.totalDepensesDirectes || 0) - timeline.reduce((sum, item) => sum + Number(item.depenses || 0), 0), 0),
        salaires_fixes: 0,
        salaires_horaires: 0,
        retraits: 0,
      };
      const next = {
        ...row,
        revenus: Number(previous.revenus || 0) + Number(row.revenus || 0),
        depenses: Number(previous.depenses || 0) + Number(row.depenses || 0),
        salaires_fixes: Number(previous.salaires_fixes || 0) + Number(row.salaires_fixes || 0),
        salaires_horaires: Number(previous.salaires_horaires || 0) + Number(row.salaires_horaires || 0),
        retraits: Number(previous.retraits || 0) + Number(row.retraits || 0),
      };
      next.sorties_detaillees = next.depenses + next.salaires_fixes + next.salaires_horaires + next.retraits;
      return [...acc, next];
    },
    []
  );

  const financeCards = [
    {
      label: 'Total entrees',
      value: formatMoney(finances.totalRevenus || 0),
      hint: 'Encaissements cumules',
      icon: ArrowTrendingUpIcon,
      color: 'text-emerald-600',
      tone: 'bg-emerald-50/60',
    },
    {
      label: 'Total sorties',
      value: formatMoney(finances.totalDepenses || 0),
      hint: 'Charges cumulees',
      icon: ArrowTrendingDownIcon,
      color: 'text-rose-600',
      tone: 'bg-rose-50/60',
    },
    {
      label: 'Benefice net',
      value: formatMoney(finances.solde || 0),
      hint: 'Entrees moins sorties',
      icon: ChartBarIcon,
      color: 'text-sky-600',
      tone: 'bg-sky-50/60',
    },
  ];

  const overviewCards = [
    {
      label: 'Total eleves',
      value: summary?.eleves || 0,
      hint: 'Inscrits cette annee',
      icon: UserIcon,
      color: 'text-indigo-600',
    },
    {
      label: 'Total classes',
      value: summary?.classes || 0,
      hint: 'Niveaux actifs',
      icon: BuildingLibraryIcon,
      color: 'text-emerald-600',
    },
    {
      label: 'Total recettes',
      value: formatMoney(finances.totalRevenus || 0),
      hint: 'Encaissement cumule',
      icon: BanknotesIcon,
      color: 'text-sky-600',
    },
    {
      label: 'Reste a couvrir',
      value: formatMoney(forecast.totalResteCumule || 0),
      hint: 'Prevision moins encaissement',
      icon: PresentationChartLineIcon,
      color: 'text-rose-600',
    },
  ];

  const revenueForecastCards = [
    {
      label: 'Mensualites prevues',
      value: formatMoney(forecast.totalMensuelPrevu || 0),
      hint: 'Base mensuelle',
      icon: BanknotesIcon,
      color: 'text-indigo-600',
    },
    {
      label: 'Total previsionnel global',
      value: formatMoney(forecast.totalCumulePrevu || 0),
      hint: 'Mensualites + inscriptions',
      icon: PresentationChartLineIcon,
      color: 'text-emerald-600',
    },
    {
      label: 'Frais inscription prevus',
      value: formatMoney(fraisInscriptionPrevus),
      hint: 'Recettes d\'inscription',
      icon: BanknotesIcon,
      color: 'text-amber-600',
    },
  ];

  if (showLoading) {
    return <PageLoadingState title="Chargement du tableau de bord" message="Les indicateurs de pilotage sont en cours de preparation." />;
  }

  return (
    <div className="app-page space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        {financeCards.map((card, idx) => (
          <MetricCard key={card.label} {...card} className={`surface-card ${getAnimationCascadeClass(idx)}`} />
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {overviewCards.map((card, idx) => (
          <MetricCard key={card.label} {...card} className={`surface-card ${getAnimationCascadeClass(idx)}`} />
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {revenueForecastCards.map((card, idx) => (
          <MetricCard
            key={card.label}
            {...card}
            className={`surface-card border border-indigo-100 bg-gradient-to-br from-white to-slate-50 ${getAnimationCascadeClass(idx)}`}
          />
        ))}
      </section>

      {summary?.subscriptionStatus ? (
        <section
          className={`rounded-2xl border p-4 shadow-sm ${
            summary.subscriptionStatus.accessBlocked
              ? 'border-rose-200 bg-rose-50'
              : summary.subscriptionStatus.status === 'active'
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-amber-200 bg-amber-50'
          }`}
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${
                summary.subscriptionStatus.accessBlocked
                  ? 'text-rose-700'
                  : summary.subscriptionStatus.status === 'active'
                    ? 'text-emerald-700'
                    : 'text-amber-700'
              }`}>
                Abonnement
              </p>
              <p className="mt-2 text-sm text-slate-700">
                Statut: <strong>{formatSubscriptionBadge(summary.subscriptionStatus) || 'inconnu'}</strong>
                {summary.subscriptionStatus.planName ? <> - Plan: <strong>{summary.subscriptionStatus.planName}</strong></> : null}
                {summary.subscriptionStatus.expiresAt ? <> - Fin: <strong>{formatDate(summary.subscriptionStatus.expiresAt)}</strong></> : null}
              </p>
              <p className="mt-2 text-sm font-medium text-slate-700">{summary.subscriptionStatus.message}</p>
            </div>
            <div className="grid gap-2 text-sm text-slate-700 md:min-w-[220px]">
              {summary.subscriptionStatus.status === 'pending' ? (
                <div className="rounded-xl bg-white/70 px-3 py-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Delai restant</p>
                  <p className="font-semibold text-slate-900">
                    {summary.subscriptionStatus.daysUntilCutoff !== null ? `${summary.subscriptionStatus.daysUntilCutoff} jour(s)` : '-'}
                  </p>
                </div>
              ) : null}
              {summary.subscriptionStatus.status === 'active' ? (
                <div className="rounded-xl bg-white/70 px-3 py-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Reste a courir</p>
                  <p className="font-semibold text-slate-900">
                    {formatSubscriptionRemaining(summary.subscriptionStatus)}
                  </p>
                </div>
              ) : null}
              {summary.subscriptionStatus.graceEndsAt ? (
                <div className="rounded-xl bg-white/70 px-3 py-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Echeance</p>
                  <p className="font-semibold text-slate-900">{formatDate(summary.subscriptionStatus.graceEndsAt)}</p>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="surface-card rounded-2xl p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Choisir le mois pour les graphes</label>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={summary?.activeMonth || ''}
              onChange={(event) => setSearchParams(event.target.value ? { month: event.target.value } : {})}
            >
              {(summary?.monthOptions || []).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setSearchParams(summary?.activeMonth ? { month: summary.activeMonth } : {})}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 md:self-end"
          >
            Actualiser graphes
          </button>
        </div>
      </section>

      <section className="grid gap-6">
        <Panel title="Revenus vs sorties detaillees (6 derniers mois)" badge="Detail">
          <StackedComparisonChart
            rows={revenueVsSortiesRows}
            revenueKey="revenus"
            stackSeries={[
              { key: 'depenses', label: 'Depenses', color: '#ef4444' },
              { key: 'salaires_fixes', label: 'Salaires fixes', color: '#0ea5e9' },
              { key: 'salaires_horaires', label: 'Salaires horaires', color: '#6366f1' },
              { key: 'retraits', label: 'Retraits', color: '#f59e0b' },
            ]}
          />
        </Panel>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Panel title="Ecart prevision vs reel (mois actif)" badge="Barres">
          <div className="mb-4 grid gap-3 md:grid-cols-2">
            {forecastGapRows.map((row) => (
              <div key={row.key} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{row.label}</p>
                <p className="mt-2 text-lg font-bold text-slate-900">
                  {formatSignedMoney(row.ecart)}
                </p>
                <p className={`mt-1 text-xs ${row.ecart >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {row.ecart >= 0 ? 'Au-dessus' : 'En dessous'} de la prévision de {Math.abs(row.ecartPct).toFixed(1)}%
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Prévision: {formatMoney(row.prevision)} · Réel: {formatMoney(row.reel)}
                </p>
              </div>
            ))}
          </div>
          <GroupedBarChart
            rows={forecastCompareRows}
            leftKey="prevision"
            rightKey="reel"
            leftLabel="Prevision"
            rightLabel="Reel"
            leftColor="#3b82f6"
            rightColor="#6366f1"
          />
        </Panel>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Panel title="Evolution du solde mensuel" badge="Courbe">
          <LineAreaChart rows={timeline} dataKey="solde" lineColor="#0ea5e9" areaColor="rgba(14,165,233,0.18)" />
        </Panel>

        <Panel title="Structure des sorties (mois actif)" badge="Doughnut">
          <DoughnutChart values={expenseSplit} />
        </Panel>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Panel title="Repere annee scolaire">
          <p className="mt-2 text-sm text-slate-600">
            Date de rentree: <strong>{forecast.startDate || '-'}</strong>
            {' '} - Mois ecoules: <strong>{forecast.moisEcoules || 0}</strong>
          </p>
          <p className="mt-1 text-xs text-slate-500">Mois du graphe: <strong>{summary?.activeMonth || '-'}</strong></p>
          <p className="mt-3 text-xs text-slate-500">
            Potentiel mensuel: <strong>{formatMoney(forecast.totalMensuelPrevu || 0)}</strong>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Sortie mensuelle prevue: <strong>{formatMoney(forecast.sortieMensuellePrevue || 0)}</strong>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Salaires prevus: <strong>{formatMoney(salairesPrevus)}</strong>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Moyenne des depenses sur 6 mois: <strong>{formatMoney(averageDepenses6M)}</strong>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Prevision cumulee: <strong>{formatMoney(forecast.totalCumulePrevu || 0)}</strong> - Encaisse: <strong>{formatMoney(forecast.totalPayeCumule || 0)}</strong>
          </p>
        </Panel>

        <Panel title="Actions rapides">
          <div className="mt-4 space-y-2">
            <a href="/eleves/ajouter" className="block rounded-md bg-indigo-600 px-4 py-2 text-center text-white hover:bg-indigo-700">Inscrire un eleve</a>
            <a href="/classes" className="block rounded-md bg-slate-700 px-4 py-2 text-center text-white hover:bg-slate-800">Ajouter une classe</a>
            <a href="/finances" className="block rounded-md bg-slate-700 px-4 py-2 text-center text-white hover:bg-slate-800">Ouvrir finances</a>
          </div>
        </Panel>
      </section>

      <section className="surface-card rounded-2xl p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Classes recentes</h2>
          <a href="/classes" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">Voir toutes</a>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-2 text-left">Nom</th>
                <th className="px-3 py-2 text-left">Cycle</th>
                <th className="px-3 py-2 text-left">Niveau</th>
                <th className="px-3 py-2 text-left">Annee</th>
                <th className="px-3 py-2 text-left">Mensualite</th>
                <th className="px-3 py-2 text-left">Frais inscription</th>
                <th className="px-3 py-2 text-left">Effectif</th>
                <th className="px-3 py-2 text-left">Effectif max</th>
              </tr>
            </thead>
            <tbody>
              {(summary?.recentClasses || []).map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-medium text-slate-800">{row.name}</td>
                  <td className="px-3 py-2">{row.cycle || '-'}</td>
                  <td className="px-3 py-2">{row.niveau || '-'}</td>
                  <td className="px-3 py-2">{row.annee || '-'}</td>
                  <td className="px-3 py-2">{formatMoney(row.mensualite || 0)}</td>
                  <td className="px-3 py-2">{formatMoney(row.frais_inscription || 0)}</td>
                  <td className="px-3 py-2">{row.effectif || 0}</td>
                  <td className="px-3 py-2">{row.max_effectif || 0}</td>
                </tr>
              ))}
              {!(summary?.recentClasses || []).length ? (
                <tr>
                  <td colSpan="8" className="px-3 py-6 text-center text-slate-500">Aucune classe enregistree.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default Dashboard;
