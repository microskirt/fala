/*
 * Which device is driving the interface: a pointer or a keyboard.
 *
 * The browser decides for itself when a focus ring is due, and its rule is
 * simple: any key going down counts as keyboard use. Fala binds Space to play
 * and pause, so clicking a nav item and then reaching for the play shortcut
 * turned the ring on for an element that had only ever been clicked. It read as
 * a stray box drawn around whatever happened to be focused.
 *
 * Rings are shown here only after a key that actually moves focus. A pointer
 * always clears the mode, and keys that do nothing to focus (Space, letters,
 * Enter) leave it alone. The ring then means "the keyboard is driving this",
 * which is the only thing it was ever supposed to say.
 */
const FOCUS_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export function installInputModality() {
  const root = document.documentElement;
  const set = (mode) => {
    if (root.dataset.input !== mode) root.dataset.input = mode;
  };
  /*
   * Capture phase, so a handler that stops propagation cannot hide the fact
   * that a pointer was used.
   */
  const onPointer = () => set('pointer');
  const onKey = (e) => {
    if (FOCUS_KEYS.has(e.key)) set('keyboard');
  };

  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('keydown', onKey, true);

  return () => {
    document.removeEventListener('pointerdown', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
  };
}
