import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PlayerProfile } from '../../shared/types';
import { api, clearAuth, getProfile, getToken, saveAuth } from './api';
import { resetSocket } from './socket';

interface AuthCtx {
  profile: PlayerProfile | null;
  chatEnabled: boolean;
  discordEnabled: boolean;
  demoMode: boolean;
  signInDemo: (name: string) => Promise<void>;
  codeVerify: boolean;
  codeVerifyChannel: string | null;
  codeVerifyButton: boolean;
  // The room's own server invite, so the header link is whatever the operator
  // configured rather than a URL baked into the build.
  discordInviteUrl: string | null;
  signInDiscord: (returnPath?: string) => void;
  linkDiscord: (returnPath?: string) => void;
  // Accept a token minted by another flow (e.g. code verification).
  acceptAuth: (token: string, profile: PlayerProfile) => void;
  signOut: () => void;
}

const Ctx = createContext<AuthCtx>(null!);

// Decode the profile straight out of a signed token's payload segment.
function profileFromToken(token: string): PlayerProfile | null {
  try {
    const payload = token.slice(0, token.lastIndexOf('.'));
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (!data.id || !data.name) return null;
    return {
      id: data.id, name: data.name, avatar: data.avatar ?? '🙂',
      provider: 'discord',
      discord: data.discord ?? null,
      isAdmin: data.isAdmin === true,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<PlayerProfile | null>(() => getProfile());
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [codeVerify, setCodeVerify] = useState(false);
  const [codeVerifyChannel, setCodeVerifyChannel] = useState<string | null>(null);
  const [codeVerifyButton, setCodeVerifyButton] = useState(false);
  const [discordInviteUrl, setDiscordInviteUrl] = useState<string | null>(null);
  const [chatEnabled, setChatEnabled] = useState(true);

  useEffect(() => {
    api.config().then(c => {
      setDiscordEnabled(!!c.discordEnabled);
      setDemoMode(!!c.demoMode);
      setCodeVerify(!!c.codeVerify);
      setCodeVerifyChannel(c.codeVerifyChannel ?? null);
      setCodeVerifyButton(!!c.codeVerifyButton);
      setDiscordInviteUrl(c.discord?.inviteUrl ?? null);
      setChatEnabled(c.chatEnabled !== false);
    }).catch(() => {});
  }, []);

  // Catch the refreshed token after the Discord OAuth redirect (#dtoken=...).
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#dtoken=')) {
      const token = decodeURIComponent(hash.slice('#dtoken='.length));
      const p = profileFromToken(token);
      if (p) {
        saveAuth(token, p);
        resetSocket();
        setProfile(p);
      }
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    // #derror is handled by the toast provider.
  }, []);

  const signInDemo = useCallback(async (name: string) => {
    const { token, profile } = await api.demoLogin(name);
    saveAuth(token, profile);
    resetSocket();
    setProfile(profile);
  }, []);

  const signInDiscord = useCallback((returnPath?: string) => {
    const ret = returnPath ?? window.location.pathname;
    window.location.href = `/api/auth/discord/start?return=${encodeURIComponent(ret)}`;
  }, []);

  const linkDiscord = useCallback((returnPath?: string) => {
    const token = getToken();
    const ret = returnPath ?? window.location.pathname;
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
    window.location.href = `/api/auth/discord/start?return=${encodeURIComponent(ret)}${tokenParam}`;
  }, []);

  const acceptAuth = useCallback((token: string, profile: PlayerProfile) => {
    saveAuth(token, profile);
    resetSocket();
    setProfile(profile);
  }, []);

  const signOut = useCallback(() => {
    clearAuth();
    resetSocket();
    setProfile(null);
  }, []);

  // The api layer raises this the first time the server refuses our token.
  // Dropping the cached profile here is what actually changes the screen:
  // otherwise the header keeps showing a signed-in operator while every
  // panel behind it waits on requests that can only ever fail.
  useEffect(() => {
    const onExpired = () => { resetSocket(); setProfile(null); };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const value = useMemo(
    () => ({ profile, chatEnabled, discordEnabled, demoMode, signInDemo, codeVerify, codeVerifyChannel, codeVerifyButton, discordInviteUrl, signInDiscord, linkDiscord, acceptAuth, signOut }),
    [profile, chatEnabled, discordEnabled, demoMode, signInDemo, codeVerify, codeVerifyChannel, codeVerifyButton, discordInviteUrl, signInDiscord, linkDiscord, acceptAuth, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  return useContext(Ctx);
}
