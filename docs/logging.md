# Logging and diagnostics

Use this guide to investigate service failures, authentication problems and
performance, and to add diagnostics to the service. Logs stay on the local
machine. The extension sends no telemetry. For startup settings, see
[Configuration](configuration.md#environment-variables).

## Files and retention

Logs live in `CODEX_SUBAGENT_EXTENSION_DATA`, which defaults to
`~/.local/share/codex-subagent-extension`.

| File            | Purpose                                                                       | Rotation                                |
| --------------- | ----------------------------------------------------------------------------- | --------------------------------------- |
| `service.jsonl` | Structured service, HTTP, authentication, tool and task events                | 5,000,000 bytes per file, three backups |
| `timing.jsonl`  | Task phases, queue and input waits, and panel call durations                  | 5,000,000 bytes per file, one backup    |
| `service.log`   | Launcher-captured service stdout and stderr, including early startup failures | Best effort at startup, one backup      |

Structured files hold one JSON object per line. The writer rotates before a
record would exceed the limit, and `.1` is the newest backup. Retention is by
size only. The data directory and log files are readable only by their owner.

Structured writes never block requests, so records can be lost:

- Each writer queues up to 1,000,000 bytes. It drops records that exceed the
  file or queue limit or cannot serialize. The next successful write adds a
  `logging.dropped` record with the count.
- A filesystem write failure prints one fixed warning to stderr. The warning
  repeats only after a successful write.
- Graceful shutdown flushes pending writes. A forced exit can lose them.

`service.log` captures output only when the launcher starts the service.
`npm run dev` and `npm start` write to the terminal. Before launching, the
launcher moves `service.log` to `service.log.1` when it has reached 5,000,000
bytes and no service holds the data-directory lease. Rotation failures do not
block startup. A running service keeps appending to its open file, so the file
can grow past the limit during a long run. Concurrent launchers can race and
lose archived output.

## Diagnose a problem

Start with `service.jsonl` around the failure time. Each service record has an
ISO `timestamp`, `level`, `event`, `pid` and `instance_id`. Each service start
gets a new instance ID, so it separates restarts even when a PID is reused.
Other fields add task, turn, provider or tool context when available.

- Look for `service.starting`, `service.ready`, `service.draining`,
  `service.stopping` and `service.stopped` to identify startup and handoff stages.
  `service.recovered` and `service.drained` include durations. If startup
  fails before structured logging starts, check the terminal or `service.log`.
  A fatal exception also writes a `service.crashed` marker to stderr before
  Node's normal crash handling.
- Match a failed HTTP response's `X-Request-Id` to `request_id` in the logs.
  The service generates this ID and carries it through asynchronous tool
  handling. `http.request` records the method, a fixed route label, status,
  `duration_ms` and whether the connection aborted. Event streams log their
  full connection lifetime when they close.
- Inspect `tool.completed` for dispatch durations and outcomes. Validation
  and access rejections log at warning level with outcome `rejected`.
  Unexpected failures log at error level with outcome `failed`. Successful
  read-only tools log at debug level. These records describe the dispatch only.
  A worker's later outcome appears in the task records.
- Filter by `task_id` for `task.execution_started`, `task.execution_failed` and
  `task.execution_completed`. Completion includes the final status, duration
  and turn cost when available. Execution errors, store listener errors and edit
  capture failures include an error classification and stack frames.

### Missing or wrong credentials

`auth.rejected` records a reason and never the supplied credential:

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

The reason reflects what the request supplied. A request with both an
Authorization header and a cookie counts as `invalid_bearer`. The service logs
the first 20 rejections per minute. It counts the rest and reports them as
`auth.rejections_suppressed` when the next rejection starts a new window.
Individual HTTP 401 and 403 records log at debug level.

See [Admin token](configuration.md#admin-token) for token creation, overrides
and session lifetime. Never paste token values into a diagnostic report.

## Measure performance

`service.resources` samples service-process resources every 60 seconds:

- RSS, used heap and external memory in bytes.
- User and system CPU time in milliseconds since the previous sample.
- Event loop utilization and p99/max delay in milliseconds for the sample.
- The number of active tasks.

The samples cover the Node service process only. Worker subprocesses use
their own CPU and memory. A delayed event loop also delays the sample, so
intervals can exceed 60 seconds.

`provider.first_event` and `provider.first_text` measure time from SDK session
launch to the first SDK event and text delta. `provider.result` records result
subtype, error status, API duration, input/output and cache token counts, cost
and provider turn count. Use them to separate provider latency from service
overhead. They record no generated text. A missing result event can mean
execution ended before the provider returned a result.

`CODEX_SUBAGENT_EXTENSION_LOG_LEVEL` sets the threshold at service startup:

- `info`, the default, includes ordinary service and resource events.
- `debug` adds health requests, successful read-only tool dispatches and
  successful HTTP tool requests.
- `warn` or `error` drops lower-level events, including resource samples.

An invalid level stops the service from starting. Task timing ignores the
threshold.

### Task timing

`timing.jsonl` holds `task.timing` records. Each has `timestamp`, `phase` and
`duration_ms`, measured with a monotonic clock.

- `instance_id` matches `service.jsonl` records from the same service process.
- `request_id` appears when the record was written during an HTTP request.
- `outcome` is `success`, `error`, `timeout` or `aborted` for measured steps.
- Turn phases carry `task_id` and `turn`.

Records exclude message text and repository paths.

| Phase                   | Measures                                                                   | Specific fields                          |
| ----------------------- | -------------------------------------------------------------------------- | ---------------------------------------- |
| `send_storage`          | Storing an accepted message                                                | `send_ref`                               |
| `repository_validation` | Checking the approved repository for a follow-up send or a turn            | `send_ref` for a send                    |
| `interrupt_shutdown`    | Stopping a running turn until its end is recorded                          |                                          |
| `scheduler_scan`        | One scheduling pass                                                        | `task_count`, `scanned_count`            |
| `queue_wait`            | Waiting to start the next turn                                             | See [queue waits](#queue-waits)          |
| `workspace_preparation` | Creating, recreating or reusing the workspace, including Git worktree work | `workspace_strategy`, `workspace_action` |
| `session_selection`     | Choosing to resume or start a session, then marking the turn running       | `session`, `new_session_reason`          |
| `prompt_assembly`       | Building the turn's prompt                                                 | `session`                                |
| `provider_run`          | The provider run, through its reply or failure                             | `input_wait_ms`                          |
| `input_wait`            | One permission or question request waiting for the user                    | `input_kind`, `queued_ms`                |
| `transport`             | A panel call, measured by the panel                                        | `operation`, `outcome`, `ui_timed_out`   |

`send_ref` is the first 16 hexadecimal digits of the SHA-256 hash of the send's
request ID. The service never records the ID itself. A retried send reuses its
ID, so the panel's `transport` record and the service's `send_storage` record
for one send share a `send_ref`. Callers can reuse a request ID on another task,
so join records on `instance_id`, `task_id` and `send_ref` together.

Scheduler scans report their work counts, so you can assess scan cost before
changing scheduling. An interrupt shutdown that has not settled has no record
yet. Phases nest inside HTTP, tool and execution durations, so do not add them
up as independent costs. `provider.first_event`, `provider.first_text` and HTTP
and tool durations stay in `service.jsonl`.

#### Queue waits

A queue wait starts when a task becomes ready for its next turn. `cause` is
`start`, `followup`, `queued_message`, `interrupt_send`, `resume` or `recovery`.
Messages queued behind a running turn and a paused queue are not timed until
the task becomes ready. The wait ends with `success` when its turn starts,
`error` when a dependency failed and `aborted` when the task was interrupted or
deleted.

- `capacity_ms` is the part of the wait when every execution slot was in use.
- `dependency_observation_span_ms` spans the first to the latest scheduler scan
  that found an unfinished dependency.
- `since_dependency_observed_ms` runs from that first scan to the end of the
  wait.

The scheduler stops scanning once every slot is in use, so a dependency can
finish or change between scans. The dependency fields are observations. They
can overlap `capacity_ms` and do not split the wait into causes.

Waits are tracked in memory. A `recovery` wait starts when the service starts,
and a wait still open at shutdown has no record.

#### User input

`input_wait.duration_ms` runs from showing a request until it is answered or
interrupted. `queued_ms` is the time the request waited behind an earlier
request from the same turn. The service shows one request at a time, so
`provider_run.input_wait_ms` sums the turn's waits without overlap.

A run's `duration_ms` minus `input_wait_ms` is the provider's elapsed time
outside user waits. It still includes network, model and tool waits, so it does
not measure active compute.

#### Panel calls

The panel measures message sends and interrupts and reports them through the
app-only `app_record_timing` tool.

- The panel batches records for up to five seconds, so `timestamp` marks when
  the service received them. A failed batch or a closed panel loses its records.
- The duration runs until the call settles, even after the panel stops waiting.
  `ui_timed_out` marks calls the panel stopped waiting for.
- A `transport` record includes `task_id` when the call names a task, and
  `send_ref` for a send. The panel sends the request ID and the service records
  only its hash.
- A `transport` record has no `request_id`, because the batch's HTTP request is
  a different call.

Transport duration includes service processing and bridge or HTTP overhead.
Compare it with service phases. Do not add it to them. The panel and service use
separate clocks, so compare durations across them and ignore timestamps.

The panel does not measure time to the first visible reply. It polls the
selected task for drafts, a later draft can't be matched reliably to a steer or
queued message, and rendering doesn't prove the screen was painted. Use
`provider.first_text` for provider response latency.

## Add diagnostics

Service-wide logging helpers live in `src/service/platform/logging`. Feature
code chooses its event names and metadata. Browser code must respect the runtime
boundaries in [Architecture](architecture.md#code-ownership).

| Helper                                | Use for                                                         |
| ------------------------------------- | --------------------------------------------------------------- |
| `logEvent(level, event, fields)`      | Stable event names with curated scalar metadata.                |
| `logError(event, error, fields)`      | Failures.                                                       |
| `withLogContext`                      | Bounded asynchronous correlation.                               |
| `measureTaskWait`, `recordTaskTiming` | Task timing, in `src/service/features/tasks/runtime/timing.ts`. |

- Start background task execution with `{ inherit: false }` so it drops the
  caller's request context.
- Measure durations with monotonic `performance.now()`.
- Log lifecycle transitions and summaries that explain a failure or measure
  useful work. Avoid logging every provider streaming delta.
- Timing helpers follow the same metadata rules and never change the measured
  operation's result or error.

Pass identifiers, statuses, counts and durations. Do not pass request bodies,
prompts, replies, tool arguments, credentials, repository contents or raw error
messages. As a backstop, the logger:

- redacts fields whose names suggest credentials or content, except numeric
  input, output and cache token counts
- removes configured admin and API credentials and bearer strings from text
- truncates string values

`logError` keeps the error type, a classification, a restricted error code, the
cause type and up to eight stack frames. It omits the message and cause text.
Categories include authentication, rate limit, abort, timeout, connection and
budget failures, with `unknown` as the fallback. They are for diagnosis only and
do not change error handling.

Stack frames can still contain local file paths, so review logs before sharing
them. Raw stdout and stderr and opt-in mention-search logs skip these redaction
rules.

Test meaningful failure paths with temporary data and log files. To exercise a
real service, use a separate data directory and free port as described in
[Local development](development.md#setup). Keep tokens out of test output and
leave any running service alone.
