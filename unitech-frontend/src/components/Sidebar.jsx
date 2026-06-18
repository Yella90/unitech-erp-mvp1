import { NavLink } from 'react-router-dom';
import { WrenchScrewdriverIcon,BriefcaseIcon,SquaresPlusIcon,
  HomeIcon, UsersIcon, BookOpenIcon, CreditCardIcon,UserGroupIcon,
  BanknotesIcon,DocumentMinusIcon,DocumentChartBarIcon,BuildingOffice2Icon,
  CalendarDaysIcon,ArrowsRightLeftIcon,ChatBubbleLeftEllipsisIcon,DocumentCurrencyDollarIcon,
  ClipboardDocumentListIcon,
  ChartBarIcon, Cog6ToothIcon, ArrowRightOnRectangleIcon,BuildingLibraryIcon, XMarkIcon
} from '@heroicons/react/24/outline';
import { canAccessResource, isSuperAdminRole } from '../utils/roles.js';

const navigation = [
  { name: 'Dashboard', href: '/', icon: HomeIcon, resource: 'dashboard', roles: ['directeur', 'promoteur', 'comptable', 'secretaire', 'censeur', 'surveillant', 'personnel'] },
  { name: 'Setup rapide', href: '/setup', icon: WrenchScrewdriverIcon, resource: 'students', roles: ['directeur', 'secretaire'] },
  { name: 'Classes', href: '/classes', icon: BuildingLibraryIcon, resource: 'classes', roles: ['directeur', 'censeur', 'surveillant'] },
  { name: 'Eleves', href: '/eleves', icon: UsersIcon, resource: 'students', roles: ['directeur', 'promoteur', 'comptable', 'secretaire', 'censeur', 'surveillant'] },
  { name: 'Enseignants', href: '/enseignants', icon: UserGroupIcon, resource: 'teachers', roles: ['directeur', 'promoteur', 'comptable', 'secretaire', 'censeur', 'surveillant'] },
  { name: 'Personnel', href: '/personnels', icon: BriefcaseIcon, resource: 'personnels', roles: ['directeur', 'promoteur', 'comptable', 'secretaire'] },
  { name: 'Matieres', href: '/matieres', icon: BookOpenIcon, resource: 'subjects', roles: ['directeur', 'censeur', 'surveillant'] },
  { name: 'Affectations', href: '/affectation', icon: SquaresPlusIcon, resource: 'assignments', roles: ['directeur', 'censeur', 'surveillant'] },
  { name: 'Emplois du temps', href: '/emplois-du-temps', icon: CalendarDaysIcon, resource: 'schedules', roles: ['directeur', 'promoteur', 'censeur', 'surveillant', 'enseignant'] },
  { name: 'Trimestres & charges', href: '/trimestres-charges', icon: CalendarDaysIcon, resource: 'trimestres', roles: ['directeur', 'promoteur', 'censeur', 'surveillant'] },
  { name: 'Notes & Bulletins', href: '/notes', icon: BookOpenIcon, resource: 'notes', roles: ['directeur', 'promoteur', 'censeur', 'surveillant', 'enseignant'] },
  { name: 'Absences', href: '/absences', icon: ClipboardDocumentListIcon, resource: 'attendance', roles: ['directeur', 'censeur', 'surveillant', 'enseignant'] },
  { name: 'Absences enseignants', href: '/absences-enseignants', icon: ClipboardDocumentListIcon, resource: 'schedules', roles: ['directeur', 'promoteur', 'comptable', 'secretaire', 'censeur', 'surveillant'] },
  { name: 'Transferts eleves', href: '/transferts', icon: ArrowsRightLeftIcon, resource: 'students', roles: ['directeur', 'secretaire'] },
  { name: 'Notifications transferts', href: '/notifications-transferts', icon: ChatBubbleLeftEllipsisIcon, resource: 'transfer_notifications', roles: ['directeur'] },
  { name: 'Retards paiements', href: '/retards-paiement', icon: ChatBubbleLeftEllipsisIcon, resource: 'finances', roles: ['directeur', 'promoteur', 'comptable', 'secretaire'] },
  { name: 'Finances', href: '/finances', icon: DocumentCurrencyDollarIcon, resource: 'finances', roles: ['directeur', 'promoteur', 'comptable', 'secretaire'] },
  { name: 'Salaires', href: '/salaires', icon: BanknotesIcon, resource: 'salaries', roles: ['directeur', 'promoteur', 'comptable', 'secretaire'] },
  { name: 'Depenses', href: '/depenses', icon: DocumentMinusIcon, resource: 'expenses', roles: ['directeur', 'promoteur', 'comptable', 'secretaire'] },
  { name: 'Retraits promoteur', href: '/retraits', icon: DocumentChartBarIcon, resource: 'finances', roles: ['directeur', 'promoteur'] },
  { name: 'Tresorerie', href: '/tresorerie', icon: DocumentChartBarIcon, resource: 'finances', roles: ['directeur', 'promoteur', 'comptable'] },
  { name: 'Utilisateurs & Roles', href: '/utilisateurs', icon: UsersIcon, resource: 'users', roles: ['directeur'] },
  { name: 'Rapports', href: '/rapports', icon: ChartBarIcon, resource: 'reports', roles: ['directeur', 'promoteur', 'comptable', 'secretaire', 'censeur', 'surveillant'] },
  { name: 'Historique actions', href: '/historique-actions', icon: ChartBarIcon, resource: 'activity_logs', roles: ['directeur', 'promoteur'] },
  { name: 'Etat synchronisation', href: '/sync-status', icon: Cog6ToothIcon, resource: 'dashboard', roles: ['directeur', 'promoteur'] },
  { name: 'Administration', href: '/administrateur', icon: BuildingOffice2Icon, resource: 'teachers', roles: ['directeur'] },
];

