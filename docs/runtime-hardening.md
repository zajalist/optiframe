# API runtime controls

Set `OPTIFRAME_ENV=production` and a nonempty `OPTIFRAME_ACCESS_TOKEN` before
starting the **single** Uvicorn worker. `OPTIFRAME_PRODUCTION=1` is an equivalent
production flag. Development keeps the existing optional-token behaviour.

In production, missing configuration fails closed: all `/api/` requests and
readiness return 503 without a token. A configured token is required through
`X-OptiFrame-Key` on every `/api/` path, including diagnostic health. Incorrect
or missing keys return 401. Static assets and the minimal probes remain public.

## Startup and probes

- `/healthz`: liveness and the worker watchdog, `{"status":"ok"}`. A stalled
  operation returns 503 with `{"status":"unhealthy"}`. No CUDA/device details.
- `/readyz`: 200 only when ready; otherwise 503 with `Retry-After: 1`.
- Production warm-up runs in one background thread using the existing shared SAM
  predictor and model lock. It executes a synthetic forward pass, mask
  postprocessing and CUDA synchronization before marking readiness. It does not
  apply lens-detection acceptance criteria to the synthetic image.
- The HTTP process can serve liveness while warm-up runs. A warm-up failure keeps
  readiness and expensive API requests at 503; it logs only the failure type.
- Production loads checkpoints with `local_files_only=True`. Populate the
  existing `facebook/sam2.1-hiera-small` cache under the service account before
  starting production. Missing cache or CUDA does not trigger an HTTP download
  or silently open the service.

Do not run multiple Uvicorn workers on the same model allocation. The admission
gate is per process. Liveness turns unhealthy after **180 seconds of unfinished
warm-up**, or **240 seconds of one admitted request / running endpoint worker**.
The latter budget includes the 120-second import/video upload allowance. A
supervisor can restart a genuinely stalled process using this probe after its
startup grace. A fast warm-up failure, such as missing cached weights, keeps
liveness healthy and readiness false, preventing a configuration restart loop.

## Bounded work and uploads

One expensive HTTP request is admitted at a time across `/api/frame*`, import,
video extraction, segmentation, live segmentation and burst segmentation.
Other requests receive 503 and `Retry-After: 1`, rather than queueing GPU or mesh
work. The model's existing lock remains in place. Authentication precedes body
parsing. Rejected or failed requests release admission in `finally`. Separately,
each expensive synchronous endpoint tracks the actual worker thread until its
function returns. If an HTTP request is cancelled but its native CPU/GPU work
continues, that worker keeps new work blocked and remains visible to the
240-second watchdog. This does not depend solely on AnyIO's normal cancellation
shielding and does not pretend Python can interrupt a stuck native thread.

Frame JSON is limited to **1,000,000 bytes**, whether `Content-Length` is present,
incorrectly small, or omitted. Existing multipart payload limits remain in
place with 64 KB allowance for multipart boundaries. Stream overflow returns
413 and closes partial multipart upload files. JSON/capture uploads must finish
within 30 seconds; import/video uploads have 120 seconds. The receive deadline
is total elapsed upload time, not a fresh allowance for every chunk. Expiry
returns 408 with `Retry-After: 1`.

API and probe responses use `Cache-Control: no-store`, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. Each response
gets a generated `X-Request-ID`; client-supplied IDs are not trusted or logged.
Unexpected guard-level errors expose a generic message and log only the request
ID and exception class. The guard stores no images or request bodies.

Tests use mocked warm-up and predictors, so they do not allocate another GPU
model. Coverage includes fail-closed configuration, all-API authentication,
readiness transitions, admission/backpressure, declared and chunked body limits,
partial-upload cleanup, upload deadlines, release after handler failures,
deterministic warm/work watchdog expiry, and orphaned workers after cancellation.
