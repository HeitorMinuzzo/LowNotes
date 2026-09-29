/** Shared dismissal behavior for app modals. The last mounted modal owns Escape. */
export function dismissibleModal(node: HTMLElement, onDismiss: () => void) {
  node.dataset.modalBackdrop = '';
  let pressedOutside = false;

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
    },
  };
}