const superAdminNavigation = [
  { name: 'Gestion abonnements', href: '/super-admin', icon: CreditCardIcon },
];

function canDisplayNavItem(role, item) {
  if (item.href === '/absences-enseignants' && String(role || '').trim().toLowerCase() === 'enseignant') {
    return false;
  }
  return canAccessResource(role, item.resource, 'read', item.roles);
}

function Sidebar({ open = false, onClose, onLogoutRequest }) {
  const role = localStorage.getItem('role');
  const schoolName = role === 'super@admin' ? 'Super Admin' : (localStorage.getItem('etablissement') || 'School');
  const items = isSuperAdminRole(role)
    ? superAdminNavigation
    : navigation.filter((item) => canDisplayNavItem(role, item));
    console.log('🟢 Sidebar rendu avec open =', open);
    

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-slate-900/40 transition-opacity lg:hidden ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={onClose}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[280px] border-r border-slate-200 bg-white transition-all duration-300 ease-in-out lg:fixed lg:left-0 lg:top-[53px] lg:z-20 lg:h-[calc(100vh-53px)] lg:w-[72px] lg:hover:w-[260px] lg:overflow-hidden lg:hover:overflow-y-auto ${
          open ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 group shadow-xl shadow-slate-100`}
      >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 lg:px-3">
          <div className="flex items-center gap-3 min-w-0">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 text-white font-bold">S</div>
          <div className="min-w-0 block lg:hidden lg:group-hover:block">
            <p className="text-xs uppercase tracking-wide text-slate-400">School ERP</p>
            <p className="truncate font-semibold text-slate-800">{schoolName}</p>
          </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 lg:hidden"
            aria-label="Fermer le menu"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4 lg:px-1">
          {items.map((item) => (
            <NavLink
              key={item.name}
              to={item.href}
              onClick={onClose}
              className={({ isActive }) =>
                `group block rounded-full px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 ${
                  isActive ? 'bg-slate-100 text-slate-900' : ''
                }`
              }
            >
              <span className="flex items-center gap-3 lg:justify-center">
                {item.icon ? <item.icon className="h-5 w-5 shrink-0" /> : null}
                <span className="inline lg:hidden overflow-hidden whitespace-nowrap text-sm transition-all duration-200 lg:group-hover:inline">
                  {item.name}
                </span>
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200 px-2 py-4 lg:px-1">
          <button
            type="button"
            onClick={onLogoutRequest}
            className="group flex w-full items-center justify-center gap-2 rounded-full bg-rose-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-700"
          >
            <ArrowRightOnRectangleIcon className="h-4 w-4" />
            <span className="inline lg:hidden overflow-hidden whitespace-nowrap transition-all duration-200 lg:group-hover:inline">Deconnexion</span>
          </button>
        </div>
      </div>
      </aside>
    </>
  );
}
export default Sidebar;
