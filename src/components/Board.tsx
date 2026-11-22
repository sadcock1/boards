import { useMemo, useRef, useState } from 'react';
import type { Board as BoardT, Card, PropDef, SelectOption } from '../types';
import { NONE_GROUP } from '../types';
import { actions, undo } from '../store';
import { checklistProgress, groupKeyOf, sortCards, visibleCards } from '../utils';
import { isDragging, justDragged, pressToDrag, useFlip } from '../dnd';
import { PropDisplay, OptionMenu } from './props';
import { Icon, MenuItem, MenuSep, Popover, Tag, toast, usePopover } from './ui';

interface Group {
  key: string;
  option: SelectOption | null;
  cards: Card[];
}

type Over = { container: string; index: number } | null;
type DragState = { kind: 'card' | 'column'; id: string; width: number; height: number } | null;

export function BoardView({
  board,
  search,
  onOpenCard,
  openCardId,
}: {
  board: BoardT;
  search: string;
  onOpenCard: (id: string) => void;
  openCardId: string | null;
}) {
  const groupProp = board.props.find((p) => p.id === board.view.groupBy && p.type === 'select');
  const [drag, setDrag] = useState<DragState>(null);
  const [over, setOver] = useState<Over>(null);
  const [editingNew, setEditingNew] = useState<string | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  useFlip(columnsRef);

  const groups: Group[] = useMemo(() => {
    const cards = sortCards(board, visibleCards(board, search), board.view.sort);
    if (!groupProp) return [{ key: NONE_GROUP, option: null, cards }];
    const map = new Map<string, Card[]>();
    map.set(NONE_GROUP, []);
    for (const o of groupProp.options ?? []) map.set(o.id, []);
    for (const c of cards) map.get(groupKeyOf(c, groupProp))!.push(c);
    const list: Group[] = [];
    list.push({ key: NONE_GROUP, option: null, cards: map.get(NONE_GROUP)! });
    for (const o of groupProp.options ?? []) list.push({ key: o.id, option: o, cards: map.get(o.id)! });
    return list;
  }, [board, search, groupProp]);

  const isHidden = (g: Group) =>
    board.view.hiddenGroups.includes(g.key) ||
    (g.key === NONE_GROUP && groupProp && (!board.view.showEmptyGroup || g.cards.length === 0));
  const shown = groups.filter((g) => !isHidden(g));
  const hidden = groups.filter((g) => g.key !== NONE_GROUP && board.view.hiddenGroups.includes(g.key));
  const doneKey = groupProp?.options?.find((o) => /done|complete|shipped|finished/i.test(o.name))?.id;

  // Latest values for drag callbacks (a drag can outlive several renders)
  const latest = useRef({ groups, shown, groupProp, boardId: board.id });
  latest.current = { groups, shown, groupProp, boardId: board.id };

  const endDrag = () => {
    setDrag(null);
    setOver(null);
  };

  const columnScrollers = () => [
    scrollRef.current,
    ...Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('.column-cards') ?? []),
  ];

  const startCardDrag = (e: React.PointerEvent, card: Card, el: HTMLElement) =>
    pressToDrag(e, {
      id: card.id,
      el,
      axis: 'y',
      container: '[data-drop="card"]',
      item: '[data-drag="card"]',
      scrollers: columnScrollers,
      tilt: true,
      onStart: ({ width, height, from }) => {
        setDrag({ kind: 'card', id: card.id, width, height });
        setOver(from);
      },
      onOver: (container, index) => setOver({ container, index }),
      onDrop: (container, index) => {
        const { groups: gs, boardId } = latest.current;
        const g = gs.find((x) => x.key === container);
        if (g) {
          const list = g.cards.filter((c) => c.id !== card.id);
          actions.moveCard(boardId, card.id, g.key, list[index - 1]?.id ?? null, list[index]?.id ?? null);
        }
        endDrag();
      },
      onCancel: endDrag,
    });

  const startColumnDrag = (e: React.PointerEvent, key: string, el: HTMLElement) =>
    pressToDrag(e, {
      id: key,
      el,
      axis: 'x',
      container: '[data-drop="column"]',
      item: '[data-drag="column"]',
      scrollers: () => [scrollRef.current],
      tilt: true,
      onStart: ({ width, height, from }) => {
        setDrag({ kind: 'column', id: key, width, height });
        setOver(from);
      },
      onOver: (container, index) => setOver({ container, index }),
      onDrop: (_c, index) => {
        const { shown: sh, groupProp: gp, boardId } = latest.current;
        if (gp) {
          const vis = sh.filter((g) => g.option && g.key !== key).map((g) => g.key);
          const opts = gp.options ?? [];
          const to = index < vis.length ? opts.findIndex((o) => o.id === vis[index]) : opts.length;
          actions.moveOption(boardId, gp.id, key, to);
        }
        endDrag();
      },
      onCancel: endDrag,
    });

  const addCard = (groupKey: string, pos: 'top' | 'bottom') => {
    const id = actions.addCard(board.id, groupKey, pos);
    setEditingNew(id);
  };

  // Column placeholder position among the draggable (option) columns
  const colDropIndex = drag?.kind === 'column' && over ? over.index : null;
  let colCount = 0;
  const colPlaceholder = drag && <div key="col-placeholder" className="column-placeholder" data-placeholder style={{ width: drag.width, height: drag.height }} />;

  return (
    <div className={`board-scroll ${drag ? 'dragging' : ''}`} ref={scrollRef}>
      <div className="board-columns" ref={columnsRef} data-drop="column" data-drop-id="columns">
        {shown.map((g) => {
          const isOption = !!g.option;
          const isDragged = drag?.kind === 'column' && drag.id === g.key;
          const before = isOption && !isDragged && colDropIndex === colCount ? colPlaceholder : null;
          if (isOption && !isDragged) colCount++;
          return [
            before,
            <Column
              key={g.key}
              board={board}
              group={g}
              groupProp={groupProp}
              dragCardId={drag?.kind === 'card' ? drag.id : null}
              dragHeight={drag?.kind === 'card' ? drag.height : 0}
              dropIndex={drag?.kind === 'card' && over?.container === g.key ? over.index : null}
              isDraggingColumn={isDragged}
              doneKey={doneKey}
              openCardId={openCardId}
              editingNew={editingNew}
              onEditDone={() => setEditingNew(null)}
              onOpenCard={onOpenCard}
              onCardPress={startCardDrag}
              onColumnPress={startColumnDrag}
              onAddCard={addCard}
            />,
          ];
        })}
        {colDropIndex !== null && colDropIndex >= colCount && colPlaceholder}

        {groupProp && (
          <div className="add-group">
            {addingGroup ? (
              <NewGroupInput
                onSubmit={(name) => {
                  if (name.trim()) actions.addOption(board.id, groupProp.id, name.trim());
                  setAddingGroup(false);
                }}
              />
            ) : (
              <button className="btn-ghost add-group-btn" onClick={() => setAddingGroup(true)}>
                <Icon name="plus" /> Add group
              </button>
            )}
          </div>
        )}

        {hidden.length > 0 && <HiddenGroups board={board} groups={hidden} groupProp={groupProp!} />}
      </div>
    </div>
  );
}

