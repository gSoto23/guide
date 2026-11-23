# Contract: Desktop Layout Layer (portal and guide)

The UI contract that screens and tests rely on. Class names are the stable hooks; e2e tests select by
role and text first and use these only for layout assertions.

## Breakpoints

| Name | Width | What changes |
|---|---|---|
| Compact | < 600 px | The accepted phone design. Only the fixes of FR-003, FR-007, FR-009, FR-010, FR-013, FR-014, FR-020, FR-021 apply. |
| Medium | 600–1023 px | Buttons size to their label; short fields share rows; toolbars wrap in a row. |
| Expanded | ≥ 1024 px | Sidebar (spec 015); two-column detail pages; grids for requests, options, settings; cards get an edge. |
| Guide wide | ≥ 768 px (guest guide only) | Backdrop card; three tile columns from 1024 px. |

## Shared components

| Hook | Contract |
|---|---|
| `button`, `.button` | Full width under 600 px (except link and toolbar buttons); `width: auto` from 600 px. Inside `.auth-panel`: full width always. |
| `.actions`, `.action-row` | Wrapping row, 8 px gap, buttons never touch. |
| `.button-link`, `.link-button` | Never full width; `.link-button` is inline text. |
| `.inbox-controls` (toolbar) | Stacked under 600 px; a wrapping row from 600 px; selects 12–20rem; `.toolbar-field` groups a label and its control. |
| `.tabs` / `.tab`, `.segmented` | Segmented control; current item by `aria-selected="true"`, `.tab-active`, `aria-pressed="true"`, or a checked radio. |
| `.card` | From 1024 px: 1 px border, 24 px padding. |
| `.badge` | Never wider than its text (`justify-self: start`, `align-self: flex-start` in columns). |
| `.badge-success`, `.badge-warning-status` | Filled status pills with AA text in both modes. |
| `.choice`, `.checkbox` with a border | 8 px gap between siblings; hover; chosen (`:has(input:checked)`): primary edge and tint. |
| `.field-row` | Short fields side by side from 600 px. |
| `.switcher-menu` | Above the navigation (`z-index`), sheet style. |
| `.guide-editor-toolbar` | Compact row at every width; active format filled. |
| `.option-grid` / `.option-card` | Icon circle, title, description, chevron; two columns from 1024 px; `.option-card-recommended` has the primary edge. |
| `.app-content > main:empty` | Skeleton placeholder; no animation with reduced motion; hidden in print. |
| `.shell-placeholder` | Non-interactive block where the switcher and account go before `/me` loads. |

## Screens

| Screen | Hooks | Expanded layout |
|---|---|---|
| Requests | `.request-list.card-grid`, `.request-facts` | Two columns; facts in a two-column definition grid. |
| Inbox | `.inbox-item`, `.inbox-icon` | Icon, title and excerpt, then badges and time at the end of the row. |
| Add property | `.option-grid` | Two columns of option cards. |
| Property overview | `main.property-page`, `.property-main`, `.property-aside` | Main column and a 22rem aside; the cover card sits at the top of the aside. |
| Guide page | `.guide-actions`, `.topic-row` | One primary action, a secondary group; topic rows with actions at the end. |
| Settings index | `.settings-grid`, `.settings-card` | Up to three columns of icon cards with descriptions. |
| Share | `.share-layout` | Two columns. |
| Guest guide | `body`, `main`, `.tiles` | Arena backdrop, the column as a card, three tile columns. |
| Public home | `.public-feature-grid`, `.feature-icon` | Icons; no orphan card. |
