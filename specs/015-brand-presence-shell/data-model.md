# Data Model: Brand Presence and Responsive Shell

No tables, columns, or migrations change.

## Read-only facts

| Fact | Source | Used for |
|---|---|---|
| Workspace plan | `workspace.plan` (`free`, `pro`, `business`) | `GuestGuide.credit` is `true` only for `free` |
| Property name | `property.name` (already in the guest target) | Link preview title and status pages |

## Contract change

`GuestGuide` (packages/contracts/src/guest.ts) gains:

| Field | Type | Rule |
|---|---|---|
| `credit` | `boolean` | `true` when the workspace plan is `free`; otherwise, or when unknown, `false` |

The field carries no personal or stay data and is safe to cache with the public guide.
