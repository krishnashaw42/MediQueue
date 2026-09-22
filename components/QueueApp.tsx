"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  priorityLabels,
  type Board,
  type Priority,
  type Snapshot,
  type Token,
  type Tracking,
} from "../lib/types";

const hospital = "ILS Hospital";

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "The operation failed.");
  }

  return result;
}

function useLive<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;

    try {
      const response = await fetch(url, { cache: "no-store" });
      const result = await response.json();

      if (version !== requestVersion.current) return;

      if (!response.ok) {
        if (response.status === 404) setData(null);
        throw new Error(result.error || "Unable to load the queue.");
      }

      setData(result);
      setError("");
    } catch (error) {
      if (version !== requestVersion.current) return;

      setError(
        error instanceof Error
          ? error.message
          : "Connection failed. Please refresh.",
      );
    }
  }, [url]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 4000);

    return () => {
      requestVersion.current++;
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [refresh]);

  return { data, error, refresh };
}

function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      {status === "missed"
        ? "No-show"
        : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      {message}
    </div>
  ) : null;
}

function Title({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-title">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="card stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Updated({ time }: { time: string }) {
  return (
    <small className="updated">
      Updated{" "}
      {new Date(time).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })}
      {" · "}Refreshes every 4 seconds
    </small>
  );
}

const navigation = [
  ["/", "Overview"],
  ["/check-in", "Join a queue"],
  ["/track", "Track my token"],
  ["/display", "Public display"],
  ["/staff", "Staff dashboard"],
  ["/admin", "Administration"],
];

export default function QueueApp() {
  const pathname = usePathname();

  if (pathname === "/display") {
    return <PublicBoard />;
  }

  let page: ReactNode;

  if (pathname === "/check-in") page = <CheckIn />;
  else if (pathname === "/staff") page = <Staff />;
  else if (pathname === "/admin") page = <Admin />;
  else if (pathname === "/track") page = <FindToken />;
  else if (pathname.startsWith("/track/")) {
    page = <Tracker key={pathname} id={pathname.split("/")[2]} />;
  } else {
    page = <Home />;
  }

  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>

      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-icon">+</span>
          Medi<span>Queue</span>
        </Link>

        <p className="nav-caption">HOSPITAL SERVICES</p>

        <nav aria-label="Main navigation">
          {navigation.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={
                pathname === href ||
                (href === "/track" && pathname.startsWith("/track/"))
                  ? "active"
                  : ""
              }
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-note">
          <strong>A little less waiting.</strong>
          <p>A little more peace of mind.</p>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <strong>{hospital}</strong>
            <small>Outpatient and pharmacy services</small>
          </div>
          
        </header>

        <main id="main">{page}</main>

        <footer>
          MediQueue · Local prototype · Notifications are simulated
        </footer>
      </div>
    </div>
  );
}

function Home() {
  const { data, error } = useLive<Board>("/api/queue?view=board");

  return (
    <>
      <Title eyebrow="WELCOME TO MEDIQUEUE" title="Your care. Without the queue.">
        A simpler, calmer hospital visit starts here.
      </Title>

      <section className="hero">
        <div>
          <span className="eyebrow">YOUR TIME MATTERS</span>
          <h2>
            Take a token.
            <br />
            Take a seat.
            <br />
            <span>We’ll keep your place.</span>
          </h2>
          <p>
            Join your hospital queue, follow your turn, and wait comfortably.
          </p>
          <div className="actions">
            <Link className="button" href="/check-in">
              Join a queue →
            </Link>
            <Link className="button secondary" href="/track">
              Track existing token
            </Link>
          </div>
        </div>

        <div className="illustration" aria-label="Illustrative sample token">
          <small>ILLUSTRATION</small>
          <p>MediQueue</p>
          <strong>A-001</strong>
          <span>Your visit, made simple.</span>
        </div>
      </section>

      <ErrorBox message={error} />

      <h2 className="section-heading">Choose your service</h2>

      <div className="service-grid">
        {data?.services.map((service) => (
          <article className="card service-card" key={service.id}>
            <div className="row">
              <h3>{service.name}</h3>
              <Badge status={service.status} />
            </div>

            <p>{service.counter} · Ground floor</p>

            <div className="service-numbers">
              <strong>{service.waiting}</strong>
              <span>visitors waiting</span>
            </div>

            <p>Approximately {service.averageMinutes} minutes per visit</p>

            <Link
              className="button secondary"
              href={`/check-in?service=${service.id}`}
            >
              Join this queue →
            </Link>
          </article>
        ))}
      </div>

      <section className="card how">
        <h2>A better visit in three steps</h2>
        <div className="three-columns">
          <div>
            <span className="step-number">1</span>
            <h3>Check in</h3>
            <p>Select your service and receive a token.</p>
          </div>
          <div>
            <span className="step-number">2</span>
            <h3>Stay informed</h3>
            <p>Follow your queue position and estimated wait.</p>
          </div>
          <div>
            <span className="step-number">3</span>
            <h3>Visit your counter</h3>
            <p>Proceed when your token is called.</p>
          </div>
        </div>
      </section>

      <div className="actions">
        <Link className="button secondary" href="/display">
          Open public display
        </Link>
        <Link className="button secondary" href="/staff">
          Staff dashboard
        </Link>
        <Link className="button secondary" href="/admin">
          Admin dashboard
        </Link>
      </div>
    </>
  );
}

