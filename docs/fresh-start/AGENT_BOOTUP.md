# Fresh Start Agent Boot-Up

Use this document at the start of every new chat session before assigning an implementation task.

Its purpose is to make the agent load the correct context first, align to the fresh-start MVP, and avoid drifting from the planned architecture or sequence.

## Required Read Order

The agent must read these documents in this order before doing any work:

1. [MVP_SPEC.md](./MVP_SPEC.md)
2. [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)
3. [WORK_ORDERS.md](./WORK_ORDERS.md)
4. the specific work order or task you assign in the current session

If a future work-order directory or per-work-order files are added, the agent should read the specific active work-order file after reading the three core docs above.

## Boot-Up Instructions For The Agent

At the beginning of the session, the agent must do all of the following before making code changes:

1. Read the three core fresh-start docs in full.
2. Extract the current source-of-truth architecture, stack, and sequencing rules.
3. Identify the next active work order or ask for it if none has been provided yet.
4. Confirm dependencies and scope boundaries for the active task.
5. Wait for the implementation instruction if no specific work order has been assigned yet.

## Non-Negotiable Context

The agent must carry these assumptions into the session unless the docs are explicitly changed:

- This is the fresh-start implementation, not a continuation of older runtime assumptions.
- The implementation style is vertical slice.
- The planned stack is:
  - Next.js
  - Express.js
  - Postgres
  - Prisma
  - TypeScript
- The browser frontend must consume the Celeris browser SDK through its public API.
- Real Google OAuth plus zkLogin is part of the MVP.
- Credits and purchase flow are part of the MVP.
- Developer app creation, sponsor-wallet provisioning, and program registration are part of the MVP.
- Sui package publish, `initialize_app`, and Sui registration remain documented manual steps in the MVP.
- The work should follow the sequence and dependency model defined in `WORK_ORDERS.md`.

## Work Order Execution Rules

Once a work order is assigned, the agent must:

1. Re-state the active work order ID and title.
2. Confirm its dependencies are satisfied or call out missing prerequisites.
3. Re-state what is in scope and out of scope for that work order.
4. Implement the slice end to end:
   - Prisma schema and migrations
   - Express routes and services
   - shared package changes
   - SDK changes
   - Next.js UI changes
   - tests
   - docs if required by the work order
5. Avoid pulling in later-slice scope unless it is required to complete the current slice correctly.

## Required Boot-Up Response Format

After reading the docs, before implementation starts, the agent should respond with a short structured summary like this:

### Boot-Up Complete

- Docs loaded:
  - `docs/fresh-start/MVP_SPEC.md`
  - `docs/fresh-start/IMPLEMENTATION_PLAN.md`
  - `docs/fresh-start/WORK_ORDERS.md`
- Active stack:
  - Next.js
  - Express.js
  - Postgres
  - Prisma
  - TypeScript
- Delivery model:
  - vertical slice
- Current sequence:
  - `FS-00` through `FS-05`
- Active work order:
  - `FS-XX` if provided, otherwise "not assigned yet"
- Dependency check:
  - satisfied or blocked
- Ready state:
  - ready for implementation

If no work order has been given yet, the final line should be:

`Ready for the specific work order.`

## Copy-Paste Session Prompt

Use this prompt to start a fresh chat with the agent:

```text
Before doing any implementation work, read these documents in order:

1. docs/fresh-start/MVP_SPEC.md
2. docs/fresh-start/IMPLEMENTATION_PLAN.md
3. docs/fresh-start/WORK_ORDERS.md
4. Then read the specific work order I assign in this session.

Treat those docs as the source of truth for architecture, sequencing, and scope. The stack is Next.js, Express.js, Postgres, Prisma, and TypeScript. The approach is vertical slice.

After reading them, give me a short boot-up summary with:
- docs loaded
- active stack
- delivery model
- current work-order sequence
- active work order
- dependency check
- ready state

If I have not assigned a work order yet, stop after the boot-up summary and wait.
```

## When The Agent Should Stop And Ask

The agent should stop and ask instead of guessing if any of the following are true:

- the requested task skips ahead of required work-order dependencies
- the task conflicts with the current MVP spec
- the task requires changing the planned stack
- the task turns a documented manual operator step into automation without an explicit instruction
- the task expands beyond the active work order in a way that would change sequence or acceptance criteria
