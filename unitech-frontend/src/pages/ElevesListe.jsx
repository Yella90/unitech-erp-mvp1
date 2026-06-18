import { NavLink } from 'react-router-dom';
import { useEffect, useState, useMemo } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import api from '../services/api';
import { PageBanner, PageErrorState, PageLoadingState, usePageLoadingVisibility } from '../components/PageState';
import { RippleButton } from '../components/RippleButton';
import { getAnimationCascadeClass } from '../utils/animations';
import { renderBulletinPdfPage } from '../utils/bulletinPdf';
import { normalizeRole } from '../utils/roles.js';
import { downloadXlsx } from '../utils/xlsx.js';

const getClasseName = (classeId, classes) => {
  const classe = classes.find((item) => String(item.id) === String(classeId));
  return classe ? classe.name : 'Classe non trouvee';
};

const initialFilters = {
  matricule: '',
  classe: '',
  matiere: '',
};

const initialDeleteState = {
  open: false,
  eleve: null,
};

const EXPORT_FORMATS = [
  { value: 'pdf', label: 'PDF' },
  { value: 'excel', label: 'Excel' },
  { value: 'csv', label: 'CSV' },
];

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('fr-FR');
}

function displayMoney(value) {
  return `${Number(value || 0).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} F`;
}

function sanitizeFileName(value) {
  return String(value || 'fiche-eleve')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function computeAge(dateValue) {
  if (!dateValue) return '-';
  const birth = new Date(dateValue);
  if (Number.isNaN(birth.getTime())) return '-';
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hasBirthdayPassed =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());

  if (!hasBirthdayPassed) age -= 1;
  return age >= 0 ? `${age} ans` : '-';
}

function monthStart(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function countMonthsBetweenInclusive(startDateLike, endDateLike) {
  const start = monthStart(startDateLike);
  const end = monthStart(endDateLike);
  if (!start || !end || start > end) return 0;
  return ((end.getFullYear() - start.getFullYear()) * 12) + (end.getMonth() - start.getMonth()) + 1;
}

function resolveEffectiveStartDate(dateInscription, schoolStartDate) {
  const candidates = [schoolStartDate, dateInscription]
    .map((value) => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    })
    .filter(Boolean);

  if (!candidates.length) {
    return new Date();
  }

  return candidates.reduce((latest, current) => (current > latest ? current : latest));
}

function computePaymentSummary(eleve, classes, paiements, schoolStartDate) {
  const classe = classes.find((item) => String(item.id) === String(eleve?.classe_actuelle_id));
  const mensualite = Number(classe?.mensualite || 0);
  const reduction = Number(eleve?.reduction || 0);
  const elevePaiements = (paiements || []).filter((item) => String(item.eleve_id) === String(eleve?.id));
  const totalVerse = elevePaiements.reduce((sum, item) => sum + Number(item.montant || 0), 0);
  const totalVerseHorsInscription = elevePaiements
    .filter((item) => String(item.mois || '').trim().toLowerCase() !== 'inscription')
    .reduce((sum, item) => sum + Number(item.montant || 0), 0);
  const dateDebut = resolveEffectiveStartDate(eleve?.date_inscription || eleve?.created_at, schoolStartDate);
  const moisDus = countMonthsBetweenInclusive(dateDebut, new Date());
  const totalMensualitesDues = mensualite * moisDus;
  const totalMensualitesNettes = Math.max(totalMensualitesDues - reduction, 0);
  const resteAPayer = Math.max(totalMensualitesNettes - totalVerseHorsInscription, 0);
  const moisCouverts = mensualite > 0 ? Math.floor(totalVerseHorsInscription / mensualite) : 0;
  const etatPaiement =
    totalMensualitesNettes <= 0
      ? 'paye'
      : totalVerseHorsInscription <= 0
        ? 'non paye'
        : resteAPayer > 0
          ? 'partiel'
          : 'paye';

  return {
    mensualite,
    reduction,
    totalVerse,
    totalVerseHorsInscription,
    moisDus,
    totalMensualitesDues,
    totalMensualitesNettes,
    resteAPayer,
    moisCouverts,
    etatPaiement,
  };
}

