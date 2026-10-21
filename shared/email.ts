// Email notifications: what a player can choose to hear about by email, and
// the shapes the settings page and the dashboard's Email tab read. The address
// itself comes from Discord sign-in (the `email` scope) and stays on the
// server: no public endpoint, profile, card, feed or bot reply ever carries it.
//
// Having an address is not consent. Every topic is off until the player turns
// it on, except account and security notices.

export type EmailTopic = 'account' | 'tournaments' | 'streak' | 'friendInvites' | 'digest' | 'announcements';

export interface EmailTopicInfo {
  id: EmailTopic;
  label: string;
  help: string;
  /** On for a player who never chose. Only account notices are. */
  defaultOn: boolean;
}

export const EMAIL_TOPICS: readonly EmailTopicInfo[] = [
  { id: 'tournaments', label: 'Tournament reminders', help: 'An hour before a tournament you signed up for, or any scheduled Cards tournament.', defaultOn: false },
  { id: 'streak', label: 'Daily Challenge streak', help: "An evening nudge when you have a streak going and haven't played today's Daily yet.", defaultOn: false },
  { id: 'friendInvites', label: 'Friend invites', help: 'When a friend invites you to their table while you are offline.', defaultOn: false },
  { id: 'digest', label: 'Weekly digest', help: "Once a week: the week's top players and the tournaments coming up.", defaultOn: false },
  { id: 'announcements', label: 'Announcements', help: 'New boards and modes, season news. A few a month at most.', defaultOn: false },
  { id: 'account', label: 'Account and security notices', help: 'Rare: only about your account itself.', defaultOn: true },
];

export const EMAIL_TOPIC_IDS: readonly EmailTopic[] = EMAIL_TOPICS.map(t => t.id);

export function isEmailTopic(v: unknown): v is EmailTopic {
  return typeof v === 'string' && (EMAIL_TOPIC_IDS as readonly string[]).includes(v);
}

export function topicInfo(id: EmailTopic): EmailTopicInfo {
  return EMAIL_TOPICS.find(t => t.id === id)!;
}

export type EmailTopics = Record<EmailTopic, boolean>;

export function defaultTopics(): EmailTopics {
  return Object.fromEntries(EMAIL_TOPICS.map(t => [t.id, t.defaultOn])) as EmailTopics;
}

/** GET /api/email/prefs: the signed-in player's own settings (their own address, to them only). */
export interface EmailPrefs {
  /** The address Discord gave at the last sign-in, or null (signed in another way, or none yet). */
  email: string | null;
  /** Discord says the address is verified. Mail only ever goes to verified addresses. */
  verified: boolean;
  topics: EmailTopics;
  /** Mail stopped after a bounce or a spam report; turning a topic back on clears it. */
  suppressed: 'bounced' | 'complained' | null;
  /** The site can send mail at all (RESEND_API_KEY set). */
  sending: boolean;
}

/** GET /api/admin/email: the dashboard's Email tab. Counts only, never addresses. */
export interface EmailAdminOverview {
  configured: boolean;
  from: string;
  webhook: boolean;
  publicUrl: string;
  accounts: number;
  withEmail: number;
  verified: number;
  suppressed: number;
  /** Players who would get mail on each topic right now (verified, not suppressed, topic on). */
  topics: Record<EmailTopic, number>;
  queue: { pending: number; sentToday: number; failedToday: number; notConfiguredToday: number };
  limits: { perUserPerDay: number; perSecond: number };
  recent: EmailLogRow[];
}

export interface EmailLogRow {
  at: number;
  topic: EmailTopic | 'test';
  /** Player id (never the address). */
  to: string;
  name: string | null;
  subject: string;
  status: 'sent' | 'failed' | 'not-configured' | 'dropped' | 'retrying';
  note?: string;
}

/** POST /api/admin/email/announcement/preview */
export interface AnnouncementPreview {
  subject: string;
  html: string;
  text: string;
  recipients: number;
}
