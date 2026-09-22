import test from "node:test";
import assert from "node:assert/strict";
import { QueueStore } from "../lib/queue";

function createQueue() {
  return new QueueStore(":memory:");
}

function add(
  queue: QueueStore,
  priority = "general",
  serviceId = "opd",
) {
  return queue.join({
    name: "Test Visitor",
    mobile: "9000000000",
    serviceId,
    priority,
  });
}

test("starts without sample patients", () => {
  const queue = createQueue();

  try {
    assert.equal(queue.tokens().length, 0);
    assert.equal(queue.snapshot().events.length, 0);
    assert.equal(queue.services().length, 3);
  } finally {
    queue.close();
  }
});

test("generates independent sequential service numbers", () => {
  const queue = createQueue();

  try {
    assert.equal(add(queue).number, "A-001");
    assert.equal(add(queue).number, "A-002");
    assert.equal(add(queue, "general", "pharmacy").number, "B-001");
  } finally {
    queue.close();
  }
});

test("general visitors follow FIFO", () => {
  const queue = createQueue();

  try {
    const first = add(queue);
    const second = add(queue);

    assert.deepEqual(
      queue.waiting("opd").map((token) => token.id),
      [first.id, second.id],
    );
  } finally {
    queue.close();
  }
});

test("two general visitors are followed by one priority visitor", () => {
  const queue = createQueue();

  try {
    const priority = add(queue, "senior");
    const first = add(queue);
    const second = add(queue);
    const third = add(queue);

    for (const expected of [first, second, priority, third]) {
      const called = queue.action("opd", "next");
      assert.equal(called.id, expected.id);
      queue.action("opd", "complete", called.id);
    }
  } finally {
    queue.close();
  }
});

test("urgent assistance moves to the front", () => {
  const queue = createQueue();

  try {
    add(queue);
    add(queue, "senior");
    const urgent = add(queue, "urgent");

    assert.equal(queue.action("opd", "next").id, urgent.id);
  } finally {
    queue.close();
  }
});

test("prevents repeated calls and duplicate completion", () => {
  const queue = createQueue();

  try {
    const token = add(queue);
    queue.action("opd", "next");

    assert.throws(() => queue.action("opd", "next"));

    const completed = queue.action("opd", "complete", token.id);

    assert.equal(completed.status, "completed");
    assert.ok(completed.completedAt);

    assert.throws(() =>
      queue.action("opd", "complete", token.id),
    );
  } finally {
    queue.close();
  }
});

test("recall and no-show retain history", () => {
  const queue = createQueue();

  try {
    const token = add(queue);
    queue.action("opd", "next");
    queue.action("opd", "recall", token.id);

    const missed = queue.action("opd", "missed", token.id);

    assert.equal(missed.status, "missed");
    assert.ok(missed.skippedAt);
    assert.ok(
      queue.snapshot().events.some((event) =>
        event.message.includes("recalled"),
      ),
    );
  } finally {
    queue.close();
  }
});

test("wait estimate includes the active visitor", () => {
  const queue = createQueue();

  try {
    const first = add(queue);
    const second = add(queue);

    assert.equal(queue.track(second.id).estimatedWait, 8);

    queue.action("opd", "next");

    assert.equal(queue.track(second.id).ahead, 0);
    assert.equal(queue.track(second.id).estimatedWait, 8);

    queue.action("opd", "complete", first.id);

    assert.equal(queue.track(second.id).estimatedWait, 0);
  } finally {
    queue.close();
  }
});

test("cancelled tokens remain recorded", () => {
  const queue = createQueue();

  try {
    const token = add(queue);

    assert.equal(queue.cancel(token.id).status, "cancelled");
    assert.ok(queue.track(token.id).token.cancelledAt);
    assert.throws(() => queue.cancel(token.id));
  } finally {
    queue.close();
  }
});

test("paused and closed queues reject check-in and next calls", () => {
  const queue = createQueue();

  try {
    add(queue);

    queue.setService("opd", "paused");
    assert.throws(() => add(queue));
    assert.throws(() => queue.action("opd", "next"));

    queue.setService("opd", "closed");
    assert.throws(() => add(queue));

    queue.setService("opd", "open");
    assert.equal(queue.action("opd", "next").status, "called");
  } finally {
    queue.close();
  }
});

test("public board contains no patient names or phone numbers", () => {
  const queue = createQueue();

  try {
    add(queue);

    const board = JSON.stringify(queue.board());

    assert.equal(board.includes("Test Visitor"), false);
    assert.equal(board.includes("9000000000"), false);
    assert.equal(board.includes('"mobile"'), false);
  } finally {
    queue.close();
  }
});

test("empty queues and unknown tracking IDs return errors", () => {
  const queue = createQueue();

  try {
    assert.throws(() => queue.action("opd", "next"), /empty/);
    assert.throws(() => queue.track("unknown"), /not found/);
  } finally {
    queue.close();
  }
});