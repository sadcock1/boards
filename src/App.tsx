import { useCallback, useEffect, useMemo, useState } from 'react';
import { actions, emptyState, getState, loadState, redo, roleOf, setReadOnlyHandler, undo, useStore } from './store';
import type { Board as BoardT } from './types';
import type { User } from './shared';
import { api } from './api';
import * as sync from './sync';
import { useSyncStatus } from './sync';
import { AuthScreen, ResetPasswordPage } from './components/AuthScreen';
import { AdminPage } from './components/AdminPage';
import { VerifyBanner, VerifyEmailPage } from './components/VerifyEmail';
import { ShareDialog } from './components/ShareDialog';
import { Popover, usePopover } from './components/ui';
import { migrateBoard } from './store';
import { sortCards, visibleCards, groupKeyOf } from './utils';
import { Sidebar } from './components/Sidebar';
import { BoardHeader, Toolbar } from './components/Toolbar';
import { BoardView } from './components/Board';
import { TableView } from './components/TableView';
import { CardPeek } from './components/CardPeek';
import { Icon, ToastHost, toast } from './components/ui';

setReadOnlyHandler(() => toast('You have view-only access to this board'));

const MOBILE_QUERY = '(max-width: 700px)';
function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

export default function App() {
  const sharedToken = /^\/s\/([A-Za-z0-9_-]+)/.exec(location.pathname)?.[1];
  if (sharedToken) return <SharedPage token={sharedToken} />;
  if (/^\/admin\/?$/.test(location.pathname)) return <AdminRoute />;
  if (/^\/reset\/?$/.test(location.pathname)) return <ResetRoute />;
  if (/^\/verify\/?$/.test(location.pathname)) return <VerifyRoute />;
  return <SignedInApp />;
}

function VerifyRoute() {
  useSystemTheme(true);
  return <VerifyEmailPage />;
}

function ResetRoute() {
  useSystemTheme(true);
  return <><ResetPasswordPage /><ToastHost /></>;
}

function AdminRoute() {
  useSystemTheme(true);
  return <AdminPage />;
}

function SignedInApp() {
  const [session, setSession] = useState<User | null | 'loading'>('loading');

  const begin = useCallback((u: User) => {
    sync.start(u);
    setSession(u);
  }, []);

  useEffect(() => {
    api<{ user: User | null }>('/auth/me')
      .then((r) => (r.user ? begin(r.user) : setSession(null)))
      .catch(() => {
        // Offline: open the last signed-in user's cached boards
        const u = sync.lastUser();
        if (u) begin(u);
        else setSession(null);
      });
    const onSignedOut = () => {
      sync.stop();
      setSession(null);
    };
    window.addEventListener('signed-out', onSignedOut);
    return () => window.removeEventListener('signed-out', onSignedOut);
  }, [begin]);

  useSystemTheme(session === null || session === 'loading');

  if (session === 'loading') return <div className="app-loading" />;
  if (!session) return <><AuthScreen onSignedIn={begin} /><ToastHost /></>;

  const signOut = async () => {
    try {
      await api('/auth/logout', { body: {} });
    } catch {
      /* offline: still clear locally */
    }
    sync.stop();
    sync.forget(session.id);
    loadState(emptyState(), null);
    setSession(null);
  };

  return <Workspace user={session} onSignOut={signOut} />;
}

function useSystemTheme(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => (document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [active]);
}

/** Read-only page for a public share link. */
function SharedPage({ token }: { token: string }) {
  const [state, setState] = useState<{ ownerName: string } | 'loading' | 'error'>('loading');
  useEffect(() => {
    api<{ id: string; ownerName: string; data: Omit<BoardT, 'id'> }>(`/shared/${token}`)
      .then((r) => {
        const board = migrateBoard({ id: r.id, ...r.data } as BoardT);
        loadState({ ...emptyState(), boards: [board], activeBoardId: board.id, sidebarOpen: false, access: { [board.id]: { role: 'viewer', ownerName: r.ownerName } } }, null);
        setState({ ownerName: r.ownerName });
      })
      .catch(() => setState('error'));
  }, [token]);
  useSystemTheme(true);
  if (state === 'loading') return <div className="app-loading" />;
  if (state === 'error')
    return (
      <div className="empty-state full">
        <div className="empty-emoji">🔒</div>
        <h2>This link isn’t active</h2>
        <p className="muted">The owner may have turned off link sharing.</p>
        <a className="btn-primary link-as-btn" href="/">Go to Boards</a>
      </div>
    );
  return <Workspace user={null} sharedBy={state.ownerName} />;
}

