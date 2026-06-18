import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import api from "../../services/api";
import { PageBanner, PageErrorState, PageLoadingState, usePageLoadingVisibility } from "../../components/PageState";
import {
  AcademicCapIcon,
  ArrowDownTrayIcon,
  BookOpenIcon,
  BuildingOffice2Icon,
  CalendarDaysIcon,
  ClockIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
  PencilSquareIcon,
  PhoneIcon,
  PrinterIcon,
  UserIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

const emptyProfile = {
  id: "",
  photo: "",
  nomComplet: "",
  matricule: "",
  sexe: "",
  dateNaissance: "",
  age: "",
  nationalite: "",
  adresse: "",
  telephone: "",
  email: "",
  situationMatrimoniale: "",
  statut: "",
  dateRecrutement: "",
  anciennete: "",
  typePersonnel: "",
  poste: "",
  departement: "",
  specialite: "",
  diplomes: "",
  niveauEtude: "",
  experience: "",
  competences: "",
  horairesTravail: "",
  numeroEmploye: "",
  typeContrat: "",
  dateDebutContrat: "",
  dateFinContrat: "",
  tempsTravail: "",
  matieres: "",
  classes: "",
  volumeHoraire: "",
  emploiDuTemps: "",
  professeurPrincipal: "",
  nombreEleves: "",
  historiqueAffectations: "",
  resultatsClasses: "",
  absencesEnseignant: "",
  retards: "",
  observationsPedagogiques: "",
  nina: "",
  inps: "",
  referencesAdministratives: "",
  documentsIdentite: "",
  diplomesScannes: "",
  contratTravail: "",
  cv: "",
  attestations: "",
  datePriseService: "",
  typePayement: "",
  salaireMensuel: "",
  tauxHoraire: "",
  prime: "",
  indemnites: "",
  modePaiement: "",
  avancesSalaire: "",
  retenues: "",
  reglePaiementPartiel: "",
  montantCreneau: "",
  montantForfaitTrimestre: "",
  echeancePaiement: "",
  etatPaiements: "",
  historiqueSalaires: "",
  presences: "",
  absences: "",
  permissions: "",
  conges: "",
  sanctionsDisciplinaires: "",
  historiquePointages: "",
  observationsAdministratives: "",
  contactUrgenceNom: "",
  contactUrgenceLien: "",
  contactUrgenceTelephone: "",
  contactUrgenceAdresse: "",
  documents: "",
};

const tabs = [
  { id: "general", label: "Vue generale", icon: UserIcon },
  { id: "pro", label: "Professionnel", icon: BuildingOffice2Icon },
  { id: "teacher", label: "Enseignement", icon: AcademicCapIcon },
  { id: "admin", label: "Administratif", icon: DocumentTextIcon },
  { id: "finance", label: "Salaire", icon: CurrencyDollarIcon },
  { id: "presence", label: "Presence", icon: ClockIcon },
  { id: "documents", label: "Documents", icon: ArrowDownTrayIcon },
];

const sexeOptions = [
  { value: "", label: "Selectionner" },
  { value: "M", label: "M" },
  { value: "F", label: "F" },
];

const situationMatrimonialeOptions = [
  { value: "", label: "Selectionner" },
  { value: "Celibataire", label: "Celibataire" },
  { value: "Marie(e)", label: "Marie(e)" },
  { value: "Divorce(e)", label: "Divorce(e)" },
  { value: "Veuf(ve)", label: "Veuf(ve)" },
];

const typePersonnelOptions = [
  { value: "", label: "Selectionner" },
  { value: "administratif", label: "Administratif" },
  { value: "pedagogique", label: "Pedagogique" },
  { value: "technique", label: "Technique" },
  { value: "enseignant", label: "Enseignant" },
  { value: "autre", label: "Autre" },
];

const posteOptions = [
  { value: "", label: "Selectionner" },
  { value: "Directeur", label: "Directeur" },
  { value: "Promoteur", label: "Promoteur" },
  { value: "Comptable", label: "Comptable" },
  { value: "Surveillant", label: "Surveillant" },
  { value: "Secretaire", label: "Secretaire" },
  { value: "Censeur", label: "Censeur" },
  { value: "Bibliothecaire", label: "Bibliothecaire" },
  { value: "Agent d'entretien", label: "Agent d'entretien" },
  { value: "Agent de securite", label: "Agent de securite" },
  { value: "Infirmerie", label: "Infirmerie" },
  { value: "Autre", label: "Autre" },
];

const typeRemunerationOptions = [
  { value: "", label: "Selectionner" },
  { value: "salaire", label: "Salaire mensuel" },
  { value: "tauxHoraire", label: "Taux horaire" },
];

const paymentRuleOptions = [
  { value: "", label: "Aucune" },
  { value: "heure", label: "Paiement a l'heure" },
  { value: "creneau", label: "Paiement au creneau" },
  { value: "forfait_trimestre", label: "Forfait trimestriel" },
  { value: "salaire_fixe", label: "Salaire fixe annualise" },
];

const paymentScheduleOptions = [
  { value: "", label: "Selectionner" },
  { value: "fin_trimestre", label: "Fin du trimestre" },
  { value: "mensuel_prorata", label: "Mensuel au prorata" },
];

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().split("T")[0];
}

function displayDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("fr-FR");
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "-";
  return `${Number(value).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} F`;
}

function formatRate(value) {
  const amount = formatMoney(value);
  return amount === "-" ? "-" : `${amount} / h`;
}

function normalizePaymentType(value) {
  if (value === "taux_horaire") return "tauxHoraire";
  return value || "";
}

function getFinanceBaseLabel(typePayement) {
  return normalizePaymentType(typePayement) === "tauxHoraire" ? "Taux horaire" : "Salaire mensuel";
}

function getPaymentTypeLabel(value) {
  const normalized = normalizePaymentType(value);
  if (normalized === "tauxHoraire") return "Taux horaire";
  if (normalized === "salaire") return "Salaire mensuel";
  return normalized || "-";
}

function sanitizeFileName(value) {
  return String(value || "profil")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function computeAge(dateValue) {
  if (!dateValue) return "";
  const birth = new Date(dateValue);
  if (Number.isNaN(birth.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hasBirthdayPassed =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hasBirthdayPassed) age -= 1;
  return age;
}

function computeAnciennete(dateValue) {
  if (!dateValue) return "";
  const start = new Date(dateValue);
  if (Number.isNaN(start.getTime())) return "";
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  const hasAnniversaryPassed =
    now.getMonth() > start.getMonth() ||
    (now.getMonth() === start.getMonth() && now.getDate() >= start.getDate());
  if (!hasAnniversaryPassed) years -= 1;
  if (years <= 0) return "Moins d'un an";
  return `${years} an${years > 1 ? "s" : ""}`;
}

function listToText(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (!value) return "";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (typeof item === "object" ? JSON.stringify(item) : item))
          .join(", ");
      }
    } catch {
      return value;
    }
  }
  return String(value);
}

function objectArrayToText(value, formatFn) {
  if (!value) return "";
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (!Array.isArray(parsed)) return "";
  return parsed.map(formatFn).join("\n");
}

function parseDateOnly(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3] || 1);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthKeyFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function monthLabelFromValue(monthValue) {
  const raw = String(monthValue || "").trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return raw || "-";
  const [yearText, monthText] = raw.split("-");
  const date = new Date(Number(yearText), Number(monthText) - 1, 1);
  if (Number.isNaN(date.getTime())) return raw;
  const label = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function listMonthsBetweenDates(startDate, endDate) {
  if (!(startDate instanceof Date) || !(endDate instanceof Date) || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) {
    return [];
  }

  const months = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endCursor = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (cursor <= endCursor) {
    months.push(monthKeyFromDate(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

function parseSalaryHistory(value) {
  if (!value) return [];

  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [mois = "", montant = "", statut = ""] = line.split("|").map((part) => part.trim());
          return { mois, montant, statut };
        });
    }
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => {
      if (!item) return null;
      if (typeof item === "string") {
        const [mois = "", montant = "", statut = ""] = item.split("|").map((part) => part.trim());
        return { mois, montant, statut };
      }
      if (typeof item !== "object") return null;
      return {
        mois: String(item.mois || item.month || item.periode || "").trim(),
        montant: item.montant ?? item.amount ?? item.total ?? 0,
        statut: String(item.statut || item.status || item.etat || "").trim(),
      };
    })
    .filter(Boolean);
}

function buildLocalMonthlySummary({ teacher, trimestre, historicalValues }) {
  if (!teacher || !trimestre) return null;
  const startDate = parseDateOnly(trimestre.start_date);
  const endDate = parseDateOnly(trimestre.end_date);
  if (!startDate || !endDate || startDate > endDate) return null;

  const monthlySalary = Number(teacher.salaire ?? teacher.salaire_base ?? 0);
  if (monthlySalary <= 0) return null;

  const monthKeys = listMonthsBetweenDates(startDate, endDate);
  const paidMap = new Map();

  for (const item of parseSalaryHistory(historicalValues)) {
    const monthValue = String(item.mois || "").trim().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthValue)) continue;
    const currentTotal = Number(paidMap.get(monthValue) || 0);
    paidMap.set(monthValue, Number((currentTotal + Number(item.montant || 0)).toFixed(2)));
  }

  const months = monthKeys.map((monthValue) => {
    const paidAmount = Number(paidMap.get(monthValue) || 0);
    const dueAmount = monthlySalary;
    const remainingAmount = Math.max(0, Number((dueAmount - paidAmount).toFixed(2)));
    return {
      month: monthValue,
      label: monthLabelFromValue(monthValue),
      due_amount: Number(dueAmount.toFixed(2)),
      paid_amount: Number(paidAmount.toFixed(2)),
      remaining_amount: remainingAmount,
      is_paid: paidAmount >= dueAmount && dueAmount > 0,
      is_partial: paidAmount > 0 && paidAmount < dueAmount,
    };
  });

  const totalDue = Number((monthlySalary * months.length).toFixed(2));
  const totalPaid = Number(months.reduce((sum, item) => sum + item.paid_amount, 0).toFixed(2));
  const remainingAmount = Math.max(0, Number((totalDue - totalPaid).toFixed(2)));
  const paidMonthsList = months.filter((item) => item.paid_amount > 0);

  return {
    teacher: {
      id: teacher.id,
      nomComplet: teacher.nomComplet || "",
      matricule: teacher.matricule || "",
    },
    trimestre: {
      id: trimestre.id,
      code: trimestre.code || "",
      label: trimestre.label || "",
      start_date: trimestre.start_date,
      end_date: trimestre.end_date,
    },
    monthlySalary: Number(monthlySalary.toFixed(2)),
    totalMonths: months.length,
    paidMonths: paidMonthsList.length,
    remainingMonths: Math.max(0, months.length - paidMonthsList.length),
    totalDue,
    totalPaid,
    remainingAmount,
    months,
    paidMonthsList,
    isMonthly: true,
    fallback: true,
  };
}

