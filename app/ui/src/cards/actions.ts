// Slice OC (docs/contracts/v1-cards.md §11): the palette's `card.add`, `card.reset` and `type.changeIcon` reach the
// page that shows them (type settings, the type page) through this bridge; the latest registered handler answers
// (`ShellActions.cards`), as `views/actions.ts` does for the views.
import { useEffect, useRef } from 'react';

export type CardsHandler = { add(): void; reset(): void; changeIcon(): void; addDisabled?(): string | null; resetDisabled?(): string | null };

const stack: CardsHandler[] = [];
const top = () => stack[stack.length - 1];

export const cardsActions: CardsHandler = {
  add: () => top()?.add(),
  reset: () => top()?.reset(),
  changeIcon: () => top()?.changeIcon(),
  addDisabled: () => top()?.addDisabled?.() ?? null,
  resetDisabled: () => top()?.resetDisabled?.() ?? null,
};

/** Registers `h` while mounted (its functions read the latest render). */
export function useCardsHandler(h: CardsHandler): void {
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => {
    const me: CardsHandler = {
      add: () => ref.current.add(), reset: () => ref.current.reset(), changeIcon: () => ref.current.changeIcon(),
      addDisabled: () => ref.current.addDisabled?.() ?? null, resetDisabled: () => ref.current.resetDisabled?.() ?? null,
    };
    stack.push(me);
    return () => { const i = stack.indexOf(me); if (i >= 0) stack.splice(i, 1); };
  }, []);
}
