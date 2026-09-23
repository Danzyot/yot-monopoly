// The dashboard's tabs, in order. Data-driven so adding a module is one entry
// here: the page, the tab strip and the /admin/<id> routes all come from this.
import type { ComponentType } from 'react';
import AltsTab from './AltsTab.tsx';
import BansTab from './BansTab.tsx';
import DiscordTab from './DiscordTab.tsx';
import FeaturesTab from './FeaturesTab.tsx';
import GraphicsManager from './GraphicsManager.tsx';
import LogsTab from './LogsTab.tsx';
import OverviewTab from './OverviewTab.tsx';
import PlayersTab from './PlayersTab.tsx';
import RoomsTab from './RoomsTab.tsx';

export interface AdminTab {
  id: string;
  label: string;
  icon: string;
  Component: ComponentType;
}

/** Stand-in until the music module lands on its own branch. */
function MusicPlaceholder() {
  return (
    <div className="adm-card">
      <h3>Music library</h3>
      <p className="muted">Music library — coming in the music module.</p>
    </div>
  );
}

export const ADMIN_TABS: AdminTab[] = [
  { id: 'overview', label: 'Overview', icon: '📊', Component: OverviewTab },
  { id: 'rooms', label: 'Rooms', icon: '🎲', Component: RoomsTab },
  { id: 'players', label: 'Players', icon: '👤', Component: PlayersTab },
  { id: 'alts', label: 'Alts', icon: '🧬', Component: AltsTab },
  { id: 'bans', label: 'Bans', icon: '⛔', Component: BansTab },
  { id: 'logs', label: 'Logs', icon: '📜', Component: LogsTab },
  { id: 'features', label: 'Features', icon: '🎛', Component: FeaturesTab },
  { id: 'discord', label: 'Discord', icon: '💬', Component: DiscordTab },
  { id: 'graphics', label: 'Graphics', icon: '🖼', Component: GraphicsManager },
  { id: 'music', label: 'Music', icon: '🎵', Component: MusicPlaceholder },
];
