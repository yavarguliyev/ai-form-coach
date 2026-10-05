import { Link } from 'react-router';
import styles from './Placeholder.module.css';

// Placeholder — built out in T-28.
export default function SummaryPage() {
  return (
    <section className={styles.page}>
      <h1>Summary</h1>
      <div className={styles.empty}>
        <p>The session summary (score, per-rep table, most common mistake) is coming next.</p>
        <Link className="btn btn-secondary" to="/">
          Back to exercises
        </Link>
      </div>
    </section>
  );
}
