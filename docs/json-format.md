# Boards JSON format

This is the format of the file you get from **Export** (⬇ at the bottom of the sidebar) and can load with **Import** (⬆). The same board shape is what the server stores for each board.

All types are defined in [`src/types.ts`](../src/types.ts).

## Top level

```jsonc
{
  "version": 1,                  // format version — must be 1 or the import is rejected
  "boards": [ /* Board, … */ ],  // every board you had open
  "activeBoardId": "k3j9…",      // board that was selected (ignored on import)
  "theme": "system",             // "light" | "dark" | "system" (ignored on import)
  "sidebarOpen": true,           // (ignored on import)
  "access": { /* boardId → { "role": "owner" | "editor" | "viewer", "ownerName"?: string } */ }
}
```

Only `version` and `boards` matter when importing. `access` is your sharing role per board at export time; it's informational and ignored on import.

**Import never replaces anything.** Each imported board gets a **new id** and is added to your boards as a new board that you own. Importing the same file twice gives you two copies.

## Board

```jsonc
{
  "id": "k3j9x2ab1f0q",   // any unique string (letters, digits, - and _ ; 4–64 chars)
  "name": "Product roadmap",
  "icon": "🚀",           // a single emoji
  "createdAt": 1795351886616,  // milliseconds since 1970 (JavaScript Date.now())
  "props": [ /* PropDef, … */ ],
  "cards": [ /* Card, … */ ],
  "view":  { /* View */ }
}
```

## Properties (`props`)

Each board defines its own properties (columns in the table, fields on a card):

```jsonc
{
  "id": "p_status",       // unique within the board; card values are keyed by this
  "name": "Status",
  "type": "select",       // see types below
  "options": [            // only for "select" and "multi_select"
    { "id": "o_todo", "name": "Not started", "color": "gray" },
    { "id": "o_doing", "name": "In progress", "color": "blue" }
  ]
}
```

| `type`         | Value stored on a card                          | Example                  |
| -------------- | ----------------------------------------------- | ------------------------ |
| `text`         | string                                          | `"Needs copy review"`    |
| `number`       | number                                          | `5`                      |
| `select`       | one option **id**                               | `"o_doing"`              |
| `multi_select` | array of option **ids**                         | `["o_fe", "o_bug"]`      |
| `date`         | `"YYYY-MM-DD"` string (no time, no timezone)    | `"2026-11-28"`           |
| `checkbox`     | `true` (unchecked = key missing or `false`)     | `true`                   |
| `url`          | string                                          | `"https://example.com"`  |

**Colors** (for options): `default`, `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`.

The order of `options` in a select property is the order of the columns on the board. The order of `props` is the order properties appear in the table and on the card page.

## Cards

```jsonc
{
  "id": "c_8fk2m1",
  "title": "Onboarding flow redesign",
  "icon": "✨",            // optional emoji
  "props": {               // propId → value (see table above)
    "p_status": "o_todo",
    "p_tags": ["o_design", "o_fe"],
    "p_due": "2026-11-28",
    "p_estimate": 5
  },
  "content": "## Goal\nCut time-to-first-board in half.\n\n- [ ] Audit current flow\n- [x] Sketch 3 options",
  "order": 1000,           // position for manual ordering (lower = higher up)
  "createdAt": 1795351886616,
  "updatedAt": 1795351886616
}
```

- **Empty values are left out.** A card with no due date simply has no `p_due` key. Values pointing at an option id that no longer exists are treated as empty.
- **`content`** is Markdown: `#`/`##`/`###` headings, `-` or `*` bullets, `1.` numbered lists, `- [ ]` / `- [x]` checklists (counted for the progress badge on cards), `>` quotes, ```` ``` ```` code blocks, `---` rules, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](url)` and bare `https://` links. Lines are separated by `\n`.
- **`order`** is a plain number used when the board is sorted manually. Gaps are fine (`1000, 2000, 3000` or `1, 1.5, 2`). Moving a card just picks a number between its new neighbours.
- **Which column a card is in** is just the value of the board's group-by property (`view.groupBy`). A card with no value, or an unknown option, goes in the "No Status" column.

