import { BRAND } from '../../shared/brand.ts';
// Discord interactions for this site's own application.
//
// Set the application's Interactions Endpoint URL in the Discord Developer
// Portal to:
//     https://<your-domain>/api/discord/interactions
//
// Every interaction is verified against the raw body with the app's public
// key before it is looked at. This site owns its application outright, so an
// interaction it does not recognise is answered, not passed anywhere else.
import { createPublicKey, verify as edVerify } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { registerIdentity } from './discord.ts';
import { impliedGuildIds, looksLikeCode, normalizeCode, resolveCode } from './verifycode.ts';
import { isOn } from './features.ts';

const BUTTON_ID = 'poker_verify_button';
const MODAL_ID = 'poker_verify_modal';

export function interactionsConfigured(): boolean {
  return !!process.env.DISCORD_PUBLIC_KEY?.trim();
}

// Ed25519 check with no dependencies: wrap Discord's raw 32-byte public key
// in the SPKI DER header node:crypto understands.
export function validSignature(
  publicKeyHex: string, signatureHex: string, timestamp: string, rawBody: Buffer,
): boolean {
  try {
    const der = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(publicKeyHex, 'hex'),
    ]);
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    return edVerify(
      null,
      Buffer.concat([Buffer.from(timestamp), rawBody]),
      key,
      Buffer.from(signatureHex, 'hex'),
    );
  } catch {
    return false;
  }
}

const ephemeral = (content: string) => ({ type: 4, data: { content, flags: 64 } });

interface Interaction {
  type: number;
  guild_id?: string;
  data?: {
    custom_id?: string;
    components?: { components?: { custom_id?: string; value?: string }[] }[];
  };
  member?: { user?: DiscordUser; roles?: string[] };
  user?: DiscordUser;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export interface InteractionOutcome {
  status: number;
  body: unknown;
}

// Handle a verified interaction payload. Returns the JSON Discord expects.
export function handleInteraction(interaction: Interaction): InteractionOutcome | null {
  // Endpoint validation ping.
  if (interaction.type === 1) return { status: 200, body: { type: 1 } };

  // Code sign-in switched off on the dashboard: the button and the modal answer that, and nothing resolves.
  if ((interaction.type === 3 && interaction.data?.custom_id === BUTTON_ID) || (interaction.type === 5 && interaction.data?.custom_id === MODAL_ID)) {
    if (!isOn('codeVerify')) {
      return { status: 200, body: ephemeral(`Verifying with a code is switched off right now. Use "Sign in with Discord" on the ${BRAND.name} site.`) };
    }
  }

  // "Verify" button → open the code modal.
  if (interaction.type === 3 && interaction.data?.custom_id === BUTTON_ID) {
    return {
      status: 200,
      body: {
        type: 9, // MODAL
        data: {
          custom_id: MODAL_ID,
          title: `${BRAND.name} Verification`,
          components: [{
            type: 1,
            components: [{
              type: 4, // text input
              custom_id: 'code',
              label: 'Your code from the poker site',
              style: 1,
              placeholder: 'POKER-XXXX',
              min_length: 4,
              max_length: 12,
              required: true,
            }],
          }],
        },
      },
    };
  }

  // Modal submitted → resolve the code for this member.
  if (interaction.type === 5 && interaction.data?.custom_id === MODAL_ID) {
    const user = interaction.member?.user ?? interaction.user;
    if (!user?.id) {
      return { status: 200, body: ephemeral("Couldn't read your Discord account — try again.") };
    }

    const raw = interaction.data.components?.[0]?.components?.[0]?.value ?? '';
    if (!looksLikeCode(raw)) {
      return {
        status: 200,
        body: ephemeral(
          "That doesn't look like a poker code. Grab one on the poker site " +
          '(Sign in → Verify with a code), then click Verify again.',
        ),
      };
    }

    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
      : null;
    const username = user.global_name || user.username;

    if (!resolveCode(normalizeCode(raw), { id: user.id, username, avatarUrl })) {
      return {
        status: 200,
        body: ephemeral('That code is invalid or expired. Get a fresh one on the poker site and try again.'),
      };
    }

    // The interaction came from inside the server, so membership is proven.
    const guilds = interaction.guild_id ? [interaction.guild_id] : impliedGuildIds();
    registerIdentity(user.id, username, guilds);

    return {
      status: 200,
      body: ephemeral(
        `You're verified as **${username}**. Head back to the poker site — it signs you in within a few seconds.`,
      ),
    };
  }

  // Not ours.
  return null;
}

// Connection-level failures happen before the upstream saw anything, so one
// immediate retry is free of double-execution risk. Timeouts are NOT retried:
// the upstream may already be processing (a second /casino could double a bet).
const RETRIABLE = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE']);

// The forward is made with the classic node:http(s) client, NOT fetch.
// Production (node:22-alpine) kept killing forwards with "Cannot perform
// ArrayBuffer.prototype.slice on a detached ArrayBuffer" thrown inside
// undici's fetch — even after the body was a fresh standalone copy, so the
// fault is in fetch's own body machinery on that build. The classic client
// has no ArrayBuffer handling at all: the Buffer goes straight to the socket.
function rawRequest(
  url: string, method: 'POST' | 'GET', headers: Record<string, string>,
  body: Buffer | null, timeoutMs: number, redirects = 0,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const doRequest = u.protocol === 'http:' ? httpRequest : httpsRequest;
    const req = doRequest(u, { method, headers }, (res: IncomingMessage) => {
      const { statusCode = 0, headers: rh } = res;
      // Follow a redirect (Vercel apex/www hops) preserving method and body —
      // the signed payload must arrive intact or the far end rejects it.
      if (rh.location && statusCode >= 300 && statusCode < 400 && redirects < 3) {
        res.resume();
        resolve(rawRequest(
          new URL(rh.location, u).toString(), method, headers, body, timeoutMs, redirects + 1,
        ));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(Object.assign(new Error(`no response within ${timeoutMs}ms`), { name: 'TimeoutError' }));
    });
    req.on('error', reject);
    req.end(body ?? undefined);
  });
}

