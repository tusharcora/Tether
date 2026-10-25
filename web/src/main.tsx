import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './components/arc/foundation.css';
import 'blobatar/motion.css';
import './theme.css';
import './styles.css';
import './studio.css';
import { applyTheme, initialTheme } from './theme';

applyTheme(initialTheme());
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
