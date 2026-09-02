import assert from 'node:assert/strict';
import test from 'node:test';

import { TaskQueue, delay } from '../task-queue.js';

test('runs tasks and resolves with their values', async () => {
  const queue = new TaskQueue({ concurrency: 2 });
  const results = await Promise.all([1, 2, 3].map((n) => queue.add(() => n * 2)));
  assert.deepEqual(results, [2, 4, 6]);
});

test('never exceeds the concurrency limit', async () => {
  const queue = new TaskQueue({ concurrency: 2 });
  let active = 0;
  let peak = 0;

  const task = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await delay(5);
    active -= 1;
  };

  await Promise.all(Array.from({ length: 6 }, () => queue.add(task)));
  assert.equal(peak, 2);
});

test('preserves FIFO order when concurrency is 1', async () => {
  const queue = new TaskQueue({ concurrency: 1 });
  const order = [];
  await Promise.all(
    ['a', 'b', 'c'].map((id) =>
      queue.add(async () => {
        await delay(1);
        order.push(id);
      }),
    ),
  );
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('a failing task rejects its own promise without stalling the queue', async () => {
  const queue = new TaskQueue({ concurrency: 1 });
  const failure = queue.add(() => {
    throw new Error('boom');
  });

  await assert.rejects(failure, /boom/);
  assert.equal(await queue.add(() => 'still working'), 'still working');
});

test('exposes running and pending counts', async () => {
  const queue = new TaskQueue({ concurrency: 1 });
  const work = [queue.add(() => delay(5)), queue.add(() => delay(5))];

  assert.equal(queue.running, 1);
  assert.equal(queue.pending, 1);

  await Promise.all(work);
  assert.equal(queue.running, 0);
  assert.equal(queue.pending, 0);
});

test('onIdle waits for every queued task', async () => {
  const queue = new TaskQueue({ concurrency: 2 });
  let done = 0;

  for (let i = 0; i < 5; i += 1) {
    queue.add(async () => {
      await delay(2);
      done += 1;
    });
  }

  await queue.onIdle();
  assert.equal(done, 5);
});

test('onIdle resolves immediately for an empty queue', async () => {
  await new TaskQueue().onIdle();
});

test('rejects invalid construction and task arguments', () => {
  assert.throws(() => new TaskQueue({ concurrency: 0 }), RangeError);
  assert.throws(() => new TaskQueue().add('not a function'), TypeError);
});
