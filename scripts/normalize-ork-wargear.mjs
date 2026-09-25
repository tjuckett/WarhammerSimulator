// Wargear is now derived from each datasheet's current Wargear options by
// normalize-ork-catalog.mjs and the shared core resolver. Keep this command as
// a compatibility entry point for local workflows without maintaining a
// second, hand-authored Ork rules layer.
await import('./normalize-ork-catalog.mjs');
