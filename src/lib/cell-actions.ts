export type CellActionKind =
  | 'run'
  | 'edit'
  | 'insert-after'
  | 'insert-before'
  | 'delete'
  | 'view-image';

export interface CellAction {
  kind: CellActionKind;
  index?: number;
  code: string;
}

export function tagToAction(tag: string): CellActionKind | null {
  if (tag === 'python-run' || tag === 'py-run' || tag === 'run') return 'run';
  if (tag === 'python-edit' || tag === 'py-edit' || tag === 'edit') return 'edit';
  if (tag === 'python-insert-after' || tag === 'py-insert-after' || tag === 'insert-after') return 'insert-after';
  if (tag === 'python-insert-before' || tag === 'py-insert-before' || tag === 'insert-before') return 'insert-before';
  if (tag === 'python-delete' || tag === 'py-delete' || tag === 'delete-cell') return 'delete';
  if (tag === 'view-image' || tag === 'see-image' || tag === 'look-image' || tag === 'view') return 'view-image';
  return null;
}

// kinds whose fenced body is allowed to be empty
const NO_BODY = new Set<CellActionKind>(['delete', 'view-image']);

export function extractCellActions(text: string): CellAction[] {
  const out: CellAction[] = [];
  const re = /```([a-zA-Z-]+)(?::(\d+))?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tag = m[1].toLowerCase();
    const idx = m[2] ? parseInt(m[2], 10) : undefined;
    const code = m[3];
    const action = tagToAction(tag);
    if (!action) continue;
    if ((action === 'edit' || action === 'insert-after' || action === 'insert-before' || action === 'delete') && idx === undefined) continue;
    const trimmed = NO_BODY.has(action) ? '' : code.trim();
    if (!NO_BODY.has(action) && !trimmed) continue;
    out.push({ kind: action, index: idx, code: trimmed });
  }
  return out;
}

export function extractCodeBlocks(text: string): string[] {
  return extractCellActions(text).filter(a => a.kind === 'run').map(a => a.code);
}

export function actionLabel(action: CellAction): string {
  if (action.kind === 'run') return '▶ executed';
  if (action.kind === 'edit') return action.index ? `✎ edit cell ${action.index}` : '✎ edit';
  if (action.kind === 'insert-after') return action.index ? `↳ after cell ${action.index}` : '↳ inserted';
  if (action.kind === 'insert-before') return action.index ? `↱ before cell ${action.index}` : '↱ inserted';
  if (action.kind === 'delete') return action.index ? `✕ delete cell ${action.index}` : '✕ delete';
  if (action.kind === 'view-image') return action.index ? `🖼 view cell ${action.index}` : '🖼 view';
  return '';
}
