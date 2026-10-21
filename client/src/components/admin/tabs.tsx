// The dashboard's tabs, in order. Data-driven so adding a module is one entry
// here: the page, the tab strip and the /admin/<id> routes all come from this.
import { Suspense, lazy, type ComponentType } from 'react';
import AltsTab from './AltsTab.tsx';
import BansTab from './BansTab.tsx';
import ContentTab from './ContentTab.tsx';
import DiscordTab from './DiscordTab.tsx';
import EmailTab from './EmailTab.tsx';
import FeaturesTab from './FeaturesTab.tsx';
import HostsTab from './HostsTab.tsx';
import GraphicsManager from './GraphicsManager.tsx';
import LogsTab from './LogsTab.tsx';
import OverviewTab from './OverviewTab.tsx';
import PagesTab from './PagesTab.tsx';
import PlayersTab from './PlayersTab.tsx';
import RoomsTab from './RoomsTab.tsx';
import MusicManager from './MusicManager.tsx';

// The charts load only when the tab is opened.
const AnalyticsBody = lazy(() => import('./AnalyticsTab.tsx'));
function AnalyticsTab() {
  return (
    <Suspense fallback={<div className="adm-stats" aria-busy="true">{Array.from({ length: 8 }, (_, i) => <div key={i} className="sk sk-tile" />)}</div>}>
      <AnalyticsBody />
    </Suspense>
  );
}

export interface AdminTab {
  id: string;
  label: string;
  icon: string;
  Component: ComponentType;
}

export const ADMIN_TABS: AdminTab[] = [
  { id: 'overview', label: 'Overview', icon: '📊', Component: OverviewTab },
  { id: 'analytics', label: 'Analytics', icon: '📈', Component: AnalyticsTab },
  { id: 'rooms', label: 'Rooms', icon: '🎲', Component: RoomsTab },
  { id: 'players', label: 'Players', icon: '👤', Component: PlayersTab },
  { id: 'hosts', label: 'Hosts', icon: '🏆', Component: HostsTab },
  { id: 'alts', label: 'Alts', icon: '🧬', Component: AltsTab },
  { id: 'bans', label: 'Bans', icon: '⛔', Component: BansTab },
  { id: 'logs', label: 'Logs', icon: '📜', Component: LogsTab },
  { id: 'features', label: 'Features', icon: '🎛', Component: FeaturesTab },
  { id: 'content', label: 'Content', icon: '✏️', Component: ContentTab },
  { id: 'pages', label: 'Pages', icon: '📄', Component: PagesTab },
  { id: 'discord', label: 'Discord', icon: '💬', Component: DiscordTab },
  { id: 'email', label: 'Email', icon: '✉️', Component: EmailTab },
  { id: 'graphics', label: 'Graphics', icon: '🖼', Component: GraphicsManager },
  { id: 'music', label: 'Music', icon: '🎵', Component: MusicManager },
];
