import { useMemo, useRef, useState } from 'react';
import type { Board, Card, PropDef, SelectOption } from '../types';
import { NONE_GROUP } from '../types';
import { actions, undo } from '../store';
import { pressToDrag, useFlip } from '../dnd';
import { checklistProgress, groupKeyOf, PROP_TYPE_ICON, sortCards, visibleCards } from '../utils';
import { PropMenu, PropValueEditor, TypeList } from './props';
import { Icon, MenuItem, MenuSep, Popover, Tag, toast, usePopover } from './ui';

interface Group {
  key: string;
  option: SelectOption | null;
  cards: Card[];
}

const DEFAULT_WIDTH: Partial<Record<PropDef['type'] | 'title', number>> = {
  title: 300,
  checkbox: 110,
  number: 130,
  date: 190,
  multi_select: 220,
};
const widthOf = (board: Board, key: string, type: PropDef['type'] | 'title') =>
  board.view.colWidths[key] ?? DEFAULT_WIDTH[type] ?? 180;

export function TableView({
  board,
  search,
  onOpenCard,
  openCardId,
}: {
  board: Board;
  search: string;
  onOpenCard: (id: string) => void;
  openCardId: string | null;
}) {
  const v = board.view;
  const groupProp = board.props.find((p) => p.id === v.groupBy && p.type === 'select');
  const columns = board.props.filter((p) => !v.tableHidden.includes(p.id));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ id: string; height: number } | null>(null);
  const [drop, setDrop] = useState<{ group: string; index: number } | null>(null);
  const dragId = drag?.id ?? null;
  const tableRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useFlip(tableRef);
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  const headerMenu = usePopover<HTMLElement>();
  const [menuCol, setMenuCol] = useState<string | null>(null);
  const addProp = usePopover<HTMLElement>();
  const [focusNew, setFocusNew] = useState<string | null>(null);

  const groups: Group[] = useMemo(() => {
    const cards = sortCards(board, visibleCards(board, search), v.sort);
    if (!groupProp) return [{ key: NONE_GROUP, option: null, cards }];
    const map = new Map<string, Card[]>([[NONE_GROUP, []]]);
    for (const o of groupProp.options ?? []) map.set(o.id, []);
    for (const c of cards) map.get(groupKeyOf(c, groupProp))!.push(c);
    return [
      { key: NONE_GROUP, option: null, cards: map.get(NONE_GROUP)! },
      ...(groupProp.options ?? []).map((o) => ({ key: o.id, option: o, cards: map.get(o.id)! })),
    ];
  }, [board, search, groupProp, v.sort]);

  const shown = groups.filter(
    (g) =>
      !v.hiddenGroups.includes(g.key) &&
      !(groupProp && g.key === NONE_GROUP && (!v.showEmptyGroup || g.cards.length === 0)),
  );
  const total = groups.reduce((n, g) => n + g.cards.length, 0);

  const w = (key: string, type: PropDef['type'] | 'title') => liveWidths[key] ?? widthOf(board, key, type);
  const tableWidth = 36 + w('title', 'title') + columns.reduce((n, p) => n + w(p.id, p.type), 0) + 44;

  // ----- column resize -----
  const startResize = (e: React.MouseEvent, key: string, type: PropDef['type'] | 'title') => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const start = w(key, type);
    let latest = start;
    const move = (ev: MouseEvent) => {
      latest = Math.max(80, Math.min(800, start + ev.clientX - startX));
      setLiveWidths((cur) => ({ ...cur, [key]: latest }));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing');
      if (latest !== start) actions.updateView(board.id, (view) => void (view.colWidths[key] = latest));
      setLiveWidths((cur) => {
        const { [key]: _, ...rest } = cur;
        return rest;
      });
    };
    document.body.classList.add('resizing');
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // ----- row drag -----
  const latestGroups = useRef(groups);
  latestGroups.current = groups;
  const endDrag = () => {
    setDrag(null);
    setDrop(null);
  };
  const startRowDrag = (e: React.PointerEvent, card: Card, el: HTMLElement) =>
    pressToDrag(
      e,
      {
        id: card.id,
        el,
        axis: 'y',
        container: '[data-drop="row"]',
        item: '[data-drag="row"]',
        scrollers: () => [scrollRef.current],
        touchDelay: 0,
        onStart: ({ height, from }) => {
          setDrag({ id: card.id, height });
          setDrop(from && { group: from.container, index: from.index });
        },
        onOver: (group, index) => setDrop({ group, index }),
        onDrop: (group, index) => {
          const g = latestGroups.current.find((x) => x.key === group);
          if (g) {
            const list = g.cards.filter((c) => c.id !== card.id);
            actions.moveCard(board.id, card.id, g.key, list[index - 1]?.id ?? null, list[index]?.id ?? null);
          }
          endDrag();
        },
        onCancel: endDrag,
      },
      { fromHandle: true },
    );

  const toggleSel = (id: string) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const allIds = shown.flatMap((g) => (v.collapsedGroups.includes(g.key) ? [] : g.cards.map((c) => c.id)));
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const addRow = (groupKey: string) => {
    const id = actions.addCard(board.id, groupKey, 'bottom');
    setFocusNew(id);
  };

  const menuProp = board.props.find((p) => p.id === menuCol);

  const header = (
    <div className="t-row t-head" style={{ width: tableWidth }}>
      <div className="t-cell t-gutter">
        <button
          className={`checkbox sel-box ${allSelected ? 'on' : ''} ${selected.size ? 'visible' : ''}`}
          onClick={() => setSelected(allSelected ? new Set() : new Set(allIds))}
          aria-label="Select all"
        >
          {allSelected && <Icon name="check" size={12} />}
        </button>
      </div>
      <HeaderCell
        width={w('title', 'title')}
        icon="Aa"
        name="Name"
        onClick={(el) => { setMenuCol('title'); headerMenu.open(el); }}
        onResize={(e) => startResize(e, 'title', 'title')}
        sortDir={v.sort?.propId === 'title' ? v.sort.dir : undefined}
      />
      {columns.map((p) => (
        <HeaderCell
          key={p.id}
          width={w(p.id, p.type)}
          icon={PROP_TYPE_ICON[p.type]}
          name={p.name}
          onClick={(el) => { setMenuCol(p.id); headerMenu.open(el); }}
          onResize={(e) => startResize(e, p.id, p.type)}
          sortDir={v.sort?.propId === p.id ? v.sort.dir : undefined}
        />
      ))}
      <div className="t-cell t-add-col">
        <button className="icon-btn small" onClick={(e) => addProp.open(e.currentTarget)} title="Add a property">
          <Icon name="plus" size={14} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="table-scroll" ref={scrollRef}>
      {selected.size > 0 && (
        <div className="selection-bar">
          <span>{selected.size} selected</span>
          <button
            className="tb-btn danger"
            onClick={() => {
              const ids = [...selected];
              actions.deleteCards(board.id, ids);
              setSelected(new Set());
              toast(`Deleted ${ids.length} card${ids.length > 1 ? 's' : ''}`, { label: 'Undo', run: undo });
            }}
          >
            <Icon name="trash" size={14} /> Delete
          </button>
          <button className="tb-btn" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className={`table ${dragId ? 'dragging-row' : ''}`} style={{ width: tableWidth }} ref={tableRef}>
        {!groupProp && header}
        {shown.map((g) => {
          const collapsed = v.collapsedGroups.includes(g.key);
          return (
            <section key={g.key} className="t-group" data-drop="row" data-drop-id={g.key} data-flip-scope>
              {groupProp && (
                <div className="t-group-head">
                  <button
                    className="icon-btn small"
                    onClick={() =>
                      actions.updateView(board.id, (view) => {
                        view.collapsedGroups = collapsed
                          ? view.collapsedGroups.filter((x) => x !== g.key)
                          : [...view.collapsedGroups, g.key];
                      })
                    }
                    aria-label={collapsed ? 'Expand group' : 'Collapse group'}
                  >
                    <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={14} />
                  </button>
                  <Tag color={g.option?.color ?? 'default'} className="column-tag">
                    {g.option?.name ?? `No ${groupProp.name}`}
                  </Tag>
                  <span className="column-count">{g.cards.length}</span>
                  <button className="icon-btn small t-group-add" onClick={() => addRow(g.key)} title="New row in group">
                    <Icon name="plus" size={14} />
                  </button>
                </div>
              )}
              {!collapsed && (
                <>
                  {groupProp && header}
                  {(() => {
                    const placeholder = (
                      <div key="placeholder" className="row-placeholder" data-placeholder style={{ width: tableWidth, height: drag?.height }} />
                    );
                    const out: React.ReactNode[] = [];
                    let n = 0;
                    const dropHere = drop?.group === g.key ? drop.index : null;
                    for (const c of g.cards) {
                      const isDragged = c.id === dragId;
                      if (!isDragged && dropHere === n) out.push(placeholder);
                      if (!isDragged) n++;
                      out.push(
                        <Row
                          key={c.id}
                          board={board}
                          card={c}
                          columns={columns}
                          width={w}
                          tableWidth={tableWidth}
                          active={openCardId === c.id}
                          selected={selected.has(c.id)}
                          anySelected={selected.size > 0}
                          dragging={isDragged}
                          autoFocus={focusNew === c.id}
                          onFocused={() => setFocusNew(null)}
                          onToggleSelect={() => toggleSel(c.id)}
                          onOpen={() => onOpenCard(c.id)}
                          onHandlePress={(e, el) => startRowDrag(e, c, el)}
                        />,
                      );
                    }
                    if (dropHere !== null && dropHere >= n) out.push(placeholder);
                    return out;
                  })()}
                  <button className="t-new-row" style={{ width: tableWidth }} onClick={() => addRow(g.key)}>
                    <Icon name="plus" size={14} /> New
                  </button>
                </>
              )}
            </section>
          );
        })}
        <div className="t-footer">
          <span className="muted small">{total} {total === 1 ? 'card' : 'cards'}</span>
        </div>
      </div>

      {headerMenu.anchor && menuCol && (
        <Popover anchor={headerMenu.anchor} onClose={headerMenu.close} width={240}>
          <div className="menu">
            <MenuItem icon="sort" onClick={() => { actions.updateView(board.id, (view) => void (view.sort = { propId: menuCol, dir: 'asc' })); headerMenu.close(); }}>
              Sort ascending
            </MenuItem>
            <MenuItem icon="sort" onClick={() => { actions.updateView(board.id, (view) => void (view.sort = { propId: menuCol, dir: 'desc' })); headerMenu.close(); }}>
              Sort descending
            </MenuItem>
            {menuCol !== 'title' && (
              <MenuItem
                icon="eyeOff"
                onClick={() => { actions.updateView(board.id, (view) => void view.tableHidden.push(menuCol)); headerMenu.close(); }}
              >
                Hide in table
              </MenuItem>
            )}
            {menuProp && (
              <>
                <MenuSep />
                <PropMenu board={board} prop={menuProp} onClose={headerMenu.close} />
              </>
            )}
          </div>
        </Popover>
      )}
      {addProp.anchor && (
        <Popover anchor={addProp.anchor} onClose={addProp.close} placement="bottom-end" width={200}>
          <TypeList onPick={(t) => { actions.addProp(board.id, t); addProp.close(); }} />
        </Popover>
      )}
    </div>
  );
}

function HeaderCell({
  width,
  icon,
  name,
  onClick,
  onResize,
  sortDir,
}: {
  width: number;
  icon: string;
  name: string;
  onClick: (el: HTMLElement) => void;
  onResize: (e: React.MouseEvent) => void;
  sortDir?: 'asc' | 'desc';
}) {
  return (
    <div className="t-cell t-hcell" style={{ width }}>
      <button className="t-hbtn" onClick={(e) => onClick(e.currentTarget)}>
        <span className="type-icon">{icon}</span>
        <span className="t-hname">{name}</span>
        {sortDir && <span className="t-sort">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </button>
      <span className="col-resizer" onMouseDown={onResize} />
    </div>
  );
}

function Row({
  board,
  card,
  columns,
  width,
  tableWidth,
  active,
  selected,
  anySelected,
  dragging,
  autoFocus,
  onFocused,
  onToggleSelect,
  onOpen,
  onHandlePress,
}: {
  board: Board;
  card: Card;
  columns: PropDef[];
  width: (key: string, type: PropDef['type'] | 'title') => number;
  tableWidth: number;
  active: boolean;
  selected: boolean;
  anySelected: boolean;
  dragging: boolean;
  autoFocus: boolean;
  onFocused: () => void;
  onToggleSelect: () => void;
  onOpen: () => void;
  onHandlePress: (e: React.PointerEvent, el: HTMLElement) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const progress = checklistProgress(card.content);
  return (
    <div
      ref={rowRef}
      data-row-id={card.id}
      data-drag="row"
      data-drag-id={card.id}
      data-flip-id={card.id}
      className={`t-row ${active ? 'active' : ''} ${selected ? 'selected' : ''} ${dragging ? 'is-dragging' : ''}`}
      style={{ width: tableWidth }}
    >
      <div className="t-cell t-gutter">
        <span
          className="row-handle"
          onPointerDown={(e) => rowRef.current && onHandlePress(e, rowRef.current)}
          title="Drag to move"
        >
          <Icon name="grip" size={14} />
        </span>
        <button className={`checkbox sel-box ${selected ? 'on' : ''} ${anySelected ? 'visible' : ''}`} onClick={onToggleSelect} aria-label="Select row">
          {selected && <Icon name="check" size={12} />}
        </button>
      </div>
      <div className="t-cell t-title" style={{ width: width('title', 'title') }}>
        {card.icon && <span className="card-icon">{card.icon}</span>}
        <input
          className="t-title-input"
          value={card.title}
          placeholder="Untitled"
          ref={(el) => {
            if (el && autoFocus) {
              el.focus();
              onFocused();
            }
          }}
          onChange={(e) => actions.updateCard(board.id, card.id, (c) => (c.title = e.target.value), `title-${card.id}`)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
        />
        {progress.total > 0 && (
          <span className={`card-meta t-progress ${progress.done === progress.total ? 'complete' : ''}`}>
            <Icon name="check" size={12} /> {progress.done}/{progress.total}
          </span>
        )}
        <button className="t-open" onClick={onOpen}>
          <Icon name="expand" size={12} /> Open
        </button>
      </div>
      {columns.map((p) => (
        <div key={p.id} className={`t-cell t-pcell t-${p.type}`} style={{ width: width(p.id, p.type) }}>
          <PropValueEditor board={board} card={card} prop={p} />
        </div>
      ))}
      <div className="t-cell t-add-col" />
    </div>
  );
}
