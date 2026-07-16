import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

import App from './app';
import { ModuleProvider } from './modules/ModuleContext';
import './index.css';
import { applyTheme, loadAppSettings } from './lib/app-settings';

applyTheme(loadAppSettings().theme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <ModuleProvider>
        <App />
      </ModuleProvider>
    </HashRouter>
  </StrictMode>,
);
