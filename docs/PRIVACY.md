# Privacy

Audio stays on your PC. Only the text goes to Claude, and only if you add a key.

## What stays on your PC

- **Audio.** Recording and speech recognition (whisper.cpp) happen locally. Audio is never uploaded anywhere.
- **History, dictionary, snippets, notes, transforms, stats.** Stored in a local SQLite database under `%APPDATA%\dev.utter.desktop`.
- **Settings.** A local JSON file. It never contains your API key.
- **Your API key.** Stored in Windows Credential Manager (service `dev.utter.desktop`, user `anthropic_api_key`). It is never written to settings, logs or error messages.

## What leaves your PC

| What | Where | When |
|---|---|---|
| Dictated text, your dictionary words and (if enabled) the foreground app name | `api.anthropic.com` | Only when you have set an API key and AI cleanup, enhance, command or transform is used. Snippet-only dictations make no call. |
| Selected text (Command mode, Transforms) | `api.anthropic.com` | Only when you press that shortcut with a key set. |
| Speech model files (download) | Hugging Face (`ggerganov/whisper.cpp`) | Only when you download a model. Files are checked against pinned sha256 hashes. |
| Key validation request (`GET /v1/models`) | `api.anthropic.com` | When you press Test or save a key. Sends only the key, as a header. |

Nothing else. **No telemetry, no analytics, no crash reporting, no accounts.**

Anthropic's handling of API data is governed by their own terms and privacy policy; see <https://www.anthropic.com/legal>. Utter uses your own API key, so that relationship is directly between you and Anthropic.

## Context awareness

At the start of a dictation Utter reads the foreground app's process name and window title to pick a style (email, chat, code...). It does not take screenshots or read other fields. With context awareness on, the app name is sent to Claude as context; with it off, no app name is sent. Turn this off in Settings, Privacy.

If you set your name, it is sent to Claude only for Email enhance sign-offs.

## Your controls

- **History retention**: forever, 24 hours, or never.
- **Saved audio**: recordings are kept locally for at most 14 days (deleted automatically) so you can replay or retry them; turn this off in Settings, Privacy.
- **No key**: with no API key Utter makes no network calls except model downloads.
- **Delete**: remove single history items, clear all history, or delete downloaded models.
- **Uninstall**: removes the app; delete `%APPDATA%\dev.utter.desktop` and the Credential Manager entry for a full clean-up.

## Fallback behavior

If Claude is unreachable or returns something unusable, Utter uses local cleanup rules on your own text. It does not retry with other services.