function formatPaymentStatusLabel(paymentSummary) {
  const status = String(paymentSummary?.etatPaiement || '').trim().toLowerCase();
  const remaining = displayMoney(paymentSummary?.resteAPayer || 0);

  if (status === 'non paye') return `Non paye - reste a payer: ${remaining}`;
  if (status === 'partiel') return `Partiel - reste a payer: ${remaining}`;
  if (status === 'paye') return 'Paye';
  return paymentSummary?.etatPaiement || '-';
}

const DEACTIVATION_REASONS = [
  { value: 'abandon', label: 'Abandon' },
  { value: 'renvoi', label: 'Renvoi' },
  { value: 'maladie', label: 'Maladie' },
  { value: 'situation familiale', label: 'Situation familiale' },
  { value: 'autre', label: 'Autre motif' },
];

const formatStudentStatus = (eleve) => {
  const statut = String(eleve?.statut || 'actif').toLowerCase();
  const motif = String(eleve?.motif_statut || '').trim();

  if (statut === 'exclu' && motif) {
    return `Desactive (${motif})`;
  }

  if (statut === 'actif') return 'Actif';
  if (statut === 'transfere') return 'Transfere';
  if (statut === 'exclu') return 'Desactive';
  if (statut === 'diplome') return 'Diplome';
  return eleve?.statut || 'Actif';
};

function toLower(value) {
  return String(value || '').trim().toLowerCase();
}

