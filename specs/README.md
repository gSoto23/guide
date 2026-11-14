# Feature Specifications

Each feature gets its own folder, created with Spec Kit (`/speckit.specify`):

```text
specs/NNN-feature-name/
├── spec.md          # What & why: user stories, acceptance scenarios, FR-###, success criteria
├── plan.md          # How: architecture, Constitution Check, complexity tracking
├── research.md      # Technical research for the plan
├── data-model.md    # Entities and relationships
├── contracts/       # API / adapter contracts (OpenAPI, schemas)
├── quickstart.md    # How to run and validate the feature
├── tasks.md         # Ordered tasks, tests first
└── checklists/      # Quality checklists
```

The planned features and their order are in the [PRD](../docs/product/prd.md#4-feature-catalog-and-prioritization)
and the [roadmap](../docs/product/roadmap.md#phase-1-mvp-months-04).
