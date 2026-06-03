# Simulator Core

Shared simulator code that should stay independent from React and Next.js.

This package owns portable rules, data, parsers, practice timelines, scenarios,
and local persistence adapters. The web app should import these modules instead
of redefining simulator behavior in UI components.

Backend storage can replace the browser-local practice storage later without
changing the timeline/scenario shapes exported here.
