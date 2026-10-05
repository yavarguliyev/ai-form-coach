import { NavLink, Outlet } from 'react-router';
import { BackendStatus } from './BackendStatus';
import styles from './Layout.module.css';

export function Layout() {
  const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? styles.active : undefined);
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>FormCoach AI</span>
        <nav className={styles.nav}>
          <NavLink to="/" end className={linkClass}>Home</NavLink>
          <NavLink to="/history" className={linkClass}>History</NavLink>
        </nav>
        <BackendStatus />
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
