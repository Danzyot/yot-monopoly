// Who this deployment is. Everything the player reads by name comes from
// here, so rebranding the site is one file.
export const BRAND = {
  name: 'Yot Monopoly',
  org: 'Yot',
  short: 'Yot',
  /** Prefix on the "Verify with a code" codes, e.g. MONO-AB12. */
  codePrefix: 'MONO-',
} as const;
