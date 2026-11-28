# Productization Plan for The Enemy Within

## Introduction

The Enemy Within is a bespoke custom RPG campaign that is loosely based on the D&D 5e game system with some important strategic departures. Tokens move in a gridless map. Combat rounds are evaluated simultaneously rather than each player taking a turn. Items must be equipped in a compatible slot. Belts and packs are containers with their own slot capacity. Beyond these and other engine differences, the game enforces a specific theme that incorporates elements from the Victorian renaissance, steampunk and gothic horror, and is set in the late 1800s in the real world. The game was created as a single monolithic solution for the sake of getting it done quickly. However, once playtesting and an initial campaign have been completed, the intent is to refactor the monolith to a highly modular solution that separates the game mechanics from the campaign content so that the same game system can be applied to other game environments. This document describes the requirements that must be satisfied and sketches out a technical solution for the end state. Content in the context of this work refers exclusively to audio, video and image assets referenced by data structures in the database.

## Current state

The current application is a Next.js/React/TypeScript/SQLite application where the Next.js server encapsulates SQLite operations behind an internal API. React/TypeScript server and client components interact with that internal API to fetch, render, and update data, both design and runtime game state. The app manages a large collection of generated and uploaded media, including audio, video and image assets. The GM has a dedicated planning interface that allows them to create game elements, like maps, creatures, items, and effects. Players join the server through a lobby and in-game player view synchronization is handled through polling. The game supports a primitive animation and effects capability. 

## Current Architecture

- Single Next.js application with internal API and SQLite database
- polling used to synchronize game state across player browsers
- Docker deployment to the cloud (fly.io)

## Refactor goals

- separate game engine mechanics from content 
- separate world building into its own function adjacent to Campaigns
- update the architecture to be more robust
- enable concurrent multi-world and multi-campaign design and play
- enable a robust content management interface
- update the deployment model to support service based deployment (Docker)

## Refactor Non-goals

- Rule changes
- Data loss
- test coverage loss
- functional regressions
- performance regressions

## Target Architecture

- Web: Next.js, React, TypeScript, Tailwind CSS/DaisyUI, Zustand for transient observable state (a proxy for game state), zod for data validation
- API: NestJS REST API, WebSocket server (WebRTC descoped: backlog)
- DB: PostgreSQL, Prisma for data migrations
- Content: Media assets (image, audio, video): object storage plus an asset library in our own API
- Auth: Auth0

## Governing Principles

The following principles must be followed during the course of the refactoring.

