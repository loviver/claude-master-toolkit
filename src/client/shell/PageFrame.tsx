import { Outlet, useOutletContext } from 'react-router-dom';
import type { ShellOutletContext } from './nav';
import { NavPane } from './NavPane';
import { SlotTarget, WorkbenchSlot } from './slots';
import styles from './PageFrame.module.css';

/**
 * Dashboard pages: the navigation side bar (plus any section the page adds under it)
 * and the page itself, scrolling inside the editor at its reading width.
 */
export function PageFrame() {
  const shell = useOutletContext<ShellOutletContext>();
  return (
    <>
      {shell.sideBarOpen && (
        <WorkbenchSlot name="sideBar">
          <NavPane />
          <SlotTarget name="sideBarSection" />
        </WorkbenchSlot>
      )}
      <div className={styles.scroll}>
        <div className={styles.page}>
          <Outlet context={shell} />
        </div>
      </div>
    </>
  );
}
