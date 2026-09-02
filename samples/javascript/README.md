# JavaScript sample — concurrency-limited task queue

`task-queue.js` runs at most N async tasks at a time. Reach for it when you
have more work than a remote service — or your own event loop — should handle
at once.

## Usage

```js
import { TaskQueue } from './task-queue.js';

const queue = new TaskQueue({ concurrency: 3 });

const pages = await Promise.all(
  urls.map((url) => queue.add(() => fetch(url).then((r) => r.text()))),
);
```

Fire-and-forget work, waiting for the whole batch at the end:

```js
for (const file of files) queue.add(() => upload(file));
await queue.onIdle();
```

## API

| Member | Description |
| --- | --- |
| `new TaskQueue({ concurrency = 4 })` | Throws `RangeError` unless `concurrency` is a positive integer. |
| `add(task)` | Queues `task` (sync or async) and resolves with its return value. Throws `TypeError` if `task` is not a function. |
| `onIdle()` | Resolves once nothing is running or pending. |
| `running` / `pending` | Live counts, handy for progress reporting. |

A task that throws or rejects settles only its own promise — the queue keeps
draining, and the slot is released either way.

## Tests

```bash
npm test    # node --test
```

No dependencies; the tests use the built-in `node:test` runner and require
Node 18 or newer.

## Points of interest

- `Promise.resolve().then(task)` means a synchronous `throw` inside a task
  becomes a rejection like any other failure, instead of escaping `add`.
- The slot is released in `finally`, so a failing task cannot deadlock the
  queue.
- `#drain` is called after every completion, which keeps the queue saturated
  without a polling loop.
