# Implementation roadmap — Codex

## Phase 0 — confirm requirements
Review OPEN_DECISIONS, threats, budget (Firebase Storage Blaze), expected user count, Firebase region. No real data yet.

## Phase 1 — foundation
Create Vite/React/TypeScript skeleton, Firebase emulator suite, lint/typecheck/tests, GitHub Actions CI, separate dev/prod configs, router and design tokens.

## Phase 2 — identity and security
Auth, invitation/approval lifecycle, role matrix, Firestore & Storage Rules, emulator attack tests. No read access before account approval.

## Phase 3 — canonical data
Persons, relations, unions, branches, validation, versioning, sources. Seed fake data and graph consistency tests.

## Phase 4 — tree and search
Lazy-load bounded subtrees, client rendering, ancestor/descendant traversal, cache versioning, search indexes and performance benchmarks.

## Phase 5 — approvals
Change request diff, privileged atomic approval, concurrency conflict handling, audit and undo-by-new-revision.

## Phase 6 — import and media
Excel mapping/preview, duplicate review, batch idempotency; private upload/download with secure access.

## Phase 7 — production readiness
Backup/restore drill, permission review, accessibility, mobile performance, monitoring, cost alerts, protected production deploy.

## Definition of done per PR
Tests pass; no credentials/private data; rules verified; user-visible Vietnamese UI; changelog and rollback steps for schema/security changes.
