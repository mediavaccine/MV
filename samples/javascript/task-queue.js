/**
 * A promise queue that runs at most `concurrency` tasks at a time.
 *
 * Useful whenever you have more work than a remote service (or your own
 * event loop) should handle at once: crawling pages, uploading files,
 * fanning out API calls.
 *
 *   const queue = new TaskQueue({ concurrency: 2 });
 *   const results = await Promise.all(urls.map((url) => queue.add(() => fetch(url))));
 */
class TaskQueue {
  #concurrency;
  #running = 0;
  #pending = [];
  #idleWaiters = [];

  constructor({ concurrency = 4 } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError('concurrency must be a positive integer');
    }
    this.#concurrency = concurrency;
  }

  /** Number of tasks currently executing. */
  get running() {
    return this.#running;
  }

  /** Number of tasks waiting for a free slot. */
  get pending() {
    return this.#pending.length;
  }

  /**
   * Queue `task` and resolve with its result once it has run.
   * Rejections propagate to the caller and do not stall the queue.
   */
  add(task) {
    if (typeof task !== 'function') {
      throw new TypeError('task must be a function');
    }
    return new Promise((resolve, reject) => {
      this.#pending.push({ task, resolve, reject });
      this.#drain();
    });
  }

  /** Resolve once every queued task has settled. */
  async onIdle() {
    if (this.#running === 0 && this.#pending.length === 0) return;
    await new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  #drain() {
    while (this.#running < this.#concurrency && this.#pending.length > 0) {
      const { task, resolve, reject } = this.#pending.shift();
      this.#running += 1;

      // Wrapping in Promise.resolve() lets `task` be sync or async, and
      // turns a synchronous throw into a rejection like any other failure.
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          this.#running -= 1;
          this.#drain();
          this.#settleIdle();
        });
    }
  }

  #settleIdle() {
    if (this.#running > 0 || this.#pending.length > 0) return;
    const waiters = this.#idleWaiters;
    this.#idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

/** Resolve after `ms` milliseconds. */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export { TaskQueue, delay };
