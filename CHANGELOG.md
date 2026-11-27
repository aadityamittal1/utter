# Changelog

All notable changes to Utter are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-27

First public release. Windows 10/11, x64 and ARM64. Installers are unsigned.

### Added

- Windows-native interface built on HeroUI v3: Segoe UI Variable with an Instrument Serif display face, a warm neutral palette with the Ember accent, a custom title bar (sidebar toggle, light/dark toggle, Windows caption buttons), a collapsible sidebar and a rounded content panel. Optional Windows accent colour, and the Windows text size setting is respected.
- Settings in one large dialog with sections for General, System, AI, Speech model, Privacy & data and About.
- An always-on-top pill pinned bottom-centre above the taskbar on the monitor you're using. It shows your shortcut on hover, starts hands-free dictation on click, draws a live 9-bar waveform while you speak, and never takes focus. It is re-raised whenever another window comes to the front, stays out of the way of fullscreen apps when idle, and "Show the pill at all times" can limit it to dictation only.
- Push-to-talk dictation (`Ctrl+Win`), hands-free mode, cancel with `Esc`, paste last and copy last.
- Local speech recognition with whisper.cpp; downloadable models with progress and checksum verification; auto-detect or fixed language, optional translate to English.
- AI cleanup with Claude Haiku 5.5 (optional Sonnet 5.5) using your own Anthropic API key, stored in Windows Credential Manager. Levels Off, Light and Medium; backtrack; spoken punctuation and lists. Falls back to local cleanup on any failure, and a guard makes sure dictated questions and prompts are cleaned up, never answered.
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
