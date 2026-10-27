export interface NavItem {
  to: string;
  icon: string;
  label: string;
}

/** Top-level ctk sections, in activity bar order. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/',           icon: 'dashboard',          label: 'Overview' },
  { to: '/sessions',   icon: 'history',            label: 'Sessions' },
  { to: '/graph',      icon: 'type-hierarchy',     label: 'Graph' },
  { to: '/code-graph', icon: 'type-hierarchy-sub', label: 'Code Graph' },
  { to: '/projects',   icon: 'folder-library',     label: 'Projects' },
  { to: '/models',     icon: 'hubot',              label: 'Models' },
  { to: '/tools',      icon: 'tools',              label: 'Tools' },
  { to: '/phases',     icon: 'git-branch',         label: 'Phases' },
  { to: '/efficiency', icon: 'zap',                label: 'Efficiency' },
  { to: '/memories',   icon: 'bookmark',           label: 'Memories' },
  { to: '/settings',   icon: 'settings-gear',      label: 'Settings' },
];

/** What the shell hands its routed pages through the outlet context. */
export interface ShellOutletContext {
  sideBarOpen: boolean;
}
