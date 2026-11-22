export type PropType = 'text' | 'number' | 'select' | 'multi_select' | 'date' | 'checkbox' | 'url';

export type Color =
  | 'default' | 'gray' | 'brown' | 'orange' | 'yellow'
  | 'green' | 'blue' | 'purple' | 'pink' | 'red';

export interface SelectOption {
  id: string;
  name: string;
  color: Color;
}

export interface PropDef {
  id: string;
  name: string;
  type: PropType;
  options?: SelectOption[];
}

export type PropValue = string | number | boolean | string[] | null | undefined;

export interface Card {
  id: string;
  title: string;
  icon?: string;
  props: Record<string, PropValue>;
  content: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export type FilterOp =
  | 'is' | 'is_not' | 'contains' | 'not_contains'
  | 'empty' | 'not_empty' | 'checked' | 'unchecked'
  | 'before' | 'after' | 'gt' | 'lt';

export interface Filter {
  id: string;
  propId: string; // 'title' for the card title
  op: FilterOp;
  value?: string;
}

export interface Sort {
  propId: string; // 'title' | 'createdAt' | 'updatedAt' | prop id
  dir: 'asc' | 'desc';
}

export interface View {
  groupBy: string | null; // select prop id
  sort: Sort | null; // null = manual
  filters: Filter[];
  visibleProps: string[];
  hiddenGroups: string[];
  showEmptyGroup: boolean;
  cardSize: 'small' | 'medium';
  layout: 'board' | 'table';
  tableHidden: string[]; // props hidden in table layout
  colWidths: Record<string, number>; // table column widths, keyed by prop id or 'title'
  collapsedGroups: string[]; // table layout
}

export interface Board {
  id: string;
  name: string;
  icon: string;
  props: PropDef[];
  cards: Card[];
  view: View;
  createdAt: number;
}

export interface AppState {
  version: 1;
  boards: Board[];
  activeBoardId: string | null;
  theme: 'light' | 'dark' | 'system';
  sidebarOpen: boolean;
  /** Your access to each board (missing = a board you created that hasn't synced yet). */
  access?: Record<string, BoardAccess>;
}

export interface BoardAccess {
  role: 'owner' | 'editor' | 'viewer';
  ownerName?: string;
  shared?: boolean; // has other members or a public link
}

export const NONE_GROUP = '__none__';
