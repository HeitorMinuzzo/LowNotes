/** Shared dismissal behavior for app modals. The last mounted modal owns Escape. */
export function dismissibleModal(node: HTMLElement, onDismiss: () => void) {
  node.dataset.modalBackdrop = '';
  let pressedOutside = false;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusableSelector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]';
  const controls = () => Array.from(node.querySelectorAll<HTMLElement>(focusableSelector)).filter((control) => control.getClientRects().length && !control.closest('[inert]'));
  queueMicrotask(() => {
    if (!node.isConnected || !isTopmost()) return;
    const firstInput = node.querySelector<HTMLInputElement>('input:not(:disabled):not([readonly])');
    (firstInput ?? controls()[0] ?? node.querySelector<HTMLElement>('[role="dialog"]'))?.focus();
  });

  function isTopmost() {
    const overlays = document.querySelectorAll('[data-modal-backdrop]');
    return overlays[overlays.length - 1] === node;
  }

  function onPointerDown(event: PointerEvent) {
    pressedOutside = event.button === 0 && event.target === node;
  }

  function onPointerUp(event: PointerEvent) {
    if (pressedOutside && event.target === node && isTopmost()) onDismiss();
    pressedOutside = false;
  }

  function onEscape(event: KeyboardEvent) {
    if (event.key === 'Tab' && isTopmost()) {
      const items = controls();
      const first = items[0];
      const last = items.at(-1);
      if (first && last && (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
    if (event.key !== 'Escape' || !isTopmost()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    onDismiss();
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onEscape, true);

  return {
    destroy() {
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onEscape, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    },
  };
}
