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
- API: NestJS REST API, WebSocket server, WebRTC
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

