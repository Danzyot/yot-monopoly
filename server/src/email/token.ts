// The unsubscribe link in every email: names the account and the topic, signed
// with the server secret (auth.ts serviceMac, under its own "unsub:" purpose so
// it can never pass as a session or any other signature). No sign-in needed and
// no expiry: an unsubscribe link has to keep working in an old email.
import { sameMac, serviceMac } from '../auth.ts';
import { isEmailTopic, type EmailTopic } from '../../../shared/email.ts';

export interface UnsubscribeClaim {
  id: string;
  topic: EmailTopic | 'all';
}

const ID_RE = /^[\w-]{1,64}$/;

export function unsubscribeToken(id: string, topic: EmailTopic | 'all'): string {
  if (!ID_RE.test(id)) throw new Error('Bad player id');
  const payload = Buffer.from(`${id}|${topic}`, 'utf8').toString('base64url');
  return `${payload}.${serviceMac(`unsub:${payload}`)}`;
}

export function verifyUnsubscribeToken(token: unknown): UnsubscribeClaim | null {
  if (typeof token !== 'string' || token.length > 300) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !sameMac(token.slice(dot + 1), serviceMac(`unsub:${payload}`))) return null;
  const [id, topic, ...rest] = Buffer.from(payload, 'base64url').toString('utf8').split('|');
  if (rest.length || !id || !ID_RE.test(id)) return null;
  if (topic !== 'all' && !isEmailTopic(topic)) return null;
  return { id, topic };
}
