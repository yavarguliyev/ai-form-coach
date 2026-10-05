import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Global styles first, so component CSS modules can override them.
import './index.css';
import App from './App';
import { BackendProvider } from './state/BackendContext';
import { UserProvider } from './state/UserContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BackendProvider>
      <UserProvider>
        <App />
      </UserProvider>
    </BackendProvider>
  </StrictMode>,
);
