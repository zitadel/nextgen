// Switches off the CSS transitions and animations inside every atom's shadow
// root. Remotion screenshots each frame while the browser keeps real time, so
// a checkbox ticking or a button pressed between two frames would be caught
// partway through a transition, differently on every render. The scenes move
// the atoms by the frame instead.
//
// Lit gives a shadow root its styles by assigning `adoptedStyleSheets`, which
// replaces the list, so the sheet goes in on every assignment rather than
// once. Import this before the atoms.

const still = new CSSStyleSheet();
still.replaceSync(
  "*, *::before, *::after { transition: none !important; animation: none !important; }",
);

const descriptor = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, "adoptedStyleSheets");
const set = descriptor?.set;
if (descriptor && set) {
  Object.defineProperty(ShadowRoot.prototype, "adoptedStyleSheets", {
    ...descriptor,
    set(this: ShadowRoot, sheets: CSSStyleSheet[]) {
      set.call(this, sheets.includes(still) ? sheets : [...sheets, still]);
    },
  });
}
