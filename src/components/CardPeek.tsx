import { useEffect, useRef, useState } from 'react';
import type { Board, Card, PropDef } from '../types';
import { actions, undo } from '../store';
import { PROP_TYPE_ICON, timeAgo } from '../utils';
import { Markdown } from './Markdown';
import { PropMenu, PropValueEditor, TypeList } from './props';
import { EmojiPicker, Icon, MenuItem, MenuSep, Popover, popoverOpen, toast, usePopover } from './ui';

export function CardPeek({
  board,
  card,
  mode,
  setMode,
  onClose,
  onNavigate,
}: {
  board: Board;
  card: Card;
  mode: 'side' | 'center';
  setMode: (m: 'side' | 'center') => void;
  onClose: () => void;
  onNavigate: (dir: 1 | -1) => void;
}) {
  const emoji = usePopover<HTMLElement>();
  const more = usePopover<HTMLElement>();
  const addProp = usePopover<HTMLElement>();
  const propMenu = usePopover<HTMLElement>();
  const [menuProp, setMenuProp] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // Focus the title of brand-new untitled cards
  useEffect(() => {
    if (!card.title && titleRef.current) titleRef.current.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = el.scrollHeight + 'px';
  }, [card.title, card.id, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (popoverOpen()) return;
      const target = e.target as HTMLElement;
      const typing = target.closest('input, textarea, select, [contenteditable]');
      if (e.key === 'Escape') {
        if (typing) (target as HTMLElement).blur();
        else onClose();
      }
      if (!typing && (e.key === 'ArrowDown' || e.key === 'j')) { e.preventDefault(); onNavigate(1); }
      if (!typing && (e.key === 'ArrowUp' || e.key === 'k')) { e.preventDefault(); onNavigate(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onNavigate]);

  const menuPropDef = board.props.find((p) => p.id === menuProp);

  const body = (
    <div className={`peek ${mode}`} onMouseDown={(e) => e.stopPropagation()}>
      <div className="peek-topbar">
        <div className="peek-topbar-left">
          <button className="icon-btn" onClick={onClose} title="Close (Esc)"><Icon name={mode === 'side' ? 'chevronsLeft' : 'x'} className={mode === 'side' ? 'flip' : ''} /></button>
          <button className="icon-btn peek-mode-btn" onClick={() => setMode(mode === 'side' ? 'center' : 'side')} title={mode === 'side' ? 'Open as centered page' : 'Open as side peek'}>
            <Icon name={mode === 'side' ? 'expand' : 'layout'} />
          </button>
          <span className="peek-sep" />
          <button className="icon-btn" onClick={() => onNavigate(-1)} title="Previous card (↑)"><Icon name="chevronDown" className="flip-v" /></button>
          <button className="icon-btn" onClick={() => onNavigate(1)} title="Next card (↓)"><Icon name="chevronDown" /></button>
        </div>
        <div className="peek-topbar-right">
          <span className="muted small">Edited {timeAgo(card.updatedAt)}</span>
          <button className="icon-btn" onClick={(e) => more.open(e.currentTarget)} aria-label="More"><Icon name="dots" /></button>
        </div>
      </div>

      <div className="peek-scroll">
        <div className="peek-content">
          <div className="peek-icon-row">
            {card.icon ? (
              <button className="peek-icon" onClick={(e) => emoji.open(e.currentTarget)}>{card.icon}</button>
            ) : (
              <button className="btn-text small add-icon" onClick={(e) => emoji.open(e.currentTarget)}>☺ Add icon</button>
            )}
          </div>
          <textarea
            ref={titleRef}
            rows={1}
            className="peek-title"
            placeholder="Untitled"
            value={card.title}
            onChange={(e) => actions.updateCard(board.id, card.id, (c) => (c.title = e.target.value), `title-${card.id}`)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                document.querySelector<HTMLElement>('.peek .content-editor, .peek .content-view')?.click();
              }
            }}
          />

          <div className="peek-props">
            {board.props.map((p) => (
              <PropRow key={p.id} board={board} card={card} prop={p} onNameClick={(el) => { setMenuProp(p.id); propMenu.open(el); }} />
            ))}
            <button className="btn-text add-prop" onClick={(e) => addProp.open(e.currentTarget)}>
              <Icon name="plus" size={14} /> Add a property
            </button>
          </div>

          <div className="peek-divider" />

          <ContentEditor board={board} card={card} />
        </div>
      </div>

      {emoji.anchor && (
        <Popover anchor={emoji.anchor} onClose={emoji.close}>
          <EmojiPicker
            onPick={(e) => { actions.updateCard(board.id, card.id, (c) => (c.icon = e)); emoji.close(); }}
            onRemove={card.icon ? () => { actions.updateCard(board.id, card.id, (c) => delete c.icon); emoji.close(); } : undefined}
          />
        </Popover>
      )}
      {more.anchor && (
        <Popover anchor={more.anchor} onClose={more.close} placement="bottom-end" width={220}>
          <div className="menu">
            <MenuItem icon="copy" onClick={() => { actions.duplicateCard(board.id, card.id); more.close(); toast('Card duplicated'); }}>Duplicate</MenuItem>
            <MenuItem icon="copy" onClick={() => { navigator.clipboard?.writeText(`${card.title}\n\n${card.content}`); more.close(); toast('Copied to clipboard'); }}>Copy as text</MenuItem>
            <MenuSep />
            <MenuItem icon="trash" danger onClick={() => { more.close(); onClose(); actions.deleteCards(board.id, [card.id]); toast('Card deleted', { label: 'Undo', run: undo }); }}>Delete</MenuItem>
            <MenuSep />
            <div className="menu-foot">Created {new Date(card.createdAt).toLocaleString()}</div>
          </div>
        </Popover>
      )}
      {addProp.anchor && (
        <Popover anchor={addProp.anchor} onClose={addProp.close} width={200}>
          <TypeList onPick={(t) => { actions.addProp(board.id, t); addProp.close(); }} />
        </Popover>
      )}
      {propMenu.anchor && menuPropDef && (
        <Popover anchor={propMenu.anchor} onClose={propMenu.close} width={240}>
          <PropMenu board={board} prop={menuPropDef} onClose={propMenu.close} />
        </Popover>
      )}
    </div>
  );

  if (mode === 'center') {
    return (
      <div className="peek-backdrop" onMouseDown={() => !popoverOpen() && onClose()}>
        {body}
      </div>
    );
  }
  return body;
}

