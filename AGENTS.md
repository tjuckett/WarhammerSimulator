# Project Instructions

- You may start the web app dev server when it is useful for verification, but do not leave it running; stop it before finishing so the user can start it later.
- After finishing each task, include the next recommended step or follow-up so the user knows what to do next.
- After code changes, include a git-style description and a concise summary of what changed.
- Do not create git commits unless the user explicitly asks for a commit.
- For frontend changes, root `npm run build` is enough verification by default unless the user asks for browser testing.
- Follow KISS: prefer the simplest direct implementation that solves the actual problem before adding abstractions, extra systems, batching, or cleverness. If complexity seems necessary, explain why first and keep it narrow.
- The active web app workspace is `apps/web`. The old `simulator/` folder may still exist locally as a stale copy until filesystem cleanup succeeds; do not edit it for new app work.
- Shared simulator rules, data, parsers, types, and practice timeline/scenario code live in `packages/simulator-core`; React/Next UI code should import them through `@warhammer-simulator/core`.
- Never parse log text for game logic or UI state. Logs are display history only; dice, outcomes, and pending actions must come from typed state/results.
- Never guess about game behavior, bug causes, or whether a fix works. Trace the relevant engine/UI state path and verify the conclusion with a focused test or reproduction before changing code or reporting a fix. If the evidence is unavailable or ambiguous, state the uncertainty and ask for clarification instead of inferring.
- Never guess at game values or duplicate rule calculations in the UI. Before changing a rules-facing display or action, trace its value from the rendered component through typed UI state to the authoritative `packages/simulator-core` resolver/state. The UI must display core-owned data/results; if that data is unavailable, fix the core query/state boundary instead of adding a local fallback or inferred value.
- Popups are UI only: they may render typed engine results and submit player choices, but must never define or validate game legality, eligibility, allocation completeness, modifiers, targets, attacks, or outcomes. Add or extend a typed `packages/simulator-core` query/result instead; do not create a parallel popup rule path.
