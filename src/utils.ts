import type { Board, Card, Color, Filter, PropDef, PropValue, SelectOption, Sort } from './types';
import { NONE_GROUP } from './types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const COLORS: Color[] = [
  'default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red',
];

export const colorLabel = (c: Color) => (c === 'default' ? 'Default' : c[0].toUpperCase() + c.slice(1));

export const randomColor = (): Color => COLORS[1 + Math.floor(Math.random() * (COLORS.length - 1))];

export const PROP_TYPE_LABEL: Record<PropDef['type'], string> = {
  text: 'Text',
  number: 'Number',
  select: 'Select',
  multi_select: 'Multi-select',
  date: 'Date',
  checkbox: 'Checkbox',
  url: 'URL',
};

export const PROP_TYPE_ICON: Record<PropDef['type'], string> = {
  text: '≡',
  number: '#',
  select: '◉',
  multi_select: '☰',
  date: '▦',
  checkbox: '☑',
  url: '🔗',
};

export function isEmpty(v: PropValue): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function findOption(prop: PropDef | undefined, id: unknown): SelectOption | undefined {
  if (!prop?.options || typeof id !== 'string') return undefined;
  return prop.options.find((o) => o.id === id);
}

export function groupKeyOf(card: Card, groupProp: PropDef | undefined): string {
  if (!groupProp) return NONE_GROUP;
  const v = card.props[groupProp.id];
  if (typeof v === 'string' && findOption(groupProp, v)) return v;
  return NONE_GROUP;
}

// ---------- markdown checklist progress ----------
export function checklistProgress(content: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const line of content.split('\n')) {
    const m = /^\s*[-*]\s+\[( |x|X)\]/.exec(line);
    if (m) {
      total++;
      if (m[1] !== ' ') done++;
    }
  }
  return { done, total };
}

// ---------- dates ----------
export function formatDate(iso: string): string {
  const d = parseDate(iso);
  if (!d) return iso;
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  const today = startOfDay(now).getTime();
  const diff = Math.round((startOfDay(d).getTime() - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString(undefined, opts);
}

export function parseDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function isOverdue(iso: string): boolean {
  const d = parseDate(iso);
  if (!d) return false;
  return d.getTime() < startOfDay(new Date()).getTime();
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ---------- filtering & sorting ----------
function valueText(board: Board, card: Card, propId: string): string {
  if (propId === 'title') return card.title;
  const prop = board.props.find((p) => p.id === propId);
  const v = card.props[propId];
  if (!prop || isEmpty(v)) return '';
  if (prop.type === 'select') return findOption(prop, v)?.name ?? '';
  if (prop.type === 'multi_select')
    return (v as string[]).map((id) => findOption(prop, id)?.name ?? '').join(', ');
  return String(v);
}

export function matchesFilter(board: Board, card: Card, f: Filter): boolean {
  const prop = board.props.find((p) => p.id === f.propId);
  const raw = f.propId === 'title' ? card.title : card.props[f.propId];
  const val = f.value ?? '';
  switch (f.op) {
    case 'empty':
      return isEmpty(raw);
    case 'not_empty':
      return !isEmpty(raw);
    case 'checked':
      return raw === true;
    case 'unchecked':
      return raw !== true;
    case 'is':
      if (!val) return true;
      if (prop?.type === 'select') return raw === val;
      if (prop?.type === 'multi_select') return Array.isArray(raw) && raw.includes(val);
      if (prop?.type === 'date') return raw === val;
      return valueText(board, card, f.propId).toLowerCase() === val.toLowerCase();
    case 'is_not':
      if (!val) return true;
      if (prop?.type === 'select') return raw !== val;
      if (prop?.type === 'multi_select') return !(Array.isArray(raw) && raw.includes(val));
      return valueText(board, card, f.propId).toLowerCase() !== val.toLowerCase();
    case 'contains':
      return valueText(board, card, f.propId).toLowerCase().includes(val.toLowerCase());
    case 'not_contains':
      return !valueText(board, card, f.propId).toLowerCase().includes(val.toLowerCase());
    case 'before':
      return typeof raw === 'string' && !!val && raw < val;
    case 'after':
      return typeof raw === 'string' && !!val && raw > val;
    case 'gt':
      return typeof raw === 'number' && val !== '' && raw > Number(val);
    case 'lt':
      return typeof raw === 'number' && val !== '' && raw < Number(val);
  }
}

export function sortCards(board: Board, cards: Card[], sort: Sort | null): Card[] {
  const arr = [...cards];
  if (!sort) return arr.sort((a, b) => a.order - b.order);
  const dir = sort.dir === 'asc' ? 1 : -1;
  const prop = board.props.find((p) => p.id === sort.propId);
  const key = (c: Card): string | number | null => {
    if (sort.propId === 'title') return c.title.toLowerCase();
    if (sort.propId === 'createdAt') return c.createdAt;
    if (sort.propId === 'updatedAt') return c.updatedAt;
    const v = c.props[sort.propId];
    if (!prop || isEmpty(v)) return null;
    if (prop.type === 'select') {
      const i = prop.options?.findIndex((o) => o.id === v) ?? -1;
      return i < 0 ? null : i;
    }
    if (prop.type === 'multi_select') return valueText(board, c, prop.id).toLowerCase();
    if (prop.type === 'checkbox') return v ? 1 : 0;
    if (prop.type === 'number') return Number(v);
    return String(v).toLowerCase();
  };
  return arr.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null && kb === null) return a.order - b.order;
    if (ka === null) return 1; // empties last regardless of direction
    if (kb === null) return -1;
    if (ka < kb) return -1 * dir;
    if (ka > kb) return 1 * dir;
    return a.order - b.order;
  });
}

export function visibleCards(board: Board, search: string): Card[] {
  const q = search.trim().toLowerCase();
  return board.cards.filter((c) => {
    if (q && !c.title.toLowerCase().includes(q) && !c.content.toLowerCase().includes(q)) return false;
    return board.view.filters.every((f) => matchesFilter(board, c, f));
  });
}

export function filterOpsFor(prop: PropDef | 'title'): { op: Filter['op']; label: string }[] {
  const type = prop === 'title' ? 'text' : prop.type;
  switch (type) {
    case 'select':
    case 'multi_select':
      return [
        { op: 'is', label: type === 'select' ? 'is' : 'contains' },
        { op: 'is_not', label: type === 'select' ? 'is not' : 'does not contain' },
        { op: 'empty', label: 'is empty' },
        { op: 'not_empty', label: 'is not empty' },
      ];
    case 'checkbox':
      return [
        { op: 'checked', label: 'is checked' },
        { op: 'unchecked', label: 'is unchecked' },
      ];
    case 'date':
      return [
        { op: 'is', label: 'is' },
        { op: 'before', label: 'is before' },
        { op: 'after', label: 'is after' },
        { op: 'empty', label: 'is empty' },
        { op: 'not_empty', label: 'is not empty' },
      ];
    case 'number':
      return [
        { op: 'is', label: '=' },
        { op: 'gt', label: '>' },
        { op: 'lt', label: '<' },
        { op: 'empty', label: 'is empty' },
        { op: 'not_empty', label: 'is not empty' },
      ];
    default:
      return [
        { op: 'contains', label: 'contains' },
        { op: 'not_contains', label: 'does not contain' },
        { op: 'is', label: 'is' },
        { op: 'empty', label: 'is empty' },
        { op: 'not_empty', label: 'is not empty' },
      ];
  }
}

export const opNeedsValue = (op: Filter['op']) =>
  !['empty', 'not_empty', 'checked', 'unchecked'].includes(op);
