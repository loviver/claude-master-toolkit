/** Callback ref for the active row of a tree: scrolls it into view when it becomes active. */
export function revealRow(el: HTMLElement | null): void {
  el?.scrollIntoView({ block: 'nearest' });
}
