## What and why

<!-- What does this change, and why? Link the issue: Fixes #123 -->

## Checklist

- [ ] Tests added or updated (pure logic gets unit tests first)
- [ ] `npm run typecheck && npm run lint && npm test` pass in `apps/desktop`
- [ ] `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test --lib` pass in `apps/desktop/src-tauri`
- [ ] Screenshots or a short clip attached for any UI change
- [ ] No telemetry added; audio still never leaves the PC; the API key never reaches settings, logs or errors
- [ ] Docs and `CHANGELOG.md` updated if behavior changed
