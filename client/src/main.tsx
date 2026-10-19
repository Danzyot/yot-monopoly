import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './fonts/fonts.css';
import './index.css';
import './styles/outfits.css';
import './styles/chogs.css';
import './styles/turnflow.css';
import './styles/ui-polish.css';
import './styles/boards.css';
import './styles/tooltip.css';
import './styles/manage.css';
import './styles/phone.css';
import './styles/gd.css';
import './styles/lobby.css';
import './styles/trades.css';
import './styles/home.css';
import './styles/hub.css';
import './styles/season.css';
import { installTooltips } from './tooltip.ts';
import { bootContent } from './content.ts';
import { CHOG_SEASON } from '../../shared/season.ts';

// The season's colours (styles/season.css). The build already put the class on
// <html> (vite.config.ts seasonClass); this keeps it right if the flag and the page disagree.
document.documentElement.classList.toggle('season-chog', CHOG_SEASON);

installTooltips();
import './styles/cinematics.css';
import './styles/ownership.css';

// Operator renames go in before the first render, so no board is drawn with the old names.
void bootContent().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
});
