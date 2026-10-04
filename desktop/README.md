# JARVIS Desktop — owner-only Phase 1

The Windows app reuses the existing Next.js UI and the existing telephony-enabled custom server. It owns one app process, one worker, and one scheduler. It does not start or replace Cloudflare tunnels and never dials a phone number by itself.

## Build and launch

- `npm run dev:jarvis` remains the normal development workflow.
- `npm run desktop:build` creates a standalone production web stage, bundles the custom app/worker/scheduler and Electron layer, and checks staged files for secrets.
- Stop the development JARVIS stack before launching Desktop, because both bind local port 3000. `npm run desktop:dev` builds and launches Electron.
- `npm run desktop:package` uses electron-builder for the Windows app payload and NSIS for `dist-desktop/JARVIS-Setup.exe`. The NSIS compiler must be installed or cached locally (or specified by `JARVIS_NSIS_PATH`). No artifact is uploaded.

The first launch copies the owner's `Desktop/JARVISS/.env.local` into `%APPDATA%/JARVIS/config/.env.local`. From then on, edit the AppData copy to change the installed app configuration. File-backed Vonage private keys are copied into the same private config directory, never into the installer. The app does not rotate credentials.

Logs, preferences and informational runtime metadata live under `%APPDATA%/JARVIS`. Previous-session PIDs are never killed blindly. Child processes receive a dedicated IPC shutdown signal and stop when the parent disconnects. This prevents an Electron crash from leaving duplicate workers; durable jobs remain in Supabase.

Closing or minimizing hides the window to the tray. Tray actions provide Open JARVIS, System Status, Restart Runtime, Start with Windows, Open Logs Folder and Exit JARVIS. Start with Windows defaults off and is available only after installation; login launch starts minimized.

The System Status window performs read-only checks. An unauthenticated phone status is conservatively shown as degraded. A dead Quick Tunnel is shown as degraded; the desktop does not create a new tunnel or change Vonage callbacks.

This Phase 1 installer is unsigned and may trigger Windows SmartScreen. Code signing is recommended before distribution beyond the owner.
