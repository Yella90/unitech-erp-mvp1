import { useEffect, useMemo, useState } from 'react';
import api from '../services/api';
import { PageBanner, PageErrorState, PageLoadingState, usePageLoadingVisibility } from '../components/PageState';
import { ClockIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('fr-FR');
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('fr-FR');
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('fr-FR')} FCFA`;
}

function parseDateOnly(value) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function addMonths(date, months) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const next = new Date(date);
  next.setMonth(next.getMonth() + Number(months || 0));
  return next;
}

function differenceInCalendarMonths(from, to) {
  if (!(from instanceof Date) || !(to instanceof Date)) return 0;
  let diff = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) diff -= 1;
  return diff;
}

function formatRemainingSubscription(school) {
  const status = String(school.subscription_status || '').toLowerCase();
  if (status !== 'active') return '-';

  const expiresAt = parseDateOnly(school.subscription_expires_at);
  if (!expiresAt) return '-';

  const today = parseDateOnly(new Date().toISOString().slice(0, 10));
  if (!today) return '-';

  const remainingMs = expiresAt.getTime() - today.getTime();
  if (remainingMs <= 0) return 'Expiré';

  const daysRemaining = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  const monthsRemaining = Math.max(0, differenceInCalendarMonths(today, expiresAt));

  if (monthsRemaining > 0) {
    const monthAnchor = addMonths(today, monthsRemaining);
    const extraDays = monthAnchor
      ? Math.max(0, Math.ceil((expiresAt.getTime() - monthAnchor.getTime()) / (24 * 60 * 60 * 1000)))
      : 0;
    return extraDays > 0
      ? `${monthsRemaining} mois et ${extraDays} jour(s)`
      : `${monthsRemaining} mois`;
  }

  return `${Math.max(1, daysRemaining)} jour(s)`;
}

function getRemainingDays(school) {
  const status = String(school.subscription_status || '').toLowerCase();
  if (status !== 'active') return null;

  const expiresAt = parseDateOnly(school.subscription_expires_at);
  if (!expiresAt) return null;

  const today = parseDateOnly(new Date().toISOString().slice(0, 10));
  if (!today) return null;

  return Math.max(0, Math.ceil((expiresAt.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)));
}

function getSubscriptionStatusTone(status) {
  if (status === 'active') return 'bg-emerald-100 text-emerald-800 ring-emerald-200';
  if (status === 'pending') return 'bg-amber-100 text-amber-800 ring-amber-200';
  if (status === 'suspended') return 'bg-rose-100 text-rose-800 ring-rose-200';
  return 'bg-slate-100 text-slate-700 ring-slate-200';
}

function getRemainingTone(status) {
  if (status === 'active') return 'bg-sky-100 text-sky-800 ring-sky-200';
  if (status === 'pending') return 'bg-amber-50 text-amber-700 ring-amber-100';
  if (status === 'suspended') return 'bg-rose-50 text-rose-700 ring-rose-100';
  return 'bg-slate-50 text-slate-600 ring-slate-200';
}

function getRemainingIcon(school) {
  const daysRemaining = getRemainingDays(school);
  if (daysRemaining === null) {
    return ClockIcon;
  }
  if (daysRemaining <= 7) {
    return ExclamationTriangleIcon;
  }
  return ClockIcon;
}

function SuperAdmin() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submittingKey, setSubmittingKey] = useState('');
  const [schoolActions, setSchoolActions] = useState({});
  const showLoading = usePageLoadingVisibility(loading);

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/superadmin/dashboard');
      setData(response.data);
      const initialActions = {};
      (response.data?.schools || []).forEach((school) => {
        initialActions[school.id] = {
          plan_code: school.subscription_plan || school.plan || 'basic',
          billing_cycle: school.billing_cycle || school.billing || 'monthly',
        };
      });
      setSchoolActions(initialActions);
    } catch (err) {
      console.error('Erreur chargement super admin:', err);
      setError(err?.response?.data?.error || 'Impossible de charger le dashboard super admin.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const stats = useMemo(() => {
    const source = data?.stats || {};
    return [
      { label: 'Total ecoles', value: source.totalSchools || 0, tone: 'text-[#1E3A8A]' },
      { label: 'Revenus mensuels', value: formatMoney(source.saasRevenue), tone: 'text-[#1E3A8A]' },
      { label: 'Abonnements actifs', value: source.activeSubscriptions || 0, tone: 'text-emerald-600' },
      { label: 'Abonnements expires', value: source.expiredSubscriptions || 0, tone: 'text-rose-600' },
      { label: 'En attente', value: source.pendingSubscriptions || 0, tone: 'text-amber-600' },
    ];
  }, [data]);

  const executeAction = async ({ key, request, successMessage }) => {
    setSubmittingKey(key);
    setError('');
    setSuccess('');
    try {
      await request();
      setSuccess(successMessage);
      await loadDashboard();
    } catch (err) {
      console.error('Erreur action super admin:', err);
      setError(err?.response?.data?.error || "L'action a echoue.");
    } finally {
      setSubmittingKey('');
    }
  };

  if (showLoading) {
    return <PageLoadingState title="Chargement super admin" message="Les abonnements et etablissements sont en cours de chargement." />;
  }

  if (error && !data) {
    return (
      <PageErrorState
        title="Dashboard super admin indisponible"
        message={error}
        action={(
          <button
            type="button"
            onClick={loadDashboard}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Reessayer
          </button>
        )}
      />
    );
  }

  return (
    <section className="space-y-6">
      <PageBanner tone="success" title={success ? 'Operation reussie' : ''} message={success} />
      <PageBanner tone="error" title={error && data ? 'Action impossible' : ''} message={data ? error : ''} />

      <section className="rounded-xl bg-white p-5 shadow-lg">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#1E3A8A]">UNITECH ERP</p>
        <h1 className="mt-2 text-2xl font-bold">Dashboard Super Admin</h1>
        <p className="mt-2 text-sm text-slate-600">Gestion des abonnements, des etablissements et des actions critiques de la plateforme.</p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {stats.map((item) => (
          <div key={item.label} className="rounded-xl bg-white p-4 shadow-lg">
            <p className="text-xs uppercase tracking-wider text-slate-500">{item.label}</p>
            <p className={`mt-1 text-3xl font-bold ${item.tone}`}>{item.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl bg-white p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Abonnements en attente</h2>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
            {data?.stats?.pendingSubscriptions || 0} en attente
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="px-3 py-2 text-left">Ecole</th>
                <th className="px-3 py-2 text-left">Plan</th>
                <th className="px-3 py-2 text-left">Montant</th>
                <th className="px-3 py-2 text-left">Cycle</th>
                <th className="px-3 py-2 text-left">Cree le</th>
                <th className="px-3 py-2 text-left">Action</th>
              </tr>
            </thead>
            <tbody>
              {(data?.pendingSubscriptions || []).map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="px-3 py-2">{row.school_name}</td>
                  <td className="px-3 py-2">{row.plan_name || row.plan_code}</td>
                  <td className="px-3 py-2">{formatMoney(row.amount)}</td>
                  <td className="px-3 py-2">{row.billing_cycle === 'annual' ? 'annuel' : 'mensuel'}</td>
                  <td className="px-3 py-2">{formatDateTime(row.created_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={submittingKey === `validate-${row.id}`}
                        onClick={() => executeAction({
                          key: `validate-${row.id}`,
                          request: () => api.post(`/superadmin/subscriptions/${row.id}/validate`),
                          successMessage: 'Abonnement valide.',
                        })}
                        className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        Valider abonnement
                      </button>
                      <button
                        type="button"
                        disabled={submittingKey === `suspend-pending-${row.id}`}
                        onClick={() => executeAction({
                          key: `suspend-pending-${row.id}`,
                          request: () => api.post(`/superadmin/subscriptions/${row.id}/suspend`),
                          successMessage: 'Abonnement suspendu.',
                        })}
                        className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        Suspendre abonnement
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!(data?.pendingSubscriptions || []).length ? (
                <tr>
                  <td colSpan="6" className="px-3 py-3 text-slate-500">Aucun abonnement en attente.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl bg-white p-5 shadow-lg">
        <h2 className="mb-3 text-lg font-semibold">Gestion etablissements</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="px-3 py-2 text-left">Ecole</th>
                <th className="px-3 py-2 text-left">Plan</th>
                <th className="px-3 py-2 text-left">Abonnement</th>
                <th className="px-3 py-2 text-left">Expire le</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.schools || []).map((school) => {
                const status = String(school.subscription_status || '').toLowerCase();
                const state = schoolActions[school.id] || {
                  plan_code: school.subscription_plan || school.plan || 'basic',
                  billing_cycle: school.billing_cycle || school.billing || 'monthly',
                };

                return (
                  <tr key={school.id} className="border-b border-slate-100 align-top">
                    <td className="px-3 py-2">
                      <p className="font-semibold">{school.name}</p>
                      <p className="text-xs text-slate-500">{school.email}</p>
                    </td>
                    <td className="px-3 py-2">{school.plan_name || school.subscription_plan || school.plan || '-'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-2">
                        <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${getSubscriptionStatusTone(status)}`}>
                          {status || '-'}
                        </span>
                        <span className={`inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${getRemainingTone(status)}`}>
                          {(() => {
                            const RemainingIcon = getRemainingIcon(school);
                            return <RemainingIcon className="h-3.5 w-3.5" aria-hidden="true" />;
                          })()}
                          {formatRemainingSubscription(school)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">{formatDate(school.subscription_expires_at)}</td>
                    <td className="px-3 py-2 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {Number(school.is_active) === 1 ? (
                          <button
                            type="button"
                            disabled={submittingKey === `deactivate-school-${school.id}`}
                            onClick={() => executeAction({
                              key: `deactivate-school-${school.id}`,
                              request: () => api.post(`/superadmin/schools/${school.id}/deactivate`),
                              successMessage: 'Ecole suspendue.',
                            })}
                            className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                          >
                            Suspendre ecole
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={submittingKey === `activate-school-${school.id}`}
                            onClick={() => executeAction({
                              key: `activate-school-${school.id}`,
                              request: () => api.post(`/superadmin/schools/${school.id}/activate`),
                              successMessage: 'Ecole activee.',
                            })}
                            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                          >
                            Activer ecole
                          </button>
                        )}

                        {school.subscription_id ? (
                          status === 'suspended' ? (
                            <button
                              type="button"
                              disabled={submittingKey === `activate-sub-${school.subscription_id}`}
                              onClick={() => executeAction({
                                key: `activate-sub-${school.subscription_id}`,
                                request: () => api.post(`/superadmin/subscriptions/${school.subscription_id}/activate`),
                                successMessage: 'Abonnement reactive.',
                              })}
                              className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              Reactiver abonnement
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={submittingKey === `suspend-sub-${school.subscription_id}`}
                              onClick={() => executeAction({
                                key: `suspend-sub-${school.subscription_id}`,
                                request: () => api.post(`/superadmin/subscriptions/${school.subscription_id}/suspend`),
                                successMessage: 'Abonnement suspendu.',
                              })}
                              className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                            >
                              Suspendre abonnement
                            </button>
                          )
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <select
                          value={state.plan_code}
                          onChange={(event) => setSchoolActions((prev) => ({
                            ...prev,
                            [school.id]: { ...prev[school.id], plan_code: event.target.value },
                          }))}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                        >
                          {(data?.plans || []).map((plan) => (
                            <option key={plan.code} value={plan.code}>
                              {plan.name} - {formatMoney(plan.price_monthly)}/mois - {formatMoney(plan.price_annual)}/an
                            </option>
                          ))}
                        </select>
                        <select
                          value={state.billing_cycle}
                          onChange={(event) => setSchoolActions((prev) => ({
                            ...prev,
                            [school.id]: { ...prev[school.id], billing_cycle: event.target.value },
                          }))}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                        >
                          <option value="monthly">mensuel</option>
                          <option value="annual">annuel</option>
                        </select>
                        <button
                          type="button"
                          disabled={submittingKey === `plan-${school.id}`}
                          onClick={() => executeAction({
                            key: `plan-${school.id}`,
                            request: () => api.post(`/superadmin/schools/${school.id}/plan`, state),
                            successMessage: 'Plan modifie avec succes.',
                          })}
                          className="rounded-lg bg-[#1E3A8A] px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          Modifier plan
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl bg-white p-5 shadow-lg">
        <h2 className="mb-3 text-lg font-semibold">Logs activites</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Action</th>
                <th className="px-3 py-2 text-left">Ecole</th>
                <th className="px-3 py-2 text-left">Acteur</th>
                <th className="px-3 py-2 text-left">Details</th>
              </tr>
            </thead>
            <tbody>
              {(data?.logs || []).map((log) => (
                <tr key={log.id} className="border-b border-slate-100">
                  <td className="px-3 py-2">{formatDateTime(log.created_at)}</td>
                  <td className="px-3 py-2">{log.action}</td>
                  <td className="px-3 py-2">{log.school_name || '-'}</td>
                  <td className="px-3 py-2">{log.actor_name || 'systeme'}</td>
                  <td className="px-3 py-2">{log.details || '-'}</td>
                </tr>
              ))}
              {!(data?.logs || []).length ? (
                <tr>
                  <td colSpan="5" className="px-3 py-3 text-slate-500">Aucun log disponible.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

export default SuperAdmin;
