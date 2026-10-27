import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import VscodeTextfield from '@vscode-elements/react-elements/dist/components/VscodeTextfield.js';
import type { VscodeTextfield as TextfieldElement } from '@vscode-elements/elements/dist/vscode-textfield/vscode-textfield.js';
import { Codicon } from './workbench/codicons';
import list from './workbench/list.module.css';
import wb from './workbench/Workbench.module.css';

export interface QuickItem {
  key: string;
  icon: string;
  label: string;
  description: string;
  title?: string;
  onPick: () => void;
}

export interface QuickSection {
  label: string;
  items: QuickItem[];
}

interface QuickOpenProps {
  placeholder: string;
  ariaLabel: string;
  query: string;
  onQuery: (query: string) => void;
  sections: QuickSection[];
  /** Show the list even with an empty query (a pick the app asked for, like "Choose declaration"). */
  forceOpen?: boolean;
  /** Escape, or a pick: clear the query and any forced list. */
  onDismiss: () => void;
}

/** What the app can do to the quick open from outside: focus it (Double Shift, a chooser opening). */
export interface QuickOpenHandle {
  focus: () => void;
}

/** VSCode's quick open in the title bar: sectioned results, arrows to move, Enter to pick, Escape to close. */
export const QuickOpen = forwardRef<QuickOpenHandle, QuickOpenProps>(function QuickOpen(
  { placeholder, ariaLabel, query, onQuery, sections, forceOpen, onDismiss },
  ref,
) {
  const field = useRef<TextfieldElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => field.current?.focus() }), []);
  const items = sections.flatMap((s) => s.items);
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [query, sections.length, items.length]);

  const visible = sections.filter((s) => s.items.length > 0 || forceOpen);
  const open = visible.length > 0 && (query.trim() !== '' || !!forceOpen);
  const pick = (item: QuickItem | undefined) => {
    if (!item) return;
    item.onPick();
    onDismiss();
  };

  let index = 0;
  return (
    <>
      <VscodeTextfield
        ref={field}
        type="search"
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={query}
        onInput={(e) => onQuery((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
          if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setActive((a) => (a - 1 + items.length) % items.length); }
          if (e.key === 'Enter') pick(items[active]);
          if (e.key === 'Escape') onDismiss();
        }}
      >
        <Codicon name="search" slot="content-before" />
      </VscodeTextfield>
      {open && (
        <ul className={wb.quickList} role="listbox" aria-label={ariaLabel}>
          {visible.map((section) => (
            <li key={section.label} role="presentation">
              <div className={wb.quickSection}>{section.label}</div>
              {section.items.length === 0 ? (
                <div className={list.empty}>No results</div>
              ) : (
                <ul className={list.list} role="group">
                  {section.items.map((item) => {
                    const i = index++;
                    return (
                      <li key={item.key} role="option" aria-selected={i === active}>
                        <button
                          type="button"
                          className={list.row}
                          aria-current={i === active}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => pick(item)}
                          title={item.title ?? item.description}
                        >
                          <Codicon name={item.icon} className={list.icon} />
                          <span className={list.label}>{item.label}</span>
                          <span className={list.description}>{item.description}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
});