function CheckIn() {
  const { data, error } = useLive<Board>("/api/queue?view=board");

  const [serviceId, setServiceId] = useState("opd");
  const [priority, setPriority] = useState<Priority>("general");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [token, setToken] = useState<Token | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const value = new URLSearchParams(window.location.search).get("service");

      if (value && ["opd", "pharmacy", "priority"].includes(value)) {
        setServiceId(value);
        if (value === "priority") setPriority("senior");
      }
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFailure("");

    try {
      const created = await post({
        action: "join",
        name,
        mobile,
        serviceId,
        priority,
      });

      setToken(created);

      try {
        localStorage.setItem("mediqueue-last-token", created.id);
      } catch {
        // Tracking still works when browser storage is unavailable.
      }
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Unable to check in.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (token) {
    return (
      <section className="card confirmation">
        <span className="eyebrow">YOU’RE CHECKED IN</span>
        <h1>Your place is reserved.</h1>
        <div className="big-token">{token.number}</div>
        <Badge status="waiting" />
        <p>Save this link to follow your visit.</p>

        <Link className="button" href={`/track/${token.id}`}>
          Track my token →
        </Link>

        <label>
          Private tracking link
          <input
            readOnly
            value={`${window.location.origin}/track/${token.id}`}
            onFocus={(event) => event.target.select()}
          />
        </label>
      </section>
    );
  }

  return (
    <>
      <Title eyebrow="PATIENT CHECK-IN" title="Let’s save your place.">
        Select a service and enter your details.
      </Title>

      <ErrorBox message={error} />

      <form className="card check-in" onSubmit={submit}>
        <h2>1. Choose a service</h2>

        <div className="service-options">
          {data?.services.map((service) => (
            <button
              key={service.id}
              type="button"
              aria-pressed={serviceId === service.id}
              disabled={service.status !== "open"}
              className={serviceId === service.id ? "selected" : ""}
              onClick={() => {
                setServiceId(service.id);
                setPriority(service.id === "priority" ? "senior" : "general");
              }}
            >
              <strong>{service.name}</strong>
              <span>
                {service.status === "open"
                  ? `${service.waiting} waiting`
                  : service.status}
              </span>
            </button>
          ))}
        </div>

        <h2>2. Your details</h2>

        <div className="two-columns">
          <label>
            Full name
            <input
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              minLength={2}
              maxLength={80}
              required
              placeholder="Enter your name"
            />
          </label>

          <label>
            Mobile number
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={mobile}
              onChange={(event) => setMobile(event.target.value)}
              pattern="\+?[0-9]{10,15}"
              title="Enter 10–15 digits, optionally starting with +"
              required
              placeholder="Enter your mobile number"
            />
          </label>
        </div>

        <h2>3. Visitor category</h2>

        <label>
          General or priority assistance
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as Priority)}
          >
            {Object.entries(priorityLabels)
              .filter(([value]) => serviceId !== "priority" || value !== "general")
              .map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
          </select>
        </label>

        {priority === "urgent" && (
          <div className="notice">
            For a medical emergency, contact hospital staff immediately.
            This queue does not replace emergency triage.
          </div>
        )}

        <ErrorBox message={failure} />

        <button
          className="button full-width"
          disabled={
            busy ||
            !data ||
            data.services.find((service) => service.id === serviceId)?.status !==
              "open"
          }
        >
          {busy ? "Creating token…" : "Get my token →"}
        </button>

        <p className="fine-print">
          No SMS is sent. Public displays show token numbers only.
        </p>
      </form>
    </>
  );
}

