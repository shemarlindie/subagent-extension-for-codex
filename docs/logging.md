# Logging and diagnostics

Use this guide to investigate service failures, authentication problems and
performance, and to add diagnostics when developing the service. Logs stay on the
local machine. The extension does not send these records to a telemetry service.
For startup settings, see [Configuration](configuration.md#environment-variables).

## Files and retention

Logs live in `CODEX_SUBAGENT_EXTENSION_DATA`, which defaults to
`~/.local/share/codex-subagent-extension`.

| File            | Purpose                                                                       | Rotation                                |
| --------------- | ----------------------------------------------------------------------------- | --------------------------------------- |
| `service.jsonl` | Structured service, HTTP, authentication, tool and task events                | 5,000,000 bytes per file, three backups |
| `timing.jsonl`  | Task phases and panel send durations                                          | 5,000,000 bytes per file, one backup    |
| `service.log`   | Launcher-captured service stdout and stderr, including early startup failures | Best effort at startup, one backup      |

Structured files contain one JSON object per line. The writer rotates before a
record would exceed the limit. `.1` is the newest backup. Rotation and retention
are size-based and have no time-based expiration. The data directory is private
to the owner, and structured files use owner-only permissions.

The shared structured writer serializes writes without blocking requests. It
bounds queued records to 1,000,000 bytes per writer and drops records that exceed
the file or queue limit or cannot serialize. The next successful write reports
`logging.dropped` with a count. A filesystem write failure emits a fixed warning
to stderr once until a successful write resets it. These failures can lose
records. Graceful service shutdown flushes pending structured writes, while a
forced exit can lose them.

`service.log` captures output only when the launcher starts the service. Direct
`npm run dev` or `npm start` output goes to the invoking terminal unless redirected.
Before launching, the launcher rotates `service.log` to `service.log.1` when
it reaches 5,000,000 bytes and no service holds the data-directory lease.
Rotation failures do not prevent startup. A running service keeps writing to its
open output file, so this is not a strict size limit during a long run.
Concurrent launchers can also race and lose archived output.

## Diagnose a problem

Start with `service.jsonl` and the failure time. Each ordinary service record has
an ISO timestamp, `level`, `event`, `pid` and `instance_id`. The instance ID
changes on logger initialization, so it distinguishes service restarts even if
an operating system reuses a PID. Record-specific fields provide task, turn,
provider or tool context when available.

- Look for `service.starting`, `service.ready`, `service.draining`,
  `service.stopping` and `service.stopped` to identify startup and handoff stages.
  `service.recovered` and `service.drained` include operation durations.
  If startup fails before structured logging initializes, check terminal output
  or `service.log`. A fatal exception also writes a synchronous `service.crashed`
  marker to stderr, preserving Node's normal crash behavior.
- Match a failed HTTP response's `X-Request-Id` to `request_id` in service logs.
  The service generates this ID and propagates it through asynchronous tool
  handling. `http.request` includes method, a fixed route label, status,
  `duration_ms` and whether the connection aborted. Event streams record their
  full connection lifetime when they close.
- Inspect `tool.completed` for dispatch durations and outcomes. Recognized
  validation or access rejections use warning level with outcome `rejected`.
  Unexpected failures use error level with outcome `failed`. Successful
  read-only tools use debug level. A tool completion describes that dispatch,
  while a worker's later outcome belongs to its task.
- Filter by `task_id` for `task.execution_started`, `task.execution_failed` and
  `task.execution_completed`. Completion includes final status, duration and
  turn cost when available. Execution errors, store listener errors and edit
  capture failures include error classification and stack frames.

### Missing or wrong credentials

`auth.rejected` records a reason without recording the supplied credential:

| Reason                       | Meaning and action                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `missing_credentials`        | The API request supplied neither a usable bearer credential nor session. Check the client's authentication configuration.                       |
| `invalid_bearer`             | An Authorization header was present and authentication failed. Check that the client and service use the same token override or data directory. |
| `invalid_or_expired_session` | A cookie was present and authentication failed. Sign in again, especially after a service restart.                                              |
| `missing_token`              | Console login supplied no token. Enter the configured admin token.                                                                              |
| `invalid_token`              | Console login supplied a rejected token. Check the service's token source.                                                                      |

Other rejection reasons distinguish origin-policy failure (`origin_denied`),
missing console mutation protection (`csrf_header_missing`) and an endpoint
that requires an admin bearer credential (`admin_bearer_required`).

These labels classify the supplied request shape. A rejected request with both
an Authorization header and a cookie is classified as `invalid_bearer`.
The service logs the first 20 authentication rejections per minute. Further
rejections are counted and reported as `auth.rejections_suppressed` when the
next rejection starts a new window. Individual HTTP 401 and 403 records use debug level.

See [Admin token](configuration.md#admin-token) for token creation, overrides
and session lifetime. Never paste token values into a diagnostic report.

## Measure performance

`service.resources` samples service-process resources every 60 seconds:

- RSS, used heap and external memory in bytes.
- User and system CPU time in milliseconds since the previous sample.
- Event loop utilization and p99/max delay in milliseconds for the sample.
- The number of active tasks.

These measurements describe the Node service process. Worker subprocesses can
consume additional CPU and memory. A delayed event loop also delays the sample,
so intervals can exceed 60 seconds.

`provider.first_event` and `provider.first_text` measure time from SDK session
launch to the first SDK event and text delta. `provider.result` records result
subtype, error status, API duration, input/output and cache token counts, cost
and provider turn count. These summaries help distinguish provider latency from
service overhead without recording generated text. Missing result events can
mean execution ended before the provider returned a result.

The service appends `task.timing` records for repository validation, message
storage, scheduler scans and interrupt shutdown to `timing.jsonl`. The panel
measures message-send transport durations and sends them through the app-only
`app_record_timing` tool. It batches them for up to five seconds, so their
timestamps mark when the service received them. A failed batch or closed panel
drops its records. Durations use a monotonic clock and milliseconds. Records
exclude message text and repository paths.

Transport duration includes service processing and bridge or HTTP overhead.
Compare it with service phases instead of adding it to them. Scheduler scans
report their work count so scan cost can be assessed before changing scheduling.
An unfinished shutdown has no completion duration until it settles. HTTP and
tool durations describe different nested boundaries and also must not be added
together as independent costs.

The default `CODEX_SUBAGENT_EXTENSION_LOG_LEVEL=info` includes ordinary service
and resource events. Set `debug` at service startup to include health-request
records, successful read-only tool dispatches and successful HTTP tool requests.
`warn` or `error` suppresses lower-level service events, including
resource samples. Task timing uses its separate file independently of this
threshold. Invalid levels prevent service startup.

## Add diagnostics

Service-wide logging helpers belong to `src/service/platform/logging`.
Feature code owns the choice of event names and metadata. Browser code must
respect the runtime boundaries in [Architecture](architecture.md#code-ownership).

Use `logEvent(level, event, fields)` for stable event names and curated scalar
metadata, `logError(event, error, fields)` for failures, and `withLogContext` for
bounded asynchronous correlation. Start background task execution with
`{ inherit: false }` so it does not retain a caller's request context. Use monotonic `performance.now()` durations.
Avoid recording every provider streaming delta. Log lifecycle transitions and
summaries that help explain a failure or measure useful work.

Pass identifiers, statuses, counts and durations. Do not pass request bodies,
prompts, replies, tool arguments, credentials, repository contents or raw error
messages. The helper redacts credential/content field names and truncates string
values as a secondary safeguard. It also scrubs exact configured admin/API
credentials and bearer strings from scalar text. Numeric input/output and cache
token counters are allowed explicitly. Error logging retains classification, a
restricted error code, cause type and bounded stack frames. It omits the raw
message and cause text. Error categories
include authentication, rate limit, abort, timeout, connection and budget
failures, with `unknown` as the fallback. These are diagnostic classifications
and do not change error handling. Stack frames can still contain local filesystem paths,
so review logs before sharing them. Raw stdout/stderr and opt-in mention-search
logs do not use these structured redaction rules.

Test meaningful failure paths with temporary data and log files. When exercising
an actual service, use a separate data directory and free port as described in
[Local development](development.md#setup). Keep authentication tokens out of test
output and leave any service already in use running.
