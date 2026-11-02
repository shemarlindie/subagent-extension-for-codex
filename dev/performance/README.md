# Performance logging probe

Compare local instrumentation overhead with:

```sh
node --import tsx dev/performance/logging.ts
```

Append `recorded-dev-plugin` or `synthetic-tally` to select one workload.
The probe prints measurements as JSON and removes its temporary logs and
in-memory databases. It makes no model calls.

Each workload runs one warmup per mode, then seven alternating baseline and
instrumented pairs:

- Recorded: the sanitized 681-event `dev-plugin` task.
- Synthetic: 19,800 tool events and 200 Chat messages.

Each run inserts the history, performs 200 task-list, Chat and latest Activity
reads, then decodes and groups the returned Activity tail 200 times. Baseline
runs bypass the new metrics while retaining the same queries, serialization,
decoding and grouping. Instrumented runs use info-level logs, the bounded
writers and one panel report flushed at the end of the sample.

| Field                 | Scope                                                                  |
| --------------------- | ---------------------------------------------------------------------- |
| `service_cpu_ms`      | Process CPU for insertion, reads and log flushes                       |
| `service_read_ms`     | Elapsed time for the read loop                                         |
| `panel_cpu_ms`        | Process CPU for decoding, grouping and report flushing                 |
| `panel_processing_ms` | Elapsed decoding and grouping time, excluding the flush                |
| `records`             | Records submitted to the writers                                       |
| `queue_peak_bytes`    | Largest pending queue in either writer, whose limit is 1,000,000 bytes |

Both phases run sequentially in Node. Results exclude transport, React,
browser paint and worker subprocesses. Compare repeated distributions and
absolute differences. Do not use these measurements as CI thresholds or
live-host latency estimates.

Query-plan inspection confirmed task-list scans and indexed event reads through
`events_task`, including covering indexes for Activity window lookups. These
checks add no queries to production paths.

## Local results

A macOS run with Node.js 24.21.0 on November 1, 2026 produced these medians
from seven pairs. Times cover all 200 polls or processing passes.

| Workload                 | Metric                   | Baseline ms | Instrumented ms |
| ------------------------ | ------------------------ | ----------: | --------------: |
| Recorded, 681 events     | Service CPU              |     357.308 |         355.467 |
| Recorded                 | Read elapsed             |     338.536 |         338.757 |
| Recorded                 | Panel processing CPU     |      66.708 |          69.268 |
| Recorded                 | Panel processing elapsed |      64.978 |          66.147 |
| Synthetic, 20,000 events | Service CPU              |     598.629 |         578.202 |
| Synthetic                | Read elapsed             |     341.531 |         339.095 |
| Synthetic                | Panel processing CPU     |      40.199 |          41.358 |
| Synthetic                | Panel processing elapsed |      27.920 |          28.080 |

Each instrumented run submitted six records and queued at most 1,367 bytes.
Baseline runs submitted none. Recorded panel elapsed time rose 1.169 ms across
200 passes, about 0.006 ms per pass. The service read and CPU distributions
overlapped between modes in both workloads.

Synthetic panel elapsed time ranged from 26.546 to 29.465 ms at baseline and
26.674 to 64.741 ms with instrumentation, including one high sample. The medians
show small local overhead, with enough variation to avoid broader latency claims.
