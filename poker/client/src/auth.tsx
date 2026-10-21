import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PlayerProfile } from '../../shared/types';
import { api, clearAuth, getProfile, getToken, saveAuth } from './api';
import { resetSocket } from './socket';

interface AuthCtx {
  profile: PlayerProfile | null;
  // May host tournaments: an operator, or a Chog Genesis holder or
  // approved host (the Chog Games hub decides; the server asks it).
  canHost: boolean;
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
  // The Chog Games hub this room is part of (null on a standalone deployment).
  // Signing in there signs you in here: same Discord app, same token secret.
  hubUrl: string | null;
  // Whether /api/config has answered (until then hubUrl is not known yet).
  configLoaded: boolean;
  signInViaHub: (returnPath?: string) => void;
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
  const [hubUrl, setHubUrl] = useState<string | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [hostCheck, setHostCheck] = useState<{ id: string; canHost: boolean } | null>(null);

  useEffect(() => {
    api.config().then(c => {
      setDiscordEnabled(!!c.discordEnabled);
      setDemoMode(!!c.demoMode);
      setCodeVerify(!!c.codeVerify);
      setCodeVerifyChannel(c.codeVerifyChannel ?? null);
      setCodeVerifyButton(!!c.codeVerifyButton);
      setDiscordInviteUrl(c.discord?.inviteUrl ?? null);
      setHubUrl(c.hubUrl ?? null);
      setChatEnabled(c.chatEnabled !== false);
    }).catch(() => {}).finally(() => setConfigLoaded(true));
  }, []);

  // Catch the refreshed token after the Discord OAuth redirect (#dtoken=...).
  // This provider mounts above the router, so the hash is read on whichever
  // route the browser lands on — a table link, the leaderboard, anywhere —
  // and the hub's /sso can send people straight back to where they were.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#dtoken=')) {
      const token = decodeURIComponent(hash.slice('#dtoken='.length));
      const p = profileFromToken(token);
      if (p) {
        saveAuth(token, p);
        resetSocket();
        setProfile(p);
        // The payload is only a first guess: a token minted by the hub carries
        // no operator flag, and this room never trusts the flag from a payload
        // anyway. Ask the server, which re-derives it from ADMIN_DISCORD_IDS.
        api.me().then(({ profile }) => {
          saveAuth(token, profile);
          setProfile(profile);
        }).catch(() => { /* a refused token is already handled by the api layer */ });
      }
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    // #derror is handled by the toast provider.
  }, []);

  // Ask once per signed-in account. Operators never need to ask.
  const profileId = profile?.id ?? null;
  const profileAdmin = !!profile?.isAdmin;
  useEffect(() => {
    if (!profileId || profileAdmin) return;
    let live = true;
    api.hosting()
      .then(r => { if (live) setHostCheck({ id: profileId, canHost: r.canHost }); })
      .catch(() => { if (live) setHostCheck({ id: profileId, canHost: false }); });
    return () => { live = false; };
  }, [profileId, profileAdmin]);
  const canHost = !!profile && (profile.isAdmin === true || (hostCheck?.id === profile.id && hostCheck.canHost));

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

  // Sign in on the hub and come back: the hub answers with the same
  // `#dtoken=` this page already reads, on the exact page you left.
  const signInViaHub = useCallback((returnPath?: string) => {
    if (!hubUrl) return;
    const ret = returnPath ?? (window.location.pathname + window.location.search);
    const back = `${window.location.origin}${ret.startsWith('/') ? ret : '/'}`;
    window.location.href = `${hubUrl}/sso?return=${encodeURIComponent(back)}`;
  }, [hubUrl]);

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
    () => ({ profile, canHost, chatEnabled, discordEnabled, demoMode, signInDemo, codeVerify, codeVerifyChannel, codeVerifyButton, discordInviteUrl, signInDiscord, hubUrl, configLoaded, signInViaHub, linkDiscord, acceptAuth, signOut }),
    [profile, canHost, chatEnabled, discordEnabled, demoMode, signInDemo, codeVerify, codeVerifyChannel, codeVerifyButton, discordInviteUrl, signInDiscord, hubUrl, configLoaded, signInViaHub, linkDiscord, acceptAuth, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  return useContext(Ctx);
}
