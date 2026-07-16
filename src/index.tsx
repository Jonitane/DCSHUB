import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

import App from './app';
import { ModuleProvider } from './modules/ModuleContext';
import { LanguageProvider } from './lib/i18n';
import './index.css';
import { applyTheme, loadAppSettings } from './lib/app-settings';

applyTheme(loadAppSettings().theme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <HashRouter>
        <ModuleProvider>
          <App />
        </ModuleProvider>
      </HashRouter>
    </LanguageProvider>
  </StrictMode>,
);
