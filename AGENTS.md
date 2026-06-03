# Project Instructions

- Do not start the web app dev server, and do not request permission to run `npm run dev`, unless the user explicitly asks for the dev server to be started.
- For frontend changes, root `npm run build` is enough verification by default unless the user asks for browser testing.
- Follow KISS: prefer the simplest direct implementation that solves the actual problem before adding abstractions, extra systems, batching, or cleverness. If complexity seems necessary, explain why first and keep it narrow.
- The active web app workspace is `apps/web`. The old `simulator/` folder may still exist locally as a stale copy until filesystem cleanup succeeds; do not edit it for new app work.
- Shared simulator rules, data, parsers, types, and practice timeline/scenario code live in `packages/simulator-core`; React/Next UI code should import them through `@warhammer-simulator/core`.
