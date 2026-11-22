import { useEffect, useRef, useState } from 'react';
import type { Board, Filter, PropDef, Sort } from '../types';
import { actions } from '../store';
import { filterOpsFor, findOption, opNeedsValue, PROP_TYPE_ICON, uid } from '../utils';
import { PropMenu, TypeList } from './props';
import { EmojiPicker, Icon, MenuHeading, MenuItem, MenuSep, Popover, Tag, usePopover } from './ui';

export function BoardHeader({ board }: { board: Board }) {
  const emoji = usePopover<HTMLElement>();
  return (
    <div className="board-header">
      <button className="board-icon-btn" onClick={(e) => emoji.open(e.currentTarget)} aria-label="Change icon">
        {board.icon || '📋'}
      </button>
      <input
        className="board-title-input"
        value={board.name}
        placeholder="Untitled board"
        onChange={(e) => actions.renameBoard(board.id, e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {emoji.anchor && (
        <Popover anchor={emoji.anchor} onClose={emoji.close}>
          <EmojiPicker
            onPick={(e) => {
              actions.setBoardIcon(board.id, e);
              emoji.close();
            }}
          />
        </Popover>
      )}
    </div>
  );
}

export function Toolbar({ board, search, setSearch }: { board: Board; search: string; setSearch: (s: string) => void }) {
  const filterPop = usePopover<HTMLElement>();
  const sortPop = usePopover<HTMLElement>();
  const groupPop = usePopover<HTMLElement>();
  const propsPop = usePopover<HTMLElement>();
  const [searchOpen, setSearchOpen] = useState(!!search);
  const searchRef = useRef<HTMLInputElement>(null);
  const v = board.view;
  const groupProp = board.props.find((p) => p.id === v.groupBy);
  const [newFilterId, setNewFilterId] = useState<string | null>(null);

  const addFilter = (propId: string) => {
    const prop = propId === 'title' ? 'title' : board.props.find((p) => p.id === propId)!;
    const id = uid();
    actions.updateView(board.id, (view) => void view.filters.push({ id, propId, op: filterOpsFor(prop)[0].op }));
    setNewFilterId(id);
  };

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          {(['board', 'table'] as const).map((l) => (
            <button
              key={l}
              className={`view-tab ${v.layout === l ? 'on' : ''}`}
              onClick={() => actions.updateView(board.id, (view) => void (view.layout = l))}
            >
              <Icon name={l === 'board' ? 'group' : 'table'} size={14} /> {l === 'board' ? 'Board' : 'Table'}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <button className={`tb-btn ${v.filters.length ? 'on' : ''}`} onClick={(e) => filterPop.open(e.currentTarget)}>
            <Icon name="filter" size={14} /> <span className="tb-label">Filter</span>
          </button>
          <button className={`tb-btn ${v.sort ? 'on' : ''}`} onClick={(e) => sortPop.open(e.currentTarget)}>
            <Icon name="sort" size={14} /> <span className="tb-label">Sort</span>
          </button>
          <button className="tb-btn" onClick={(e) => groupPop.open(e.currentTarget)}>
            <Icon name="group" size={14} /> <span className="tb-label">Group{groupProp ? `: ${groupProp.name}` : ''}</span>
          </button>
          <button className="tb-btn" onClick={(e) => propsPop.open(e.currentTarget)}>
            <Icon name="sliders" size={14} /> <span className="tb-label">Properties</span>
          </button>
          <div className={`search ${searchOpen ? 'open' : ''}`}>
            <button
              className="icon-btn"
              onClick={() => {
                setSearchOpen(true);
                requestAnimationFrame(() => searchRef.current?.focus());
              }}
              aria-label="Search"
            >
              <Icon name="search" />
            </button>
            {searchOpen && (
              <input
                ref={searchRef}
                className="search-input"
                placeholder="Search cards…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={() => !search && setSearchOpen(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearch('');
                    setSearchOpen(false);
                  }
                }}
              />
            )}
          </div>
          <button
            className="btn-primary new-btn"
            onClick={() => {
              const first = groupProp?.options?.find((o) => !v.hiddenGroups.includes(o.id))?.id ?? '__none__';
              const id = actions.addCard(board.id, first, 'top');
              window.dispatchEvent(new CustomEvent('open-card', { detail: id }));
            }}
          >
            <Icon name="plus" size={14} className="new-btn-icon" /> <span className="new-btn-label">New</span>
          </button>
        </div>
      </div>

      {(v.filters.length > 0 || v.sort) && (
        <div className="chips">
          {v.sort && <SortChip board={board} sort={v.sort} />}
          {v.sort && v.filters.length > 0 && <span className="chips-sep" />}
          {v.filters.map((f) => (
            <FilterChip key={f.id} board={board} filter={f} startOpen={f.id === newFilterId} onOpened={() => setNewFilterId(null)} />
          ))}
          {v.filters.length > 0 && (
            <button className="chip ghost" onClick={(e) => filterPop.open(e.currentTarget)}>
              <Icon name="plus" size={12} /> Add filter
            </button>
          )}
        </div>
      )}

      {filterPop.anchor && (
        <Popover anchor={filterPop.anchor} onClose={filterPop.close} width={240}>
          <div className="menu">
            <MenuHeading>Filter by</MenuHeading>
            <MenuItem icon={<span className="type-icon">Aa</span>} onClick={() => { addFilter('title'); filterPop.close(); }}>Name</MenuItem>
            {board.props.map((p) => (
              <MenuItem key={p.id} icon={<span className="type-icon">{PROP_TYPE_ICON[p.type]}</span>} onClick={() => { addFilter(p.id); filterPop.close(); }}>
                {p.name}
              </MenuItem>
            ))}
            {v.filters.length > 0 && (
              <>
                <MenuSep />
                <MenuItem icon="trash" danger onClick={() => { actions.updateView(board.id, (view) => void (view.filters = [])); filterPop.close(); }}>
                  Clear all filters
                </MenuItem>
              </>
            )}
          </div>
        </Popover>
      )}

      {sortPop.anchor && (
        <Popover anchor={sortPop.anchor} onClose={sortPop.close} width={240}>
          <SortMenu board={board} onDone={sortPop.close} />
        </Popover>
      )}

      {groupPop.anchor && (
        <Popover anchor={groupPop.anchor} onClose={groupPop.close} width={260}>
          <GroupMenu board={board} onDone={groupPop.close} />
        </Popover>
      )}

      {propsPop.anchor && (
        <Popover anchor={propsPop.anchor} onClose={propsPop.close} width={280}>
          <PropertiesMenu board={board} />
        </Popover>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function SortMenu({ board, onDone }: { board: Board; onDone: () => void }) {
  const cur = board.view.sort;
  const options: { id: string; name: string }[] = [
    { id: 'title', name: 'Name' },
    ...board.props.filter((p) => p.id !== board.view.groupBy).map((p) => ({ id: p.id, name: p.name })),
    { id: 'createdAt', name: 'Created time' },
    { id: 'updatedAt', name: 'Last edited' },
  ];
  const set = (s: Sort | null) => actions.updateView(board.id, (v) => void (v.sort = s));
  return (
    <div className="menu">
      <MenuItem icon="grip" right={!cur ? <Icon name="check" size={14} /> : undefined} onClick={() => { set(null); onDone(); }}>
        Manual (drag to reorder)
      </MenuItem>
      <MenuSep />
      <MenuHeading>Sort by</MenuHeading>
      {options.map((o) => (
        <MenuItem
          key={o.id}
          right={cur?.propId === o.id ? (cur.dir === 'asc' ? '↑' : '↓') : undefined}
          active={cur?.propId === o.id}
          onClick={() => set({ propId: o.id, dir: cur?.propId === o.id && cur.dir === 'asc' ? 'desc' : 'asc' })}
        >
          {o.name}
        </MenuItem>
      ))}
    </div>
  );
}

function sortName(board: Board, id: string) {
  return id === 'title' ? 'Name' : id === 'createdAt' ? 'Created time' : id === 'updatedAt' ? 'Last edited' : board.props.find((p) => p.id === id)?.name ?? '?';
}

function SortChip({ board, sort }: { board: Board; sort: Sort }) {
  return (
    <span className="chip on">
      <button
        className="chip-main"
        onClick={() => actions.updateView(board.id, (v) => void (v.sort = { ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' }))}
        title="Toggle direction"
      >
        {sort.dir === 'asc' ? '↑' : '↓'} {sortName(board, sort.propId)}
      </button>
      <button className="chip-x" onClick={() => actions.updateView(board.id, (v) => void (v.sort = null))} aria-label="Remove sort">
        <Icon name="x" size={10} />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
function FilterChip({ board, filter, startOpen, onOpened }: { board: Board; filter: Filter; startOpen: boolean; onOpened: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const pop = usePopover<HTMLElement>();
  const prop = filter.propId === 'title' ? 'title' : board.props.find((p) => p.id === filter.propId);
  useEffect(() => {
    if (startOpen && ref.current) {
      pop.open(ref.current);
      onOpened();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startOpen]);
  if (!prop) return null;
  const name = prop === 'title' ? 'Name' : prop.name;
  const ops = filterOpsFor(prop);
  const opLabel = ops.find((o) => o.op === filter.op)?.label ?? filter.op;
  let valueLabel = '';
  if (opNeedsValue(filter.op) && filter.value) {
    valueLabel = prop !== 'title' && (prop.type === 'select' || prop.type === 'multi_select') ? findOption(prop, filter.value)?.name ?? '' : filter.value;
  }
  const set = (fn: (f: Filter) => void) =>
    actions.updateView(board.id, (v) => {
      const f = v.filters.find((x) => x.id === filter.id);
      if (f) fn(f);
    }, `filter-${filter.id}`);
  const active = !opNeedsValue(filter.op) || !!filter.value;

  return (
    <>
      <span className={`chip ${active ? 'on' : ''}`}>
        <button ref={ref} className="chip-main" onClick={(e) => pop.open(e.currentTarget)}>
          <span>
            <strong>{name}</strong>
            {valueLabel ? `: ${valueLabel}` : !opNeedsValue(filter.op) ? ` ${opLabel}` : ''}
          </span>
          <Icon name="chevronDown" size={12} />
        </button>
        <button className="chip-x" onClick={() => actions.updateView(board.id, (v) => void (v.filters = v.filters.filter((x) => x.id !== filter.id)))} aria-label="Remove filter">
          <Icon name="x" size={10} />
        </button>
      </span>
      {pop.anchor && (
        <Popover anchor={pop.anchor} onClose={pop.close} width={280}>
          <div className="filter-editor">
            <div className="filter-row">
              <span className="filter-name">{name}</span>
              <select className="select" value={filter.op} onChange={(e) => set((f) => (f.op = e.target.value as Filter['op']))}>
                {ops.map((o) => (
                  <option key={o.op} value={o.op}>{o.label}</option>
                ))}
              </select>
            </div>
            {opNeedsValue(filter.op) && <FilterValue prop={prop} value={filter.value ?? ''} onChange={(val) => set((f) => (f.value = val))} />}
          </div>
        </Popover>
      )}
    </>
  );
}

function FilterValue({ prop, value, onChange }: { prop: PropDef | 'title'; value: string; onChange: (v: string) => void }) {
  if (prop !== 'title' && (prop.type === 'select' || prop.type === 'multi_select')) {
    return (
      <div className="filter-options">
        {(prop.options ?? []).map((o) => (
          <button key={o.id} className={`menu-item ${value === o.id ? 'active' : ''}`} onClick={() => onChange(value === o.id ? '' : o.id)}>
            <span className="menu-label"><Tag color={o.color}>{o.name}</Tag></span>
            {value === o.id && <span className="menu-right"><Icon name="check" size={14} /></span>}
          </button>
        ))}
        {!prop.options?.length && <div className="menu-empty">No options</div>}
      </div>
    );
  }
  const type = prop === 'title' ? 'text' : prop.type === 'date' ? 'date' : prop.type === 'number' ? 'number' : 'text';
  return <input autoFocus className="input" type={type} placeholder="Type a value…" value={value} onChange={(e) => onChange(e.target.value)} />;
}

// ---------------------------------------------------------------------------
function GroupMenu({ board, onDone }: { board: Board; onDone: () => void }) {
  const selects = board.props.filter((p) => p.type === 'select');
  const v = board.view;
  const groupProp = board.props.find((p) => p.id === v.groupBy);
  return (
    <div className="menu">
      <MenuHeading>Group by</MenuHeading>
      {selects.map((p) => (
        <MenuItem
          key={p.id}
          icon={<span className="type-icon">{PROP_TYPE_ICON.select}</span>}
          right={v.groupBy === p.id ? <Icon name="check" size={14} /> : undefined}
          onClick={() => { actions.updateView(board.id, (view) => { view.groupBy = p.id; view.hiddenGroups = []; }); onDone(); }}
        >
          {p.name}
        </MenuItem>
      ))}
      <MenuItem
        icon={<span className="type-icon">+</span>}
        onClick={() => {
          const id = actions.addProp(board.id, 'select', 'Status');
          actions.updateView(board.id, (view) => { view.groupBy = id; view.hiddenGroups = []; view.visibleProps = view.visibleProps.filter((x) => x !== id); });
          onDone();
        }}
      >
        New select property
      </MenuItem>
      <MenuItem right={!v.groupBy ? <Icon name="check" size={14} /> : undefined} onClick={() => { actions.updateView(board.id, (view) => void (view.groupBy = null)); onDone(); }}>
        None (single column)
      </MenuItem>
      {groupProp && (
        <>
          <MenuSep />
          <MenuItem
            icon={v.showEmptyGroup ? 'eye' : 'eyeOff'}
            onClick={() => actions.updateView(board.id, (view) => void (view.showEmptyGroup = !view.showEmptyGroup))}
            right={<span className={`switch ${v.showEmptyGroup ? 'on' : ''}`} />}
          >
            Show “No {groupProp.name}”
          </MenuItem>
          {v.hiddenGroups.length > 0 && (
            <MenuItem icon="eye" onClick={() => actions.updateView(board.id, (view) => void (view.hiddenGroups = []))}>
              Show all hidden groups
            </MenuItem>
          )}
        </>
      )}
      {v.layout === 'board' && (
        <>
          <MenuSep />
          <MenuHeading>Card size</MenuHeading>
          {(['small', 'medium'] as const).map((s) => (
            <MenuItem key={s} right={v.cardSize === s ? <Icon name="check" size={14} /> : undefined} onClick={() => actions.updateView(board.id, (view) => void (view.cardSize = s))}>
              {s === 'small' ? 'Compact (title only)' : 'Default'}
            </MenuItem>
          ))}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function PropertiesMenu({ board }: { board: Board }) {
  const typePop = usePopover<HTMLElement>();
  const editPop = usePopover<HTMLElement>();
  const [editing, setEditing] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const v = board.view;
  const table = v.layout === 'table';
  const editingProp = board.props.find((p) => p.id === editing);

  return (
    <div className="menu">
      <MenuHeading>{table ? 'Shown in table' : 'Shown on cards'}</MenuHeading>
      <div
        onDragOver={(e) => {
          if (!dragId) return;
          e.preventDefault();
          const rows = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-prop-row]'));
          let idx = rows.length;
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i].getBoundingClientRect();
            if (e.clientY < r.top + r.height / 2) { idx = i; break; }
          }
          setDropIdx(idx);
        }}
        onDrop={() => {
          if (dragId && dropIdx !== null) actions.moveProp(board.id, dragId, dropIdx);
          setDragId(null);
          setDropIdx(null);
        }}
      >
        {board.props.map((p, i) => {
          const shown = table ? !v.tableHidden.includes(p.id) : v.visibleProps.includes(p.id);
          const isGroup = !table && v.groupBy === p.id;
          return (
            <div
              key={p.id}
              data-prop-row
              className={`prop-row ${dropIdx === i ? 'drop-before' : ''} ${dropIdx === board.props.length && i === board.props.length - 1 ? 'drop-after' : ''}`}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); setDragId(p.id); }}
              onDragEnd={() => { setDragId(null); setDropIdx(null); }}
            >
              <span className="option-grip"><Icon name="grip" size={12} /></span>
              <button className="prop-row-main" onClick={(e) => { setEditing(p.id); editPop.open(e.currentTarget); }}>
                <span className="type-icon">{PROP_TYPE_ICON[p.type]}</span>
                <span className="menu-label">{p.name}</span>
                {isGroup && <span className="muted small">grouped</span>}
              </button>
              <button
                className="icon-btn small"
                disabled={isGroup}
                title={isGroup ? 'Board is grouped by this property' : shown ? 'Hide' : 'Show'}
                onClick={() => actions.updateView(board.id, (view) => {
                  if (table) view.tableHidden = shown ? [...view.tableHidden, p.id] : view.tableHidden.filter((x) => x !== p.id);
                  else view.visibleProps = shown ? view.visibleProps.filter((x) => x !== p.id) : [...view.visibleProps, p.id];
                })}
              >
                <Icon name={shown && !isGroup ? 'eye' : 'eyeOff'} size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <MenuSep />
      <MenuItem icon="plus" onClick={(e) => typePop.open(e.currentTarget)}>New property</MenuItem>
      {typePop.anchor && (
        <Popover anchor={typePop.anchor} onClose={typePop.close} placement="right-start" width={200}>
          <TypeList onPick={(t) => { actions.addProp(board.id, t); typePop.close(); }} />
        </Popover>
      )}
      {editPop.anchor && editingProp && (
        <Popover anchor={editPop.anchor} onClose={editPop.close} placement="right-start" width={240}>
          <PropMenu board={board} prop={editingProp} onClose={editPop.close} />
        </Popover>
      )}
    </div>
  );
}
