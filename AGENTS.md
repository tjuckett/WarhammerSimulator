# Project Instructions

- You may start the web app dev server when it is useful for verification, but do not leave it running; stop it before finishing so the user can start it later.
- After finishing each task, include the next recommended step or follow-up so the user knows what to do next.
- For frontend changes, root `npm run build` is enough verification by default unless the user asks for browser testing.
- Follow KISS: prefer the simplest direct implementation that solves the actual problem before adding abstractions, extra systems, batching, or cleverness. If complexity seems necessary, explain why first and keep it narrow.
- The active web app workspace is `apps/web`. The old `simulator/` folder may still exist locally as a stale copy until filesystem cleanup succeeds; do not edit it for new app work.
- Shared simulator rules, data, parsers, types, and practice timeline/scenario code live in `packages/simulator-core`; React/Next UI code should import them through `@warhammer-simulator/core`.