- Next.js is a presentation engine only. Today's server actions (used throughout) all become calls to the NestJS API: a named migration task, not a side effect.
- SSR is favored over client-rendering, where practical. If SSG can be leveraged with effect, then use it. This holds for design pages and every page's first load; the live session view is client-driven after load (WebSocket events into Zustand), since re-rendering it from the server on a timer is what today's polling does, and why changes arrive out of order.
- NestJS is an API and integration layer only.
- The API is PURE REST. NO JSON-RPC or other RPC-over-HTTP interfaces. Game commands (plan a step, ready up, roll, resolve a round) are modelled as resources created by POST (e.g. `POST /sessions/{id}/rounds/{n}/plans/{token}/steps`); their effects come back as events over WebSockets.
- Game sessions (play: rounds, plans, rolls, movement, everything that happens at the table) are event-sourced with CQRS: eventual consistency, with asynchronous state changes delivered to the frontend via WebSockets. World and campaign design (maps, creatures, items, effects, actions, media) is plain state: ordinary create / read / update / delete, no event store.
- All business logic is expressed in pure functions that operate on a shared domain model.
- Randomness enters only as recorded events: every dice result is an event (as plan dice already are), never rolled again on replay, so replaying a session's events through the pure functions always gives the same game.
- All game state is described in terms of a core domain model that determines the database schemas and API contracts. The domain model IS the contract and the API and DB adapt to changes to the domain model and not the other way around.
- The domain model's types (zod) are the source everything else follows: Prisma's schema is one adapter behind repositories, mapped from the domain, never the other way round. The database must not quietly become the contract.
- The core domain model is the ubiquitous language used by all tiers of the application.
- Domain-driven design is the driving methodology.
- All well-understood design principles (SOLID, KISS, DRY, YAGNI, etc.) are respected at all times.
- All well-understood design patterns (GRASP, Gang of Four) are aggressively leveraged where they fit, never for their own sake.
- Code smells are actively rooted out and corrected incrementally as work progresses (red, green, refactor).
- The ubiquitous language permeates all tiers of the application and should reinforce intent, if not understanding by non-technical stakeholders.
- The final solution must be: human-readable, highly modular, exhibit very high cohesion and low coupling.
  - Coupling is judged by the surface area between modules, which should be as small as possible: each module exposes a narrow public interface and hides the rest. Indicators, checked by tooling in CI (e.g. dependency-cruiser): imports across packages (the engine package imports nothing from web, API or database code); no import cycles; how many modules each module imports and how many import it (a module everything depends on, or one that depends on everything, is a smell); and how many exports a module has (a module with hundreds, like today's `lib/db.ts`, is many modules in one).

## Real-time updates: polling today, and what it costs

How browsers learn about changes now (2026-11-25):

- **The play page** re-renders from the server every 3 s (`app/(app)/AutoRefresh.tsx`, `router.refresh()`), every 1 s while the player has an improvisation open or agreed. It carries tokens' positions, plans, the round, rolls, everything on the page.
- **The map** polls every 1 s for script effects and for walks recorded by other browsers (`MapView.tsx`: `fxSince`, `walksSince`), to animate them.
- **Heartbeat** checks in every 5 s (presence); the lobby every 3 s; the join prompt every 10 s.

Symptoms seen in play, all from separate polls arriving in either order:

- A player's smooth walk shows on another browser as the token jumping straight to its destination: the page refresh (final position) landed before the map's walk poll (the path to animate).
- In a round replay, an area's overlay (a smoke bomb) shows as the round starts instead of when it's used (at 5 s).
- Generally: state from "the future" (an end state) reaching a browser before the animation that leads to it.

For productization: push changes from the server over WebSockets instead of polling. Ordering still matters with one channel: send events (a walk, an area placed) before, or with, the end state they lead to, and have the client hold an end state until its animation has played. The near-term fix for the jump does the same holding without WebSockets (backlog T).

## Worlds and campaigns

One engine, many worlds, many campaigns per world (Loren, 2026-11-27). This shapes the domain model from Phase 1 and the PostgreSQL schema in Phase 5, even though the UI for several of each comes last.

- **Engine:** the rules (rounds, movement, saves, hazards, effects…), the same for every world. Owns no content.
- **World:** what's built for a setting. Its maps and locations, creatures, items, effects, actions, professions, media and script library. A world can be played by many campaigns.
- **Campaign:** one group's play in a world. Its characters and party, sessions, story (objectives, discoveries, journals, vars, triggers), game time, and the live state of the world's maps as this campaign has left them (token positions, doors opened, hazards sprung or spent, secrets found).
- **To settle in Phase 1:** where each table's rows belong. Most are clearly world or campaign. The rest are map things that are both: designed in the world (a door, a trap), with their state kept per campaign (open, sprung). The likely answer is world-owned definitions plus a campaign overlay for their state.

Today's database has exactly one world and one campaign. The migration in Phase 5 makes both explicit, and nothing changes for the campaign being played.

## Phased Implementation

**How the work is done:**
- **Trunk-based:** small steps merged to main (or branches merged within a day), each one tested and deployable.
- **Strangler pattern:** the game stays playable after every step, and each phase ends with a play session.
- **Tests:** tsc, the full test suite and the coupling checks pass on every commit, so no coverage is lost along the way. Each phase's steps are planned at about 5 minutes each and approved before work starts.

**Why PostgreSQL comes late:** the domain model is the contract. The schema is designed from it once the domain model and repositories exist, so switching databases becomes one adapter behind a flag. Moving the data first would make today's SQLite schema the contract by default.

**Making the late move safe:**
- **Phase 1:** a draft Prisma schema is written from the domain model, including world and campaign ownership, and reviewed but not used.
- **Phase 2:** every repository gets contract tests, so the PostgreSQL adapter must pass the same tests as the SQLite one.

### Phase 0: Preparation

- Push everything to origin.
- Timing at the critical boundaries (browser ↔ server, server ↔ database, full round trips for common requests, resolving a round), written as structured logs behind a flag.
- At least one play session with the timing on, to capture a performance baseline.
- Convert the repository to a Turborepo monorepo on pnpm, with the app moved to `apps/web` unchanged.
- CI on every push: tsc, the tests, dependency-cruiser (no import cycles; the engine imports nothing from web, API or database code).

### Phase 1: Domain model and engine

- `packages/domain`: the domain model as zod types, in the ubiquitous language. That includes the engine, world and campaign split above, and where each kind of data belongs.
- `packages/engine`: the pure rules moved in (`resolveRound`, `hazards`, `aoe`, `effectCopy`, `exposure`, `auras` and the rest already checked as pure), depending only on the domain.
- Break the remaining import cycles.
- A draft Prisma schema from the domain model, reviewed but not yet used.

### Phase 2: Application services

- One application service per area of the domain (catalog, maps, sessions and rounds, story, media…) with repository interfaces behind it, still on SQLite.
- Server actions and pages call services, never the database. Moved one area at a time; today 89 app files import `lib/db` directly.
- Repository contract tests.

### Phase 3: NestJS API alongside

- `apps/api`: NestJS. The application services move in behind pure REST routes that show ownership (worlds, campaigns, sessions…), with zod validation (JSON Schema generated from it where needed).
- Next calls the API through a typed client, one area at a time, design data first. Areas not yet moved stay in-process meanwhile.

### Phase 4: Live play

- A WebSocket gateway. Session commands become events (CQRS, event-sourced), with every die an event (as plan dice already are).
- Polling is replaced through a client abstraction: walks and script effects first, which fixes the out-of-order jumps, then the play page.

### Phase 5: PostgreSQL

- PostgreSQL in Docker Compose, with a Prisma adapter behind the repositories, using the schema from Phase 1 with world and campaign ownership.
- Migrate the data from SQLite: today's data becomes one world and one campaign. Verify the migration, then optimise the indexes.
- The switch sits behind a flag, with SQLite kept for rollback until a play session confirms it.
- Export and import carry worlds and campaigns.

### Phase 6: Media

- Object storage for images, audio and video, plus an asset library in the API. Existing media is migrated, with every reference checked.

### Phase 7: Platform

- Auth0.
- Several worlds and several campaigns per world in the UI: world building as its own function next to campaigns.
- Deploying as separate services (Docker), with a migration script that orchestrates the switch.

### Checked at the end of every phase

- Basic create, read, update, delete and list for what moved.
- Export and import.
- Live map updates (from Phase 4).
- Performance against the Phase 0 baseline at each boundary.
- A play session.

### Descoped

- WebRTC (voice or video at the table): in the backlog, after productization.
