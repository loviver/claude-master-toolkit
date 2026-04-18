import { Outlet } from 'react-router-dom';
import { Sidebar } from './ui/Sidebar/Sidebar';
import styles from './Layout.module.css';

export function Layout() {
  return (
    <div className={styles.layout}>
      <Sidebar />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
