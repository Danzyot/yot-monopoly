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
import { registerIdentity } from './discord.ts';
import { impliedGuildIds, looksLikeCode, normalizeCode, resolveCode } from './verifycode.ts';
import { isOn } from './features.ts';

const BUTTON_ID = 'mono_verify_button';
const MODAL_ID = 'mono_verify_modal';

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
              label: `Your code from ${BRAND.name}`,
              style: 1,
              placeholder: `${BRAND.codePrefix}XXXX`,
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
          `That doesn't look like a ${BRAND.name} code. Grab one on the site ` +
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
        body: ephemeral('That code is invalid or expired. Get a fresh one on the site and try again.'),
      };
    }

    // The interaction came from inside the server, so membership is proven.
    const guilds = interaction.guild_id ? [interaction.guild_id] : impliedGuildIds();
    registerIdentity(user.id, username, guilds);

    return {
      status: 200,
      body: ephemeral(
        `You're verified as **${username}**. Head back to ${BRAND.name} — it signs you in within a few seconds.`,
      ),
    };
  }

  // Not ours.
  return null;
}
