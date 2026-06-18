import { useEffect, useState } from 'react';
import api from '../services/api';
import { PageBanner, PageErrorState, PageLoadingState, usePageLoadingVisibility } from '../components/PageState';
import SearchableSelect from '../components/SearchableSelect';

const initialForm = { eleve_id: '', transfer_type: 'internal', to_school_id: '', to_classe_id: '', reason: '' };

function Transferts() {
  const currentSchoolId = Number(localStorage.getItem('schoolId') || 0);
  const [rows, setRows] = useState([]);
  const [eleves, setEleves] = useState([]);
  const [classes, setClasses] = useState([]);
  const [schools, setSchools] = useState([]);
  const [formData, setFormData] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const showLoading = usePageLoadingVisibility(loading);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [transfersResponse, elevesResponse, currentClassesResponse, transferOptionsResponse] = await Promise.all([
        api.get('/system/transferts'),
        api.get('/eleves'),
        api.get('/classes'),
        api.get('/system/transferts/options'),
      ]);
      setRows(transfersResponse.data || []);
      setEleves(elevesResponse.data || []);
      const currentClasses = (currentClassesResponse.data || []).map((item) => ({ ...item, school_name: null }));
      const externalClasses = transferOptionsResponse.data?.classes || [];
      setClasses([...currentClasses, ...externalClasses]);
      setSchools(transferOptionsResponse.data?.schools || []);
    } catch (err) {
      setError('Impossible de charger les transferts.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {  load(); }, []);

  const availableClasses = classes.filter((item) => {
    if (formData.transfer_type === 'external') {
      return Number(item.school_id) === Number(formData.to_school_id || 0);
    }
    return !item.school_name;
  });

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await api.post('/system/transferts', formData);
      setFormData(initialForm);
      await load();
      setSuccess('Demande de transfert envoyee avec succes.');
    } catch (err) {
      setError(err.response?.data?.error || "Erreur lors de l'envoi de la demande.");
    }
  }

  async function handleStatus(id, status) {
    try {
      setError('');
      setSuccess('');
       if (!formData.eleve_id) {
    setError('Veuillez selectionner un eleve.');
    return;
  }
  if (formData.transfer_type === 'external' && !formData.to_school_id) {
    setError("Veuillez selectionner l'etablissement cible.");
    return;
  }
  if (formData.transfer_type === 'internal' && !formData.to_classe_id) {
    setError('Veuillez selectionner la classe cible.');
    return;
  }
      await api.patch(`/system/transferts/${id}/status`, { status });
      await load();
      setSuccess(`Demande ${status === 'accepted' ? 'acceptee' : 'rejetee'} avec succes.`);
    } catch (err) {
      setError('Erreur lors de la mise a jour du transfert.');
    }
  }

  if (showLoading) {
    return <PageLoadingState title="Chargement des transferts" message="Les demandes de transfert sont en cours de chargement." />;
  }

  if (error && rows.length === 0) {
    return (
      <PageErrorState
        title="Transferts indisponibles"
        message={error}
        action={
          <button type="button" onClick={load} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            Reessayer
          </button>
        }
      />
    );
  }

  return (
    <section className="space-y-5">
      <PageBanner tone="success" title={success ? 'Operation reussie' : ''} message={success} />
      <PageBanner tone="error" title={error && rows.length > 0 ? 'Action impossible' : ''} message={rows.length > 0 ? error : ''} />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
          <p className="text-sm text-slate-500">Demandes recues</p>
          <p className="mt-3 text-3xl font-semibold text-slate-900">{rows.length}</p>
        </div>
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
          <p className="text-sm text-slate-500">Demandes validees</p>
          <p className="mt-3 text-3xl font-semibold text-slate-900">{rows.filter((item) => item.status === 'accepted').length}</p>
        </div>
        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm">
          <p className="text-sm text-slate-500">En attente</p>
          <p className="mt-3 text-3xl font-semibold text-slate-900">{rows.filter((item) => item.status === 'pending').length}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
        <form onSubmit={handleSubmit} className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm space-y-3">
          <h2 className="text-base font-semibold">Nouvelle demande</h2>
          <SearchableSelect
            value={formData.eleve_id}
            onChange={(nextValue) => setFormData((prev) => ({ ...prev, eleve_id: nextValue }))}
            placeholder="Rechercher un eleve"
            emptyLabel="Aucun eleve trouve"
            options={eleves.map((item) => ({
              value: item.id,
              label: `${item.nom} ${item.prenom}`,
              keywords: `${item.matricule || ''} ${item.nom || ''} ${item.prenom || ''}`,
            }))}
          />
          <select
            className="w-full rounded-md border border-slate-300 px-3 py-2"
            value={formData.transfer_type}
            onChange={(e) => setFormData((prev) => ({ ...prev, transfer_type: e.target.value, to_school_id: '', to_classe_id: '' }))}
          >
            <option value="internal">Transfert interne</option>
            <option value="external">Transfert vers un autre etablissement</option>
          </select>
          {formData.transfer_type === 'external' ? (
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              value={formData.to_school_id}
              onChange={(e) => setFormData((prev) => ({ ...prev, to_school_id: e.target.value, to_classe_id: '' }))}
            >
              <option value="">Selectionner l'etablissement cible</option>
              {schools.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          ) : null}
          <select className="w-full rounded-md border border-slate-300 px-3 py-2" value={formData.to_classe_id} onChange={(e) => setFormData((prev) => ({ ...prev, to_classe_id: e.target.value }))}>
            <option value="">{formData.transfer_type === 'external' ? 'Selectionner la classe cible (optionnel)' : 'Selectionner la classe cible'}</option>
            {availableClasses.map((item) => <option key={item.id} value={item.id}>{item.school_name ? `${item.name} - ${item.school_name}` : item.name}</option>)}
          </select>
          <textarea className="w-full rounded-md border border-slate-300 px-3 py-2" rows={3} placeholder="Motif du transfert" value={formData.reason} onChange={(e) => setFormData((prev) => ({ ...prev, reason: e.target.value }))} />
          <button className="w-full rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700">Envoyer</button>
        </form>

        <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm overflow-x-auto">
          <h2 className="text-base font-semibold">Demandes de transfert</h2>
          <table className="w-full min-w-[760px] mt-4 border-collapse text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left">Eleve</th>
                <th className="px-4 py-3 text-left">De</th>
                <th className="px-4 py-3 text-left">Vers</th>
                <th className="px-4 py-3 text-left">Etablissement cible</th>
                <th className="px-4 py-3 text-left">Statut</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3">{item.nom} {item.prenom}</td>
                  <td className="px-4 py-3">{item.from_classe || '-'}</td>
                  <td className="px-4 py-3">{item.to_classe || '-'}</td>
                  <td className="px-4 py-3">{item.to_school_name || item.from_school_name || '-'}</td>
                  <td className="px-4 py-3">{item.status}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {item.status !== 'pending' ? (
    <span className="text-xs text-slate-400 capitalize">{item.status}</span>
  ) : item.transfer_type !== 'external' || Number(item.to_school_id || 0) === currentSchoolId ? (
    <>
      <button className="rounded-md bg-emerald-600 px-3 py-1 text-xs text-white" onClick={() => handleStatus(item.id, 'accepted')}>Accepter</button>
      <button className="rounded-md bg-amber-600 px-3 py-1 text-xs text-white" onClick={() => handleStatus(item.id, 'rejected')}>Rejeter</button>
    </>
  ) : (
    <span className="text-xs text-slate-400">En attente de l'etablissement cible</span>
  )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default Transferts;
