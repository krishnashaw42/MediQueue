import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join as joinPath } from "node:path";

import type {
  Board,
  Priority,
  QueueEvent,
  Service,
  Snapshot,
  Token,
  Tracking,
} from "./types";

const now = () => new Date().toISOString();

export class QueueError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

export class QueueStore {
  private db: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ":memory:") {
      mkdirSync(dirname(filename), { recursive: true });
    }

    this.db = new DatabaseSync(filename);

    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS services (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prefix TEXT NOT NULL,
        counter TEXT NOT NULL,
        defaultMinutes INTEGER NOT NULL,
        status TEXT NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 0,
        streak INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        mobile TEXT NOT NULL,
        serviceId TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        calledAt TEXT,
        completedAt TEXT,
        skippedAt TEXT,
        cancelledAt TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tokenId TEXT,
        message TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS one_active_per_service
      ON tokens(serviceId)
      WHERE status = 'called';
    `);

    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO services
      (id, name, prefix, counter, defaultMinutes, status, sequence, streak)
      VALUES (?, ?, ?, ?, ?, 'open', 0, 0)
    `);

    insert.run("opd", "Doctor OPD", "A", "Counter 01", 8);
    insert.run("pharmacy", "Pharmacy", "B", "Counter 02", 4);
    insert.run("priority", "Priority assistance", "P", "Counter 03", 6);
  }

  close() {
    this.db.close();
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");

    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private event(tokenId: string | null, message: string) {
    this.db
      .prepare(`
        INSERT INTO events (tokenId, message, createdAt)
        VALUES (?, ?, ?)
      `)
      .run(tokenId, message, now());
  }

  services(): Service[] {
    return this.db
      .prepare("SELECT * FROM services ORDER BY rowid")
      .all() as unknown as Service[];
  }

  tokens(): Token[] {
    return this.db
      .prepare("SELECT * FROM tokens ORDER BY createdAt, rowid")
      .all() as unknown as Token[];
  }

  private service(id: string): Service {
    const service = this.services().find((item) => item.id === id);

    if (!service) {
      throw new QueueError("Service not found.", 404);
    }

    return service;
  }

  private token(id: string): Token {
    const token = this.db
      .prepare("SELECT * FROM tokens WHERE id = ?")
      .get(id) as unknown as Token | undefined;

    if (!token) {
      throw new QueueError(
        "Token not found. Check your tracking link.",
        404,
      );
    }

    return token;
  }

  private masked(token: Token): Token {
    return {
      ...token,
      mobile: `••••••${token.mobile.slice(-4)}`,
    };
  }

  join(input: {
    name: string;
    mobile: string;
    serviceId: string;
    priority: string;
  }): Token {
    if (
      typeof input.name !== "string" ||
      input.name.trim().length < 2 ||
      input.name.trim().length > 80
    ) {
      throw new QueueError("Enter a name between 2 and 80 characters.", 400);
    }

    if (
      typeof input.mobile !== "string" ||
      !/^\+?[0-9]{10,15}$/.test(input.mobile)
    ) {
      throw new QueueError("Enter a mobile number containing 10–15 digits.", 400);
    }

    const allowed = [
      "general",
      "senior",
      "pregnant",
      "disability",
      "urgent",
    ];

    if (!allowed.includes(input.priority)) {
      throw new QueueError("Choose a valid visitor category.", 400);
    }

    if (
      input.serviceId === "priority" &&
      input.priority === "general"
    ) {
      throw new QueueError(
        "Select an assistance category for the priority service.",
        400,
      );
    }

    return this.transaction(() => {
      const service = this.service(input.serviceId);

      if (service.status !== "open") {
        throw new QueueError(
          `${service.name} is ${service.status}. Please contact the help desk.`,
        );
      }

      const id = randomUUID();
      const number =
        `${service.prefix}-` +
        String(service.sequence + 1).padStart(3, "0");

      this.db
        .prepare("UPDATE services SET sequence = sequence + 1 WHERE id = ?")
        .run(service.id);

      this.db
        .prepare(`
          INSERT INTO tokens
          (id, number, name, mobile, serviceId, priority, status, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?)
        `)
        .run(
          id,
          number,
          input.name.trim(),
          input.mobile,
          service.id,
          input.priority,
          now(),
        );

      this.event(id, `${number} joined ${service.name}`);

      return this.masked(this.token(id));
    });
  }

  waiting(serviceId: string): Token[] {
    const service = this.service(serviceId);

    const waiting = this.tokens().filter(
      (token) =>
        token.serviceId === serviceId &&
        token.status === "waiting",
    );

    const urgent = waiting.filter((token) => token.priority === "urgent");
    const general = waiting.filter((token) => token.priority === "general");
    const priority = waiting.filter(
      (token) =>
        token.priority !== "general" &&
        token.priority !== "urgent",
    );

    const ordered = [...urgent];
    let streak = service.streak;

    while (general.length || priority.length) {
      if (priority.length && (streak >= 2 || !general.length)) {
        ordered.push(priority.shift()!);
        streak = 0;
      } else {
        ordered.push(general.shift()!);
        streak = Math.min(2, streak + 1);
      }
    }

    return ordered;
  }

  action(
    serviceId: string,
    action: string,
    expectedTokenId?: string,
  ): Token {
    return this.transaction(() => {
      const service = this.service(serviceId);

      const current = this.tokens().find(
        (token) =>
          token.serviceId === serviceId &&
          token.status === "called",
      );

      if (action === "next") {
        if (current) {
          throw new QueueError(
            "Complete the current token or mark it as a no-show first.",
          );
        }

        if (service.status !== "open") {
          throw new QueueError(`The queue is ${service.status}.`);
        }

        const next = this.waiting(serviceId)[0];

        if (!next) {
          throw new QueueError("The queue is empty.");
        }

        this.db
          .prepare(`
            UPDATE tokens
            SET status = 'called', calledAt = ?
            WHERE id = ? AND status = 'waiting'
          `)
          .run(now(), next.id);

        if (next.priority !== "urgent") {
          const streak =
            next.priority === "general"
              ? Math.min(2, service.streak + 1)
              : 0;

          this.db
            .prepare("UPDATE services SET streak = ? WHERE id = ?")
            .run(streak, serviceId);
        }

        this.event(next.id, `${next.number} called to ${service.counter}`);

        return this.masked(this.token(next.id));
      }

      if (!current || current.id !== expectedTokenId) {
        throw new QueueError(
          "The active token changed. Refresh and try again.",
        );
      }

      if (action === "recall") {
        this.event(
          current.id,
          `${current.number} recalled to ${service.counter}`,
        );

        return this.masked(current);
      }

      if (action !== "complete" && action !== "missed") {
        throw new QueueError("Unknown counter action.", 400);
      }

      if (action === "complete") {
        this.db
          .prepare(`
            UPDATE tokens
            SET status = 'completed', completedAt = ?
            WHERE id = ? AND status = 'called'
          `)
          .run(now(), current.id);
      } else {
        this.db
          .prepare(`
            UPDATE tokens
            SET status = 'missed', skippedAt = ?
            WHERE id = ? AND status = 'called'
          `)
          .run(now(), current.id);
      }

      this.event(
        current.id,
        `${current.number} ${
          action === "complete" ? "completed" : "marked as no-show"
        }`,
      );

      return this.masked(this.token(current.id));
    });
  }

  cancel(id: string): Token {
    return this.transaction(() => {
      const token = this.token(id);

      if (token.status !== "waiting") {
        throw new QueueError("Only waiting tokens can be cancelled.");
      }

      this.db
        .prepare(`
          UPDATE tokens
          SET status = 'cancelled', cancelledAt = ?
          WHERE id = ?
        `)
        .run(now(), id);

      this.event(id, `${token.number} cancelled`);

      return this.masked(this.token(id));
    });
  }

  setService(id: string, status: string) {
    if (!["open", "paused", "closed"].includes(status)) {
      throw new QueueError("Invalid queue status.", 400);
    }

    return this.transaction(() => {
      const service = this.service(id);

      this.db
        .prepare("UPDATE services SET status = ? WHERE id = ?")
        .run(status, id);

      this.event(null, `${service.name} ${status}`);
      return this.service(id);
    });
  }

  average(serviceId: string): number {
    const recent = this.tokens()
      .filter(
        (token) =>
          token.serviceId === serviceId &&
          token.completedAt &&
          token.calledAt,
      )
      .sort(
        (a, b) =>
          Date.parse(a.completedAt!) - Date.parse(b.completedAt!),
      )
      .slice(-20);

    if (!recent.length) {
      return this.service(serviceId).defaultMinutes;
    }

    const total = recent.reduce(
      (sum, token) =>
        sum +
        (Date.parse(token.completedAt!) - Date.parse(token.calledAt!)) /
          60000,
      0,
    );

    return Math.max(1, Math.round(total / recent.length));
  }

  track(id: string): Tracking {
    const token = this.token(id);
    const service = this.service(token.serviceId);
    const waiting = this.waiting(service.id);

    const current = this.tokens().find(
      (item) =>
        item.serviceId === service.id &&
        item.status === "called",
    );

    const ahead = Math.max(
      0,
      waiting.findIndex((item) => item.id === id),
    );

    return {
      token: this.masked(token),
      service,
      current: current?.number ?? null,
      ahead,
      estimatedWait:
        token.status === "waiting"
          ? (ahead + (current ? 1 : 0)) * this.average(service.id)
          : 0,
      displayStatus:
        token.status === "waiting" && ahead <= 3
          ? "approaching"
          : token.status,
      updatedAt: now(),
    };
  }

  board(): Board {
    const tokens = this.tokens();

    return {
      services: this.services().map((service) => {
        const waiting = this.waiting(service.id);
        const current = tokens.find(
          (token) =>
            token.serviceId === service.id &&
            token.status === "called",
        );

        return {
          ...service,
          waiting: waiting.length,
          averageMinutes: this.average(service.id),
          current: current?.number ?? null,
          upcoming: waiting.slice(0, 3).map((token) => token.number),
        };
      }),
      updatedAt: now(),
    };
  }

  snapshot(): Snapshot {
    const tokens = this.tokens();
    const called = tokens.filter((token) => token.calledAt);

    const averageWait = called.length
      ? Math.round(
          called.reduce(
            (sum, token) =>
              sum +
              (Date.parse(token.calledAt!) - Date.parse(token.createdAt)) /
                60000,
            0,
          ) / called.length,
        )
      : 0;

    const completed = tokens.filter(
      (token) =>
        token.status === "completed" &&
        token.calledAt &&
        token.completedAt,
    );

    const averageService = completed.length
      ? Math.max(
          1,
          Math.round(
            completed.reduce(
              (sum, token) =>
                sum +
                (Date.parse(token.completedAt!) -
                  Date.parse(token.calledAt!)) /
                  60000,
              0,
            ) / completed.length,
          ),
        )
      : 0;

    return {
      services: this.board().services,
      tokens: tokens.map((token) => this.masked(token)),
      events: this.db
        .prepare("SELECT * FROM events ORDER BY id DESC LIMIT 15")
        .all() as unknown as QueueEvent[],
      metrics: {
        waiting: tokens.filter((token) => token.status === "waiting").length,
        completed: completed.length,
        missed: tokens.filter((token) => token.status === "missed").length,
        averageWait,
        averageService,
      },
      hours: Array.from({ length: 24 }, (_, hour) => ({
        label: String(hour).padStart(2, "0"),
        count: tokens.filter(
          (token) => new Date(token.createdAt).getHours() === hour,
        ).length,
      })),
      updatedAt: now(),
    };
  }

  reset() {
    this.transaction(() => {
      this.db.exec(`
        DELETE FROM events;
        DELETE FROM tokens;
        UPDATE services
        SET sequence = 0, streak = 0, status = 'open';
      `);
    });
  }
}

const globalQueue = globalThis as unknown as {
  mediqueue?: QueueStore;
};

export function getStore() {
  if (!globalQueue.mediqueue) {
    globalQueue.mediqueue = new QueueStore(
      process.env.DATABASE_PATH ||
        joinPath(process.cwd(), "data", "mediqueue.sqlite"),
    );
  }

  return globalQueue.mediqueue;
}