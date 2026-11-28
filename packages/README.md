# Shared packages

Packages shared by the apps (Phase 1 of docs/productization.md: `domain`, the domain model as zod types, and `engine`, the pure game rules). They import nothing from `apps/`, the database, Next.js or React (checked by `pnpm deps`).
