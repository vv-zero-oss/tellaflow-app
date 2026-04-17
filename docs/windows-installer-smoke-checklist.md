# Windows Installer Smoke Checklist

Use this checklist after running `npm run build:win` or `npm run build:win:qa`.
Before manual verification, run `npm run smoke:win` for automated preflight checks.

## Install + Launch

- [ ] Verify `dist/*.exe` (NSIS installer) is produced.
- [ ] Install with default path and confirm install completes without errors.
- [ ] Launch Tellaflow from Start Menu after install.
- [ ] Confirm app opens onboarding on first run.

## Permissions + Onboarding

- [ ] Grant microphone permission when prompted.
- [ ] Open Windows accessibility settings from onboarding.
- [ ] Complete onboarding and verify app reaches ready state.
- [ ] Restart app once and verify onboarding does not reappear.

## Recording + Paste Reliability

- [ ] In Notepad, hold hotkey, speak, release, confirm text appears.
- [ ] In VS Code, repeat and confirm text appears in the active editor.
- [ ] In browser text area (e.g. web chat), repeat and confirm paste works.
- [ ] While recording, switch apps before release and verify text goes to the new frontmost app.
- [ ] Repeat rapid recordings 5+ times and confirm clipboard restores correctly after each paste.

## Fallback Behavior

- [ ] Trigger recording when target app name cannot be captured (e.g. quick app switch) and verify best-effort paste still occurs.
- [ ] Confirm no crashes or unhandled errors when paste activation fails.

## Core Features

- [ ] Toggle sounds on/off and verify recording cues behave as expected.
- [ ] Enable/disable floating bar and verify click-to-record still works.
- [ ] Download a non-bundled model and run one transcription.
- [ ] Open History and confirm entries are saved.

## Packaging Sanity

- [ ] Close app and relaunch from desktop/start shortcut.
- [ ] Uninstall app from Windows settings and verify uninstall completes cleanly.
- [ ] Reinstall and verify existing profile behavior is understood (fresh vs persisted userData).
