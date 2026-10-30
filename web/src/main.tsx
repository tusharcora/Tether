import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bridge } from './bridge';
import './components/kept/foundation.css';
import './styles.css';
import './studio.css';
import './studio-arc.css';
import './tw.css';
import { applyTheme, initialTheme } from './theme';

applyTheme(initialTheme());
// Tether.app: room for the traffic lights, and a strip to move the window by (shell.css)
if (bridge()) document.documentElement.classList.add('tether-app');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
