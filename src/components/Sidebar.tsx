import { useRef, useState } from 'react';
import type { AppState } from '../types';
import type { User } from '../shared';
import { actions, exportJSON, importJSON, roleOf, undo } from '../store';
import { Icon, MenuItem, MenuSep, Popover, toast, usePopover } from './ui';
import { ChangePassword } from './ChangePassword';

export function Sidebar({ state, user, onSignOut }: { state: AppState; user: User; onSignOut: () => void }) {
  const menu = usePopover<HTMLElement | { x: number; y: number }>();
  const userMenu = usePopover<HTMLElement>();
  const passwordPop = usePopover<HTMLElement>();
  const workspaceRef = useRef<HTMLButtonElement>(null);
  const [menuBoard, setMenuBoard] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = () => {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `boards-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const target = state.boards.find((b) => b.id === menuBoard);

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button ref={workspaceRef} className="workspace" onClick={(e) => userMenu.open(e.currentTarget)} title={user.email}>
          <span className="workspace-logo">{(user.name || user.email)[0]?.toUpperCase()}</span>
          <span className="workspace-name">{user.name}</span>
          <Icon name="chevronDown" size={12} className="muted" />
        </button>
        <button className="icon-btn" onClick={actions.toggleSidebar} title="Close sidebar (⌘\)">
          <Icon name="chevronsLeft" />
        </button>
      </div>

      <div className="sidebar-section-title">
        <span>Boards</span>
        <button className="icon-btn small" onClick={() => actions.addBoard()} title="New board">
          <Icon name="plus" size={14} />
        </button>
      </div>

      <nav
        className="board-list"
        onDragOver={(e) => {
          if (!dragId) return;
          e.preventDefault();
          const rows = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-board-row]'));
          let idx = rows.length;
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i].getBoundingClientRect();
            if (e.clientY < r.top + r.height / 2) { idx = i; break; }
          }
          setDropIdx(idx);
        }}
        onDrop={() => {
          if (dragId && dropIdx !== null) actions.moveBoard(dragId, dropIdx);
          setDragId(null);
          setDropIdx(null);
        }}
      >
        {state.boards.map((b, i) => (
          <div
            key={b.id}
            data-board-row
            className={`board-link ${b.id === state.activeBoardId ? 'active' : ''} ${dropIdx === i ? 'drop-before' : ''} ${dropIdx === state.boards.length && i === state.boards.length - 1 ? 'drop-after' : ''}`}
            onClick={() => actions.setActiveBoard(b.id)}
            onDoubleClick={() => setRenaming(b.id)}
            onContextMenu={(e) => { e.preventDefault(); setMenuBoard(b.id); menu.open({ x: e.clientX, y: e.clientY }); }}
            draggable={renaming !== b.id}
            onDragStart={(e) => { e.dataTransfer.setData('text/plain', b.id); setDragId(b.id); }}
            onDragEnd={() => { setDragId(null); setDropIdx(null); }}
          >
            <span className="board-link-icon">{b.icon || '📋'}</span>
            {renaming === b.id ? (
              <input
                autoFocus
                className="input small"
                defaultValue={b.name}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => { actions.renameBoard(b.id, e.target.value.trim() || 'Untitled board'); setRenaming(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <span className="board-link-name">{b.name || 'Untitled board'}</span>
            )}
            {state.access?.[b.id]?.ownerName && (
              <span className="board-link-shared" title={`Shared by ${state.access[b.id].ownerName}`}>
                <Icon name="users" size={12} />
              </span>
            )}
            <span className="board-link-count">{b.cards.length}</span>
            <button
              className="icon-btn small board-link-more"
              onClick={(e) => { e.stopPropagation(); setMenuBoard(b.id); menu.open(e.currentTarget); }}
              aria-label="Board options"
            >
              <Icon name="dots" size={14} />
            </button>
          </div>
        ))}
        <button className="board-link add" onClick={() => actions.addBoard()}>
          <span className="board-link-icon"><Icon name="plus" size={14} /></span>
          <span className="board-link-name">New board</span>
        </button>
      </nav>

      <div className="sidebar-bottom">
        <div className="theme-switch" role="radiogroup" aria-label="Theme">
          {(['light', 'system', 'dark'] as const).map((t) => (
            <button key={t} className={state.theme === t ? 'on' : ''} onClick={() => actions.setTheme(t)} title={`${t[0].toUpperCase()}${t.slice(1)} theme`}>
              <Icon name={t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'monitor'} size={14} />
            </button>
          ))}
        </div>
        <div className="sidebar-bottom-actions">
          <button className="icon-btn small" onClick={doExport} title="Export all boards (JSON)"><Icon name="download" size={14} /></button>
          <button className="icon-btn small" onClick={() => fileRef.current?.click()} title="Import boards (JSON)"><Icon name="upload" size={14} /></button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (importJSON(await f.text())) toast('Boards imported', { label: 'Undo', run: undo });
              else toast('That file doesn’t look like a boards export');
            }}
          />
        </div>
      </div>

      {userMenu.anchor && (
        <Popover anchor={userMenu.anchor} onClose={userMenu.close} width={240}>
          <div className="menu">
            <div className="menu-foot">Signed in as<br /><strong>{user.email}</strong></div>
            <MenuSep />
            <MenuItem icon="lock" onClick={() => { userMenu.close(); if (workspaceRef.current) passwordPop.open(workspaceRef.current); }}>Change password</MenuItem>
            {user.admin && <MenuItem icon="users" onClick={() => { userMenu.close(); location.href = '/admin'; }}>Admin dashboard</MenuItem>}
            <MenuItem icon="logout" onClick={() => { userMenu.close(); onSignOut(); }}>Sign out</MenuItem>
          </div>
        </Popover>
      )}
      {passwordPop.anchor && (
        <Popover anchor={passwordPop.anchor} onClose={passwordPop.close} width={300}>
          <ChangePassword email={user.email} onDone={passwordPop.close} />
        </Popover>
      )}

      {menu.anchor && target && (
        <Popover anchor={menu.anchor} onClose={menu.close} width={200}>
          <div className="menu">
            <MenuItem icon="edit" onClick={() => { setRenaming(target.id); menu.close(); }}>Rename</MenuItem>
            <MenuItem icon="copy" onClick={() => { actions.duplicateBoard(target.id); menu.close(); }}>Duplicate</MenuItem>
            <MenuSep />
            {roleOf(state, target.id) === 'owner' ? (
              <MenuItem
                icon="trash"
                danger
                onClick={() => {
                  actions.deleteBoard(target.id);
                  menu.close();
                  toast(`Deleted “${target.name}”`, { label: 'Undo', run: undo });
                }}
              >
                Delete
              </MenuItem>
            ) : (
              <MenuItem
                icon="x"
                danger
                onClick={() => {
                  actions.deleteBoard(target.id);
                  menu.close();
                  toast(`Left “${target.name}”`);
                }}
              >
                Leave board
              </MenuItem>
            )}
          </div>
        </Popover>
      )}
    </aside>
  );
}
