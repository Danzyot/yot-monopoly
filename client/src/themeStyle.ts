import type { CSSProperties } from 'react';
import type { Theme } from '../../shared/themes.ts';

/** CSS variables that reskin the HTML interface for an edition. */
export function themeStyle(theme: Theme): CSSProperties {
  const ui = theme.ui;
  const vars: Record<string, string> = { '--accent': theme.palette.accent };
  if (ui) {
    vars['--bg'] = ui.bg;
    vars['--panel'] = ui.panel;
    vars['--panel-solid'] = ui.panelSolid;
    vars['--line'] = ui.line;
    vars['--text'] = ui.text;
    vars['--muted'] = ui.muted;
    if (ui.font) vars['--font'] = ui.font;
  }
  return vars as CSSProperties;
}
