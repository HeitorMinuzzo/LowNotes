import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import * as Y from 'yjs';
import { yCollab, YSyncConfig, yUndoManagerKeymap } from 'y-codemirror.next';
import type { Awareness } from 'y-protocols/awareness';

export function createLocalCollaboration(text: Y.Text, awareness: Awareness | null) {
  // Only CodeMirror edits enter history; snapshots and remote updates do not.
  const undoManager = new Y.UndoManager(text, { trackedOrigins: new Set([YSyncConfig]) });
  return {
    undoManager,
    extension: [
      // basicSetup also binds Ctrl+Z. Always use Yjs's selective history first.
      Prec.highest(keymap.of(yUndoManagerKeymap)),
      yCollab(text, awareness, { undoManager }),
    ],
  };
}
