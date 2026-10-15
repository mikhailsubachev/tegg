// Requests for the Create offer (FR-LNK-04 AC-4, D-286): every context with a broken chip (editor, read view,
// properties, Broken links page) asks the app to show the one offer.
export type OfferEditor = { commands: { replaceLink(pos: number, linkText: string): boolean } };
export type OfferRequest = {
  /** The note the link is in (resolution and placement are relative to it). */
  from: string;
  /** The link target as written, without alias or subpath. */
  target: string;
  /** A relation's allowed types (D-243), else null. */
  relationTo: string[] | null;
  /** The chip; the focus returns to it when the offer closes. */
  anchor: HTMLElement | null;
  /** The editor holding the chip, for a plan with a rewrite (D-287); absent in read-only views. */
  editor?: OfferEditor;
  chipPos?: number;
};

let handler: ((r: OfferRequest) => void) | null = null;

export function setOfferHandler(h: ((r: OfferRequest) => void) | null): void {
  handler = h;
}

export function requestOffer(r: OfferRequest): void {
  handler?.({ ...r, target: r.target.split(/[|#]/)[0].trim().normalize('NFC') });
}
