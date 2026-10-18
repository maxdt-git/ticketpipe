# Windows automatic quick fixes

**Platform support: Windows only.** Automatic execution is unavailable on macOS and Linux; ticket generation and manual quick-fix suggestions remain supported there.

After generating a quick-fix suggestion, choose **Let TicketPipe try**, select an existing application window, and start. Keep the selected window in front. Switching applications stops the attempt. TicketPipe's Stop button remains available; closing the controlling page also stops execution. Routine actions run without individual approval.

This release uses Windows UI Automation. Apps must expose accessible controls. Unreadable apps, administrator prompts, protected fields, destructive operations, terminals, and fixes requiring another window need user intervention. No screenshot or coordinate fallback is used. macOS and Linux retain manual quick fixes and tickets, with automatic fixing unavailable.

The configured AI receives the original masked incident, suggestions, explicitly checked manual steps, and masked live accessibility information. Captured content is untrusted evidence. A planner establishes fixed success criteria and proposes the first action in the same request. The runner validates both before input, avoiding a second AI round trip before the first action. The runner independently checks accessible text, visibility, values, selection and toggle state; an AI completion message cannot establish success. For editable value checks, a unique automation ID and role can identify a field whose name changes after editing, provided the observation is complete. Other checks and ambiguous or truncated observations retain exact-name matching. Explicit user confirmation is labeled user-reported.

## Runtime

```mermaid
flowchart TD
  A[Screenpipe + description] --> B[Mask and freeze incident for 30 minutes]
  B --> C[Quick-fix suggestion]
  C --> D[User selects a Windows app]
  D --> E[Background repair runner]
  E --> F[Observe via private Rust child process]
  F --> G[Configured AI proposes one structured action]
  G --> H[Validate policy, scope and fresh control identity]
  H --> I[Perform one action and observe again]
  I --> J{Independent success checks}
  J -->|Continue within limits| F
  J -->|Pass| K[Verified fixed]
  J -->|Blocked or limit| L[Unresolved or needs your help]
  M[Stop, focus loss, target loss, lease expiry] --> N[Revoke, abort AI and terminate helper]
  L --> O[Original incident + factual attempt record]
  N --> O
  O --> P[Draft ticket, review and approve publishing]
```

Limits: one active attempt; 20 input actions; three minutes overall; 45 seconds per AI request; 12 seconds without a UI heartbeat. The UI polls once per second and renews its lease every four seconds. Initial activation allows up to one second for Windows to finish the requested handoff and requires 75 ms of stable target focus before observation or input. That wait permits only the original foreground window (or a transient absence of foreground) until the target is reached. An unrelated window, cancellation, or focus leaving an already reached target stops startup. No focus is reacquired during this wait or an active attempt. The helper independently monitors scope every 100 ms, rechecks before input, resolves controls again, and consumes every observation once. UIA calls have a 12-second watchdog; Stop kills a stalled helper. Process identity includes handle, PID and process creation time. Owned dialogs must belong to the same process and selected root owner.

No attempt resumes after restart. Incident snapshots and run records are held in process memory. Active incidents are pinned against expiration. Ticket escalation uses those snapshots and a deterministic audit section. Unacknowledged input is labeled uncertain and excluded from the factual “Already tried” list.

The UI distinguishes reading controls, waiting for AI, acting and verification, and shows elapsed AI waiting time. Bounded diagnostic logs persist stage timings, counts, outcome and failure codes in the per-user TicketPipe `logs/automatic-fixes.jsonl` file (on Windows, `%APPDATA%\TicketPipe\logs\automatic-fixes.jsonl`). Rotation keeps the current file and one previous file, approximately 256 KB each. Logs exclude incident text, window titles, control names and values, prompts, model responses and credentials. They cannot restore a run or authorize actions. A failed log write does not interrupt Stop or repair execution.

## Local interfaces

Every control request needs the per-launch `x-ticketpipe-token` from the served UI, the exact loopback Host, and a matching Origin when present. Generated previews use DOMPurify and a restrictive content security policy.

| Interface | Purpose |
|---|---|
| `GET /api/fix/windows` | Enumerate eligible windows; return short-lived opaque choices |
| `POST /api/fix/runs` | Start with incidentId, windowId and manualSteps; return 202 immediately |
| `GET /api/fix/runs/:id` | Progress, audit, checks and outcome |
| `POST /api/fix/runs/:id/stop` | Revoke and cancel |
| `POST /api/fix/runs/:id/heartbeat` | Renew UI lease |
| `POST /api/fix/runs/:id/confirm` | Record explicit user confirmation |
| `POST /api/draft` | Accept incidentId, optional fixRunId and manualSteps |

## Development and packaging

