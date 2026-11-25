# Changelog

All notable changes to Utter are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-24

First public release. Windows 10/11, x64 and ARM64. Installers are unsigned.

### Added

- Push-to-talk dictation (`Ctrl+Win`), hands-free mode, cancel with `Esc`, paste last and copy last.
- Local speech recognition with whisper.cpp; downloadable models with progress and checksum verification; auto-detect or fixed language, optional translate to English.
- The floating pill with listening, locked, thinking, done and error states, and live level bars.
- AI cleanup with Claude Haiku 5.5 (optional Sonnet 5.5) using your own Anthropic API key, stored in Windows Credential Manager. Levels Off, Light and Medium; backtrack; spoken punctuation and lists. Falls back to local cleanup on any failure.
- Context-aware styles per app category (Formal, Casual, Very casual, Excited) with an editable rules table.
- Dictionary with replacements, CSV import/export and auto-learn from History edits.
- Snippets (voice shortcuts) with CSV import/export; a snippet on its own is inserted without an AI call.
- Dictate & enhance, auto-enhance per category, and transforms on selected text (Polish, Prompt engineer, up to 8 custom).
- Command mode: apply a spoken instruction to the selection or insert generated text.
- History with search, retry, original-text diff, audio playback, editing and retention options.
- Notes, Insights (words, WPM, time saved, streaks, heatmap, top apps), usage and cost estimate.
- First-run onboarding, tray menu, launch at login, light/dark/system theme, rebindable shortcuts.

[Unreleased]: https://github.com/aadityamittal1/utter/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aadityamittal1/utter/releases/tag/v0.1.0
