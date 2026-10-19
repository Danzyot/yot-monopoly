// Inline icon set (16×16 grid, stroke-based, currentColor). Emoji in UI
// chrome reads as a prototype; these keep the interface looking deliberate.
// Player avatars are content, not chrome — they stay as they are.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = ({ size = 16, ...rest }: P) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...rest,
});

export const IconLink = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.2" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.2" />
  </svg>
);

export const IconGavel = (p: P) => (
  <svg {...base(p)}>
    <path d="m14 4 6 6-3 3-6-6 3-3Z" />
    <path d="m11 7-7 7 3 3 7-7" />
    <path d="M4 20h9" />
  </svg>
);

export const IconChevron = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconCopy = (p: P) => (
  <svg {...base(p)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </svg>
);

export const IconEye = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

export const IconScroll = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
    <path d="M9 12h6M9 16h6" />
  </svg>
);

export const IconReplay = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 1 0 2.6-6.3" />
    <path d="M3 4v4h4" />
    <path d="M10 9.5v5l4.2-2.5Z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconSoundOn = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
  </svg>
);

export const IconSoundOff = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
    <path d="m16.5 9.5 5 5m0-5-5 5" />
  </svg>
);

export const IconGear = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.98 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.98a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09c0 .68.4 1.3 1.03 1.56a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9c.26.63.88 1.03 1.56 1.03H21a2 2 0 1 1 0 4h-.09c-.68 0-1.3.4-1.51 1Z" />
  </svg>
);

export const IconShield = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 2 4.5 5v6c0 5 3.2 8.6 7.5 10 4.3-1.4 7.5-5 7.5-10V5Z" />
    <path d="m9 12 2 2 4-4.5" />
  </svg>
);

export const IconTrophy = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z" />
    <path d="M7 6H4.5a0 0 0 0 0 0 0c0 2.8 1 4.5 2.9 5M17 6h2.5c0 2.8-1 4.5-2.9 5" />
  </svg>
);

export const IconUsers = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 20c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
    <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 15.3c1.7.7 2.8 2.2 3.2 4.7" />
  </svg>
);

export const IconClock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const IconChips = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4" />
  </svg>
);

export const IconPlay = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 5.5v13l10-6.5Z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPause = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 5.5v13M16 5.5v13" strokeWidth={2.6} />
  </svg>
);

export const IconStop = (p: P) => (
  <svg {...base(p)}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
);

export const IconChat = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.7A8 8 0 1 1 21 12Z" />
  </svg>
);

export const IconBot = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="8" width="14" height="11" rx="2.5" />
    <path d="M12 8V4.5M9.5 4.5h5" />
    <circle cx="9.3" cy="13" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="14.7" cy="13" r="1.1" fill="currentColor" stroke="none" />
    <path d="M9.5 16.2h5" />
  </svg>
);

export const IconRabbit = (p: P) => (
  <svg {...base(p)}>
    <path d="M13 10c0-3 .8-6.8 2.8-7 1.6-.1.9 3.7.2 5.6" />
    <path d="M11.5 10c-.4-2.8-1.8-6-3.5-5.7-1.5.3.1 3.9 1.3 5.5" />
    <circle cx="12" cy="15.5" r="5.5" />
  </svg>
);

export const IconGift = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="9" width="16" height="11" rx="1.5" />
    <path d="M4 13h16M12 9v11" />
    <path d="M12 9C10 9 7.5 8.3 7.5 6.2 7.5 4.7 9 4 10.2 4.8 11.4 5.6 12 9 12 9Zm0 0c2 0 4.5-.7 4.5-2.8 0-1.5-1.5-2.2-2.7-1.4C12.6 5.6 12 9 12 9Z" />
  </svg>
);

export const IconArrowLeft = (p: P) => (
  <svg {...base(p)}>
    <path d="M19 12H5m6-7-7 7 7 7" />
  </svg>
);

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 12.5 5 5L19.5 7" />
  </svg>
);

export const IconX = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const IconRefresh = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 12a8 8 0 1 1-2.3-5.7" />
    <path d="M20 4v4.5h-4.5" />
  </svg>
);

export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </svg>
);

export const IconGrid = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="7" height="7" rx="1.2" />
    <rect x="13" y="4" width="7" height="7" rx="1.2" />
    <rect x="4" y="13" width="7" height="7" rx="1.2" />
    <rect x="13" y="13" width="7" height="7" rx="1.2" />
  </svg>
);

export const IconSpade = ({ size = 16, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden {...rest}>
    <path
      d="M50 8 C36 28 20 39 20 55 c0 11 9 19 19 19 4 0 7-1 10-3 -1 8-4 13-10 18 v5 h22 v-5 c-6-5-9-10-10-18 3 2 6 3 10 3 10 0 19-8 19-19 C80 39 64 28 50 8 Z"
      fill="currentColor"
    />
  </svg>
);

export const IconPencil = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 0l.5.5a2.1 2.1 0 0 1 0 3L8.5 19Z" />
    <path d="M14.5 6l3.5 3.5" />
  </svg>
);

// Discord's app mark: the blurple speech-bubble tile with the face knocked
// out of it. The face is a mask rather than a black-filled shape, so the
// cut-out shows whatever is actually behind the tile instead of assuming the
// surface under it is pure black.
export const IconDiscord = ({ size = 30, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...rest}>
    <defs>
      <mask id="chog-discord-face">
        <rect width="24" height="24" fill="#fff" />
        <g transform="translate(4.95 4.45) scale(0.483)">
          <path
            fill="#000"
            d="M20.32 4.37a19.8 19.8 0 0 0-4.93-1.51 13.8 13.8 0 0 0-.64 1.28 18.3 18.3 0 0 0-5.5 0 13.8 13.8 0 0 0-.64-1.28c-1.71.29-3.37.8-4.93 1.51A20.3 20.3 0 0 0 .1 18.06a19.9 19.9 0 0 0 6.07 3.03c.49-.66.93-1.37 1.3-2.1a12.9 12.9 0 0 1-2.05-.98c.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.16 0c.17.13.33.26.5.38-.65.39-1.34.71-2.05.98.37.73.81 1.44 1.3 2.1a19.9 19.9 0 0 0 6.07-3.03 20.3 20.3 0 0 0-3.58-13.69ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Zm7.96 0c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.21 0 2.18 1.09 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Z"
          />
        </g>
      </mask>
    </defs>
    <g fill="#5865f2" mask="url(#chog-discord-face)">
      <rect x="2.4" y="2.6" width="17.2" height="15.2" rx="4.4" />
      {/* The bubble's tail, off the bottom-right corner. */}
      <path d="M12.8 13.4 L21.2 22.1 L15.4 16.9 Z" />
    </g>
  </svg>
);
