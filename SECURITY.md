# Security policy

## Reporting a vulnerability

Please report security issues **privately**. Do not open a public issue.

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability** (GitHub Security Advisories): <https://github.com/aadityamittal1/utter/security/advisories/new>.
3. Describe what you found, how to reproduce it, and the impact. Never include a real API key.

You can expect an acknowledgement within a few days. Utter is maintained by volunteers, so fixes are best-effort, but security reports come first. We will credit you in the advisory unless you prefer not to be named.

## Supported versions

Only the latest release receives security fixes.

## In scope

- **API key handling**: the Anthropic key must live only in Windows Credential Manager. Anything that writes it to settings, logs, error messages, history or the UI after entry is a bug.
- **Clipboard**: Utter saves, replaces and restores your clipboard to insert text. Leaks, clobbering of newer clipboard content, or exposure of clipboard data to other parties.
- **Keyboard hook and simulated input**: the global hook must only match configured shortcuts and must not record, store or transmit other keystrokes. Injected input must not be exploitable.
- **Network**: audio must never leave the PC; the only outbound traffic is text to the Anthropic API (with a key) and speech model downloads. Any other traffic, or telemetry, is a bug.
- **Local data**: history, audio and database files, and the IPC surface between the UI and the Rust core.
- **Supply chain**: model download integrity (checksums) and the release workflow.

## Out of scope

- The SmartScreen warning and antivirus false positives on unsigned builds (known; signing is on the roadmap).
- Issues requiring an already compromised or administrator-level local account.
- Vulnerabilities in Anthropic's API or in third-party dependencies with no impact on Utter (report those upstream).