function profileFromRecord(type, record) {
  if (!record) return emptyProfile;
  const teacher = type === "enseignant";
  const matiere = record.matiere || "";

  return {
    id: record.id || "",
    photo: record.photo || "",
    nomComplet: record.nomComplet || "",
    matricule: record.matricule || `${teacher ? "ENS" : "PER"}-${record.id}`,
    sexe: record.sexe || "",
    dateNaissance: formatDate(record.date_naissance),
    age: computeAge(record.date_naissance),
    nationalite: record.nationalite || "",
    adresse: record.adresse || "",
    telephone: record.telephone || "",
    email: record.email || "",
    situationMatrimoniale: record.situation_matrimoniale || "",
    statut: record.statut || "",
    dateRecrutement: formatDate(record.date_embauche),
    anciennete: computeAnciennete(record.date_embauche),
    typePersonnel: record.type_personnel || (teacher ? "Enseignant" : "Personnel"),
    poste: record.poste || (teacher ? `Professeur de ${matiere}` : ""),
    departement: record.departement || "",
    specialite: record.specialite || matiere,
    diplomes: record.diplomes || "",
    niveauEtude: record.niveau_etude || "",
    experience: record.experience_professionnelle || "",
    competences: listToText(record.competences),
    horairesTravail: record.horaires_travail || "",
    numeroEmploye: record.numero_employe || "",
    typeContrat: record.type_contrat || "",
    dateDebutContrat: formatDate(record.date_debut_contrat || record.date_embauche),
    dateFinContrat: formatDate(record.date_fin_contrat),
    tempsTravail: record.temps_travail || "",
    matieres: listToText(record.matieres_enseignees || record.matiere),
    classes: listToText(record.classes_affectees),
    volumeHoraire: record.volume_horaire || "",
    emploiDuTemps: record.emploi_du_temps || "",
    professeurPrincipal: record.professeur_principal || "",
    nombreEleves: record.nombre_eleves_suivis ?? "",
    historiqueAffectations: objectArrayToText(record.historique_affectations, (item) => `${item.periode || ""}: ${item.valeur || item.libelle || ""}`),
    resultatsClasses: objectArrayToText(record.resultats_classes, (item) => `${item.classe || ""} | ${item.moyenne || ""} | ${item.succes || ""}`),
    absencesEnseignant: record.absences_enseignant ?? "",
    retards: record.retards ?? "",
    observationsPedagogiques: record.observations_pedagogiques || "",
    nina: record.nina || "",
    inps: record.inps || "",
    referencesAdministratives: record.references_administratives || "",
    documentsIdentite: record.documents_identite || "",
    diplomesScannes: record.diplomes_scannes || "",
    contratTravail: record.contrat_travail || "",
    cv: record.cv || "",
    attestations: record.attestations || "",
    datePriseService: formatDate(record.date_prise_service),
    typePayement: normalizePaymentType(record.typePayement || record.type_payement),
    salaireMensuel: record.salaire ?? record.salaire_base ?? "",
    tauxHoraire: record.tauxHoraire ?? record.taux_horaire ?? "",
    prime: record.prime ?? "",
    indemnites: record.indemnites ?? "",
    modePaiement: record.mode_paiement || record.typePayement || record.type_payement || "",
    avancesSalaire: record.avances_salaire ?? "",
    retenues: record.retenues ?? "",
    reglePaiementPartiel: record.regle_paiement_partiel || "",
    montantCreneau: record.montant_creneau ?? "",
    montantForfaitTrimestre: record.montant_forfait_trimestre ?? "",
    echeancePaiement: record.echeance_paiement || "",
    etatPaiements: record.etat_paiements || "",
    historiqueSalaires: objectArrayToText(record.historique_salaires, (item) => `${item.mois || ""} | ${item.montant || ""} | ${item.statut || ""}`),
    presences: record.presences || "",
    absences: record.absences ?? "",
    permissions: record.permissions ?? "",
    conges: record.conges || "",
    sanctionsDisciplinaires: record.sanctions_disciplinaires || "",
    historiquePointages: objectArrayToText(record.historique_pointages, (item) => `${item.date || ""} | ${item.entree || ""} | ${item.sortie || ""}`),
    observationsAdministratives: record.observations_administratives || "",
    contactUrgenceNom: record.contact_urgence_nom || "",
    contactUrgenceLien: record.contact_urgence_lien || "",
    contactUrgenceTelephone: record.contact_urgence_telephone || "",
    contactUrgenceAdresse: record.contact_urgence_adresse || "",
    documents: objectArrayToText(record.documents, (item) => `${item.nom || ""} | ${item.type || ""} | ${item.date || ""}`),
  };
}

function textToList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function linesToObjects(value, keys) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      return keys.reduce((acc, key, index) => {
        acc[key] = parts[index] || "";
        return acc;
      }, {});
    });
}

function parseHistoryLines(value, keys) {
  if (!value) return [];
  return linesToObjects(value, keys).filter((item) => Object.values(item).some((entry) => String(entry || "").trim()));
}

function buildPayload(profile, type) {
  const teacher = type === "enseignant";
  return {
    nomComplet: profile.nomComplet,
    matricule: profile.matricule,
    photo: profile.photo,
    sexe: profile.sexe,
    date_naissance: profile.dateNaissance || null,
    nationalite: profile.nationalite,
    adresse: profile.adresse,
    telephone: profile.telephone,
    email: profile.email,
    situation_matrimoniale: profile.situationMatrimoniale,
    statut: profile.statut,
    date_embauche: profile.dateRecrutement || null,
    type_personnel: profile.typePersonnel,
    poste: profile.poste,
    departement: profile.departement,
    specialite: profile.specialite,
    diplomes: profile.diplomes,
    niveau_etude: profile.niveauEtude,
    experience_professionnelle: profile.experience,
    competences: textToList(profile.competences),
    horaires_travail: profile.horairesTravail,
    numero_employe: profile.numeroEmploye,
    type_contrat: profile.typeContrat,
    date_debut_contrat: profile.dateDebutContrat || null,
    date_fin_contrat: profile.dateFinContrat || null,
    temps_travail: profile.tempsTravail,
    nina: profile.nina,
    inps: profile.inps,
    references_administratives: profile.referencesAdministratives,
    documents_identite: profile.documentsIdentite,
    diplomes_scannes: profile.diplomesScannes,
    contrat_travail: profile.contratTravail,
    cv: profile.cv,
    attestations: profile.attestations,
    date_prise_service: profile.datePriseService || null,
    typePayement: profile.typePayement || null,
    salaire: profile.salaireMensuel || null,
    tauxHoraire: profile.tauxHoraire || null,
    prime: profile.prime || null,
    indemnites: profile.indemnites || null,
    mode_paiement: profile.modePaiement,
    avances_salaire: profile.avancesSalaire || null,
    retenues: profile.retenues || null,
    regle_paiement_partiel: profile.reglePaiementPartiel || null,
    montant_creneau: profile.montantCreneau || null,
    montant_forfait_trimestre: profile.montantForfaitTrimestre || null,
    echeance_paiement: profile.echeancePaiement || null,
    etat_paiements: profile.etatPaiements,
    historique_salaires: linesToObjects(profile.historiqueSalaires, ["mois", "montant", "statut"]),
    presences: profile.presences,
    absences: profile.absences || null,
    retards: profile.retards || null,
    permissions: profile.permissions || null,
    conges: profile.conges,
    sanctions_disciplinaires: profile.sanctionsDisciplinaires,
    historique_pointages: linesToObjects(profile.historiquePointages, ["date", "entree", "sortie"]),
    observations_administratives: profile.observationsAdministratives,
    contact_urgence_nom: profile.contactUrgenceNom,
    contact_urgence_lien: profile.contactUrgenceLien,
    contact_urgence_telephone: profile.contactUrgenceTelephone,
    contact_urgence_adresse: profile.contactUrgenceAdresse,
    documents: linesToObjects(profile.documents, ["nom", "type", "date"]),
    matiere: teacher ? textToList(profile.matieres)[0] || profile.specialite : undefined,
    matieres_enseignees: teacher ? textToList(profile.matieres) : undefined,
    classes_affectees: teacher ? textToList(profile.classes) : undefined,
    volume_horaire: teacher ? profile.volumeHoraire : undefined,
    emploi_du_temps: teacher ? profile.emploiDuTemps : undefined,
    professeur_principal: teacher ? profile.professeurPrincipal : undefined,
    nombre_eleves_suivis: teacher ? profile.nombreEleves || null : undefined,
    historique_affectations: teacher ? linesToObjects(profile.historiqueAffectations, ["periode", "valeur"]) : undefined,
    resultats_classes: teacher ? linesToObjects(profile.resultatsClasses, ["classe", "moyenne", "succes"]) : undefined,
    absences_enseignant: teacher ? profile.absencesEnseignant || null : undefined,
    observations_pedagogiques: teacher ? profile.observationsPedagogiques : undefined,
  };
}

