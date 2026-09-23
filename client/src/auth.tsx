import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api.ts';
import { resetSocket } from './net.ts';
import { toast } from './toast.tsx';
import { DEFAULT_FEATURES, type PlayerProfile, type SiteConfig } from '../../shared/types.ts';

interface AuthState {
  profile: PlayerProfile | null;
  config: SiteConfig;
  ready: boolean;
  /** Set when the server says this account or address is banned. */
  banned: string | null;
  signInDiscord(): void;
  signInDemo(name: string): Promise<void>;
  acceptAuth(token: string, profile: PlayerProfile): void;
  signOut(): void;
  setBanned(msg: string | null): void;
  /** Opens the sign-in dialog (rendered by <AuthModalHost>). */
  openSignIn(): void;
  signInOpen: boolean;
  closeSignIn(): void;
}

const EMPTY_CONFIG: SiteConfig = {
  discordEnabled: false, demoMode: false, adminMode: false, codeVerify: false,
  codeVerifyChannel: null, codeVerifyButton: false, inviteUrl: null, features: DEFAULT_FEATURES,
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [config, setConfig] = useState<SiteConfig>(EMPTY_CONFIG);
  const [ready, setReady] = useState(false);
  const [banned, setBanned] = useState<string | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);

  useEffect(() => {
    // Discord sends people back with #dtoken=… or #derror=… in the address.
    const hash = new URLSearchParams(location.hash.slice(1));
    const t = hash.get('dtoken');
    const err = hash.get('derror');
    if (t || err) history.replaceState(null, '', location.pathname + location.search);
    if (t) setToken(t);
    if (err) toast(err, 'error');

    const loadConfig = api<SiteConfig>('/api/config').then(setConfig).catch(() => {});
    const loadMe = getToken()
      ? api<{ profile: PlayerProfile }>('/api/auth/me')
        .then(r => { setProfile(r.profile); if (t) toast(`Signed in as ${r.profile.name}`); })
        .catch((e: Error & { status?: number }) => {
          if (e.status === 403) setBanned(e.message);
          if (e.status === 401 || e.status === 403) setToken(null);
        })
      : Promise.resolve();
    Promise.all([loadConfig, loadMe]).finally(() => {
      setReady(true);
      if (t) resetSocket();
    });
  }, []);

  const acceptAuth = useCallback((token: string, p: PlayerProfile) => {
    setToken(token);
    setProfile(p);
    setSignInOpen(false);
    resetSocket();
  }, []);

  const value: AuthState = {
    profile, config, ready, banned, setBanned,
    signInDiscord() {
      location.href = `/api/auth/discord/start?return=${encodeURIComponent(location.pathname + location.search)}`;
    },
    async signInDemo(name: string) {
      const r = await api<{ token: string; profile: PlayerProfile }>('/api/auth/demo', { method: 'POST', json: { name } });
      acceptAuth(r.token, r.profile);
    },
    acceptAuth,
    signOut() {
      setToken(null);
      setProfile(null);
      resetSocket();
    },
    openSignIn: () => setSignInOpen(true),
    closeSignIn: () => setSignInOpen(false),
    signInOpen,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
