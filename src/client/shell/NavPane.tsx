import { NavLink } from 'react-router-dom';
import { NAV_ITEMS } from './nav';
import { Codicon } from './workbench/codicons';
import list from './workbench/list.module.css';
import styles from './workbench/Workbench.module.css';

/** The navigation side bar view: every ctk section, labelled, as an explorer list. */
export function NavPane() {
  return (
    <section className={styles.navPane} aria-label="ctk">
      <header className={styles.paneHeader}>
        <h2 className={styles.paneTitle}>ctk</h2>
      </header>
      <ul className={list.list}>
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.to === '/'} className={list.row}>
              <Codicon name={item.icon} className={list.icon} />
              <span className={list.label}>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