function Workspace({ user, onSignOut, sharedBy }: { user: User | null; onSignOut?: () => void; sharedBy?: string }) {
  const state = useStore((s) => s);
  const syncStatus = useSyncStatus();
  const sharePop = usePopover<HTMLElement>();
  const isMobile = useIsMobile();

  // On phones the sidebar is a drawer: start closed, and close it after picking a board
  useEffect(() => {
    if (isMobile && getState().sidebarOpen) actions.toggleSidebar();
  }, [isMobile]);
  useEffect(() => {
    if (isMobile && getState().sidebarOpen) actions.toggleSidebar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeBoardId]);
  const board = state.boards.find((b) => b.id === state.activeBoardId) ?? state.boards[0];
  const [search, setSearch] = useState('');
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [peekMode, setPeekMode] = useState<'side' | 'center'>(() => (localStorage.getItem('peek-mode') as 'side' | 'center') || 'side');
  const openCard = board?.cards.find((c) => c.id === openCardId) ?? null;
  const readOnly = !!board && roleOf(state, board.id) === 'viewer';

  useEffect(() => {
    try { localStorage.setItem('peek-mode', peekMode); } catch { /* ignore */ }
  }, [peekMode]);

  // Theme
  useEffect(() => {
    const apply = () => {
      const dark = state.theme === 'dark' || (state.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [state.theme]);

  // Like Notion: the tab shows the board's emoji as its icon, and just the name as its title
  useEffect(() => {
    document.title = board ? board.name || 'Untitled board' : 'Boards';
    setFavicon(board?.icon);
  }, [board?.icon, board?.name, board]);
  // Back to the app's own icon and name on the sign-in page (after signing out)
  useEffect(() => () => {
    document.title = 'Boards';
    setFavicon(undefined);
  }, []);

  // Close peek when switching boards; clear search
  useEffect(() => {
    setOpenCardId(null);
    setSearch('');
  }, [board?.id]);

  // "New" button opens the created card
  useEffect(() => {
    const h = (e: Event) => setOpenCardId((e as CustomEvent<string>).detail);
    window.addEventListener('open-card', h);
    return () => window.removeEventListener('open-card', h);
  }, []);

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = (e.target as HTMLElement).closest('input, textarea, select');
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        const ok = e.shiftKey ? redo() : undo();
        if (ok) toast(e.shiftKey ? 'Redone' : 'Undone');
      } else if (mod && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        if (redo()) toast('Redone');
      } else if (mod && e.key === '\\') {
        e.preventDefault();
        actions.toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ordered list of visible cards (column by column) for ↑/↓ navigation in the peek
  const navOrder = useMemo(() => {
    if (!board) return [];
    const gp = board.props.find((p) => p.id === board.view.groupBy);
    const cards = sortCards(board, visibleCards(board, search), board.view.sort);
    if (!gp) return cards.map((c) => c.id);
    const keys = ['__none__', ...(gp.options ?? []).map((o) => o.id)].filter((k) => !board.view.hiddenGroups.includes(k));
    return keys.flatMap((k) => cards.filter((c) => groupKeyOf(c, gp) === k).map((c) => c.id));
  }, [board, search]);

  const navigate = useCallback(
    (dir: 1 | -1) => {
      if (!openCardId || navOrder.length === 0) return;
      const i = navOrder.indexOf(openCardId);
      const next = navOrder[(i + dir + navOrder.length) % navOrder.length];
      if (next) setOpenCardId(next);
    },
    [openCardId, navOrder],
  );

  const closePeek = useCallback(() => setOpenCardId(null), []);

  return (
    <div className={`app ${state.sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      {state.sidebarOpen && user && <Sidebar state={state} user={user} onSignOut={onSignOut!} />}
      {state.sidebarOpen && user && isMobile && <div className="sidebar-backdrop" onClick={actions.toggleSidebar} />}
      <main className="main">
        {user && !user.verified && <VerifyBanner user={user} />}
        <div className="topbar">
          {(!state.sidebarOpen || isMobile) && user && (
            <button className="icon-btn" onClick={actions.toggleSidebar} title="Open sidebar (⌘\)">
              <Icon name="menu" />
            </button>
          )}
          {board && readOnly && <span className="badge">View only</span>}
          <span className="topbar-spacer" />
          {user && <SyncIndicator status={syncStatus} />}
          {user && board && (
            <button className="tb-btn share-btn" onClick={(e) => sharePop.open(e.currentTarget)}>
              <Icon name="share" size={14} /> <span className="tb-label">Share</span>
            </button>
          )}
          {sharedBy && (
            <span className="shared-by muted small">
              Shared by {sharedBy} · <a href="/">Open Boards</a>
            </span>
          )}
        </div>
        {sharePop.anchor && board && user && (
          <Popover anchor={sharePop.anchor} onClose={sharePop.close} placement="bottom-end" width={420}>
            <ShareDialog boardId={board.id} role={roleOf(state, board.id)} me={user} synced={sync.isSynced(board.id)} />
          </Popover>
        )}
        {board ? (
          <div className={`board-area ${openCard && peekMode === 'side' ? 'with-peek' : ''} ${readOnly ? 'readonly' : ''}`}>
            <div className="board-main">
              <div className="board-head-wrap">
                <BoardHeader board={board} />
                <Toolbar board={board} search={search} setSearch={setSearch} />
              </div>
              {board.view.layout === 'table' ? (
                <TableView board={board} search={search} onOpenCard={setOpenCardId} openCardId={openCardId} />
              ) : (
                <BoardView board={board} search={search} onOpenCard={setOpenCardId} openCardId={openCardId} />
              )}
            </div>
            {openCard && (
              <CardPeek
                key={isMobile ? 'mobile' : peekMode}
                board={board}
                card={openCard}
                mode={isMobile ? 'side' : peekMode}
                setMode={setPeekMode}
                onClose={closePeek}
                onNavigate={navigate}
              />
            )}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-emoji">🗂️</div>
            <h2>No boards yet</h2>
            {user && <button className="btn-primary" onClick={() => actions.addBoard()}>Create a board</button>}
          </div>
        )}
      </main>
      <ToastHost />
    </div>
  );
}

/** Silent while everything is in sync: only speaks up when edits are being held on this device. */
function SyncIndicator({ status }: { status: ReturnType<typeof useSyncStatus> }) {
  if (status === 'saved' || status === 'saving') return null;
  const label = status === 'offline' ? 'Offline' : 'Sync problem';
  const title =
    status === 'offline'
      ? 'You’re offline. Changes are saved on this device and will sync when you reconnect.'
      : 'Couldn’t sync. Your changes are kept on this device and will retry automatically.';
  return (
    <span className={`sync-status ${status}`} title={title} role="status">
      <span className="sync-dot" />
      <span className="sync-label">{label}</span>
    </span>
  );
}

/** Point the tab icon at the board's emoji (drawn to a PNG so every browser shows it), or back at the app logo. */
const FAVICON_DEFAULTS = new Map<HTMLLinkElement, string>();
function setFavicon(emoji: string | undefined) {
  const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')];
  links.forEach((l) => FAVICON_DEFAULTS.has(l) || FAVICON_DEFAULTS.set(l, l.getAttribute('href') ?? ''));
  let href: string | null = null;
  if (emoji) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.font = '54px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, 32, 36);
      href = c.toDataURL('image/png');
    }
  }
  for (const l of links) {
    l.href = href ?? FAVICON_DEFAULTS.get(l)!;
    if (href) l.type = 'image/png';
    else l.type = FAVICON_DEFAULTS.get(l)!.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  }
}