Run `bun install`, `bun run build:native`, `bun run typecheck`, and `bun test`. Building the Windows controller requires Rust and a Windows linker. `scripts/build-native.ts` uses Cargo from PATH or the workspace's existing portable GNU toolchain. `bun run build windows-x64` embeds the release helper directly into the standalone executable. At runtime it extracts a hash-versioned, integrity-checked copy in the per-user TicketPipe native folder. The recipient needs no Rust, Python, Node or Bun installation. Run the executable with `--check-controller` for a read-only extraction and controller availability check.

The repair runner and controller are TicketPipe implementations. They do not import Workshop Companion's agent or application stack. Existing window-identity and cancellation patterns inform the design; the workspace's portable Rust build tools are reused.

Cross-platform builds use the same build command and omit the helper outside Windows. macOS bundles require zip or tar on the build machine.

On a non-Windows build host, the default build produces macOS and Linux releases. To cross-package Windows as well, set `TICKETPIPE_WINDOWS_HELPER` to a controller executable built on Windows.

`bun run scripts/native-acceptance.ts` serves disposable browser controls at `http://127.0.0.1:4243`. Bring that page to the foreground, then click Run acceptance checks. It exercises the real native boundary, field input, independent verification, destructive-action refusal, stale observations, protected fields, replaced identity, and Stop. These scripted checks are separate from production agent behavior. Real configured-AI acceptance must additionally exercise successful repair, unsuccessful repair and Stop with live Screenpipe evidence in ordinary applications.

## Validation recorded on 2026-10-18

- Type checking passed; 30 Bun tests and seven Rust tests passed.
- Eight native boundary checks passed against disposable controls in an existing Chrome installation.
- Real Gemini 3.5 Flash Lite calls with live Screenpipe evidence exercised verified repair, a disabled control requiring user help, and Stop during an AI request. The desktop window picker and progress UI were also exercised; moving focus away stopped a run.
- Real AI ticket drafting retained the original evidence and included exactly one genuinely performed action. Local saving and GitHub publishing regression tests passed; GitHub publishing used a mocked response and no issue was posted.
- All five release targets compiled. Both macOS archives were checked for the executable permission on the bundled binary. macOS and Linux binaries were not launched on this Windows host.
- The final Windows executable ran a complete real AI repair with only Windows system directories on PATH. Its embedded helper extracted and operated successfully; no Rust, Python, Node or Bun executable was available through PATH. This was an isolation check on the development computer, not a clean-machine installation test.

Acceptance covers Chrome accessibility controls, not every Windows application. Production repair decisions come from the general agent prompts and structured action policy; the fixture procedures are not part of that runner.

### Follow-up: Chrome search-field test

Screenpipe frames 13856 and 13857 show the user's selected Chrome New Tab search field still containing `apples` between 07:54:50 and 07:56:12 Europe/Paris. Input records show a switch back to TicketPipe at 07:56:13, followed by the focus-loss outcome in frame 13859. No actions were listed. That run had no persistent diagnostic log, so the stage responsible for its initial delay cannot be established retrospectively.

After adding stage diagnostics and the combined planning/first-action request, a real Gemini 3.5 Flash Lite run in a disposable Chrome New Tab window replaced `apples` with `oranges` and independently verified the value in 4.6 seconds, with one AI request and one text action. An earlier replay returned an invalid success check and correctly performed no input. Regression coverage additionally verifies cancellation of a late combined response, validation before the first action, changing control names, ambiguous identities and log payload privacy. These findings do not prove the exact cause of the original delay.

### Follow-up: initial window handoff

The next user attempt, at 08:16:02 Europe/Paris, ended after 41 ms with `focus_lost` during `connecting`, before observation, AI inference or input. Screenpipe's focus event for the selected Chrome window was recorded at 08:16:02.132562, approximately 7 ms after the controller's failure. The native binding checked foreground focus immediately after requesting activation. Windows can complete cross-input-queue activation asynchronously ([Microsoft explanation](https://devblogs.microsoft.com/oldnewthing/20161118-00/?p=94745)).

The controller now waits for the bounded initial handoff described above. It also avoids the input-queue attachment fallback when SetForegroundWindow has already accepted the activation request. Regression tests cover delayed activation, deadline, an unrelated window, focus leaving the target during startup, failed binding without AI/input, and cancellation of a late binding response.

A complete real desktop test used the rebuilt Windows executable, live Screenpipe context, the quick-fix result, the actual application picker and a separate Chrome New Tab window. At 08:27:05, selecting that window completed binding in 159 ms, followed by one real Gemini request and one text input. `apples` became `oranges` without submitting a search; independent verification and the TicketPipe UI both reported `verified_fixed` after 2.396 seconds. A separate accessibility read confirmed the Chrome field value. This test exercised the window handoff rather than starting with the target already focused. All five release targets were rebuilt.

The user subsequently confirmed that the repair worked in their own manual test. This is the tested Windows baseline saved on `codex/screenpipe-testing`.