function PropRow({ board, card, prop, onNameClick }: { board: Board; card: Card; prop: PropDef; onNameClick: (el: HTMLElement) => void }) {
  return (
    <div className="prop-line">
      <button className="prop-name" onClick={(e) => onNameClick(e.currentTarget)}>
        <span className="type-icon">{PROP_TYPE_ICON[prop.type]}</span>
        <span className="prop-name-text">{prop.name}</span>
      </button>
      <PropValueEditor board={board} card={card} prop={prop} />
    </div>
  );
}

function ContentEditor({ board, card }: { board: Board; card: Card }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setEditing(false), [card.id]);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = Math.max(120, el.scrollHeight) + 'px';
  };

  useEffect(() => {
    if (editing && ref.current) {
      resize();
      ref.current.focus();
      const len = ref.current.value.length;
      ref.current.setSelectionRange(len, len);
    }
  }, [editing]);

  const toggleTask = (lineIndex: number) => {
    actions.updateCard(board.id, card.id, (c) => {
      const lines = c.content.split('\n');
      lines[lineIndex] = lines[lineIndex].replace(/\[( |x|X)\]/, (_, m) => (m === ' ' ? '[x]' : '[ ]'));
      c.content = lines.join('\n');
    });
  };

  if (editing) {
    return (
      <div className="content-wrap">
        <textarea
          ref={ref}
          className="content-editor"
          value={card.content}
          placeholder="Write something… Markdown works: # heading, - list, - [ ] task, **bold**"
          onChange={(e) => {
            actions.updateCard(board.id, card.id, (c) => (c.content = e.target.value), `content-${card.id}`);
            resize();
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            // Continue lists on Enter
            if (e.key === 'Enter' && !e.shiftKey) {
              const el = e.currentTarget;
              const before = el.value.slice(0, el.selectionStart);
              const lineStart = before.lastIndexOf('\n') + 1;
              const line = before.slice(lineStart);
              const m = /^(\s*)([-*] \[[ xX]\] |[-*] |(\d+)[.)] )(.*)$/.exec(line);
              if (m) {
                e.preventDefault();
                if (!m[4].trim()) {
                  // Empty item: end the list
                  const v = el.value.slice(0, lineStart) + el.value.slice(el.selectionStart);
                  actions.updateCard(board.id, card.id, (c) => (c.content = v), `content-${card.id}`);
                  requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
                  return;
                }
                let marker = m[2];
                if (m[3]) marker = `${Number(m[3]) + 1}${m[2].trim().slice(-1)} `;
                else if (/\[[xX]\]/.test(marker)) marker = marker.replace(/\[[xX]\]/, '[ ]');
                const insert = `\n${m[1]}${marker}`;
                const pos = el.selectionStart + insert.length;
                const v = el.value.slice(0, el.selectionStart) + insert + el.value.slice(el.selectionEnd);
                actions.updateCard(board.id, card.id, (c) => (c.content = v), `content-${card.id}`);
                requestAnimationFrame(() => { el.setSelectionRange(pos, pos); resize(); });
              }
            }
          }}
        />
        <div className="content-hint">Markdown supported · click outside to finish</div>
      </div>
    );
  }

  return (
    <div className="content-view" onClick={() => setEditing(true)}>
      {card.content.trim() ? (
        <Markdown text={card.content} onToggleTask={toggleTask} />
      ) : (
        <div className="content-placeholder">Click to add notes, a checklist, links…</div>
      )}
    </div>
  );
}