## View

How the board is displayed. Shared with collaborators, except `layout`, which is personal.

```jsonc
{
  "layout": "board",          // "board" | "table" — which tab you're on
  "groupBy": "p_status",      // id of a "select" property, or null for one column / flat table
  "sort": null,               // null = manual (by card.order), or { "propId": "…", "dir": "asc" | "desc" }
  "filters": [ /* Filter, … */ ],   // all filters must match (AND)
  "visibleProps": ["p_tags", "p_due"],  // properties shown on board cards
  "tableHidden": [],          // properties hidden in the table
  "hiddenGroups": [],         // option ids whose columns are hidden
  "showEmptyGroup": true,     // show the "No Status" column
  "cardSize": "medium",       // "medium" | "small" (title only)
  "colWidths": { "title": 300, "p_tags": 220 },   // table column widths in px
  "collapsedGroups": []       // option ids collapsed in the grouped table
}
```

`sort.propId` can be a property id or `"title"`, `"createdAt"`, `"updatedAt"`.

Older exports may be missing `layout`, `tableHidden`, `colWidths` and `collapsedGroups`; they're filled in with defaults on import.

### Filter

```jsonc
{ "id": "f_1", "propId": "p_priority", "op": "is", "value": "o_high" }
```

`propId` is a property id or `"title"` (the card name). `value` is a string: an option id for select properties, `"YYYY-MM-DD"` for dates, a number as text for numbers.

| `op`                          | Works on                     | Needs `value` |
| ----------------------------- | ---------------------------- | ------------- |
| `is`, `is_not`                | everything except checkbox   | yes           |
| `contains`, `not_contains`    | title, text, url             | yes           |
| `before`, `after`             | date                         | yes           |
| `gt`, `lt`                    | number                       | yes           |
| `empty`, `not_empty`          | everything except checkbox   | no            |
| `checked`, `unchecked`        | checkbox                     | no            |

For `multi_select`, `is` means "contains this option".

## Minimal example

A complete file you could write by hand and import:

```json
{
  "version": 1,
  "boards": [
    {
      "id": "trip0001",
      "name": "Trip planning",
      "icon": "✈️",
      "createdAt": 0,
      "props": [
        {
          "id": "status",
          "name": "Status",
          "type": "select",
          "options": [
            { "id": "todo", "name": "To do", "color": "gray" },
            { "id": "booked", "name": "Booked", "color": "green" }
          ]
        },
        { "id": "date", "name": "Date", "type": "date" }
      ],
      "cards": [
        {
          "id": "c1",
          "title": "Flights",
          "props": { "status": "booked", "date": "2027-03-14" },
          "content": "- [x] Outbound\n- [ ] Return",
          "order": 1000,
          "createdAt": 0,
          "updatedAt": 0
        },
        {
          "id": "c2",
          "title": "Hotel",
          "props": { "status": "todo" },
          "content": "",
          "order": 2000,
          "createdAt": 0,
          "updatedAt": 0
        }
      ],
      "view": {
        "groupBy": "status",
        "sort": null,
        "filters": [],
        "visibleProps": ["date"],
        "hiddenGroups": [],
        "showEmptyGroup": true,
        "cardSize": "medium"
      }
    }
  ]
}
```

## Server API (for reference)

The server stores each board as the Board object above without its `id`. Clients send changes as patches to `PATCH /api/boards/:id`:

```jsonc
{
  "clientId": "tab-id",        // so the sender can ignore its own echo
  "patch": {
    "meta":   { "name": "…", "icon": "…", "props": [ … ], "view": { … } },  // any of these, replaced whole
    "upsert": [ /* full Card objects to add or replace */ ],
    "remove": [ "cardId", … ]
  }
}
```

Limits: 5,000 cards per board and 5 MB per request.
