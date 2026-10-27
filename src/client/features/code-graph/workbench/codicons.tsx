import codiconHref from '@vscode/codicons/dist/codicon.css?url';

// vscode-icon looks up this exact id to load the font inside its shadow root, and the
// @font-face it declares also serves the plain `.codicon` spans below. Load it once,
// before any icon connects (this module only ships in the lazy code-graph chunk).
const STYLESHEET_ID = 'vscode-codicon-stylesheet';
if (typeof document !== 'undefined' && !document.getElementById(STYLESHEET_ID)) {
  const link = document.createElement('link');
  link.id = STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = codiconHref;
  document.head.append(link);
}

/** A codicon glyph (https://microsoft.github.io/vscode-codicons/dist/codicon.html). */
export function Codicon({ name, className, title, slot }: {
  name: string;
  className?: string;
  title?: string;
  /** Slot of the host web component (e.g. `content-before` of a textfield). */
  slot?: string;
}) {
  return (
    <span
      className={`codicon codicon-${name}${className ? ` ${className}` : ''}`}
      aria-hidden={title ? undefined : true}
      title={title}
      slot={slot}
    />
  );
}
