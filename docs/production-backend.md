# Desktop GPU backend operations

## Verified deployment — 3 October 2026

The `OptiFrame Backend` scheduled task is installed and running on the desktop. A scheduled-context preflight verified all runtime imports and local SAM checkpoint access without allocating another GPU model. The manual server was stopped before the scheduled task started its single worker. Readiness then returned 200. The existing temporary Cloudflare tunnel remains in place; the permanent domain is not configured.

Validation: 96 backend tests and 7 supervisor tests passed. A live local smoke check returned an accepted 256-point outline in 110 ms, generated a frame preview and a 318 KB STL ZIP, rejected an unauthenticated request with 401, and rejected an oversized JSON request with 413. This timing is one warm localhost request, not phone latency or an accuracy benchmark. CAD validation and recording results are separate from service availability.

During the next controlled backend update, the supervisor detected the old worker's exit and started its replacement after a one-second backoff. The replacement reached ready state with the same cached model and token. The scheduled supervisor remained running throughout. Two additional alignment-provenance tests passed; the live exported ZIP retained `alignment_source: illustrative`.

This deployment uses the current Windows user's desktop GPU. It is **not an
always-on hosted production service**: Windows must remain awake, the user must
be logged in, and the network must work. Logging in starts the scheduled task;
logging out or sleeping interrupts service. The installer does not change power
settings. A stable domain and managed Cloudflare tunnel are still pending.

## Components

- `deploy/install-backend-task.ps1`: stores user-local configuration and registers
  a hidden task at that user's logon. It does **not** start the task.
- `deploy/start-backend.ps1`: decrypts the API key with Windows DPAPI into the
  process environment and starts the supervisor without placing the key on a
  command line.
- `deploy/supervisor.py`: starts one uvicorn worker on `127.0.0.1:8766`, using the
  same Python executable that starts the supervisor. It passes
  `OPTIFRAME_ENV=production` and `OPTIFRAME_ACCESS_TOKEN` to the backend.

The Windows file lock permits one supervisor per runtime directory. Before
**each** backend launch, an occupied port makes the supervisor exit without
killing the existing process. A Windows Job Object kills the owned backend if
the supervisor exits or crashes; it never attaches to an unrelated process.
If process ownership cannot be established, launch fails closed.

## Prerequisites

Use the existing `C:\Python314\python.exe` environment on this machine. Installed
GPU dependencies are recorded in `gpu/requirements-desktop.txt`; PyTorch
`2.11.0+cu128` uses its separate CUDA 12.8 wheel index. This file pins direct
dependencies, not the full transitive dependency graph. Do not reinstall over a
working GPU environment as part of launching this service.

The SAM weights must already be cached locally. Production startup warms the
existing model once with an actual inference; it does not download missing
weights. Missing model files leave readiness unavailable while the process
remains live. Current health endpoints are public and carry no secrets.

## Install and switch over

Run from the intended checkout, in PowerShell as the current desktop user:

```powershell
& .\deploy\install-backend-task.ps1
```

Enter the **existing** API access key at the secure prompt. Do not paste it in a
shell command, repository file, or scheduled-task argument. The encrypted value
is bound to this Windows user and machine. A different account cannot reuse it.

Configuration and logs are in `%LOCALAPPDATA%\OptiFrame\runtime`. The installer
restricts directory access to the current user and SYSTEM before writing the
encrypted configuration. Anyone running code as that same user can still read
the running process environment; DPAPI is protection at rest, not isolation from
the account owner.

If installed from a packaged app such as Codex, Windows may redirect that folder
inside the app's `LocalCache\Local` directory. The installer resolves the actual
config file handle and pins its physical parent as the task's `-RuntimeRoot`.
This prevents an unpackaged Task Scheduler process from seeing a different
directory. It also keeps manual and scheduled launches on the same instance lock.
Inspect the task action to find the exact runtime directory; this argument is a
path, never the access key. Do not move or clear that directory while installed.

Before starting the task, deliberately stop the old **OptiFrame backend only**.
Identify the listener and its command line before stopping it. Keep the existing
OptiFrame quick tunnel running so its URL continues to route to port 8766. Do not
alter or stop other Cloudflared services on the computer.

```powershell
Start-ScheduledTask -TaskName 'OptiFrame Backend'
Get-ScheduledTask -TaskName 'OptiFrame Backend'
Get-ScheduledTaskInfo -TaskName 'OptiFrame Backend'
Invoke-RestMethod 'http://127.0.0.1:8766/healthz'
Invoke-RestMethod 'http://127.0.0.1:8766/readyz'
```

`healthz` responds when the process can serve requests. `readyz` only succeeds
after the model is loaded and warmed; a 503 response means the capture pipeline
is not ready. The supervisor never interprets a successful liveness response as
proof of segmentation quality, print fit, or measurement accuracy.

## Recovery and logs

- Backend exit: restart after exponential delays of 1, 2, 4, 8, 16, 32, then
  at most 60 seconds. A run lasting at least five minutes resets the delay.
- Startup: 120-second grace period before health checks. Process crashes are
  still detected during the grace period.
- Liveness: a three-second timeout, with checks separated by ten seconds. Three
  consecutive failures restart the owned backend. A success resets the count.
- Readiness: checked and logged once per minute while live. Readiness failure
  **does not** restart the backend, preventing missing-model restart loops.
- Supervisor/task failure: Task Scheduler retries five times, one minute apart.
  After these attempts, inspect logs and start the task after fixing the cause.
- Uvicorn limits: one worker, 32 concurrent connections/tasks, five-second
  keep-alive, eight-second graceful shutdown, and forwarded headers trusted
  only from localhost. No request-count recycling reloads the GPU model.

Logs rotate at approximately 5 MB each, keeping four backups plus the current
`backend.log` (about 25 MB total). The known API token and common credential
header/query forms are redacted before writing. No environment dump is logged.
Access logging is disabled. This is not a general-purpose secret detector;
application code must not print credentials or uploaded images.

```powershell
Get-Content "$env:LOCALAPPDATA\OptiFrame\runtime\backend.log" -Tail 60
Stop-ScheduledTask -TaskName 'OptiFrame Backend'
```

Failures before Python starts are written to `launcher-error.log` in the same
runtime directory, with one bounded backup. If that directory cannot be reached,
the fallback is `%TEMP%\OptiFrame-launcher-error.log`. Errors record the startup
phase and a redacted exception message, never the configuration contents.

For a deliberate update, stop the task, change code, then start the task. Do not
launch a second GPU model to warm a replacement beside the running instance.
Rotating the key requires rerunning the installer and restarting the task;
existing phone links must then use the new key.

## Tunnel boundary

No named tunnel is installed by these scripts. The current OptiFrame quick
tunnel is a temporary manual process: if it stops or the computer reboots, its
public URL may change and does not automatically recover. A separate existing
Cloudflared system service belongs to another setup and is not modified.

A managed tunnel needs its own account authorization, domain DNS, and local
credential storage before it can be configured. Until that work is completed,
the backend supervisor improves local recovery but does not provide full public
website uptime or a stable production URL.

## Verification

```powershell
C:\Python314\python.exe -m unittest discover -s deploy -p test_supervisor.py -v
```

Tests use simulated health failures, credential strings, and an actual short
Windows dummy subprocess for Job Object cleanup. They do not start a GPU model,
install tasks, alter the running backend, or change tunnels. Live recovery still
requires a controlled post-install crash/hang test with the deployment owner.