function NewGroupInput({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [v, setV] = useState('');
  return (
    <input
      autoFocus
      className="input"
      placeholder="Group name"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onSubmit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit(v);
        if (e.key === 'Escape') onSubmit('');
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------
function Column(props: {
  board: BoardT;
  group: Group;
  groupProp: PropDef | undefined;
  dragCardId: string | null;
  dragHeight: number;
  dropIndex: number | null;
  isDraggingColumn: boolean;
  doneKey?: string;
  openCardId: string | null;
  editingNew: string | null;
  onEditDone: () => void;
  onOpenCard: (id: string) => void;
  onCardPress: (e: React.PointerEvent, card: Card, el: HTMLElement) => void;
  onColumnPress: (e: React.PointerEvent, key: string, el: HTMLElement) => void;
  onAddCard: (groupKey: string, pos: 'top' | 'bottom') => void;
}) {
  const { board, group, groupProp } = props;
  const colRef = useRef<HTMLDivElement>(null);
  const menu = usePopover<HTMLElement>();
  const [renaming, setRenaming] = useState(false);
  const name = group.option ? group.option.name : groupProp ? `No ${groupProp.name}` : 'All cards';
  const color = group.option?.color ?? 'default';
  const canDragGroup = !!group.option;

  // Cards with the drop placeholder slotted in
  const placeholder = <div key="placeholder" className="card-placeholder" data-placeholder style={{ height: props.dragHeight }} />;
  const children: React.ReactNode[] = [];
  let n = 0;
  for (const c of group.cards) {
    const isDragged = c.id === props.dragCardId;
    if (!isDragged && props.dropIndex === n) children.push(placeholder);
    if (!isDragged) n++;
    children.push(
      <CardItem
        key={c.id}
        board={board}
        card={c}
        done={!!props.doneKey && group.key === props.doneKey}
        active={props.openCardId === c.id}
        dragging={isDragged}
        editing={props.editingNew === c.id}
        onEditDone={props.onEditDone}
        onOpen={() => props.onOpenCard(c.id)}
        onPress={(e, el) => props.onCardPress(e, c, el)}
      />,
    );
  }
  if (props.dropIndex !== null && props.dropIndex >= n) children.push(placeholder);

  return (
    <>
      <div
        ref={colRef}
        className={`column col-${color} ${props.isDraggingColumn ? 'is-dragging' : ''} ${props.dropIndex !== null ? 'is-over' : ''}`}
        data-group-key={group.key}
        data-drop="card"
        data-drop-id={group.key}
        data-flip-id={`col:${group.key}`}
        {...(canDragGroup ? { 'data-drag': 'column', 'data-drag-id': group.key } : {})}
      >
        <div
          className="column-header"
          onPointerDown={(e) => canDragGroup && !renaming && colRef.current && props.onColumnPress(e, group.key, colRef.current)}
        >
          <div className="column-title">
            {renaming && group.option ? (
              <input
                autoFocus
                className="input small"
                defaultValue={group.option.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && groupProp) actions.updateOption(board.id, groupProp.id, group.key, (o) => (o.name = v));
                  setRenaming(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(false);
                }}
              />
            ) : (
              <span onDoubleClick={() => group.option && setRenaming(true)}>
                <Tag color={color} className="column-tag">{name}</Tag>
              </span>
            )}
            <span className="column-count">{group.cards.length}</span>
          </div>
          <div className="column-actions">
            {groupProp && (
              <button className="icon-btn" onClick={(e) => menu.open(e.currentTarget)} aria-label="Group options">
                <Icon name="dots" />
              </button>
            )}
            <button className="icon-btn" onClick={() => props.onAddCard(group.key, 'top')} aria-label="New card">
              <Icon name="plus" />
            </button>
          </div>
        </div>

        <div className="column-cards" data-flip-scope>
          {children}
          <button className="new-card-btn" onClick={() => props.onAddCard(group.key, 'bottom')}>
            <Icon name="plus" size={14} /> New
          </button>
        </div>
      </div>

      {menu.anchor && groupProp && (
        <Popover anchor={menu.anchor} onClose={menu.close} width={220}>
          {group.option ? (
            <OptionMenu
              board={board}
              prop={groupProp}
              opt={group.option}
              onDeleted={() => {
                menu.close();
                toast(`Deleted group “${group.option!.name}”`, { label: 'Undo', run: undo });
              }}
              extra={
                <MenuItem
                  icon="eyeOff"
                  onClick={() => {
                    actions.updateView(board.id, (v) => void v.hiddenGroups.push(group.key));
                    menu.close();
                  }}
                >
                  Hide group
                </MenuItem>
              }
            />
          ) : (
            <div className="menu">
              <MenuItem
                icon="eyeOff"
                onClick={() => {
                  actions.updateView(board.id, (v) => void (v.showEmptyGroup = false));
                  menu.close();
                }}
              >
                Hide “No {groupProp.name}”
              </MenuItem>
            </div>
          )}
        </Popover>
      )}
    </>
  );
}

function HiddenGroups({ board, groups, groupProp }: { board: BoardT; groups: Group[]; groupProp: PropDef }) {
  return (
    <div className="hidden-groups">
      <div className="hidden-groups-title">Hidden groups</div>
      {groups.map((g) => (
        <button
          key={g.key}
          className="hidden-group"
          onClick={() => actions.updateView(board.id, (v) => (v.hiddenGroups = v.hiddenGroups.filter((x) => x !== g.key)))}
          title={`Show ${g.option?.name ?? ''}`}
        >
          <Tag color={g.option?.color ?? 'default'}>{g.option?.name ?? `No ${groupProp.name}`}</Tag>
          <span className="column-count">{g.cards.length}</span>
          <Icon name="eye" size={14} className="hidden-group-eye" />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
function CardItem({
  board,
  card,
  done,
  active,
  dragging,
  editing,
  onEditDone,
  onOpen,
  onPress,
}: {
  board: BoardT;
  card: Card;
  done: boolean;
  active: boolean;
  dragging: boolean;
  editing: boolean;
  onEditDone: () => void;
  onOpen: () => void;
  onPress: (e: React.PointerEvent, el: HTMLElement) => void;
}) {
  const menu = usePopover<HTMLElement | { x: number; y: number }>();
  const [renaming, setRenaming] = useState(false);
  const isEditing = editing || renaming;
  const progress = checklistProgress(card.content);
  const visible = board.view.visibleProps
    .map((id) => board.props.find((p) => p.id === id))
    .filter((p): p is PropDef => !!p && p.id !== board.view.groupBy);
  const small = board.view.cardSize === 'small';

  const finishEdit = (value: string) => {
    actions.updateCard(board.id, card.id, (c) => (c.title = value.trim()));
    setRenaming(false);
    onEditDone();
  };

  return (
    <>
      <div
        data-card-id={card.id}
        data-drag="card"
        data-drag-id={card.id}
        data-flip-id={card.id}
        className={`card ${active ? 'active' : ''} ${dragging ? 'is-dragging' : ''} ${small ? 'small' : ''}`}
        onPointerDown={(e) => {
          e.stopPropagation(); // don't start a column drag
          if (!isEditing) onPress(e, e.currentTarget);
        }}
        onClick={() => !isEditing && !justDragged() && onOpen()}
        onContextMenu={(e) => {
          e.preventDefault();
          if (isDragging() || justDragged()) return; // long-press on touch starts a drag instead
          menu.open({ x: e.clientX, y: e.clientY });
        }}
      >
        <div className="card-title-row">
          {card.icon && <span className="card-icon">{card.icon}</span>}
          {isEditing ? (
            <textarea
              autoFocus
              rows={1}
              className="card-title-input"
              defaultValue={card.title}
              placeholder="Type a name…"
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => finishEdit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
            />
          ) : (
            <span className={`card-title ${card.title ? '' : 'untitled'}`}>{card.title || 'Untitled'}</span>
          )}
        </div>
        {!small && (visible.some((p) => card.props[p.id] !== undefined) || progress.total > 0) && (
          <div className="card-props">
            {visible.map((p) => (
              <PropDisplay key={p.id} prop={p} value={card.props[p.id]} done={done} />
            ))}
            {progress.total > 0 && (
              <span className={`card-meta ${progress.done === progress.total ? 'complete' : ''}`}>
                <Icon name="check" size={12} /> {progress.done}/{progress.total}
              </span>
            )}
          </div>
        )}
        {!isEditing && (
          <div className="card-hover-actions">
            <button
              className="icon-btn small"
              onClick={(e) => {
                e.stopPropagation();
                setRenaming(true);
              }}
              aria-label="Rename"
            >
              <Icon name="edit" size={14} />
            </button>
            <button
              className="icon-btn small"
              onClick={(e) => {
                e.stopPropagation();
                menu.open(e.currentTarget);
              }}
              aria-label="Card options"
            >
              <Icon name="dots" size={14} />
            </button>
          </div>
        )}
      </div>
      {menu.anchor && (
        <Popover anchor={menu.anchor} onClose={menu.close} width={200}>
          <div className="menu">
            <MenuItem icon="expand" onClick={() => { menu.close(); onOpen(); }}>Open</MenuItem>
            <MenuItem icon="edit" onClick={() => { menu.close(); setRenaming(true); }}>Rename</MenuItem>
            <MenuItem icon="copy" onClick={() => { actions.duplicateCard(board.id, card.id); menu.close(); }}>Duplicate</MenuItem>
            <MenuSep />
            <MenuItem
              icon="trash"
              danger
              onClick={() => {
                actions.deleteCards(board.id, [card.id]);
                menu.close();
                toast('Card deleted', { label: 'Undo', run: undo });
              }}
            >
              Delete
            </MenuItem>
          </div>
        </Popover>
      )}
    </>
  );
}
