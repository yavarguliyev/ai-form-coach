import { Link } from 'react-router';
import styles from './Placeholder.module.css';

// Placeholder — built out in T-29.
export default function HistoryPage() {
  return (
    <section className={styles.page}>
      <h1>History</h1>
      <div className={styles.empty}>
        <p>Past sessions and progress charts are coming soon.</p>
        <Link className="btn btn-secondary" to="/">
          Back to exercises
        </Link>
      </div>
    </section>
  );
}
