import { NavLink, Outlet } from 'react-router';
import { useUser } from '../state/UserContext';
import { BackendStatus } from './BackendStatus';
import styles from './Layout.module.css';

export function Layout() {
  const { user } = useUser();
  const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? styles.active : undefined);
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <NavLink to="/" className={styles.brand}>
          <span className={styles.logo} aria-hidden />
          FormCoach <span className={styles.brandAi}>AI</span>
        </NavLink>
        <nav className={styles.nav} aria-label="Main">
          <NavLink to="/" end className={linkClass}>
            Exercises
          </NavLink>
          <NavLink to="/history" className={linkClass}>
            History
          </NavLink>
        </nav>
        <div className={styles.right}>
          {user && (
            <span className={styles.user} title="Change the user on the Exercises page">
              {user.name}
            </span>
          )}
          <BackendStatus />
        </div>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
