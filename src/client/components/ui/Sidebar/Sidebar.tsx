import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ListOrdered,
  Cpu,
  Wrench,
  GitBranch,
  Zap,
  Bookmark,
  Settings as SettingsIcon,
  FolderKanban,
  Network,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../Icon/Icon';
import styles from './Sidebar.module.css';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',          label: 'Overview',    icon: LayoutDashboard },
  { to: '/sessions',  label: 'Sessions',    icon: ListOrdered },
  { to: '/graph',     label: 'Graph',       icon: Network },
  { to: '/projects',  label: 'Projects',    icon: FolderKanban },
  { to: '/models',    label: 'Models',      icon: Cpu },
  { to: '/tools',     label: 'Tools',       icon: Wrench },
  { to: '/phases',    label: 'Phases',      icon: GitBranch },
  { to: '/efficiency',label: 'Efficiency',  icon: Zap },
  { to: '/memories',  label: 'Memories',    icon: Bookmark },
  { to: '/settings',  label: 'Settings',    icon: SettingsIcon },
];

export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.logoRow}>
          <svg className={styles.claudeLogo} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path
              d="M20 4 C20 4 22 12 26 16 C30 20 38 20 38 20 C38 20 30 20 26 24 C22 28 20 36 20 36 C20 36 18 28 14 24 C10 20 2 20 2 20 C2 20 10 20 14 16 C18 12 20 4 20 4 Z"
              fill="currentColor"
            />
          </svg>
          <div>
            <h1 className={styles.title}>ctk</h1>
            <span className={styles.subtitle}>Analytics</span>
          </div>
        </div>
      </div>

      <NavigationMenu.Root className={styles.nav} orientation="vertical">
        <NavigationMenu.List className={styles.list}>
          {NAV_ITEMS.map((item) => (
            <NavigationMenu.Item key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}
                end={item.to === '/'}
              >
                <Icon icon={item.icon} size="sm" />
                <span>{item.label}</span>
              </NavLink>
            </NavigationMenu.Item>
          ))}
        </NavigationMenu.List>
      </NavigationMenu.Root>

      <div className={styles.footer}>
        <span className={styles.footerLabel}>v0.1.5</span>
      </div>
    </aside>
  );
}
