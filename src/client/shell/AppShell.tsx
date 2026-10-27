import { Suspense, useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { CTK_VERSION } from '../../shared/version';
import { useSessionsListLive } from '../hooks/queries/useSessions';
import { NAV_ITEMS, type ShellOutletContext } from './nav';
import { SlotsProvider, useSlotsHost } from './slots';
import {
  ActivityBar,
  ActivityLink,
  ActivitySeparator,
  ProgressLine,
  StatusBar,
  StatusItem,
  TitleBar,
  Workbench,
} from './workbench/Workbench';

/**
 * The one frame every route renders in: VSCode's workbench. Global navigation lives in
 * the activity bar; routed pages fill the editor and, through WorkbenchSlot, any other part.
 */
export function AppShell() {
  useSessionsListLive();
  const { context, occupied, panelCollapsed, target } = useSlotsHost();
  const [sideBarOpen, setSideBarOpen] = useState(readSideBarOpen);
  const pick = useCallback((wasActive: boolean) => {
    setSideBarOpen((open) => {
      const next = wasActive ? !open : true;
      writeSideBarOpen(next);
      return next;
    });
  }, []);
  const outletContext: ShellOutletContext = { sideBarOpen };

  return (
    <SlotsProvider value={context}>
      <Workbench
        titleBar={(
          <TitleBar
            icon="pulse"
            title={`ctk ${CTK_VERSION}`}
            start={target('titleStart')}
            center={target('titleCenter')}
            end={target('titleEnd')}
          />
        )}
        activityBar={(
          <ActivityBar footer={<ActivityLink {...SETTINGS} onPick={pick} />}>
            {SECTIONS.map((item) => <ActivityLink key={item.to} {...item} end={item.to === '/'} onPick={pick} />)}
            {occupied('activity') && <ActivitySeparator />}
            {target('activity')}
          </ActivityBar>
        )}
        sideBar={occupied('sideBar') ? target('sideBar') : null}
        editor={<Suspense fallback={<ProgressLine />}><Outlet context={outletContext} /></Suspense>}
        panel={occupied('panel') ? target('panel') : null}
        panelCollapsed={panelCollapsed}
        auxBar={occupied('auxBar') ? target('auxBar') : null}
        statusBar={(
          <StatusBar
            start={target('statusStart')}
            end={(
              <>
                {target('statusEnd')}
                <StatusItem title="ctk version">v{CTK_VERSION}</StatusItem>
              </>
            )}
          />
        )}
      />
    </SlotsProvider>
  );
}

const SETTINGS = NAV_ITEMS.find((item) => item.to === '/settings')!;
const SECTIONS = NAV_ITEMS.filter((item) => item !== SETTINGS);

const SIDE_BAR_KEY = 'ctk.sideBarOpen';

/** Open unless the viewer collapsed it; storage may be unavailable (private mode). */
function readSideBarOpen(): boolean {
  try {
    return localStorage.getItem(SIDE_BAR_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writeSideBarOpen(open: boolean) {
  try {
    localStorage.setItem(SIDE_BAR_KEY, String(open));
  } catch {
    // Not persisted: the side bar still toggles for this visit.
  }
}