export default function ElevesListe() {
  const [eleves, setEleves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pageSuccess, setPageSuccess] = useState('');
  const [classes, setClasses] = useState([]);
  const [matieres, setMatieres] = useState([]);
  const [affectations, setAffectations] = useState([]);
  const [paiements, setPaiements] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [deleteState, setDeleteState] = useState(initialDeleteState);
  const [deletePassword, setDeletePassword] = useState('');
  const [deactivationReason, setDeactivationReason] = useState('abandon');
  const [deactivationReasonDetails, setDeactivationReasonDetails] = useState('');
  const [deactivatingId, setDeactivatingId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [schoolInfo, setSchoolInfo] = useState(null);
  const [dashboardContext, setDashboardContext] = useState(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [generationProgress] = useState({ running: false, current: 0, total: 0, message: '' });
  const [exportingList, setExportingList] = useState(false);
  const [selectedExportFormat, setSelectedExportFormat] = useState('pdf');
  const [ocrNoteType, setOcrNoteType] = useState('devoir');
  const [ocrTrimestre, setOcrTrimestre] = useState('1');
  const showLoading = usePageLoadingVisibility(loading);
  const currentRole = normalizeRole(currentUser?.role || localStorage.getItem('role'));
  const canExportStudents = ['directeur', 'promoteur', 'comptable', 'secretaire'].includes(currentRole) || ['super@admin', 'superadmin'].includes(currentRole);

  const selectedClasseId = String(filters.classe || '').trim();

  const availableMatieresForClasse = useMemo(() => {
    const source = selectedClasseId
      ? affectations.filter((item) => String(item.classe_id) === selectedClasseId)
      : affectations;
    const matiereNames = source
      .map((item) => item.nom_matiere || item.nom || item.matiere || '')
      .filter(Boolean);

    if (!matiereNames.length) {
      return [...new Set(matieres.map((item) => item.nom || item.name || item.matiere || '').filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'fr'))
        .map((name) => ({ id: name, nom: name }));
    }

    return [...new Set(matiereNames)]
      .sort((a, b) => a.localeCompare(b, 'fr'))
      .map((name) => ({ id: name, nom: name }));
  }, [affectations, selectedClasseId, matieres]);

  const filteredEleves = useMemo(() => {
    const search = toLower(filters.matricule);
    const matiereFilter = String(filters.matiere || '').trim();

    return eleves.filter((eleve) => {
      const fullName = `${eleve.nom || ''} ${eleve.prenom || ''}`.trim();
      const eleveClasseId = String(eleve.classe_actuelle_id || '').trim();
      const matchesSearch =
        !search ||
        toLower(eleve.matricule).includes(search) ||
        toLower(fullName).includes(search);
      const matchesClass = !selectedClasseId || eleveClasseId === selectedClasseId;
      const matchesSubject =
        !matiereFilter ||
        affectations.some(
          (item) =>
            String(item.classe_id) === eleveClasseId &&
            String(item.nom_matiere || item.nom || item.matiere || '') === matiereFilter
        );
      return matchesSearch && matchesClass && matchesSubject;
    });
  }, [affectations, eleves, filters.matiere, filters.matricule, selectedClasseId]);

  useEffect(() => {
    const fetchPageData = async () => {
      try {
        const [classesResponse, matieresResponse, elevesResponse, meResponse, affectationsResponse, paiementsResponse, dashboardResponse] = await Promise.all([
          api.get('/classes'),
          api.get('/matieres'),
          api.get('/eleves/'),
          api.get('/auth/me'),
          api.get('/affectation'),
          api.get('/system/paiements'),
          api.get('/system/dashboard/summary'),
        ]);

        setClasses(classesResponse.data || []);
        setMatieres(matieresResponse.data || []);
        setEleves(elevesResponse.data || []);
        setCurrentUser(meResponse.data?.user || null);
        setSchoolInfo(meResponse.data || null);
        setAffectations(affectationsResponse.data || []);
        setPaiements(paiementsResponse.data || []);
        setDashboardContext(dashboardResponse.data || null);
      } catch (err) {
        if (err?.response?.status === 401) {
          window.location.href = '/login';
          return;
        }
        setError('Erreur lors du chargement des eleves');
        console.error('Erreur chargement eleves:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPageData();
  }, []);

  function handleFilterChange(event) {
    const { name, value } = event.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  }

  function handleFilterSubmit(event) {
    event.preventDefault();
  }

  function resetFilters() {
    setFilters(initialFilters);
  }

  function buildStudentExportRows() {
    return filteredEleves.map((eleve, index) => {
      const paymentSummary = computePaymentSummary(eleve, classes, paiements, dashboardContext?.forecast?.startDate);
      return {
        numero: index + 1,
        matricule: eleve.matricule || '-',
        nomComplet: `${eleve.nom || ''} ${eleve.prenom || ''}`.trim() || '-',
        sexe: eleve.sexe || '-',
        dateNaissance: formatDate(eleve.date_naissance),
        lieuNaissance: eleve.lieu_naissance || '-',
        nationalite: eleve.nationalite || '-',
        age: computeAge(eleve.date_naissance),
        classe: getClasseName(eleve.classe_actuelle_id, classes),
        parent: eleve.nom_parent || '-',
        professionParent: eleve.profession_parent || '-',
        telephoneParent: eleve.telephone_parent || '-',
        emailParent: eleve.email_parent || '-',
        adresse: eleve.adresse || '-',
        dateInscription: formatDate(eleve.date_inscription || eleve.created_at),
        anneeScolaire: eleve.annee_scolaire_id || '-',
        mensualite: displayMoney(paymentSummary.mensualite),
        moisDus: paymentSummary.moisDus,
        totalDu: displayMoney(paymentSummary.totalMensualitesNettes),
        montantPaye: displayMoney(paymentSummary.totalVerse),
        moisCouverts: paymentSummary.moisCouverts,
        etatPaiement: formatPaymentStatusLabel(paymentSummary),
        statut: formatStudentStatus(eleve),
      };
    });
  }

  function exportStudentsCsv(rows) {
    const headers = [
      'N°',
      'Matricule',
      'Nom complet',
      'Sexe',
      'Date naissance',
      'Lieu naissance',
      'Nationalite',
      'Age',
      'Classe',
      'Parent',
      'Profession parent',
      'Telephone parent',
      'Email parent',
      'Adresse',
      'Date inscription',
      'Annee scolaire',
      'Mensualite',
      'Mois dus',
      'Total du',
      'Montant paye',
      'Mois couverts',
      'Etat paiement',
      'Statut',
    ];
    const csvLines = [
      headers.join(';'),
      ...rows.map((row) =>
        [
          row.numero,
          row.matricule,
          row.nomComplet,
          row.sexe,
          row.dateNaissance,
          row.lieuNaissance,
          row.nationalite,
          row.age,
          row.classe,
          row.parent,
          row.professionParent,
          row.telephoneParent,
          row.emailParent,
          row.adresse,
          row.dateInscription,
          row.anneeScolaire,
          row.mensualite,
          row.moisDus,
          row.totalDu,
          row.montantPaye,
          row.moisCouverts,
          row.etatPaiement,
          row.statut,
        ]
          .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
          .join(';')
      ),
    ];

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `liste-eleves-${sanitizeFileName(schoolInfo?.name || 'ecole')}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  }

  function exportStudentsExcel(rows) {
    downloadXlsx(
      [
        {
          name: 'Eleves',
          rows: [
            ['N°', 'Matricule', 'Nom complet', 'Sexe', 'Date naissance', 'Lieu naissance', 'Nationalite', 'Age', 'Classe', 'Parent', 'Profession parent', 'Telephone parent', 'Email parent', 'Adresse', 'Date inscription', 'Annee scolaire', 'Mensualite', 'Mois dus', 'Total du', 'Montant paye', 'Mois couverts', 'Etat paiement', 'Statut'],
            ...rows.map((row) => [
              row.numero,
              row.matricule,
              row.nomComplet,
              row.sexe,
              row.dateNaissance,
              row.lieuNaissance,
              row.nationalite,
              row.age,
              row.classe,
              row.parent,
              row.professionParent,
              row.telephoneParent,
              row.emailParent,
              row.adresse,
              row.dateInscription,
              row.anneeScolaire,
              row.mensualite,
              row.moisDus,
              row.totalDu,
              row.montantPaye,
              row.moisCouverts,
              row.etatPaiement,
              row.statut,
            ]),
          ],
        },
      ],
      `liste-eleves-${sanitizeFileName(schoolInfo?.name || 'ecole')}.xlsx`,
      'Liste des eleves'
    );
  }

  async function handleGenerateBulletinsByClass() {
    if (!filteredEleves.length) return;
    setExportingPdf(true);
    setError('');
    setPageSuccess('');
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
      filteredEleves.forEach((eleve, index) => {
        if (index > 0) doc.addPage();
        renderBulletinPdfPage(doc, {
          payload: {
            school: schoolInfo || {},
            student: {
              prenom: eleve.prenom || '',
              nom: eleve.nom || '',
              matricule: eleve.matricule || '',
              classe: getClasseName(eleve.classe_actuelle_id, classes),
              filiere: eleve.serie || '',
            },
            bulletin: {
              schoolYear: eleve.annee_scolaire_id || '',
              trimestre: ocrTrimestre,
              generatedAt: new Date().toISOString(),
              verificationCode: eleve.matricule || `${eleve.id}`,
            },
            stats: {
              moyenneGenerale: eleve.moyenne_generale || '',
              rang: eleve.rang_eleve || '',
            },
            notes: [],
          },
        });
      });
      doc.save(`bulletins-${sanitizeFileName(schoolInfo?.name || 'ecole')}.pdf`);
      setPageSuccess('Le PDF des bulletins a ete genere avec succes.');
    } catch (err) {
      console.error('Erreur generation bulletins:', err);
      setError('Erreur lors de la generation des bulletins.');
    } finally {
      setExportingPdf(false);
    }
  }

  async function handleExportPdf() {
    if (!filteredEleves.length) return;
    setExportingPdf(true);
    setError('');
    setPageSuccess('');
    try {
      exportStudentsPdf(buildStudentExportRows());
      setPageSuccess('La liste des eleves a ete exportee en PDF.');
    } catch (err) {
      console.error('Erreur export PDF eleves:', err);
      setError("Erreur lors de l'export PDF des eleves.");
    } finally {
      setExportingPdf(false);
    }
  }

  function openDeleteModal(eleve) {
    setDeleteState({ open: true, eleve });
    setDeletePassword('');
    setDeactivationReason('abandon');
    setDeactivationReasonDetails('');
  }

  function closeDeleteModal() {
    if (deactivatingId) return;
    setDeleteState(initialDeleteState);
    setDeletePassword('');
    setDeactivationReason('abandon');
    setDeactivationReasonDetails('');
  }

  async function handleDeactivate() {
    if (!deleteState.eleve || deactivatingId === deleteState.eleve.id) return;
    if (!deletePassword.trim()) {
      setError('Mot de passe requis pour confirmer la desactivation.');
      return;
    }

    setDeactivatingId(deleteState.eleve.id);
    setError('');
    setPageSuccess('');
    try {
      await api.patch(`/eleves/${deleteState.eleve.id}/deactivate`, {
        currentPassword: deletePassword,
        statusReason: deactivationReason,
        statusReasonDetails: deactivationReason === 'autre' ? deactivationReasonDetails : '',
      });
      const refreshed = await api.get('/eleves/');
      setEleves(refreshed.data || []);
      setPageSuccess('Eleve desactive avec succes.');
      closeDeleteModal();
    } catch (err) {
      console.error('Erreur desactivation eleve:', err);
      setError(err.response?.data?.error || "Erreur lors de la desactivation de l'eleve.");
    } finally {
      setDeactivatingId(null);
    }
  }

  function exportStudentsPdf(rows) {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFillColor(15, 23, 42);
    doc.roundedRect(10, 8, pageWidth - 20, 24, 5, 5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text("Liste generale des eleves", 16, 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(schoolInfo?.name || 'UNITECH ERP', 16, 24);
    doc.text(`Genere le ${formatDate(new Date().toISOString())}`, pageWidth - 16, 18, { align: 'right' });
    doc.text(`Effectif exporte: ${rows.length}`, pageWidth - 16, 24, { align: 'right' });

    autoTable(doc, {
      startY: 40,
      theme: 'grid',
      styles: {
        fontSize: 7.5,
        cellPadding: 2,
        textColor: [15, 23, 42],
        lineColor: [203, 213, 225],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
      },
      head: [[
        'N°',
        'Matricule',
        'Nom complet',
        'Sexe',
        'Date naissance',
        'Lieu naissance',
        'Nationalite',
        'Age',
        'Classe',
        'Parent',
        'Profession parent',
        'Telephone parent',
        'Email parent',
        'Adresse',
        'Date inscription',
        'Annee scolaire',
        'Mensualite',
        'Mois dus',
        'Total du',
        'Montant paye',
        'Mois couverts',
        'Etat paiement',
        'Statut',
      ]],
      body: rows.map((row) => [
        row.numero,
        row.matricule,
        row.nomComplet,
        row.sexe,
        row.dateNaissance,
        row.lieuNaissance,
        row.nationalite,
        row.age,
        row.classe,
        row.parent,
        row.professionParent,
        row.telephoneParent,
        row.emailParent,
        row.adresse,
        row.dateInscription,
        row.anneeScolaire,
        row.mensualite,
        row.moisDus,
        row.totalDu,
        row.montantPaye,
        row.moisCouverts,
        row.etatPaiement,
        row.statut,
      ]),
    });

    doc.save(`liste-eleves-${sanitizeFileName(schoolInfo?.name || 'ecole')}.pdf`);
  }

  async function handleExportStudents() {
    if (!canExportStudents) {
      setError("Votre role n'est pas autorise a exporter la liste des eleves.");
      return;
    }

    const rows = buildStudentExportRows();
    if (!rows.length) {
      setError("Aucun eleve disponible pour l'export.");
      return;
    }

    setExportingList(true);
    setError('');
    setPageSuccess('');
    try {
      if (selectedExportFormat === 'csv') {
        exportStudentsCsv(rows);
      } else if (selectedExportFormat === 'excel') {
        exportStudentsExcel(rows);
      } else {
        exportStudentsPdf(rows);
      }
      setPageSuccess(`La liste des eleves a ete exportee en ${selectedExportFormat.toUpperCase()}.`);
    } catch (err) {
      console.error('Erreur export liste eleves:', err);
      setError("Erreur lors de l'export de la liste des eleves.");
    } finally {
      setExportingList(false);
    }
  }

  if (showLoading) {
    return <PageLoadingState title="Chargement des eleves" message="La liste des eleves est en cours de chargement." />;
  }

  if (error && eleves.length === 0) {
    return (
      <PageErrorState
        title="Liste des eleves indisponible"
        message={error}
        action={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Reessayer
          </button>
        }
      />
    );
  }

  const deleteTarget = deleteState.eleve;
  const deleteTargetClasse = deleteTarget ? getClasseName(deleteTarget.classe_actuelle_id, classes) : '';

  return (
    <section className="app-page space-y-5">
      <PageBanner tone="success" title={pageSuccess ? 'Operation reussie' : ''} message={pageSuccess} />
      <PageBanner tone="error" title={error && eleves.length > 0 ? 'Action impossible' : ''} message={eleves.length > 0 ? error : ''} />

      <div className="surface-card rounded-2xl p-5">
        <form onSubmit={handleFilterSubmit} className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto_auto]">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="matricule">Rechercher par nom ou matricule</label>
            <input
              id="matricule"
              name="matricule"
              type="text"
              value={filters.matricule}
              onChange={handleFilterChange}
              className="w-full rounded-2xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Ex: AB261234 ou Jean Dupont"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="classe">Filtrer par classe</label>
            <select
              id="classe"
              name="classe"
              value={filters.classe}
              onChange={handleFilterChange}
              className="w-full rounded-2xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Toutes les classes</option>
              {classes.map((cl) => (
                <option key={cl.id} value={cl.id}>{cl.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="matiere">Filtrer par matiere</label>
            <select
              id="matiere"
              name="matiere"
              value={filters.matiere}
              onChange={handleFilterChange}
              className="w-full rounded-2xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={Boolean(filters.classe) && availableMatieresForClasse.length === 0}
            >
              <option value="">
                {filters.classe ? 'Matieres affectees a la classe' : 'Toutes les matieres'}
              </option>
              {availableMatieresForClasse.map((matiere) => (
                <option key={matiere.id} value={matiere.nom}>{matiere.nom}</option>
              ))}
            </select>
            {filters.classe && availableMatieresForClasse.length === 0 ? (
              <p className="mt-1 text-xs text-amber-600">Aucune matiere affectee a cette classe pour le moment.</p>
            ) : null}
          </div>

          <button
            type="submit"
            className="self-end rounded-2xl bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700"
          >
            Filtrer
          </button>

          <button
            type="button"
            onClick={resetFilters}
            className="self-end rounded-2xl bg-slate-600 px-4 py-2 text-white hover:bg-slate-700"
          >
            Reinitialiser
          </button>
        </form>
      </div>

      <div className="surface-card flex flex-col gap-2 rounded-2xl p-4 sm:flex-row sm:flex-wrap sm:justify-end">
        <button className="w-full rounded-2xl bg-slate-600 px-4 py-2 text-white hover:bg-slate-700 sm:w-auto">
          Transferts entrants
        </button>
        {canExportStudents ? (
          <>
            <select
              value={selectedExportFormat}
              onChange={(e) => setSelectedExportFormat(e.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-slate-700 sm:w-auto"
            >
              {EXPORT_FORMATS.map((item) => (
                <option key={item.value} value={item.value}>
                  Export {item.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleExportStudents}
              disabled={!filteredEleves.length || exportingList}
              className="w-full rounded-2xl bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {exportingList ? 'Export en cours...' : `Telecharger ${selectedExportFormat.toUpperCase()}`}
            </button>
          </>
        ) : null}
        <select
          value={ocrNoteType}
          onChange={(e) => setOcrNoteType(e.target.value)}
          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-slate-700 sm:w-auto"
        >
          <option value="devoir">Devoir</option>
          <option value="composition">Composition</option>
        </select>
        <select
          value={ocrTrimestre}
          onChange={(e) => setOcrTrimestre(e.target.value)}
          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-slate-700 sm:w-auto"
        >
          <option value="1">Trimestre 1</option>
          <option value="2">Trimestre 2</option>
          <option value="3">Trimestre 3</option>
        </select>
        <RippleButton
          type="button"
          onClick={handleGenerateBulletinsByClass}
          disabled={!filteredEleves.length || exportingPdf}
          className="w-full rounded-2xl px-4 py-2 sm:w-auto disabled:cursor-not-allowed"
          variant="primary"
        >
          {exportingPdf ? 'Generation bulletins...' : 'Generer bulletins (classe)'}
        </RippleButton>
        <RippleButton
          type="button"
          onClick={handleExportPdf}
          disabled={!filteredEleves.length || exportingPdf}
          className="w-full rounded-2xl px-4 py-2 sm:w-auto disabled:cursor-not-allowed"
          variant="secondary"
        >
          {exportingPdf ? 'Generation OCR...' : 'Exporter liste PDF (OCR)'}
        </RippleButton>
        <NavLink
          to="/eleves/ajouter"
          className="w-full rounded-2xl bg-indigo-600 px-4 py-2 text-center text-white hover:bg-indigo-700 sm:w-auto"
        >
          Inscrire un eleve
        </NavLink>
      </div>

      <div className="surface-card overflow-x-auto rounded-2xl p-5">
        <h2 className="text-base font-semibold">Eleves de l'ecole</h2>
        <table className="mt-4 w-full min-w-[720px] border-collapse text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr className="border-b border-slate-200">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Matricule</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Nom complet</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Classe</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Naissance</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Statut</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredEleves.map((eleve, idx) => (
              <tr key={eleve.id} className={`hover:bg-slate-50 ${getAnimationCascadeClass(idx)}`}>
                <td className="px-4 py-3 text-slate-700">{eleve.matricule}</td>
                <td className="px-4 py-3 text-slate-700">{eleve.nom} {eleve.prenom}</td>
                <td className="px-4 py-3 text-slate-700">{getClasseName(eleve.classe_actuelle_id, classes)}</td>
                <td className="px-4 py-3 text-slate-700">{eleve.date_naissance}</td>
                <td className="px-4 py-3 text-slate-700">{formatStudentStatus(eleve)}</td>
                <td className="px-4 py-3">
                  <NavLink
                    className="mr-2 inline-block rounded-md bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
                    to={`/eleveProfil/${eleve.id}`}
                  >
                    Profil
                  </NavLink>
                  <button
                    type="button"
                    onClick={() => openDeleteModal(eleve)}
                    disabled={deactivatingId === eleve.id || String(eleve.statut || '').toLowerCase() === 'exclu'}
                    className="rounded-md bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deactivatingId === eleve.id ? 'Desactivation...' : String(eleve.statut || '').toLowerCase() === 'exclu' ? 'Desactive' : 'Desactiver'}
                  </button>
                </td>
              </tr>
            ))}

            {filteredEleves.length === 0 && (
              <tr>
                <td colSpan="6" className="px-4 py-6 text-center text-sm text-slate-500">
                  Aucun eleve trouve.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {generationProgress.running ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-lg">
            <h3 className="text-sm font-semibold">Génération des bulletins</h3>
            <p className="mt-2 text-sm text-slate-600">{generationProgress.message}</p>
            <div className="mt-4 w-full">
              <div className="h-3 w-full rounded-full bg-slate-100">
                <div
                  className="h-3 rounded-full bg-indigo-600"
                  style={{ width: `${Math.round((generationProgress.current / Math.max(1, generationProgress.total)) * 100)}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>{generationProgress.current} / {generationProgress.total}</span>
                <span>{Math.round((generationProgress.current / Math.max(1, generationProgress.total)) * 100)}%</span>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => { /* no-op: let generation finish */ }}
                className="rounded-md bg-slate-200 px-4 py-2 text-sm text-slate-700"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteState.open && deleteTarget ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/55 p-3 backdrop-blur-sm sm:p-4">
          <div className="flex min-h-full items-center justify-center">
            <div className="w-full max-w-3xl overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:rounded-[28px]">
            <div className="relative overflow-hidden border-b border-rose-100 bg-gradient-to-r from-rose-50 via-white to-amber-50 px-4 py-5 sm:px-6 sm:py-6">
              <div className="absolute right-0 top-0 h-28 w-28 rounded-full bg-rose-100/70 blur-2xl" />
              <div className="absolute bottom-0 left-12 h-20 w-20 rounded-full bg-amber-100/70 blur-2xl" />
              <div className="relative">
                <div className="inline-flex items-center rounded-full border border-rose-200 bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700 sm:text-xs">
                  Zone sensible
                </div>
                <h2 className="mt-3 pr-8 text-lg font-semibold text-slate-900 sm:text-xl">Confirmer la desactivation de l'eleve</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  Le dossier eleve sera conserve, mais son statut passera en mode inactif. Avant de continuer, verifiez les informations et renseignez un motif clair.
                </p>
              </div>
            </div>

            <div className="max-h-[calc(100vh-10rem)] overflow-y-auto bg-slate-50/70 px-4 py-4 sm:max-h-[calc(100vh-12rem)] sm:px-6 sm:py-6">
            <div className="grid gap-4 md:grid-cols-[1.15fr_0.85fr] md:gap-6">
              <div className="space-y-4">
                <div className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white px-4 py-4 text-sm text-rose-900 shadow-sm">
                  <p className="font-semibold">Impact de la desactivation</p>
                  <p className="mt-1 leading-6 text-rose-800">
                    Le dossier eleve reste conserve, mais il sera marque comme desactive avec un motif enregistre.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5 sm:py-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Eleve concerne</h3>
                      <p className="mt-2 break-words text-lg font-semibold text-slate-900 sm:text-xl">{deleteTarget.nom} {deleteTarget.prenom}</p>
                      <p className="mt-1 text-sm text-slate-500">Verifiez bien l'identite avant suppression.</p>
                    </div>
                    <div className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                      {formatStudentStatus(deleteTarget)}
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Matricule</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{deleteTarget.matricule || '-'}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Classe</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{deleteTargetClasse}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date de naissance</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{deleteTarget.date_naissance || '-'}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Statut</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{formatStudentStatus(deleteTarget)}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5 sm:py-5">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Compte responsable</h3>
                  <div className="mt-4 rounded-2xl bg-slate-900 px-4 py-4 text-white">
                    <p className="break-words text-base font-semibold">{currentUser?.name || 'Utilisateur connecte'}</p>
                    <p className="mt-1 break-all text-sm text-slate-300">{currentUser?.email || '-'}</p>
                    <div className="mt-3 inline-flex rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-200">
                      {currentUser?.role || localStorage.getItem('role') || '-'}
                    </div>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    Ce compte sera considere comme auteur de l'action dans ce flux de confirmation.
                  </p>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900 shadow-sm">
                  <p className="font-semibold">Engagement de responsabilite</p>
                  <p className="mt-1 leading-6">
                    En entrant votre mot de passe, vous confirmez etre autorise a desactiver ce dossier eleve.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5 sm:py-5">
                  <label className="block text-sm font-semibold text-slate-800" htmlFor="deactivation-reason">
                    Motif de desactivation
                  </label>
                  <div className="mt-3">
                    <select
                      id="deactivation-reason"
                      value={deactivationReason}
                      onChange={(e) => setDeactivationReason(e.target.value)}
                      disabled={deactivatingId === deleteTarget.id}
                      className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:cursor-not-allowed disabled:bg-slate-100"
                    >
                      {DEACTIVATION_REASONS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </div>
                  {deactivationReason === 'autre' ? (
                    <div className="mt-3">
                      <textarea
                        value={deactivationReasonDetails}
                        onChange={(e) => setDeactivationReasonDetails(e.target.value)}
                        disabled={deactivatingId === deleteTarget.id}
                        rows={3}
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:cursor-not-allowed disabled:bg-slate-100"
                        placeholder="Precisez le motif"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5 sm:py-5">
                  <label className="block text-sm font-semibold text-slate-800" htmlFor="delete-password">
                    Mot de passe de confirmation
                  </label>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Cette verification permet de confirmer votre identite avant la desactivation.
                  </p>
                  <div className="mt-3">
                    <input
                      id="delete-password"
                      type="password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      disabled={deactivatingId === deleteTarget.id}
                      className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-400 disabled:cursor-not-allowed disabled:bg-slate-100"
                      placeholder="Mot de passe du compte connecte"
                    />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    Le mot de passe n'est utilise ici que pour confirmer cette operation sensible.
                  </p>
                </div>
              </div>
            </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-4 py-4 sm:flex-row sm:justify-end sm:px-6 sm:py-5">
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deactivatingId === deleteTarget.id}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleDeactivate}
                disabled={deactivatingId === deleteTarget.id}
                className="w-full rounded-xl bg-amber-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-amber-200 transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
              >
                {deactivatingId === deleteTarget.id ? 'Desactivation...' : 'Confirmer la desactivation'}
              </button>
            </div>
            </div>
          </div>
        </div>
      ) : null}

    </section>
  );
}


