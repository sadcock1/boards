import { useRef, useState } from 'react';
import type { Board, Card, PropDef, PropType, PropValue, SelectOption } from '../types';
import { actions } from '../store';
import {
  COLORS, colorLabel, findOption, formatDate, isEmpty, isOverdue, PROP_TYPE_ICON, PROP_TYPE_LABEL,
} from '../utils';
import { AutoInput, ColorDot, Icon, MenuHeading, MenuItem, MenuSep, Popover, Tag, usePopover } from './ui';

// ---------------------------------------------------------------------------
// Read-only compact display (used on board cards)
// ---------------------------------------------------------------------------
export function PropDisplay({ prop, value, done }: { prop: PropDef; value: PropValue; done?: boolean }) {
  if (isEmpty(value)) return null;
  switch (prop.type) {
    case 'select': {
      const o = findOption(prop, value);
      return o ? <Tag color={o.color}>{o.name}</Tag> : null;
    }
    case 'multi_select':
      return (
        <>
          {(value as string[]).map((id) => {
            const o = findOption(prop, id);
            return o ? <Tag key={id} color={o.color}>{o.name}</Tag> : null;
          })}
        </>
      );
    case 'date':
      return (
        <span className={`card-meta ${!done && isOverdue(String(value)) ? 'overdue' : ''}`} title={prop.name}>
          <Icon name="calendar" size={12} /> {formatDate(String(value))}
        </span>
      );
    case 'checkbox':
      return value ? (
        <span className="card-meta" title={prop.name}>
          <span className="mini-check on"><Icon name="check" size={10} /></span> {prop.name}
        </span>
      ) : null;
    case 'number':
      return <span className="card-meta" title={prop.name}>{prop.name}: {String(value)}</span>;
    case 'url':
      return (
        <a className="card-meta link" href={String(value)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {String(value).replace(/^https?:\/\/(www\.)?/, '').slice(0, 32)}
        </a>
      );
    default:
      return <span className="card-meta text" title={prop.name}>{String(value)}</span>;
  }
}

// ---------------------------------------------------------------------------
// Select / multi-select editor (popover body)
// ---------------------------------------------------------------------------
export function SelectEditor({
  board,
  prop,
  value,
  onChange,
}: {
  board: Board;
  prop: PropDef;
  value: PropValue;
  onChange: (v: PropValue) => void;
}) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const optMenu = usePopover<HTMLElement>();
  const [editing, setEditing] = useState<string | null>(null);
  const multi = prop.type === 'multi_select';
  const selected: string[] = multi ? ((value as string[]) ?? []) : value ? [value as string] : [];
  const options = prop.options ?? [];
  const filtered = options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = options.some((o) => o.name.toLowerCase() === q.trim().toLowerCase());
  const canCreate = q.trim() !== '' && !exact;
  const items: ({ kind: 'opt'; opt: SelectOption } | { kind: 'create' })[] = [
    ...filtered.map((opt) => ({ kind: 'opt' as const, opt })),
    ...(canCreate ? [{ kind: 'create' as const }] : []),
  ];

  const toggle = (id: string) => {
    if (multi) onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    else onChange(selected[0] === id ? null : id);
    setQ('');
  };
  const create = () => {
    const id = actions.addOption(board.id, prop.id, q.trim());
    if (multi) onChange([...selected, id]);
    else onChange(id);
    setQ('');
  };
  const editingOpt = options.find((o) => o.id === editing);

  return (
    <div className="select-editor">
      <div className="select-input-wrap">
        {selected.map((id) => {
          const o = findOption(prop, id);
          return o ? (
            <Tag key={id} color={o.color} onRemove={() => toggle(id)}>
              {o.name}
            </Tag>
          ) : null;
        })}
        <input
          autoFocus
          className="select-input"
          placeholder={selected.length ? '' : 'Search or create an option…'}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHi(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHi((h) => Math.min(items.length - 1, h + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHi((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const it = items[hi];
              if (!it) return;
              if (it.kind === 'create') create();
              else toggle(it.opt.id);
            } else if (e.key === 'Backspace' && q === '' && selected.length) {
              toggle(selected[selected.length - 1]);
            }
          }}
        />
      </div>
      <div className="menu-heading">{multi ? 'Select options' : 'Select an option'} {canCreate ? '' : 'or create one'}</div>
      <div className="select-options">
        {items.map((it, i) =>
          it.kind === 'create' ? (
            <button key="create" className={`menu-item ${hi === i ? 'hl' : ''}`} onMouseEnter={() => setHi(i)} onClick={create}>
              <span className="menu-label">
                Create <Tag color="gray">{q.trim()}</Tag>
              </span>
            </button>
          ) : (
            <div key={it.opt.id} className={`option-row ${hi === i ? 'hl' : ''}`} onMouseEnter={() => setHi(i)}>
              <button className="option-main" onClick={() => toggle(it.opt.id)}>
                <span className="option-grip"><Icon name="grip" size={12} /></span>
                <Tag color={it.opt.color}>{it.opt.name}</Tag>
                {selected.includes(it.opt.id) && <Icon name="check" size={14} className="option-check" />}
              </button>
              <button
                className="icon-btn small"
                onClick={(e) => {
                  setEditing(it.opt.id);
                  optMenu.open(e.currentTarget);
                }}
                aria-label="Edit option"
              >
                <Icon name="dots" size={14} />
              </button>
            </div>
          ),
        )}
        {items.length === 0 && <div className="menu-empty">No options yet — type to create one</div>}
      </div>
      {optMenu.anchor && editingOpt && (
        <Popover anchor={optMenu.anchor} onClose={optMenu.close} placement="right-start" width={220}>
          <OptionMenu board={board} prop={prop} opt={editingOpt} onDeleted={optMenu.close} />
        </Popover>
      )}
    </div>
  );
}

export function OptionMenu({ board, prop, opt, onDeleted, extra }: { board: Board; prop: PropDef; opt: SelectOption; onDeleted: () => void; extra?: React.ReactNode }) {
  return (
    <div className="menu">
      <div className="menu-pad">
        <AutoInput
          className="input"
          value={opt.name}
          autoFocus
          selectAll
          onChange={(v) => actions.updateOption(board.id, prop.id, opt.id, (o) => (o.name = v), `opt-${opt.id}`)}
        />
      </div>
      {extra}
      <MenuItem
        icon="trash"
        danger
        onClick={() => {
          actions.deleteOption(board.id, prop.id, opt.id);
          onDeleted();
        }}
      >
        Delete
      </MenuItem>
      <MenuSep />
      <MenuHeading>Colors</MenuHeading>
      {COLORS.map((c) => (
        <MenuItem
          key={c}
          icon={<ColorDot color={c} />}
          right={opt.color === c ? <Icon name="check" size={14} /> : undefined}
          onClick={() => actions.updateOption(board.id, prop.id, opt.id, (o) => (o.color = c))}
        >
          {colorLabel(c)}
        </MenuItem>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable value cell (used in the card page)
// ---------------------------------------------------------------------------
export function PropValueEditor({ board, card, prop }: { board: Board; card: Card; prop: PropDef }) {
  const pop = usePopover<HTMLElement>();
  const value = card.props[prop.id];
  const set = (v: PropValue, coalesce?: string) => actions.setCardProp(board.id, card.id, prop.id, v, coalesce);

  switch (prop.type) {
    case 'checkbox':
      return (
        <div className="prop-value">
          <button className={`checkbox ${value ? 'on' : ''}`} onClick={() => set(!value)} aria-label={prop.name}>
            {value ? <Icon name="check" size={12} /> : null}
          </button>
        </div>
      );
    case 'select':
    case 'multi_select':
      return (
        <>
          <button className="prop-value clickable" onClick={(e) => pop.open(e.currentTarget)}>
            {isEmpty(value) ? <span className="empty">Empty</span> : <span className="tag-list"><PropDisplay prop={prop} value={value} /></span>}
          </button>
          {pop.anchor && (
            <Popover anchor={pop.anchor} onClose={pop.close} width={300}>
              <SelectEditor board={board} prop={prop} value={value} onChange={(v) => set(v)} />
            </Popover>
          )}
        </>
      );
    case 'date':
      return (
        <div className="prop-value date-value">
          <input
            type="date"
            className={`inline-input ${value ? "" : "is-empty"}`}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => set(e.target.value || null)}
          />
          {!isEmpty(value) && (
            <>
              <span className="date-rel">{formatDate(String(value))}</span>
              <button className="icon-btn small" onClick={() => set(null)} aria-label="Clear date">
                <Icon name="x" size={12} />
              </button>
            </>
          )}
        </div>
      );
    case 'number':
      return (
        <div className="prop-value">
          <input
            type="number"
            className="inline-input"
            placeholder="Empty"
            value={typeof value === 'number' ? value : ''}
            onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value), `p-${card.id}-${prop.id}`)}
          />
        </div>
      );
    case 'url':
      return (
        <div className="prop-value url-value">
          <input
            className="inline-input"
            placeholder="Empty"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => set(e.target.value, `p-${card.id}-${prop.id}`)}
          />
          {!isEmpty(value) && (
            <a className="icon-btn small" href={/^https?:/.test(String(value)) ? String(value) : `https://${value}`} target="_blank" rel="noreferrer" aria-label="Open link">
              <Icon name="expand" size={12} />
            </a>
          )}
        </div>
      );
    default:
      return (
        <div className="prop-value">
          <TextArea value={typeof value === 'string' ? value : ''} onChange={(v) => set(v, `p-${card.id}-${prop.id}`)} />
        </div>
      );
  }
}

function TextArea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = el.scrollHeight + 'px';
  };
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        if (el) requestAnimationFrame(resize);
      }}
      rows={1}
      className="inline-input"
      placeholder="Empty"
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        resize();
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Property header menu (rename / type / hide / delete)
// ---------------------------------------------------------------------------
export function PropMenu({ board, prop, onClose }: { board: Board; prop: PropDef; onClose: () => void }) {
  const typeMenu = usePopover<HTMLElement>();
  const visible = board.view.visibleProps.includes(prop.id);
  return (
    <div className="menu">
      <div className="menu-pad">
        <AutoInput
          className="input"
          value={prop.name}
          autoFocus
          selectAll
          onChange={(v) => actions.updateProp(board.id, prop.id, (p) => (p.name = v), `prop-${prop.id}`)}
        />
      </div>
      <MenuItem
        icon={<span className="type-icon">{PROP_TYPE_ICON[prop.type]}</span>}
        right={<>{PROP_TYPE_LABEL[prop.type]} <Icon name="chevronRight" size={12} /></>}
        onClick={(e) => typeMenu.open(e.currentTarget)}
      >
        Type
      </MenuItem>
      <MenuItem
        icon={visible ? 'eyeOff' : 'eye'}
        onClick={() =>
          actions.updateView(board.id, (v) => {
            v.visibleProps = visible ? v.visibleProps.filter((x) => x !== prop.id) : [...v.visibleProps, prop.id];
          })
        }
      >
        {visible ? 'Hide on board' : 'Show on board'}
      </MenuItem>
      {prop.type === 'select' && board.view.groupBy !== prop.id && (
        <MenuItem icon="group" onClick={() => { actions.updateView(board.id, (v) => { v.groupBy = prop.id; v.hiddenGroups = []; }); onClose(); }}>
          Group board by this
        </MenuItem>
      )}
      <MenuSep />
      <MenuItem
        icon="trash"
        danger
        onClick={() => {
          actions.deleteProp(board.id, prop.id);
          onClose();
        }}
      >
        Delete property
      </MenuItem>
      {typeMenu.anchor && (
        <Popover anchor={typeMenu.anchor} onClose={typeMenu.close} placement="right-start" width={200}>
          <TypeList
            current={prop.type}
            onPick={(t) => {
              actions.changePropType(board.id, prop.id, t);
              typeMenu.close();
            }}
          />
        </Popover>
      )}
    </div>
  );
}

export function TypeList({ current, onPick }: { current?: PropType; onPick: (t: PropType) => void }) {
  const types: PropType[] = ['text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url'];
  return (
    <div className="menu">
      <MenuHeading>Property type</MenuHeading>
      {types.map((t) => (
        <MenuItem
          key={t}
          icon={<span className="type-icon">{PROP_TYPE_ICON[t]}</span>}
          right={current === t ? <Icon name="check" size={14} /> : undefined}
          onClick={() => onPick(t)}
        >
          {PROP_TYPE_LABEL[t]}
        </MenuItem>
      ))}
    </div>
  );
}
