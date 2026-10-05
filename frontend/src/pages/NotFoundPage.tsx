import { Link } from 'react-router';
import { useTitle } from '../useTitle';
import styles from './Placeholder.module.css';

export default function NotFoundPage({ title = 'Page not found', message }: { title?: string; message?: string }) {
  useTitle(title);
  return (
    <section className={styles.page}>
      <h1>{title}</h1>
      <div className={styles.empty}>
        <p>{message ?? "There's nothing at this address."}</p>
        <Link className="btn btn-primary" to="/">
          Back to exercises
        </Link>
      </div>
    </section>
  );
}
