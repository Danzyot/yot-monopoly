import type { CSSProperties } from 'react';
import type { Edition } from '../../shared/themes.ts';

/** CSS variables that reskin the HTML interface for an edition. */
export function themeStyle(theme: Edition): CSSProperties {
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
    if (ui.go) vars['--go'] = ui.go;
    if (ui.goText) vars['--go-text'] = ui.goText;
  }
  return vars as CSSProperties;
}