function InputField({
  label,
  value,
  field,
  editMode,
  onChange,
  type = "text",
  textarea = false,
  placeholder = "",
  selectOptions = null,
}) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {editMode ? (
        selectOptions ? (
          <select
            value={value ?? ""}
            onChange={(e) => onChange(field, e.target.value)}
            className="premium-control w-full rounded-2xl border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          >
            {selectOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : textarea ? (
          <textarea
            value={value ?? ""}
            onChange={(e) => onChange(field, e.target.value)}
            rows={4}
            placeholder={placeholder}
            className="premium-control w-full rounded-2xl border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        ) : (
          <input
            type={type}
            value={value ?? ""}
            onChange={(e) => onChange(field, e.target.value)}
            placeholder={placeholder}
            className="premium-control w-full rounded-2xl border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        )
      ) : (
        <p className="min-h-[42px] rounded-2xl bg-gray-50 px-3 py-2 text-gray-700">{value || "-"}</p>
      )}
    </div>
  );
}

const SectionCard = ({ title, icon: Icon, children }) => (
  <div className="surface-card premium-card mb-6 rounded-2xl p-6">
    <div className="mb-4 flex items-center border-b-2 border-gray-200 pb-3">
      <Icon className="mr-3 h-6 w-6 text-blue-600" />
      <h2 className="text-xl font-bold text-gray-800">{title}</h2>
    </div>
    {children}
  </div>
);

function PersonnelProfile() {
  const { type, id } = useParams();
  const normalizedType = type === "personnel" ? "personnel" : "enseignant";
  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [schoolInfo, setSchoolInfo] = useState(null);
  const [trimestres, setTrimestres] = useState([]);
  const [selectedTrimestreId, setSelectedTrimestreId] = useState("");
  const [hourlySummary, setHourlySummary] = useState(null);
  const [hourlySummaryLoading, setHourlySummaryLoading] = useState(false);
  const [hourlySummaryError, setHourlySummaryError] = useState("");
  const [monthlySummary, setMonthlySummary] = useState(null);
  const [monthlySummaryLoading, setMonthlySummaryLoading] = useState(false);
  const [monthlySummaryError, setMonthlySummaryError] = useState("");
  const [absenceSummary, setAbsenceSummary] = useState(null);
  const [absenceSummaryLoading, setAbsenceSummaryLoading] = useState(false);
  const [absenceSummaryError, setAbsenceSummaryError] = useState("");
  const [absenceSaving, setAbsenceSaving] = useState(false);
  const [absenceForm, setAbsenceForm] = useState({
    date: "",
    heure_debut: "",
    heure_fin: "",
    type: "absence",
    justifie: false,
    motif: "",
  });
  const [formData, setFormData] = useState(emptyProfile);
  const [editMode, setEditMode] = useState(false);
  const [activeTab, setActiveTab] = useState("general");
  const [saving, setSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [pageError, setPageError] = useState("");
  const [pageSuccess, setPageSuccess] = useState("");
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const showLoading = usePageLoadingVisibility(loading);

  useEffect(() => {
    let mounted = true;

    async function fetchProfile() {
      if (mounted) {
        setLoading(true);
        setPageError("");
      }
      try {
        const [response, authResponse, trimestresResponse] = await Promise.all([
          normalizedType === "enseignant"
            ? api.get(`/enseignants/${id}`)
            : api.get(`/personnels/${id}`),
          api.get("/auth/me"),
          normalizedType === "enseignant"
            ? api.get("/system/trimestres")
            : Promise.resolve({ data: [] }),
        ]);
        if (!mounted) return;
        const trimestreRows = trimestresResponse.data || [];
        setRecord(response.data);
        setFormData(profileFromRecord(normalizedType, response.data));
        setCurrentUser(authResponse.data?.user || null);
        setSchoolInfo(authResponse.data || null);
        setTrimestres(trimestreRows);
        setSelectedTrimestreId((prev) => prev || String(trimestreRows[0]?.id || ""));
      } catch (error) {
        console.error("Erreur chargement profil personnel:", error);
        if (mounted) {
          setPageError(
            error.response?.data?.error ||
              `Impossible de charger le profil ${normalizedType === "enseignant" ? "enseignant" : "personnel"}.`
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchProfile();

    return () => {
      mounted = false;
    };
  }, [id, normalizedType]);

  const isHourlyTeacher =
    normalizedType === "enseignant" &&
    normalizePaymentType(record?.typePayement || record?.type_payement || formData.typePayement) === "tauxHoraire";
  const isMonthlyTeacher =
    normalizedType === "enseignant" &&
    normalizePaymentType(record?.typePayement || record?.type_payement || formData.typePayement) === "salaire";

  useEffect(() => {
    if (!isHourlyTeacher) {
      return;
    }

    if (!selectedTrimestreId) {
      return;
    }

    let mounted = true;

    async function fetchHourlySummary() {
      setHourlySummaryLoading(true);
      setHourlySummaryError("");
      try {
        const response = await api.get(`/system/teachers/${id}/trimestre-hourly-summary`, {
          params: { trimestre_id: selectedTrimestreId },
        });
        if (!mounted) return;
        setHourlySummary(response.data || null);
      } catch (error) {
        if (!mounted) return;
        setHourlySummary(null);
        setHourlySummaryError(
          error.response?.data?.error ||
            "Impossible de calculer la remuneration horaire pour ce trimestre."
        );
      } finally {
        if (mounted) setHourlySummaryLoading(false);
      }
    }

    fetchHourlySummary();

    return () => {
      mounted = false;
    };
  }, [id, isHourlyTeacher, selectedTrimestreId]);

  useEffect(() => {
    if (!isMonthlyTeacher) {
      return;
    }

    if (!selectedTrimestreId) {
      return;
    }

    let mounted = true;

    async function fetchMonthlySummary() {
      setMonthlySummaryLoading(true);
      setMonthlySummaryError("");
      try {
        const response = await api.get(`/system/teachers/${id}/trimestre-monthly-summary`, {
          params: { trimestre_id: selectedTrimestreId },
        });
        if (!mounted) return;
        setMonthlySummary(response.data || null);
      } catch (error) {
        if (!mounted) return;
        const trimestre = trimestres.find((item) => String(item.id) === String(selectedTrimestreId));
        const fallbackSummary = buildLocalMonthlySummary({
          teacher: record,
          trimestre,
          historicalValues: record?.historique_salaires,
        });
        if (fallbackSummary) {
          setMonthlySummary(fallbackSummary);
          setMonthlySummaryError("");
          return;
        }

        setMonthlySummary(null);
        setMonthlySummaryError(
          error.response?.data?.error ||
            "Impossible de calculer la remuneration mensuelle pour ce trimestre."
        );
      } finally {
        if (mounted) setMonthlySummaryLoading(false);
      }
    }

    fetchMonthlySummary();

    return () => {
      mounted = false;
    };
  }, [id, isMonthlyTeacher, selectedTrimestreId, record, trimestres]);

  useEffect(() => {
    if (normalizedType !== "enseignant" || !selectedTrimestreId) {
      return;
    }

    let mounted = true;

    async function fetchAbsenceSummary() {
      setAbsenceSummaryLoading(true);
      setAbsenceSummaryError("");
      try {
        const response = await api.get(`/system/teachers/${id}/trimestre-absence-summary`, {
          params: { trimestre_id: selectedTrimestreId },
        });
        if (!mounted) return;
        setAbsenceSummary(response.data || null);
      } catch (error) {
        if (!mounted) return;
        setAbsenceSummary(null);
        setAbsenceSummaryError(
          error.response?.data?.error ||
            "Impossible de charger les absences de cet enseignant."
        );
      } finally {
        if (mounted) setAbsenceSummaryLoading(false);
      }
    }

    fetchAbsenceSummary();

    return () => {
      mounted = false;
    };
  }, [id, normalizedType, selectedTrimestreId, record, trimestres]);

  const quickStats = useMemo(
    () => {
      const baseMontant =
        normalizePaymentType(formData.typePayement) === "tauxHoraire"
          ? Number(formData.tauxHoraire || 0)
          : Number(formData.salaireMensuel || 0);
      const primes = Number(formData.prime || 0) + Number(formData.indemnites || 0);
      const deductions = Number(formData.avancesSalaire || 0) + Number(formData.retenues || 0);
      const brut = baseMontant + primes;
      const net = brut - deductions;

      return {
        baseRemuneration:
          normalizePaymentType(formData.typePayement) === "tauxHoraire"
            ? formatRate(formData.tauxHoraire)
            : formatMoney(formData.salaireMensuel),
        primes: formatMoney(primes),
        deductions: formatMoney(deductions),
        brut: formatMoney(brut),
        net: formatMoney(net),
      };
    },
    [formData]
  );

  const salaryHistoryEntries = useMemo(
    () => parseSalaryHistory(formData.historiqueSalaires),
    [formData.historiqueSalaires]
  );

  const canChangeOwnPassword = useMemo(() => {
    const currentEmail = String(currentUser?.email || "").trim().toLowerCase();
    const profileEmail = String(formData.email || "").trim().toLowerCase();
    return Boolean(currentUser?.id && currentEmail && profileEmail && currentEmail === profileEmail);
  }, [currentUser, formData.email]);

  const renderHourlyTrimestreSection = () => {
    if (!isHourlyTeacher) return null;

    return (
      <div className="mb-6 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 via-white to-sky-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-700">Rémunération horaire</p>
            <h4 className="mt-1 text-xl font-bold text-slate-900">Synthèse par trimestre</h4>
            <p className="mt-1 text-sm text-slate-600">
              Choisissez un trimestre pour calculer les créneaux à payer, en déduisant ceux déjà passés.
            </p>
          </div>

          <label className="w-full md:w-80">
            <span className="mb-1 block text-sm font-medium text-slate-700">Trimestre</span>
            <select
              value={selectedTrimestreId}
              onChange={(e) => setSelectedTrimestreId(e.target.value)}
              className="premium-control w-full rounded-2xl border border-slate-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            >
              <option value="">Sélectionner un trimestre</option>
              {trimestres.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} - {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {hourlySummaryLoading ? (
            <p className="text-sm text-slate-500">Calcul de la rémunération trimestrielle en cours...</p>
          ) : hourlySummaryError ? (
            <p className="text-sm font-medium text-rose-600">{hourlySummaryError}</p>
          ) : hourlySummary ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Créneaux totaux</p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{hourlySummary.totalSlots || 0}</p>
                </div>
                <div className="rounded-2xl bg-amber-50 p-4">
                  <p className="text-sm text-slate-500">Créneaux passés</p>
                  <p className="mt-2 text-2xl font-bold text-amber-700">{hourlySummary.passedSlots || 0}</p>
                </div>
                <div className="rounded-2xl bg-emerald-50 p-4">
                  <p className="text-sm text-slate-500">Créneaux restants</p>
                  <p className="mt-2 text-2xl font-bold text-emerald-700">{hourlySummary.remainingSlots || 0}</p>
                </div>
                <div className="rounded-2xl bg-blue-50 p-4">
                  <p className="text-sm text-slate-500">Total trimestre</p>
                  <p className="mt-2 text-2xl font-bold text-blue-700">{formatMoney(hourlySummary.totalAmount)}</p>
                </div>
                <div className="rounded-2xl bg-cyan-50 p-4">
                  <p className="text-sm text-slate-500">Déjà versé</p>
                  <p className="mt-2 text-2xl font-bold text-cyan-700">{formatMoney(hourlySummary.totalPaidAmount)}</p>
                </div>
                <div className="rounded-2xl bg-indigo-50 p-4">
                  <p className="text-sm text-slate-500">Reste à payer</p>
                  <p className="mt-2 text-2xl font-bold text-indigo-700">{formatMoney(hourlySummary.remainingAmount)}</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                  <p className="text-sm text-slate-500">Créneaux manqués</p>
                  <p className="mt-2 text-2xl font-bold text-rose-700">{Number(hourlySummary.absenceSlots || 0).toLocaleString('fr-FR')}</p>
                </div>
                <div className="rounded-2xl border border-orange-100 bg-orange-50 p-4">
                  <p className="text-sm text-slate-500">Heures manquées</p>
                  <p className="mt-2 text-2xl font-bold text-orange-700">{Number(hourlySummary.absenceHours || 0).toFixed(2)} h</p>
                </div>
                <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                  <p className="text-sm text-slate-500">Déduction absences</p>
                  <p className="mt-2 text-2xl font-bold text-rose-700">{formatMoney(hourlySummary.absenceDeductionAmount)}</p>
                </div>
              </div>

              <p className="mt-4 text-sm text-slate-600">
                Calcul: total du trimestre - déduction absences - total déjà versé = montant restant à payer.
              </p>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm text-slate-500">Taux horaire</p>
                  <p className="mt-2 text-xl font-bold text-slate-900">{formatRate(hourlySummary.hourlyRate)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm text-slate-500">Heures totales du trimestre</p>
                  <p className="mt-2 text-xl font-bold text-slate-900">{Number(hourlySummary.totalHours || 0).toFixed(2)} h</p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm text-slate-500">Heures restantes</p>
                  <p className="mt-2 text-xl font-bold text-slate-900">{Number(hourlySummary.remainingHours || 0).toFixed(2)} h</p>
                </div>
              </div>

              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[1120px] text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-3 text-left">Jour</th>
                      <th className="px-3 py-3 text-left">Créneau</th>
                      <th className="px-3 py-3 text-left">Classe</th>
                      <th className="px-3 py-3 text-left">Matière</th>
                      <th className="px-3 py-3 text-right">Occurrences</th>
                      <th className="px-3 py-3 text-right">Passées</th>
                      <th className="px-3 py-3 text-right">Restantes</th>
                      <th className="px-3 py-3 text-right">Absences</th>
                      <th className="px-3 py-3 text-right">Déduction</th>
                      <th className="px-3 py-3 text-right">Net</th>
                      <th className="px-3 py-3 text-right">Montant du créneau</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(hourlySummary.rows || []).map((row) => (
                      <tr key={row.id} className="border-b border-slate-100">
                        <td className="px-3 py-3 text-slate-700">{row.jour || '-'}</td>
                        <td className="px-3 py-3 text-slate-700">
                          {row.heure_debut || '-'}{row.heure_fin ? ` - ${row.heure_fin}` : ''}
                        </td>
                        <td className="px-3 py-3 text-slate-700">{row.classe || '-'}</td>
                        <td className="px-3 py-3 text-slate-700">{row.matiere || '-'}</td>
                        <td className="px-3 py-3 text-right text-slate-700">{row.total_slots || 0}</td>
                        <td className="px-3 py-3 text-right text-slate-700">{row.passed_slots || 0}</td>
                        <td className="px-3 py-3 text-right text-slate-700">{row.remaining_slots || 0}</td>
                        <td className="px-3 py-3 text-right text-slate-700">{row.absence_slots || 0}</td>
                        <td className="px-3 py-3 text-right text-slate-700">{formatMoney(row.absence_amount)}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-900">{formatMoney(row.net_amount)}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-900">{formatMoney(row.total_amount)}</td>
                      </tr>
                    ))}
                    {!hourlySummary.rows?.length ? (
                      <tr>
                        <td colSpan="11" className="px-3 py-8 text-center text-slate-400">
                          Aucun créneau horaire trouvé pour ce trimestre.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Sélectionnez un trimestre pour afficher les créneaux à payer.
            </p>
          )}
        </div>
      </div>
    );
  };

  const renderMonthlyTrimestreSection = () => {
    if (!isMonthlyTeacher) return null;

    return (
      <div className="mb-6 rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-lime-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Rémunération mensuelle</p>
            <h4 className="mt-1 text-xl font-bold text-slate-900">Synthèse par trimestre</h4>
            <p className="mt-1 text-sm text-slate-600">
              Le montant dû correspond au nombre de mois du trimestre, puis on retranche les montants déjà versés.
            </p>
          </div>

          <label className="w-full md:w-80">
            <span className="mb-1 block text-sm font-medium text-slate-700">Trimestre</span>
            <select
              value={selectedTrimestreId}
              onChange={(e) => setSelectedTrimestreId(e.target.value)}
              className="premium-control w-full rounded-2xl border border-slate-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
            >
              <option value="">Sélectionner un trimestre</option>
              {trimestres.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} - {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {monthlySummaryLoading ? (
            <p className="text-sm text-slate-500">Calcul de la rémunération mensuelle en cours...</p>
          ) : monthlySummaryError ? (
            <p className="text-sm font-medium text-rose-600">{monthlySummaryError}</p>
          ) : monthlySummary ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Mois du trimestre</p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{monthlySummary.totalMonths || 0}</p>
                </div>
                <div className="rounded-2xl bg-emerald-50 p-4">
                  <p className="text-sm text-slate-500">Mois payés</p>
                  <p className="mt-2 text-2xl font-bold text-emerald-700">{monthlySummary.paidMonths || 0}</p>
                </div>
                <div className="rounded-2xl bg-amber-50 p-4">
                  <p className="text-sm text-slate-500">Mois restants</p>
                  <p className="mt-2 text-2xl font-bold text-amber-700">{monthlySummary.remainingMonths || 0}</p>
                </div>
                <div className="rounded-2xl bg-blue-50 p-4">
                  <p className="text-sm text-slate-500">Total dû</p>
                  <p className="mt-2 text-2xl font-bold text-blue-700">{formatMoney(monthlySummary.totalDue)}</p>
                </div>
                <div className="rounded-2xl bg-indigo-50 p-4">
                  <p className="text-sm text-slate-500">Reste à payer</p>
                  <p className="mt-2 text-2xl font-bold text-indigo-700">{formatMoney(monthlySummary.remainingAmount)}</p>
                </div>
              </div>

              <p className="mt-4 text-sm text-slate-600">
                Calcul: nombre de mois du trimestre × salaire mensuel - total déjà versé.
              </p>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm text-slate-500">Salaire mensuel</p>
                  <p className="mt-2 text-xl font-bold text-slate-900">{formatMoney(monthlySummary.monthlySalary)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm text-slate-500">Total déjà versé</p>
                  <p className="mt-2 text-xl font-bold text-slate-900">{formatMoney(monthlySummary.totalPaid)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm text-slate-500">Mois payés</p>
                  <p className="mt-2 text-xl font-bold text-slate-900">{monthlySummary.paidMonthsList?.length || 0}</p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-800">Mois payés</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {monthlySummary.paidMonthsList?.length ? (
                    monthlySummary.paidMonthsList.map((item) => (
                      <span
                        key={item.month}
                        className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800"
                      >
                        {item.label} • {formatMoney(item.paid_amount)}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-slate-500">Aucun mois payé pour ce trimestre.</span>
                  )}
                </div>
              </div>

              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-3 text-left">Mois</th>
                      <th className="px-3 py-3 text-right">Dû</th>
                      <th className="px-3 py-3 text-right">Versé</th>
                      <th className="px-3 py-3 text-right">Reste</th>
                      <th className="px-3 py-3 text-left">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(monthlySummary.months || []).map((row) => (
                      <tr key={row.month} className="border-b border-slate-100">
                        <td className="px-3 py-3 text-slate-700">{row.label || row.month || '-'}</td>
                        <td className="px-3 py-3 text-right text-slate-700">{formatMoney(row.due_amount)}</td>
                        <td className="px-3 py-3 text-right text-slate-700">{formatMoney(row.paid_amount)}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-900">{formatMoney(row.remaining_amount)}</td>
                        <td className="px-3 py-3 text-slate-700">
                          {row.is_paid ? 'Payé' : row.is_partial ? 'Partiel' : 'Non payé'}
                        </td>
                      </tr>
                    ))}
                    {!monthlySummary.months?.length ? (
                      <tr>
                        <td colSpan="5" className="px-3 py-8 text-center text-slate-400">
                          Aucun mois trouvé pour ce trimestre.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Sélectionnez un trimestre pour afficher le détail des mois payés.
            </p>
          )}
        </div>
      </div>
    );
  };

  const renderTeacherAbsenceSection = () => {
    if (normalizedType !== "enseignant") return null;

    const details = absenceSummary?.absenceDetails || [];

    return (
      <div className="mb-6 rounded-2xl border border-rose-100 bg-gradient-to-r from-rose-50 via-white to-orange-50 p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-700">Absences enseignant</p>
            <h4 className="mt-1 text-xl font-bold text-slate-900">Gestion et impact sur les créneaux</h4>
            <p className="mt-1 text-sm text-slate-600">
              Enregistre les absences du trimestre et calcule automatiquement les créneaux et heures manqués.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            <p className="text-xs uppercase tracking-wide text-slate-500">Trimestre actif</p>
            <p className="mt-1 font-semibold text-slate-900">
              {trimestres.find((item) => String(item.id) === String(selectedTrimestreId)) ? `${trimestres.find((item) => String(item.id) === String(selectedTrimestreId)).code} - ${trimestres.find((item) => String(item.id) === String(selectedTrimestreId)).label}` : '-'}
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {absenceSummaryLoading ? (
            <p className="text-sm text-slate-500">Chargement des absences enseignant...</p>
          ) : absenceSummaryError ? (
            <p className="text-sm font-medium text-rose-600">{absenceSummaryError}</p>
          ) : absenceSummary ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm text-slate-500">Absences enregistrées</p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{(details || []).length}</p>
                </div>
                <div className="rounded-2xl bg-amber-50 p-4">
                  <p className="text-sm text-slate-500">Créneaux manqués</p>
                  <p className="mt-2 text-2xl font-bold text-amber-700">{Number(absenceSummary.absenceSlots || 0).toLocaleString('fr-FR')}</p>
                </div>
                <div className="rounded-2xl bg-orange-50 p-4">
                  <p className="text-sm text-slate-500">Heures manquées</p>
                  <p className="mt-2 text-2xl font-bold text-orange-700">{Number(absenceSummary.absenceHours || 0).toFixed(2)} h</p>
                </div>
                <div className="rounded-2xl bg-rose-50 p-4">
                  <p className="text-sm text-slate-500">Déduction absences</p>
                  <p className="mt-2 text-2xl font-bold text-rose-700">{formatMoney(absenceSummary.absenceDeductionAmount)}</p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm text-slate-500">Total brut du trimestre</p>
                  <p className="mt-2 text-xl font-bold text-slate-900">{formatMoney(absenceSummary.totalAmount)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm text-slate-500">Montant net dû</p>
                  <p className="mt-2 text-xl font-bold text-slate-900">{formatMoney(absenceSummary.netAmountDue)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm text-slate-500">Reste à payer</p>
                  <p className="mt-2 text-xl font-bold text-slate-900">{formatMoney(absenceSummary.remainingAmount)}</p>
                </div>
              </div>

              <form onSubmit={handleCreateAbsence} className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2 xl:grid-cols-6">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Date</label>
                  <input
                    type="date"
                    className="w-full rounded-2xl border border-slate-300 px-3 py-2"
                    value={absenceForm.date}
                    onChange={(e) => handleAbsenceFormChange('date', e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Heure début</label>
                  <input
                    type="time"
                    className="w-full rounded-2xl border border-slate-300 px-3 py-2"
                    value={absenceForm.heure_debut}
                    onChange={(e) => handleAbsenceFormChange('heure_debut', e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Heure fin</label>
                  <input
                    type="time"
                    className="w-full rounded-2xl border border-slate-300 px-3 py-2"
                    value={absenceForm.heure_fin}
                    onChange={(e) => handleAbsenceFormChange('heure_fin', e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Type</label>
                  <select
                    className="w-full rounded-2xl border border-slate-300 px-3 py-2"
                    value={absenceForm.type}
                    onChange={(e) => handleAbsenceFormChange('type', e.target.value)}
                  >
                    <option value="absence">Absence</option>
                    <option value="retard">Retard</option>
                    <option value="conge">Congé</option>
                    <option value="mission">Mission</option>
                  </select>
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={absenceForm.justifie}
                      onChange={(e) => handleAbsenceFormChange('justifie', e.target.checked)}
                    />
                    Justifiée
                  </label>
                </div>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={absenceSaving}
                    className="w-full rounded-2xl bg-rose-600 px-4 py-2 text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {absenceSaving ? 'Enregistrement...' : 'Ajouter'}
                  </button>
                </div>
                <div className="md:col-span-2 xl:col-span-6">
                  <label className="mb-1 block text-sm font-medium text-slate-700">Motif</label>
                  <textarea
                    className="w-full rounded-2xl border border-slate-300 px-3 py-2"
                    rows={3}
                    value={absenceForm.motif}
                    onChange={(e) => handleAbsenceFormChange('motif', e.target.value)}
                    placeholder="Motif de l'absence ou du retard"
                  />
                </div>
                <p className="md:col-span-2 xl:col-span-6 text-xs text-slate-500">
                  Laissez les heures vides pour enregistrer une absence sur toute la journée.
                </p>
              </form>

              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-3 text-left">Date</th>
                      <th className="px-3 py-3 text-left">Type</th>
                      <th className="px-3 py-3 text-left">Heure</th>
                      <th className="px-3 py-3 text-right">Creneaux</th>
                      <th className="px-3 py-3 text-right">Heures</th>
                      <th className="px-3 py-3 text-right">Montant</th>
                      <th className="px-3 py-3 text-left">Motif</th>
                      <th className="px-3 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.map((item) => (
                      <tr key={item.id} className="border-b border-slate-100">
                        <td className="px-3 py-3 text-slate-700">{formatDate(item.date)}</td>
                        <td className="px-3 py-3 text-slate-700">{item.type || '-'}</td>
                        <td className="px-3 py-3 text-slate-700">
                          {item.heure_debut || item.heure_fin ? `${item.heure_debut || '--'} - ${item.heure_fin || '--'}` : 'Journée complète'}
                        </td>
                        <td className="px-3 py-3 text-right text-slate-700">{Number(item.missed_slots || 0)}</td>
                        <td className="px-3 py-3 text-right text-slate-700">{Number(item.missed_hours || 0).toFixed(2)}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-900">{formatMoney(item.missed_amount)}</td>
                        <td className="px-3 py-3 text-slate-700">{item.motif || '-'}</td>
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteTeacherAbsence(item.id)}
                            className="rounded-md bg-rose-600 px-3 py-1 text-xs text-white"
                          >
                            Supprimer
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!details.length ? (
                      <tr>
                        <td colSpan="8" className="px-3 py-8 text-center text-slate-400">
                          Aucune absence enregistrée pour ce trimestre.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Sélectionnez un trimestre pour afficher et gérer les absences.
            </p>
          )}
        </div>
      </div>
    );
  };

  const handleDownloadProfilePdf = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const financeBaseLabel = getFinanceBaseLabel(formData.typePayement);
    const financeBaseValue =
      normalizePaymentType(formData.typePayement) === "tauxHoraire"
        ? formatRate(formData.tauxHoraire)
        : formatMoney(formData.salaireMensuel);

    doc.setFillColor(30, 58, 138);
    doc.roundedRect(12, 10, pageWidth - 24, 26, 5, 5, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text("Fiche d'informations du personnel", 18, 22);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Genere le ${displayDate(new Date().toISOString())}`, pageWidth - 18, 22, { align: "right" });

    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(formData.nomComplet || "Personnel", 18, 48);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Matricule: ${formData.matricule || "-"}`, 18, 55);
    doc.text(`Poste: ${formData.poste || "-"}`, 18, 61);
    doc.text(`Statut: ${formData.statut || "-"}`, 18, 67);

    if (formData.photo && String(formData.photo).startsWith("data:image/")) {
      try {
        const imageFormat = String(formData.photo).includes("image/png") ? "PNG" : "JPEG";
        doc.addImage(formData.photo, imageFormat, pageWidth - 42, 44, 24, 24);
      } catch (imageError) {
        console.error("Erreur ajout photo profil personnel au PDF:", imageError);
      }
    }

    autoTable(doc, {
      startY: 76,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 2.5, textColor: [15, 23, 42] },
      headStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: "bold" },
      body: [
        [{ content: "Informations generales", colSpan: 2, styles: { fontStyle: "bold" } }],
        ["Nom complet", formData.nomComplet || "-"],
        ["Matricule", formData.matricule || "-"],
        ["Sexe", formData.sexe || "-"],
        ["Date naissance", displayDate(formData.dateNaissance)],
        ["Age", formData.age || "-"],
        ["Nationalite", formData.nationalite || "-"],
        ["Telephone", formData.telephone || "-"],
        ["Email", formData.email || "-"],
        ["Adresse", formData.adresse || "-"],
        ["Situation matrimoniale", formData.situationMatrimoniale || "-"],
        [{ content: "Professionnel", colSpan: 2, styles: { fontStyle: "bold" } }],
        ["Type personnel", formData.typePersonnel || "-"],
        ["Poste", formData.poste || "-"],
        ["Departement", formData.departement || "-"],
        ["Specialite", formData.specialite || "-"],
        ["Date recrutement", displayDate(formData.dateRecrutement)],
        ["Anciennete", formData.anciennete || "-"],
        ["Type contrat", formData.typeContrat || "-"],
        ["Temps travail", formData.tempsTravail || "-"],
        [{ content: "Finance", colSpan: 2, styles: { fontStyle: "bold" } }],
        ["Type remuneration", formData.typePayement || "-"],
        [financeBaseLabel, financeBaseValue],
        ["Prime", formatMoney(formData.prime)],
        ["Indemnites", formatMoney(formData.indemnites)],
        ["Mode paiement", formData.modePaiement || "-"],
        ["Etat paiements", formData.etatPaiements || "-"],
        [{ content: "Urgence", colSpan: 2, styles: { fontStyle: "bold" } }],
        ["Contact urgence", formData.contactUrgenceNom || "-"],
        ["Telephone urgence", formData.contactUrgenceTelephone || "-"],
        ["Lien urgence", formData.contactUrgenceLien || "-"],
        ["Adresse urgence", formData.contactUrgenceAdresse || "-"],
      ],
    });

    doc.save(`${sanitizeFileName(formData.nomComplet)}-profil.pdf`);
  };

  const handleDownloadPaymentPdf = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const paymentType = normalizePaymentType(record?.typePayement || record?.type_payement || formData.typePayement);
    const isHourly = paymentType === "tauxHoraire";
    const isMonthly = paymentType === "salaire";
    const financeBaseLabel = getFinanceBaseLabel(paymentType || formData.typePayement);
    const financeBaseValue = isHourly ? formatRate(formData.tauxHoraire) : formatMoney(formData.salaireMensuel);
    const baseMontant = isHourly ? Number(formData.tauxHoraire || 0) : Number(formData.salaireMensuel || 0);
    const totalBrut = baseMontant + Number(formData.prime || 0) + Number(formData.indemnites || 0);
    const totalNet = totalBrut - Number(formData.avancesSalaire || 0) - Number(formData.retenues || 0);
    const genericHistory = parseHistoryLines(formData.historiqueSalaires, ["mois", "montant", "statut"]);
    const hourlyRows = (hourlySummary?.rows || []).map((row) => [
      row.jour || "-",
      `${row.heure_debut || "-"}${row.heure_fin ? ` - ${row.heure_fin}` : ""}`,
      row.classe || "-",
      row.matiere || "-",
      String(row.total_slots || 0),
      String(row.passed_slots || 0),
      String(row.remaining_slots || 0),
      String(row.absence_slots || 0),
      formatMoney(row.absence_amount),
      formatMoney(row.net_amount),
      formatMoney(row.total_amount),
    ]);
    const monthlyRows = (monthlySummary?.months || []).map((row) => [
      row.label || row.month || "-",
      formatMoney(row.due_amount),
      formatMoney(row.paid_amount),
      formatMoney(row.remaining_amount),
      row.is_paid ? "Payé" : row.is_partial ? "Partiel" : "Non payé",
    ]);

    doc.setFillColor(5, 150, 105);
    doc.roundedRect(12, 10, pageWidth - 24, 26, 5, 5, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text(
      isHourly
        ? "Bulletin de versement horaire"
        : isMonthly
          ? "Bulletin de versement mensuel"
          : "Bulletin de versement / fiche de paie",
      18,
      22
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Genere le ${displayDate(new Date().toISOString())}`, pageWidth - 18, 22, { align: "right" });

    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    if (formData.photo && String(formData.photo).startsWith("data:image/")) {
      try {
        const imageFormat = String(formData.photo).includes("image/png") ? "PNG" : "JPEG";
        doc.addImage(formData.photo, imageFormat, 18, 46, 22, 22);
      } catch (imageError) {
        console.error("Erreur ajout photo personnel au bulletin de versement:", imageError);
      }
    }
    doc.text(formData.nomComplet || "Personnel", 44, 48);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Matricule: ${formData.matricule || "-"}`, 44, 55);
    doc.text(`Poste: ${formData.poste || "-"}`, 44, 61);
    doc.text(`Type remuneration: ${getPaymentTypeLabel(paymentType || formData.typePayement)}`, 44, 67);
    doc.text(`Mode paiement: ${formData.modePaiement || "-"}`, 44, 73);
    doc.text(`Telephone: ${formData.telephone || "-"}`, 44, 79);
    doc.text(`Email: ${formData.email || "-"}`, 44, 85);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(pageWidth - 82, 48, 70, 40, 3, 3, "F");
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.text("Contact etablissement", pageWidth - 77, 55);
    doc.setFont("helvetica", "normal");
    doc.text(schoolInfo?.name || "-", pageWidth - 77, 61);
    doc.text(`Tel: ${schoolInfo?.phone || "-"}`, pageWidth - 77, 67);
    doc.text(`Email: ${schoolInfo?.email || "-"}`, pageWidth - 77, 73);
    doc.text(`Adresse: ${schoolInfo?.address || "-"}`, pageWidth - 77, 79);

    autoTable(doc, {
      startY: 96,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 2.5, textColor: [15, 23, 42] },
      headStyles: {
        fillColor: isHourly ? [219, 234, 254] : isMonthly ? [220, 252, 231] : [220, 252, 231],
        textColor: isHourly ? [30, 64, 175] : [6, 78, 59],
        fontStyle: "bold",
      },
      body: [
        [financeBaseLabel, financeBaseValue],
        ["Prime", formatMoney(formData.prime)],
        ["Indemnites", formatMoney(formData.indemnites)],
        ["Avances", formatMoney(formData.avancesSalaire)],
        ["Retenues", formatMoney(formData.retenues)],
        ["Etat paiement", formData.etatPaiements || "-"],
        ["Total brut", formatMoney(totalBrut)],
        ["Net a verser", formatMoney(totalNet)],
      ],
    });

    const summaryEndY = doc.lastAutoTable?.finalY || 96;

    if (isHourly && hourlySummary) {
      autoTable(doc, {
        startY: summaryEndY + 10,
        head: [["Jour", "Créneau", "Classe", "Matière", "Occur.", "Passées", "Rest.", "Abs.", "Déduction", "Net", "Montant"]],
        body: hourlyRows.length ? hourlyRows : [["-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "Aucun créneau horaire"]],
        theme: "grid",
        styles: { fontSize: 7.8, cellPadding: 2, textColor: [15, 23, 42] },
        headStyles: { fillColor: [219, 234, 254], textColor: [30, 64, 175], fontStyle: "bold" },
        margin: { left: 14, right: 14 },
        didDrawPage: () => {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.setTextColor(15, 23, 42);
          doc.text("Détail des créneaux à payer", 14, summaryEndY + 6);
        },
      });
    } else if (isMonthly && monthlySummary) {
      autoTable(doc, {
        startY: summaryEndY + 10,
        head: [["Mois", "Dû", "Versé", "Reste", "Statut"]],
        body: monthlyRows.length ? monthlyRows : [["-", "-", "-", "-", "Aucun mois trouvé"]],
        theme: "grid",
        styles: { fontSize: 8.2, cellPadding: 2.2, textColor: [15, 23, 42] },
        headStyles: { fillColor: [220, 252, 231], textColor: [6, 78, 59], fontStyle: "bold" },
        margin: { left: 14, right: 14 },
        didDrawPage: () => {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.setTextColor(15, 23, 42);
          doc.text("Mois payés / à payer", 14, summaryEndY + 6);
        },
      });
    } else {
      autoTable(doc, {
        startY: summaryEndY + 10,
        head: [["Mois / Periode", "Montant", "Statut"]],
        body: genericHistory.length
          ? genericHistory.map((item) => [item.mois || "-", formatMoney(item.montant), item.statut || "-"])
          : [["-", "-", "Aucun historique de paiement enregistre"]],
        theme: "grid",
        styles: { fontSize: 8.5, cellPadding: 2.5, textColor: [15, 23, 42] },
        headStyles: { fillColor: [219, 234, 254], textColor: [30, 64, 175], fontStyle: "bold" },
        didDrawPage: () => {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.setTextColor(15, 23, 42);
          doc.text("Historique des paiements", 14, summaryEndY + 6);
        },
      });
    }

    doc.save(`${sanitizeFileName(formData.nomComplet)}-versement.pdf`);
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "dateNaissance") next.age = computeAge(value);
      if (field === "dateRecrutement") next.anciennete = computeAnciennete(value);
      return next;
    });
  };

  const handlePhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPageError("Veuillez choisir une image valide pour la photo de profil.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setFormData((prev) => ({ ...prev, photo: String(reader.result || "") }));
      setPageError("");
    };
    reader.onerror = () => {
      setPageError("Impossible de lire cette image. Veuillez reessayer.");
    };
    reader.readAsDataURL(file);
  };

  const handleCancel = () => {
    setEditMode(false);
    setFormData(profileFromRecord(normalizedType, record));
    setPageSuccess("");
  };

  const handlePasswordFieldChange = (field, value) => {
    setPasswordForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePasswordChange = async (event) => {
    event.preventDefault();
    setPageError("");
    setPageSuccess("");

    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPageError("Tous les champs du mot de passe sont requis.");
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      setPageError("Le nouveau mot de passe doit contenir au moins 8 caracteres.");
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPageError("La confirmation du nouveau mot de passe ne correspond pas.");
      return;
    }

    setPasswordSaving(true);
    try {
      const response = await api.post("/auth/change-password", {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setPageSuccess(response.data?.message || "Mot de passe modifie avec succes.");
    } catch (error) {
      console.error("Erreur changement mot de passe:", error);
      setPageError(error.response?.data?.error || "Impossible de modifier le mot de passe.");
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleAbsenceFormChange = (field, value) => {
    setAbsenceForm((prev) => ({ ...prev, [field]: value }));
  };

  const reloadAbsenceSummary = async () => {
    if (normalizedType !== "enseignant" || !selectedTrimestreId) return;
    const response = await api.get(`/system/teachers/${id}/trimestre-absence-summary`, {
      params: { trimestre_id: selectedTrimestreId },
    });
    setAbsenceSummary(response.data || null);
  };

  const handleCreateAbsence = async (event) => {
    event.preventDefault();
    if (!selectedTrimestreId) {
      setPageError("Sélectionnez d'abord un trimestre.");
      return;
    }

    setAbsenceSaving(true);
    setPageError("");
    setPageSuccess("");
    try {
      await api.post(`/system/teachers/${id}/absences`, {
        ...absenceForm,
        justifie: absenceForm.justifie ? 1 : 0,
      });
      setAbsenceForm({
        date: "",
        heure_debut: "",
        heure_fin: "",
        type: "absence",
        justifie: false,
        motif: "",
      });
      await reloadAbsenceSummary();
      setPageSuccess("Absence enseignant enregistrée avec succès.");
    } catch (error) {
      console.error("Erreur enregistrement absence enseignant:", error);
      setPageError(error.response?.data?.error || "Impossible d'enregistrer l'absence.");
    } finally {
      setAbsenceSaving(false);
    }
  };

  const handleDeleteTeacherAbsence = async (absenceId) => {
    try {
      setPageError("");
      setPageSuccess("");
      await api.delete(`/system/teacher-absences/${absenceId}`);
      await reloadAbsenceSummary();
      setPageSuccess("Absence enseignant supprimée avec succès.");
    } catch (error) {
      console.error("Erreur suppression absence enseignant:", error);
      setPageError(error.response?.data?.error || "Impossible de supprimer l'absence.");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setPageError("");
    setPageSuccess("");
    try {
      const payload = buildPayload(formData, normalizedType);
      if (normalizedType === "enseignant") {
        await api.put(`/enseignants/${id}`, payload);
      } else {
        await api.put(`/personnels/${id}`, payload);
      }
      const refreshed =
        normalizedType === "enseignant"
          ? await api.get(`/enseignants/${id}`)
          : await api.get(`/personnels/${id}`);
      setRecord(refreshed.data);
      setFormData(profileFromRecord(normalizedType, refreshed.data));
      setEditMode(false);
      setPageSuccess(
        `Le profil ${normalizedType === "enseignant" ? "enseignant" : "personnel"} a ete enregistre avec succes.`
      );
    } catch (error) {
      console.error("Erreur sauvegarde profil personnel:", error);
      setPageError(
        error.response?.data?.error ||
          `La mise a jour du profil ${normalizedType === "enseignant" ? "enseignant" : "personnel"} a echoue.`
      );
    } finally {
      setSaving(false);
    }
  };

  const renderGeneralTab = () => (
    <SectionCard title="Informations Generales" icon={UserIcon}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InputField label="Nom complet" value={formData.nomComplet} field="nomComplet" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Matricule" value={formData.matricule} field="matricule" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Sexe" value={formData.sexe} field="sexe" editMode={editMode} onChange={handleInputChange} selectOptions={sexeOptions} />
        <InputField label="Date de naissance" value={formData.dateNaissance} field="dateNaissance" type="date" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Age" value={formData.age} field="age" editMode={false} onChange={handleInputChange} />
        <InputField label="Nationalite" value={formData.nationalite} field="nationalite" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Adresse" value={formData.adresse} field="adresse" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Telephone" value={formData.telephone} field="telephone" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Email" value={formData.email} field="email" type="email" editMode={editMode} onChange={handleInputChange} />
        <InputField
          label="Situation matrimoniale"
          value={formData.situationMatrimoniale}
          field="situationMatrimoniale"
          editMode={editMode}
          onChange={handleInputChange}
          selectOptions={situationMatrimonialeOptions}
        />
        <InputField label="Statut" value={formData.statut} field="statut" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Date de recrutement" value={formData.dateRecrutement} field="dateRecrutement" type="date" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Anciennete" value={formData.anciennete} field="anciennete" editMode={false} onChange={handleInputChange} />
        <InputField
          label="Type de personnel"
          value={formData.typePersonnel}
          field="typePersonnel"
          editMode={editMode}
          onChange={handleInputChange}
          selectOptions={typePersonnelOptions}
        />
      </div>
    </SectionCard>
  );

  const renderProfessionalTab = () => (
    <SectionCard title="Informations Professionnelles" icon={BuildingOffice2Icon}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InputField
          label="Poste occupe"
          value={formData.poste}
          field="poste"
          editMode={editMode}
          onChange={handleInputChange}
          selectOptions={posteOptions}
        />
        <InputField label="Departement / Service" value={formData.departement} field="departement" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Specialite" value={formData.specialite} field="specialite" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Diplomes" value={formData.diplomes} field="diplomes" editMode={editMode} onChange={handleInputChange} textarea />
        <InputField label="Niveau d'etude" value={formData.niveauEtude} field="niveauEtude" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Experience professionnelle" value={formData.experience} field="experience" editMode={editMode} onChange={handleInputChange} textarea />
        <InputField label="Competences" value={formData.competences} field="competences" editMode={editMode} onChange={handleInputChange} textarea placeholder="Separez par des virgules" />
        <InputField label="Horaires de travail" value={formData.horairesTravail} field="horairesTravail" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Numero d'employe" value={formData.numeroEmploye} field="numeroEmploye" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Type de contrat" value={formData.typeContrat} field="typeContrat" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Date debut contrat" value={formData.dateDebutContrat} field="dateDebutContrat" type="date" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Date fin contrat" value={formData.dateFinContrat} field="dateFinContrat" type="date" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Temps plein / partiel" value={formData.tempsTravail} field="tempsTravail" editMode={editMode} onChange={handleInputChange} />
      </div>
    </SectionCard>
  );

  const renderTeacherTab = () => (
    <SectionCard title="Informations Pour Les Enseignants" icon={AcademicCapIcon}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InputField label="Matieres enseignees" value={formData.matieres} field="matieres" editMode={editMode} onChange={handleInputChange} textarea placeholder="Separez par des virgules" />
        <InputField label="Classes affectees" value={formData.classes} field="classes" editMode={editMode} onChange={handleInputChange} textarea placeholder="Separez par des virgules" />
        <InputField label="Volume horaire" value={formData.volumeHoraire} field="volumeHoraire" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Emploi du temps" value={formData.emploiDuTemps} field="emploiDuTemps" editMode={editMode} onChange={handleInputChange} textarea />
        <InputField label="Professeur principal" value={formData.professeurPrincipal} field="professeurPrincipal" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Nombre d'eleves suivis" value={formData.nombreEleves} field="nombreEleves" type="number" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Historique des affectations" value={formData.historiqueAffectations} field="historiqueAffectations" editMode={editMode} onChange={handleInputChange} textarea placeholder="Une ligne par element: periode | valeur" />
        <InputField label="Resultats des classes" value={formData.resultatsClasses} field="resultatsClasses" editMode={editMode} onChange={handleInputChange} textarea placeholder="Une ligne: classe | moyenne | succes" />
        <InputField label="Absences de l'enseignant" value={formData.absencesEnseignant} field="absencesEnseignant" type="number" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Retards" value={formData.retards} field="retards" type="number" editMode={editMode} onChange={handleInputChange} />
        <div className="md:col-span-2">
          <InputField label="Observations pedagogiques" value={formData.observationsPedagogiques} field="observationsPedagogiques" editMode={editMode} onChange={handleInputChange} textarea />
        </div>
      </div>
    </SectionCard>
  );

  const renderAdminTab = () => (
    <SectionCard title="Informations Administratives" icon={DocumentTextIcon}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InputField label="Numero NINA / CIN" value={formData.nina} field="nina" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Numero INPS" value={formData.inps} field="inps" editMode={editMode} onChange={handleInputChange} />
        <InputField label="References administratives" value={formData.referencesAdministratives} field="referencesAdministratives" editMode={editMode} onChange={handleInputChange} textarea />
        <InputField label="Documents d'identite" value={formData.documentsIdentite} field="documentsIdentite" editMode={editMode} onChange={handleInputChange} textarea />
        <InputField label="Diplomes scannes" value={formData.diplomesScannes} field="diplomesScannes" editMode={editMode} onChange={handleInputChange} textarea />
        <InputField label="Contrat de travail" value={formData.contratTravail} field="contratTravail" editMode={editMode} onChange={handleInputChange} textarea />
        <InputField label="CV" value={formData.cv} field="cv" editMode={editMode} onChange={handleInputChange} textarea />
        <InputField label="Attestations" value={formData.attestations} field="attestations" editMode={editMode} onChange={handleInputChange} textarea />
        <InputField label="Date de prise de service" value={formData.datePriseService} field="datePriseService" type="date" editMode={editMode} onChange={handleInputChange} />
      </div>
    </SectionCard>
  );

  const renderFinanceTab = () => (
    <SectionCard title="Salaire Et Finance" icon={CurrencyDollarIcon}>
      {isHourlyTeacher ? renderHourlyTrimestreSection() : null}
      {isMonthlyTeacher ? renderMonthlyTrimestreSection() : null}
      {renderTeacherAbsenceSection()}
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Apercu financier</p>
            <h3 className="mt-1 text-xl font-bold text-slate-900">Resume de remuneration</h3>
            <p className="mt-1 text-sm text-slate-600">
              La synthese trimestrielle ci-dessus sert maintenant de base pour le paiement horaire.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-slate-500">Type de remuneration</p>
            <p className="mt-1 text-base font-semibold text-slate-900">{getPaymentTypeLabel(formData.typePayement)}</p>
          </div>
        </div>
      </div>
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Catalogue salaire</p>
            <h4 className="mt-1 text-lg font-semibold text-slate-900">Historique des versements</h4>
            <p className="mt-1 text-sm text-slate-600">
              Cette vue resume les montants saisis pour chaque mois ou periode du profil.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Base de remuneration</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{getFinanceBaseLabel(formData.typePayement)}</p>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr className="border-b border-slate-200">
                <th className="px-3 py-3 text-left">Mois / periode</th>
                <th className="px-3 py-3 text-right">Montant</th>
                <th className="px-3 py-3 text-left">Statut</th>
              </tr>
            </thead>
            <tbody>
              {salaryHistoryEntries.length ? (
                salaryHistoryEntries.map((item, index) => (
                  <tr key={`${item.mois || 'salary'}-${index}`} className="border-b border-slate-100">
                    <td className="px-3 py-3 text-slate-700">{item.mois || '-'}</td>
                    <td className="px-3 py-3 text-right text-slate-700">{formatMoney(item.montant)}</td>
                    <td className="px-3 py-3 text-slate-700">{item.statut || '-'}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="3" className="px-3 py-8 text-center text-slate-400">
                    Aucun historique salarial disponible.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="hidden">
        <div className="premium-card rounded-2xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-sm text-slate-600">{getFinanceBaseLabel(formData.typePayement)}</p>
          <p className="mt-2 text-2xl font-bold text-blue-700">{quickStats.baseRemuneration}</p>
        </div>
        <div className="premium-card rounded-2xl border border-green-100 bg-green-50 p-4">
          <p className="text-sm text-slate-600">Primes et indemnites</p>
          <p className="mt-2 text-2xl font-bold text-green-700">{quickStats.primes}</p>
        </div>
        <div className="premium-card rounded-2xl border border-rose-100 bg-rose-50 p-4">
          <p className="text-sm text-slate-600">Avances et retenues</p>
          <p className="mt-2 text-2xl font-bold text-rose-700">{quickStats.deductions}</p>
        </div>
        <div className="premium-card rounded-2xl border border-amber-100 bg-amber-50 p-4">
          <p className="text-sm text-slate-600">Total brut</p>
          <p className="mt-2 text-2xl font-bold text-amber-700">{quickStats.brut}</p>
        </div>
        <div className="premium-card rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-sm text-slate-600">Net a verser</p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{quickStats.net}</p>
        </div>
      </div>
      <div className="hidden">
        <div className="surface-card premium-card rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h4 className="text-lg font-semibold text-slate-900">Base de remuneration</h4>
              <p className="text-sm text-slate-500">Configurez le mode de paiement principal du profil.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <InputField
              label="Type de remuneration"
              value={formData.typePayement}
              field="typePayement"
              editMode={editMode}
              onChange={handleInputChange}
              selectOptions={typeRemunerationOptions}
            />
            <InputField label="Mode de paiement" value={formData.modePaiement} field="modePaiement" editMode={editMode} onChange={handleInputChange} />
            <InputField
              label="Regle paiement partiel"
              value={formData.reglePaiementPartiel}
              field="reglePaiementPartiel"
              editMode={editMode}
              onChange={handleInputChange}
              selectOptions={paymentRuleOptions}
            />
            <InputField
              label="Echeance de paiement"
              value={formData.echeancePaiement}
              field="echeancePaiement"
              editMode={editMode}
              onChange={handleInputChange}
              selectOptions={paymentScheduleOptions}
            />
            <InputField
              label="Salaire mensuel"
              value={formData.salaireMensuel}
              field="salaireMensuel"
              type="number"
              editMode={editMode}
              onChange={handleInputChange}
            />
            <InputField
              label="Taux horaire"
              value={formData.tauxHoraire}
              field="tauxHoraire"
              type="number"
              editMode={editMode}
              onChange={handleInputChange}
            />
            <InputField
              label="Montant par creneau"
              value={formData.montantCreneau}
              field="montantCreneau"
              type="number"
              editMode={editMode}
              onChange={handleInputChange}
            />
            <InputField
              label="Forfait trimestriel"
              value={formData.montantForfaitTrimestre}
              field="montantForfaitTrimestre"
              type="number"
              editMode={editMode}
              onChange={handleInputChange}
            />
            <InputField label="Etat des paiements" value={formData.etatPaiements} field="etatPaiements" editMode={editMode} onChange={handleInputChange} />
          </div>
        </div>
        <div className="surface-card premium-card rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
          <h4 className="text-lg font-semibold text-slate-900">Incidences sur le versement</h4>
          <p className="mb-4 text-sm text-slate-500">Les montants ci-dessous sont pris en compte dans la fiche de paie.</p>
          <div className="grid grid-cols-1 gap-4">
            <InputField label="Prime" value={formData.prime} field="prime" type="number" editMode={editMode} onChange={handleInputChange} />
            <InputField label="Indemnites" value={formData.indemnites} field="indemnites" type="number" editMode={editMode} onChange={handleInputChange} />
            <InputField label="Avances sur salaire" value={formData.avancesSalaire} field="avancesSalaire" type="number" editMode={editMode} onChange={handleInputChange} />
            <InputField label="Retenues" value={formData.retenues} field="retenues" type="number" editMode={editMode} onChange={handleInputChange} />
          </div>
        </div>
      </div>
      <div className="hidden">
        <div className="md:col-span-2">
          <InputField label="Historique des salaires" value={formData.historiqueSalaires} field="historiqueSalaires" editMode={editMode} onChange={handleInputChange} textarea placeholder="Une ligne: mois | montant | statut" />
        </div>
      </div>
    </SectionCard>
  );

  const renderPresenceTab = () => (
    <SectionCard title="Presence Et Discipline" icon={ClockIcon}>
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="premium-card rounded-2xl bg-red-50 p-4 text-center">
          <p className="text-sm text-gray-600">Absences</p>
          <p className="text-3xl font-bold text-red-600">{formData.absences || 0}</p>
        </div>
        <div className="premium-card rounded-2xl bg-yellow-50 p-4 text-center">
          <p className="text-sm text-gray-600">Retards</p>
          <p className="text-3xl font-bold text-yellow-600">{formData.retards || 0}</p>
        </div>
        <div className="premium-card rounded-2xl bg-green-50 p-4 text-center">
          <p className="text-sm text-gray-600">Presences</p>
          <p className="text-3xl font-bold text-green-600">{formData.presences || "-"}</p>
        </div>
        <div className="premium-card rounded-2xl bg-blue-50 p-4 text-center">
          <p className="text-sm text-gray-600">Permissions</p>
          <p className="text-3xl font-bold text-blue-600">{formData.permissions || 0}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <InputField label="Presences" value={formData.presences} field="presences" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Absences" value={formData.absences} field="absences" type="number" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Retards" value={formData.retards} field="retards" type="number" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Permissions" value={formData.permissions} field="permissions" type="number" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Conges" value={formData.conges} field="conges" editMode={editMode} onChange={handleInputChange} />
        <InputField label="Sanctions disciplinaires" value={formData.sanctionsDisciplinaires} field="sanctionsDisciplinaires" editMode={editMode} onChange={handleInputChange} textarea />
        <InputField label="Historique des pointages" value={formData.historiquePointages} field="historiquePointages" editMode={editMode} onChange={handleInputChange} textarea placeholder="Une ligne: date | entree | sortie" />
        <InputField label="Observations administratives" value={formData.observationsAdministratives} field="observationsAdministratives" editMode={editMode} onChange={handleInputChange} textarea />
      </div>
    </SectionCard>
  );

  const renderDocumentsTab = () => (
    <div className="space-y-6">
      <SectionCard title="Contacts D'urgence" icon={PhoneIcon}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <InputField label="Nom du contact" value={formData.contactUrgenceNom} field="contactUrgenceNom" editMode={editMode} onChange={handleInputChange} />
          <InputField label="Lien avec le personnel" value={formData.contactUrgenceLien} field="contactUrgenceLien" editMode={editMode} onChange={handleInputChange} />
          <InputField label="Telephone" value={formData.contactUrgenceTelephone} field="contactUrgenceTelephone" editMode={editMode} onChange={handleInputChange} />
          <InputField label="Adresse" value={formData.contactUrgenceAdresse} field="contactUrgenceAdresse" editMode={editMode} onChange={handleInputChange} />
        </div>
      </SectionCard>
      <SectionCard title="Documents" icon={DocumentTextIcon}>
        <InputField
          label="Documents"
          value={formData.documents}
          field="documents"
          editMode={editMode}
          onChange={handleInputChange}
          textarea
          placeholder="Une ligne: nom | type | date"
        />
      </SectionCard>
    </div>
  );

  const renderPasswordSection = () => {
    if (!canChangeOwnPassword) return null;

    return (
      <SectionCard title="Securite Du Compte" icon={UserIcon}>
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div>
            <h4 className="text-lg font-semibold text-slate-900">Changer votre mot de passe</h4>
            <p className="mt-2 text-sm text-slate-500">
              Ce formulaire met a jour le mot de passe de votre compte personnel de connexion.
            </p>
            <form onSubmit={handlePasswordChange} className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Mot de passe actuel</label>
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => handlePasswordFieldChange("currentPassword", e.target.value)}
                  className="premium-control w-full rounded-2xl border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Nouveau mot de passe</label>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => handlePasswordFieldChange("newPassword", e.target.value)}
                  className="premium-control w-full rounded-2xl border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  minLength={8}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Confirmer le nouveau mot de passe</label>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => handlePasswordFieldChange("confirmPassword", e.target.value)}
                  className="premium-control w-full rounded-2xl border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  minLength={8}
                  required
                />
              </div>
              <button
                type="submit"
                disabled={passwordSaving}
                className="premium-action rounded-2xl bg-slate-900 px-4 py-2 text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {passwordSaving ? "Mise a jour..." : "Mettre a jour le mot de passe"}
              </button>
            </form>
          </div>
          <div className="premium-card rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h4 className="text-base font-semibold text-slate-900">Bonnes pratiques</h4>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>Utilisez au moins 8 caracteres.</li>
              <li>Choisissez un mot de passe different de celui fourni a la creation.</li>
              <li>Ne partagez pas ce mot de passe avec d'autres utilisateurs.</li>
            </ul>
          </div>
        </div>
      </SectionCard>
    );
  };

  if (showLoading) {
    return (
      <div className="p-6">
        <PageLoadingState
          title={`Chargement du profil ${normalizedType === "enseignant" ? "enseignant" : "personnel"}`}
          message="Les informations de cette fiche sont en cours de chargement."
        />
      </div>
    );
  }

  if (pageError && !record) {
    return (
      <div className="p-6">
        <PageErrorState
          title="Profil indisponible"
          message={pageError}
          action={(
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="premium-action rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Reessayer
            </button>
          )}
        />
      </div>
    );
  }

  return (
    <div className="app-page min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <PageBanner tone="success" title={pageSuccess ? "Enregistrement reussi" : ""} message={pageSuccess} />
        <PageBanner tone="error" title={pageError && record ? "Action impossible" : ""} message={record ? pageError : ""} />
        <div className="surface-card premium-card mb-6 rounded-2xl p-5 sm:p-6">
          <div className="mb-6 flex items-start justify-between">
            <div className="flex-1">
              <h1 className="mb-2 text-3xl font-bold text-gray-800">Profil Personnel / Enseignant</h1>
              <p className="text-gray-600">
                {formData.nomComplet || "Personnel"} - {formData.poste || formData.typePersonnel || "Fonction non renseignee"}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {editMode ? (
                <>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="premium-action flex items-center gap-2 rounded-2xl bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-60"
                  >
                    <PencilSquareIcon className="h-5 w-5" />
                    {saving ? "Enregistrement..." : "Enregistrer"}
                  </button>
                  <button
                    onClick={handleCancel}
                    className="premium-action flex items-center gap-2 rounded-2xl bg-gray-500 px-4 py-2 text-white hover:bg-gray-600"
                  >
                    <XMarkIcon className="h-5 w-5" />
                    Annuler
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setEditMode(true)}
                  className="premium-action flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                >
                  <PencilSquareIcon className="h-5 w-5" />
                  Modifier le profil
                </button>
              )}
              <button className="premium-action flex items-center gap-2 rounded-2xl bg-gray-600 px-4 py-2 text-white hover:bg-gray-700">
                <PrinterIcon className="h-5 w-5" />
                Imprimer
              </button>
              <button onClick={handleDownloadProfilePdf} className="premium-action flex items-center gap-2 rounded-2xl bg-purple-600 px-4 py-2 text-white hover:bg-purple-700">
                <ArrowDownTrayIcon className="h-5 w-5" />
                Telecharger
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="md:col-span-1">
              <div className="mb-6 text-center">
                <img
                  src={formData.photo || "https://via.placeholder.com/160x160?text=Photo"}
                  alt="Photo du personnel"
                  className="mx-auto mb-4 h-40 w-40 rounded-full border-4 border-blue-200 object-cover shadow-lg"
                />
                {editMode ? (
                  <div className="mb-4">
                    <label className="premium-action inline-flex cursor-pointer items-center rounded-2xl bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100">
                      Changer la photo
                      <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                    </label>
                  </div>
                ) : null}
                <div className="mb-3 inline-block rounded-full bg-blue-100 px-3 py-1">
                  <span className="text-sm font-semibold text-blue-800">{formData.statut || "Non renseigne"}</span>
                </div>
                <h3 className="text-2xl font-bold text-gray-800">{formData.nomComplet || "-"}</h3>
                <p className="text-gray-600">{formData.matricule || "-"}</p>
              </div>

              <div className="premium-card space-y-3 rounded-2xl bg-gray-50 p-4">
                <div className="flex items-center gap-3">
                  <PhoneIcon className="h-5 w-5 text-blue-600" />
                  <div className="text-sm">
                    <p className="text-gray-600">Telephone</p>
                    <p className="font-semibold">{formData.telephone || "-"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <UserIcon className="h-5 w-5 text-green-600" />
                  <div className="text-sm">
                    <p className="text-gray-600">Email</p>
                    <p className="font-semibold">{formData.email || "-"}</p>
                  </div>
                </div>
                <div className="border-t pt-3">
                  <p className="mb-2 text-xs text-gray-600">Contact d'urgence</p>
                  <p className="text-sm font-semibold">{formData.contactUrgenceNom || "-"}</p>
                  <p className="text-sm text-gray-600">{formData.contactUrgenceTelephone || "-"}</p>
                </div>
              </div>
            </div>

            <div className="md:col-span-2">
              <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <InputField label="Nom complet" value={formData.nomComplet} field="nomComplet" editMode={false} onChange={handleInputChange} />
                <InputField label="Matricule" value={formData.matricule} field="matricule" editMode={false} onChange={handleInputChange} />
                <InputField label="Poste occupe" value={formData.poste} field="poste" editMode={false} onChange={handleInputChange} />
                <InputField label="Type de personnel" value={formData.typePersonnel} field="typePersonnel" editMode={false} onChange={handleInputChange} />
                <InputField label="Date de recrutement" value={displayDate(formData.dateRecrutement)} field="dateRecrutement" editMode={false} onChange={handleInputChange} />
                <InputField label="Anciennete" value={formData.anciennete} field="anciennete" editMode={false} onChange={handleInputChange} />
                <InputField label="Departement" value={formData.departement} field="departement" editMode={false} onChange={handleInputChange} />
                <InputField label="Statut" value={formData.statut} field="statut" editMode={false} onChange={handleInputChange} />
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button className="premium-action flex items-center justify-center gap-2 rounded-2xl bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100">
                  <BookOpenIcon className="h-5 w-5" />
                  Affecter des matieres
                </button>
                <button onClick={() => setActiveTab("finance")} className="premium-action flex items-center justify-center gap-2 rounded-2xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100">
                  <ClockIcon className="h-5 w-5" />
                  Enregistrer absence
                </button>
                <button className="premium-action flex items-center justify-center gap-2 rounded-2xl bg-purple-50 px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100">
                  <CalendarDaysIcon className="h-5 w-5" />
                  Emploi du temps
                </button>
                <button onClick={handleDownloadPaymentPdf} className="premium-action flex items-center justify-center gap-2 rounded-2xl bg-orange-50 px-3 py-2 text-sm font-medium text-orange-700 hover:bg-orange-100">
                  <CurrencyDollarIcon className="h-5 w-5" />
                  Fiche de paie
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="surface-card premium-card rounded-t-2xl border-b bg-white shadow-lg">
          <div className="flex flex-wrap">
            {tabs.map((tab) => {
              const IconComponent = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`premium-action flex items-center gap-2 border-b-2 px-4 py-3 font-medium transition-colors ${
                    activeTab === tab.id
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-gray-600 hover:text-gray-800"
                  }`}
                >
                  <IconComponent className="h-5 w-5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="surface-card premium-card rounded-b-2xl bg-white p-6">
          {activeTab === "general" && renderGeneralTab()}
          {activeTab === "pro" && renderProfessionalTab()}
          {activeTab === "teacher" && renderTeacherTab()}
          {activeTab === "admin" && renderAdminTab()}
          {activeTab === "finance" && renderFinanceTab()}
          {activeTab === "presence" && renderPresenceTab()}
          {activeTab === "documents" && renderDocumentsTab()}
          {renderPasswordSection()}
        </div>
      </div>
    </div>
  );
}

export default PersonnelProfile;