function FindToken() {
  const router = useRouter();

  const [value, setValue] = useState("");
  const [last, setLast] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setLast(localStorage.getItem("mediqueue-last-token") || "");
      } catch {
        // Manual tracking works without localStorage.
      }
    }, 0);

    return () => clearTimeout(timer);
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();

    const id = value.trim().split("/track/").pop()?.split(/[?#]/)[0];

    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      setError("Enter the tracking link or unique ID from your confirmation.");
      return;
    }

    router.push(`/track/${id}`);
  }

  return (
    <>
      <Title eyebrow="YOUR VISIT" title="Track your token.">
        Use the private link or unique ID from your confirmation.
      </Title>

      <form className="card narrow" onSubmit={submit}>
        <label>
          Tracking link or unique ID
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
            placeholder="Paste your tracking link"
          />
        </label>

        <ErrorBox message={error} />

        <button className="button">Find token →</button>

        {last && (
          <Link className="text-link" href={`/track/${last}`}>
            Open my last token
          </Link>
        )}
      </form>
    </>
  );
}

function Tracker({ id }: { id: string }) {
  const { data, error, refresh } = useLive<Tracking>(
    `/api/queue?token=${encodeURIComponent(id)}`,
  );

  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (!confirm("Cancel this token and leave the queue?")) return;

    setBusy(true);
    setFailure("");

    try {
      await post({ action: "cancel", tokenId: id });
      await refresh();
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Cancellation failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="row">
        <Title eyebrow="LIVE TRACKING" title="Your visit, at a glance.">
          {hospital}
        </Title>

        <button className="button secondary" onClick={refresh}>
          Refresh
        </button>
      </div>

      <ErrorBox message={error || failure} />

      {!data ? (
        error ? (
          <Link href="/track" className="button">
            Try another tracking link
          </Link>
        ) : (
          <p>Loading your token…</p>
        )
      ) : (
        <>
          <div className="tracker-grid">
            <section className="card token-card">
              <span className="eyebrow">{data.service.name}</span>
              <div className="big-token">{data.token.number}</div>
              <Badge status={data.displayStatus} />

              <p>
                {data.token.name} · {data.token.mobile}
              </p>

              <strong>{data.service.counter} · Ground floor</strong>
            </section>

            <section>
              {["approaching", "called"].includes(data.displayStatus) && (
                <div className="notification" role="status" aria-live="polite">
                  <small>IN-APP NOTIFICATION · DEMO</small>
                  <h2>
                    {data.displayStatus === "called"
                      ? "It’s your turn!"
                      : "Your turn is getting closer."}
                  </h2>
                  <p>
                    {data.displayStatus === "called"
                      ? `Please proceed to ${data.service.counter}.`
                      : `${data.ahead} visitors ahead. Please stay nearby.`}
                  </p>
                </div>
              )}

              {data.service.status !== "open" &&
                data.token.status === "waiting" && (
                  <div className="notice">
                    This queue is {data.service.status}. Estimates do not
                    include the interruption.
                  </div>
                )}

              <div className="two-columns">
                <Stat
                  label="Visitors ahead"
                  value={
                    data.token.status === "waiting" ? data.ahead : "—"
                  }
                />
                <Stat
                  label="Estimated wait"
                  value={`${data.estimatedWait} min`}
                />
              </div>

              <div className="card">
                <span className="eyebrow">CURRENTLY SERVING</span>
                <h2>{data.current || "No active token"}</h2>
                <p>Waiting time is an estimate and may change.</p>
              </div>
            </section>
          </div>

          <section className="card">
            <h2>Your visit journey</h2>

            <div className="journey">
              {["Checked in", "Waiting", "Called", "Completed"].map(
                (label, index) => {
                  const stage =
                    data.token.status === "completed"
                      ? 3
                      : data.token.status === "called"
                        ? 2
                        : 1;

                  return (
                    <div
                      key={label}
                      className={index <= stage ? "reached" : ""}
                    >
                      <span>{index + 1}</span>
                      <strong>{label}</strong>
                    </div>
                  );
                },
              )}
            </div>

            {["missed", "cancelled"].includes(data.token.status) && (
              <div className="notice">
                This token is {data.token.status}.{" "}
                <Link href="/check-in">Join again if needed.</Link>
              </div>
            )}

            <div className="row">
              <Updated time={data.updatedAt} />

              {data.token.status === "waiting" && (
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={cancel}
                >
                  {busy ? "Cancelling…" : "Cancel token"}
                </button>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function Staff() {
  const { data, error, refresh } = useLive<Snapshot>("/api/queue");

  const [serviceId, setServiceId] = useState("opd");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [message, setMessage] = useState("");

  const service = data?.services.find((item) => item.id === serviceId);

  const current = data?.tokens.find(
    (token) =>
      token.serviceId === serviceId &&
      token.status === "called",
  );

  const waiting =
    data?.tokens.filter(
      (token) =>
        token.serviceId === serviceId &&
        token.status === "waiting",
    ) || [];

  const history =
    data?.tokens
      .filter(
        (token) =>
          token.serviceId === serviceId &&
          ["completed", "missed", "cancelled"].includes(token.status),
      )
      .sort((a, b) => {
        const aTime = a.completedAt || a.skippedAt || a.cancelledAt || a.createdAt;
        const bTime = b.completedAt || b.skippedAt || b.cancelledAt || b.createdAt;
        return Date.parse(bTime) - Date.parse(aTime);
      })
      .slice(0, 15) || [];

  async function act(operation: string) {
    if (
      operation === "missed" &&
      !confirm(`Mark ${current?.number} as a no-show?`)
    ) {
      return;
    }

    setBusy(true);
    setFailure("");
    setMessage("");

    try {
      const result = await post({
        action: "counter",
        serviceId,
        operation,
        tokenId: current?.id,
      });

      setMessage(
        operation === "recall"
          ? `${result.number} recalled. Audio announcements are not enabled.`
          : `${result.number}: ${
              operation === "next" ? "called" : result.status
            }.`,
      );

      await refresh();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Title eyebrow="DEMO ROLE · COUNTER STAFF" title="Keep care moving.">
        Select your counter and manage one visit at a time.
      </Title>

      <ErrorBox message={error || failure} />

      <label className="card">
        Service and counter
        <select
          value={serviceId}
          onChange={(event) => {
            setServiceId(event.target.value);
            setMessage("");
          }}
        >
          {data?.services.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name} · {item.counter}
            </option>
          ))}
        </select>
      </label>

      <div className="two-columns">
        <section className="card serving">
          <div className="row">
            <span className="eyebrow">NOW SERVING</span>
            <Badge status={service?.status || "open"} />
          </div>

          <div className="big-token">{current?.number || "—"}</div>
          <h2>{current?.name || "Ready for the next visitor"}</h2>
          <p>{current?.mobile || service?.counter}</p>

          <div className="control-grid">
            <button
              className="button"
              disabled={
                busy ||
                !!current ||
                waiting.length === 0 ||
                service?.status !== "open"
              }
              onClick={() => act("next")}
            >
              Call next
            </button>
            <button
              className="button complete"
              disabled={busy || !current}
              onClick={() => act("complete")}
            >
              Complete
            </button>
            <button
              className="button secondary"
              disabled={busy || !current}
              onClick={() => act("recall")}
            >
              Recall
            </button>
            <button
              className="button secondary"
              disabled={busy || !current}
              onClick={() => act("missed")}
            >
              No-show
            </button>
          </div>

          {message && (
            <div className="notice" role="status">
              {message}
            </div>
          )}

          <p className="fine-print">
            {waiting.length} waiting · Average service{" "}
            {service?.averageMinutes || "—"} min
          </p>
        </section>

        <section className="card">
          <h2>Waiting list</h2>
          <p className="fine-print">
            Listed by arrival. Call next applies priority ordering.
          </p>

          {waiting.length === 0 && (
            <div className="empty">No visitors waiting.</div>
          )}

          {waiting.map((token) => (
            <div className="waiting-row" key={token.id}>
              <strong className="small-token">{token.number}</strong>
              <div>
                <strong>{token.name}</strong>
                <small>{token.mobile}</small>
              </div>
              <span className="category">
                {priorityLabels[token.priority]}
              </span>
            </div>
          ))}
        </section>
      </div>

      <div className="notice">
        Priority rule: two general visitors, then one priority visitor.
        Urgent assistance goes first. Each group follows arrival order.
      </div>

      <section className="card">
        <h2>Queue history</h2>

        {history.length === 0 ? (
          <div className="empty">No completed or missed visits yet.</div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Visitor</th>
                  <th>Category</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((token) => (
                  <tr key={token.id}>
                    <td>{token.number}</td>
                    <td>{token.name}</td>
                    <td>{priorityLabels[token.priority]}</td>
                    <td>
                      <Badge status={token.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data && <Updated time={data.updatedAt} />}
    </>
  );
}

function Admin() {
  const { data, error, refresh } = useLive<Snapshot>("/api/queue");

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  async function change(body: Record<string, unknown>) {
    if (
      body.action === "reset" &&
      !confirm("Delete all local tokens and history? This cannot be undone.")
    ) {
      return;
    }

    if (
      body.status === "closed" &&
      !confirm("Close this queue to new check-ins and calls?")
    ) {
      return;
    }

    setBusy(true);
    setFailure("");

    try {
      await post(body);
      await refresh();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Title eyebrow="DEMO ROLE · ADMINISTRATOR" title="The bigger picture.">
        Local queue activity, service availability and counter status.
      </Title>

      <ErrorBox message={error || failure} />

      {!data ? (
        <p>Loading administration…</p>
      ) : (
        <>
          <div className="stats-grid">
            <Stat label="Waiting" value={data.metrics.waiting} />
            <Stat label="Completed" value={data.metrics.completed} />
            <Stat label="No-shows" value={data.metrics.missed} />
            <Stat
              label="Average wait"
              value={`${data.metrics.averageWait} min`}
            />
          </div>

          <p>
            {data.services.filter((service) => service.status === "open").length}
            {" "}open queues · Average completed service time:{" "}
            {data.metrics.averageService} min
          </p>

          <h2 className="section-heading">Service queues</h2>

          <div className="service-grid">
            {data.services.map((service) => (
              <section className="card" key={service.id}>
                <div className="row">
                  <h3>{service.name}</h3>
                  <Badge status={service.status} />
                </div>

                <p>{service.counter}</p>
                <h2>{service.waiting} waiting</h2>
                <p>Serving: {service.current || "Available"}</p>

                <label>
                  Queue availability
                  <select
                    disabled={busy}
                    value={service.status}
                    onChange={(event) =>
                      change({
                        action: "service",
                        serviceId: service.id,
                        status: event.target.value,
                      })
                    }
                  >
                    <option value="open">Open</option>
                    <option value="paused">Paused</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
              </section>
            ))}
          </div>

          <section className="card">
            <h2>Arrival patterns</h2>
            <p>Local check-ins grouped by hour across recorded dates.</p>

            <div
              className="chart"
              role="img"
              aria-label={data.hours
                .map((hour) => `${hour.label}:00: ${hour.count} arrivals`)
                .join(", ")}
            >
              {data.hours.map((hour) => (
                <div className="chart-column" key={hour.label}>
                  <span>{hour.count}</span>
                  <div
                    className="bar"
                    style={{
                      height: `${
                        3 +
                        (hour.count /
                          Math.max(1, ...data.hours.map((item) => item.count))) *
                          120
                      }px`,
                    }}
                  />
                  <small>{hour.label}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Recent activity</h2>

            {!data.events.length && (
              <div className="empty">
                Activity will appear after your first check-in.
              </div>
            )}

            {data.events.map((event) => (
              <div className="activity-row" key={event.id}>
                <span>{event.message}</span>
                <small>
                  {new Date(event.createdAt).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </div>
            ))}
          </section>

          <section className="card row">
            <div>
              <h3>Start with empty queues</h3>
              <p>Clear local records. No sample patients will be added.</p>
            </div>

            <button
              className="button danger"
              disabled={busy}
              onClick={() =>
                change({ action: "reset", confirmation: "RESET" })
              }
            >
              Clear local queues
            </button>
          </section>

          <Updated time={data.updatedAt} />
        </>
      )}
    </>
  );
}

function PublicBoard() {
  const { data, error } = useLive<Board>("/api/queue?view=board");
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleString("en-IN"));
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);

    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="public-board">
      <header className="row">
        <div>
          <h2>MediQueue</h2>
          <p>{hospital}</p>
        </div>
        <time>{clock}</time>
      </header>

      <main>
        <Title eyebrow="LIVE QUEUE DISPLAY" title="We’re ready to see you.">
          Proceed to your counter when your token is called.
        </Title>

        <ErrorBox message={error} />

        <div className="board-grid">
          {data?.services.map((service) => (
            <section className="board-card" key={service.id}>
              <div className="row">
                <h2>{service.name}</h2>
                <Badge status={service.status} />
              </div>

              <p>{service.counter} · Ground floor</p>

              <div className="board-current">
                <span>NOW SERVING</span>
                <strong>{service.current || "—"}</strong>
              </div>

              <span className="eyebrow">UP NEXT</span>

              <div className="upcoming">
                {service.upcoming.length ? (
                  service.upcoming.map((number) => (
                    <strong key={number}>{number}</strong>
                  ))
                ) : (
                  <p>No visitors waiting</p>
                )}
              </div>

              <p>{service.waiting} visitors waiting</p>
            </section>
          ))}
        </div>

        <div className="board-message">
          Please keep your token ready. For assistance, contact the help desk.
        </div>
      </main>

      <footer className="row">
        <Link href="/">← Hospital home</Link>
        {data && <Updated time={data.updatedAt} />}
        <span>Token numbers only · Audio announcements not enabled</span>
      </footer>
    </div>
  );
}