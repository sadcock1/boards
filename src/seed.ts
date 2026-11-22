import type { AppState, Board, Card, PropValue } from './types';
import { uid } from './utils';

export function newBoard(name: string, icon = '📋'): Board {
  const statusId = uid();
  const todo = uid();
  const doing = uid();
  const done = uid();
  return {
    id: uid(),
    name,
    icon,
    createdAt: Date.now(),
    props: [
      {
        id: statusId,
        name: 'Status',
        type: 'select',
        options: [
          { id: todo, name: 'Not started', color: 'gray' },
          { id: doing, name: 'In progress', color: 'blue' },
          { id: done, name: 'Done', color: 'green' },
        ],
      },
    ],
    cards: [],
    view: {
      groupBy: statusId,
      sort: null,
      filters: [],
      visibleProps: [],
      hiddenGroups: [],
      showEmptyGroup: true,
      cardSize: 'medium',
      layout: 'board',
      tableHidden: [],
      colWidths: {},
      collapsedGroups: [],
    },
  };
}

export function seedState(): AppState {
  const b = newBoard('Product roadmap', '🚀');
  const status = b.props[0];
  const [todo, doing, done] = status.options!.map((o) => o.id);
  const review = uid();
  status.options!.splice(2, 0, { id: review, name: 'In review', color: 'purple' });

  const tags = { id: uid(), name: 'Tags', type: 'multi_select' as const, options: [
    { id: uid(), name: 'Frontend', color: 'orange' as const },
    { id: uid(), name: 'Backend', color: 'pink' as const },
    { id: uid(), name: 'Design', color: 'yellow' as const },
    { id: uid(), name: 'Bug', color: 'red' as const },
  ] };
  const [fe, be, design, bug] = tags.options.map((o) => o.id);
  const priority = { id: uid(), name: 'Priority', type: 'select' as const, options: [
    { id: uid(), name: 'High', color: 'red' as const },
    { id: uid(), name: 'Medium', color: 'yellow' as const },
    { id: uid(), name: 'Low', color: 'gray' as const },
  ] };
  const [hi, med, lo] = priority.options.map((o) => o.id);
  const due = { id: uid(), name: 'Due', type: 'date' as const };
  const estimate = { id: uid(), name: 'Estimate', type: 'number' as const };
  b.props.push(tags, priority, due, estimate);
  b.view.visibleProps = [tags.id, priority.id, due.id];

  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  let order = 0;
  const card = (title: string, icon: string | undefined, props: Record<string, PropValue>, content = ''): Card => {
    const now = Date.now();
    order += 1000;
    return { id: uid(), title, icon, props, content, order, createdAt: now, updatedAt: now };
  };

  b.cards = [
    card('Onboarding flow redesign', '✨', { [status.id]: todo, [tags.id]: [design, fe], [priority.id]: hi, [due.id]: day(6), [estimate.id]: 5 },
      '## Goal\nCut time-to-first-board in half.\n\n- [ ] Audit current flow\n- [ ] Sketch 3 options\n- [ ] Usability test with 5 people'),
    card('Dark mode polish', undefined, { [status.id]: todo, [tags.id]: [fe], [priority.id]: lo }),
    card('Rate limiting on public API', '🛡️', { [status.id]: todo, [tags.id]: [be], [priority.id]: med, [due.id]: day(12) }),
    card('Drag & drop between columns', undefined, { [status.id]: doing, [tags.id]: [fe], [priority.id]: hi, [due.id]: day(1), [estimate.id]: 3 },
      '- [x] Card reordering\n- [x] Cross-column moves\n- [ ] Column reordering\n- [ ] Touch support'),
    card('Fix timezone bug in due dates', '🐛', { [status.id]: doing, [tags.id]: [bug, be], [priority.id]: hi, [due.id]: day(-1) }),
    card('Search across cards', undefined, { [status.id]: review, [tags.id]: [fe, be], [priority.id]: med, [estimate.id]: 2 }),
    card('Set up CI pipeline', '⚙️', { [status.id]: done, [tags.id]: [be], [priority.id]: med },
      'Runs typecheck, lint and tests on every push.'),
    card('Brand colours & typography', '🎨', { [status.id]: done, [tags.id]: [design], [priority.id]: lo }),
    card('Explore offline sync', '💡', { [tags.id]: [be] }, 'Not prioritised yet — just an idea.'),
  ];

  return {
    version: 1,
    boards: [b, newBoard('Personal', '🏡')],
    activeBoardId: b.id,
    theme: 'system',
    sidebarOpen: true,
  };
}
