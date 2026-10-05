import { BrowserRouter, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import HomePage from './pages/HomePage';
import WorkoutPage from './pages/WorkoutPage';
import SummaryPage from './pages/SummaryPage';
import HistoryPage from './pages/HistoryPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="workout/:exerciseSlug" element={<WorkoutPage />} />
          <Route path="sessions/:sessionId" element={<SummaryPage />} />
          <Route path="history" element={<HistoryPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
