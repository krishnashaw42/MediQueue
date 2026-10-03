"use client";

import Link from "next/link";
import PaymentSettings from "./PaymentSettings";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  Hospital,
  User,
  Service,
  Token,
  Order,
  SMS,
} from "../lib/v2/store";

type GatewayStatus = {
  connected: boolean;
  mode: string;
  webhooksConfigured: boolean;
};
type Me = {
  user: User | null;
  hospital: Hospital | null;
  gateway: GatewayStatus | null;
  smsConfigured: boolean;
};
type ServiceView = Service & {
  current: string | null;
  waiting: number;
  upcoming: string[];
  average: number;
};
type OrderView = Order & {
  hospitalName: string;
  serviceName: string;
  number: string | null;
  tokenStatus: string | null;
  smsStatus: string | null;
};
type Track = {
  id: string;
  number: string;
  status: string;
  hospital: string;
  service: string;
  serviceStatus: string;
  ahead: number;
  estimatedMinutes: number;
  current: string | null;
  createdAt: string;
};
const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    paise / 100,
  );
const date = (value: string) => new Date(value).toLocaleString("en-IN");
const labels: Record<string, string> = {
  general: "General",
  senior: "Senior citizen",
  pregnant: "Pregnancy assistance",
  disability: "Accessibility assistance",
};

async function api<T>(path: string, data?: unknown): Promise<T> {
  const role =
    typeof window === "undefined"
      ? null
      : sessionStorage.getItem("mediqueue-tab-role");
  const headers: Record<string, string> = {};
  if (role === "patient" || role === "hospital")
    headers["X-MediQueue-Role"] = role;
  if (data !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(`/api/v2/${path}`, {
    method: data === undefined ? "GET" : "POST",
    cache: "no-store",
    headers,
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "Request failed. Please retry.");
  return result as T;
}
function useLive<T>(path: string | null, interval = 5000) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((n) => n + 1), []);
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    setData(null);
    setError("");
    setLoading(true);
    if (!path) {
      setLoading(false);
      return;
    }
    async function load() {
      try {
        const d = await api<T>(path!);
        if (alive) {
          setData(d);
          setError("");
        }
      } catch (e) {
        if (alive) {
          setData(null);
          setError((e as Error).message);
        }
      } finally {
        if (alive) {
          setLoading(false);
          timer = setTimeout(load, interval);
        }
      }
    }
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [path, version, interval]);
  return { data, error, loading, refresh };
}
function Badge({ children }: { children: ReactNode }) {
  return (
    <span className={`badge ${typeof children === "string" ? children : ""}`}>
      {children}
    </span>
  );
}
function Heading({
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
function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      {message}
    </div>
  ) : null;
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
function Field({
  label,
  name,
  type = "text",
  value,
  required = true,
  minLength,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  value?: string;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        autoComplete={type === "password" ? "new-password" : undefined}
      />
    </label>
  );
}
function ActionForm({
  children,
  onSave,
  label = "Save changes",
  success = "Changes saved.",
}: {
  children: ReactNode;
  onSave: (data: Record<string, string>) => Promise<unknown>;
  label?: string;
  success?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await onSave(
        Object.fromEntries(new FormData(e.currentTarget)) as Record<
          string,
          string
        >,
      );
      setMessage(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form-stack">
      {children}
      <ErrorBox message={error} />
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? "Please wait…" : label}
      </button>
    </form>
  );
}

export default function QueueApp() {
  const path = usePathname(),
    router = useRouter(),
    me = useLive<Me>("me", 30000);
  const directory = useLive<{ hospitals: Hospital[] }>("hospitals", 30000);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    setSelected(localStorage.getItem("mq-hospital") || "");
  }, []);
  const user = me.data?.user || null;
  const hospitals = directory.data?.hospitals || [];
  const hospitalId =
    user?.hospitalId ||
    (hospitals.some((h) => h.id === selected)
      ? selected
      : hospitals[0]?.id || "");
  const hospital =
    me.data?.hospital || hospitals.find((h) => h.id === hospitalId);
  const services = useLive<{ services: ServiceView[]; gateway: GatewayStatus }>(
    hospitalId ? `services?hospital=${hospitalId}` : null,
  );
  const isAuth = /^\/(login|signup)\/(user|hospital)$/.test(path);
  async function logout() {
    await api("logout", {});
    me.refresh();
    router.push("/");
  }
  const nav =
    user?.role === "hospital"
      ? [
          ["/", "Overview"],
          ["/staff", "Manage queue"],
          ["/insights", "Insights"],
          ["/admin", "Services & prices"],
          ["/payments", "Payments"],
          ["/display", "Public display"],
          ["/account", "Account centre"],
          ["/login/user", "Patient sign in"],
        ]
      : [
          ["/", "Overview"],
          ["/check-in", "Book a token"],
          ["/track", "Track my token"],
          ...(user
            ? [
                ["/tokens", "My tokens & payments"],
                ["/account", "Account centre"],
              ]
            : [
                ["/login/user", "Patient sign in"],
                ["/login/hospital", "Hospital sign in"],
              ]),
        ];
  let content: ReactNode;
  if (isAuth)
    content = (
      <Auth
        key={path}
        role={path.endsWith("hospital") ? "hospital" : "patient"}
        signup={path.startsWith("/signup")}
        done={() => {
          me.refresh();
          router.push("/account");
        }}
      />
    );
  else if (path.startsWith("/track/"))
    content = <Tracker id={path.split("/")[2]} />;
  else if (path === "/track") content = <FindToken />;
  else if (me.loading) content = <Empty>Loading your account…</Empty>;
  else if (me.error) content = <ErrorBox message={me.error} />;
  else if (path === "/account")
    content = user ? (
      <Account me={me.data!} refresh={me.refresh} />
    ) : (
      <SignInGate />
    );
  else if (
    ["/staff", "/insights", "/admin", "/payments"].includes(path) &&
    user?.role !== "hospital"
  )
    content = <SignInGate hospital />;
  else if (path === "/staff") content = <Dashboard />;
  else if (path === "/insights") content = <Insights />;
  else if (path === "/admin")
    content = (
      <Services
        services={services.data?.services || []}
        refresh={services.refresh}
      />
    );
  else if (path === "/payments") content = <Orders hospital />;
  else if (path === "/tokens")
    content = user?.role === "patient" ? <Orders /> : <SignInGate />;
  else if (path === "/check-in")
    content =
      user?.role === "patient" ? (
        <Booking
          key={hospitalId}
          user={user}
          services={services.data?.services || []}
          gateway={services.data?.gateway}
          hospital={hospital}
        />
      ) : (
        <SignInGate />
      );
  else if (path === "/display")
    content = (
      <PublicDisplay
        hospital={hospital}
        services={services.data?.services || []}
      />
    );
  else
    content = (
      <Home
        user={user}
        hospital={hospital}
        services={services.data?.services || []}
      />
    );
  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-icon">+</span>Medi<span>Queue</span>
        </Link>
        <p className="nav-caption">
          {user?.role === "hospital"
            ? "HOSPITAL WORKSPACE"
            : "YOUR HOSPITAL VISIT"}
        </p>
        <nav>
          {nav.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={path === href ? "active" : ""}
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
            <strong>{hospital?.name || "Welcome to MediQueue"}</strong>
            <small>
              {user?.role === "hospital"
                ? "Hospital account"
                : "Book, pay and follow your turn"}
            </small>
          </div>
          <div className="topbar-actions">
            {user?.role !== "hospital" && hospitals.length > 0 && (
              <select
                name="hospital"
                aria-label="Choose hospital"
                value={hospitalId}
                onChange={(e) => {
                  setSelected(e.target.value);
                  localStorage.setItem("mq-hospital", e.target.value);
                }}
              >
                {hospitals.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            )}
            {user ? (
              <>
                <Link
                  className="avatar"
                  href="/account"
                  aria-label="Account centre"
                >
                  {user.name.slice(0, 1).toUpperCase()}
                </Link>
                <button
                  className="button secondary compact"
                  onClick={() =>
                    void logout().catch((e) => window.alert(e.message))
                  }
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link className="button compact" href="/login/user">
                Sign in
              </Link>
            )}
          </div>
        </header>
        <main id="main">
          <ErrorBox message={directory.error || services.error} />
          {content}
        </main>
        <footer>MediQueue · Your visit, made simple.</footer>
      </div>
    </div>
  );
}
function SignInGate({ hospital = false }: { hospital?: boolean }) {
  return (
    <section className="card narrow">
      <Heading
        eyebrow={hospital ? "Hospital access" : "Your account"}
        title={
          hospital
            ? "Sign in to manage your hospital."
            : "Sign in to book and manage tokens."
        }
      />
      <p>
        {hospital
          ? "Queue controls, payments and hospital settings are available to hospital accounts."
          : "Keep your tokens, receipts and profile together."}
      </p>
      <Link
        className="button"
        href={`/login/${hospital ? "hospital" : "user"}`}
      >
        Continue to sign in
      </Link>
    </section>
  );
}
function Auth({
  role,
  signup,
  done,
}: {
  role: "patient" | "hospital";
  signup: boolean;
  done: () => void;
}) {
  const suffix = role === "hospital" ? "hospital" : "user";
  return (
    <div className="auth-grid">
      <section className="auth-story">
        <span className="eyebrow">
          {role === "hospital" ? "FOR HOSPITALS" : "FOR PATIENTS"}
        </span>
        <h1>
          {role === "hospital"
            ? "More care. Less crowding."
            : "Your care, on your time."}
        </h1>
        <p>
          {role === "hospital"
            ? "Manage your queues, set token prices and give every visitor a clearer journey."
            : "Book a token, pay securely and see when your turn is approaching."}
        </p>
        <div className="auth-steps">
          <p>01 · Your own account</p>
          <p>02 · One place for every visit</p>
          <p>03 · A clearer hospital experience</p>
        </div>
      </section>
      <section className="card auth-form">
        <div className="tabs">
          <Link
            href={`/${signup ? "signup" : "login"}/user`}
            className={role === "patient" ? "active" : ""}
          >
            Patient
          </Link>
          <Link
            href={`/${signup ? "signup" : "login"}/hospital`}
            className={role === "hospital" ? "active" : ""}
          >
            Hospital
          </Link>
        </div>
        <h2>{signup ? "Create your account" : "Welcome back"}</h2>
        <p>
          {role === "hospital"
            ? "For the person managing the hospital."
            : "Your next visit starts here."}
        </p>
        <ActionForm
          label={signup ? "Create account" : "Sign in"}
          success=""
          onSave={async (d) => {
            await api(signup ? "register" : "login", { ...d, role });
            sessionStorage.setItem("mediqueue-tab-role", role);
            done();
          }}
        >
          {signup && (
            <>
              <Field label="Your full name" name="name" minLength={2} />
              <Field
                label="Mobile number"
                name="mobile"
                type="tel"
                placeholder="+919876543210"
              />
              {role === "hospital" && (
                <Field
                  label="Hospital name"
                  name="hospitalName"
                  minLength={2}
                />
              )}
            </>
          )}
          <Field label="Email address" name="email" type="email" />
          <Field
            label="Password"
            name="password"
            type="password"
            minLength={signup ? 12 : 1}
          />
          {signup && (
            <small>
              Use at least 12 characters. Email and phone verification are not
              included in this experimental version.
            </small>
          )}
        </ActionForm>
        <p className="auth-switch">
          {signup ? "Already registered?" : "New to MediQueue?"}{" "}
          <Link href={`/${signup ? "login" : "signup"}/${suffix}`}>
            {signup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </section>
    </div>
  );
}
function Home({
  user,
  hospital,
  services,
}: {
  user: User | null;
  hospital?: Hospital;
  services: ServiceView[];
}) {
  return (
    <>
      <Heading
        eyebrow="Welcome to MediQueue"
        title={
          user
            ? `Hello, ${user.name.split(" ")[0]}.`
            : "Your care. Without the queue."
        }
      >
        A simpler, calmer hospital visit starts here.
      </Heading>
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
            {user?.role === "hospital"
              ? "Your hospital, your services, your queue."
              : "Choose your hospital, book a token and follow your turn."}
          </p>
          <div className="actions">
            <Link
              className="button"
              href={user?.role === "hospital" ? "/staff" : "/check-in"}
            >
              {user?.role === "hospital" ? "Manage queue" : "Book a token"} →
            </Link>
            <Link className="button secondary" href="/track">
              Track existing token
            </Link>
          </div>
        </div>
        <div className="illustration">
          <small>ILLUSTRATION</small>
          <p>MediQueue</p>
          <strong>A-001</strong>
          <span>Your visit, made simple.</span>
        </div>
      </section>
      <h2 className="section-heading">
        {hospital ? `${hospital.name} · services` : "Find your hospital"}
      </h2>
      {!services.length && (
        <section className="card">
          <Empty>No hospital services are available yet.</Empty>
          {!user && (
            <Link className="text-link" href="/signup/hospital">
              Register a hospital
            </Link>
          )}
        </section>
      )}
      <div className="service-grid">
        {services.map((s) => (
          <section className="card service-card" key={s.id}>
            <div className="row">
              <h3>{s.name}</h3>
              <Badge>{s.status}</Badge>
            </div>
            <div className="service-numbers">
              <strong>{s.waiting}</strong>
              <span>people waiting</span>
            </div>
            <p>Typical service time · {s.average} min</p>
            <p>{s.price ? money(s.price) : "Price not set"}</p>
            <Link
              className="button secondary"
              href={user?.role === "hospital" ? "/admin" : "/check-in"}
            >
              {user?.role === "hospital" ? "Manage service" : "Choose service"}
            </Link>
          </section>
        ))}
      </div>
    </>
  );
}

type CheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  order_id: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
  theme: { color: string };
  handler: (r: {
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) => void;
  modal: { ondismiss: () => void };
};
declare global {
  interface Window {
    Razorpay?: new (options: CheckoutOptions) => {
      open: () => void;
      on: (event: string, fn: () => void) => void;
    };
  }
}
let scriptPromise: Promise<void> | null = null;
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    const timeout = setTimeout(() => {
      script.remove();
      scriptPromise = null;
      reject(new Error("Payment checkout timed out. Please retry."));
    }, 15000);
    script.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timeout);
      script.remove();
      scriptPromise = null;
      reject(
        new Error("Payment checkout could not load. Check your connection."),
      );
    };
    document.body.appendChild(script);
  });
  return scriptPromise;
}
function Booking({
  user,
  hospital,
  services,
  gateway,
}: {
  user: User;
  hospital?: Hospital;
  services: ServiceView[];
  gateway?: GatewayStatus;
}) {
  const router = useRouter();
  const [serviceId, setServiceId] = useState(""),
    [priority, setPriority] = useState("general"),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const attempt = useRef<{ selection: string; key: string } | null>(null);
  const selection = services.find((s) => s.id === serviceId) || services[0];
  async function pay() {
    if (!selection || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await loadCheckout();
      const signature = `${selection.id}:${priority}:${consent}`;
      if (attempt.current?.selection !== signature)
        attempt.current = { selection: signature, key: crypto.randomUUID() };
      const r = await api<{ order: Order; key: string; hospital: string }>(
        "order",
        {
          serviceId: selection.id,
          priority,
          smsConsent: consent,
          requestKey: attempt.current.key,
        },
      );
      if (r.order.tokenId) {
        router.push(`/track/${r.order.tokenId}`);
        return;
      }
      if (!window.Razorpay) throw new Error("Payment checkout is unavailable.");
      const checkout = new window.Razorpay({
        key: r.key,
        amount: r.order.amount,
        currency: "INR",
        name: r.hospital,
        description: `Queue token · ${selection.name}`,
        order_id: r.order.gatewayId!,
        prefill: { name: user.name, email: user.email, contact: user.mobile },
        theme: { color: "#087f79" },
        handler: (result) => {
          void api<{ token: Token | null }>("verify", {
            orderId: r.order.id,
            paymentId: result.razorpay_payment_id,
            signature: result.razorpay_signature,
          })
            .then((v) => {
              if (v.token) router.push(`/track/${v.token.id}`);
              else {
                setMessage(
                  "Payment is still processing. Your tokens page will check its status.",
                );
                router.push("/tokens");
              }
            })
            .catch((e) => {
              setError(
                `${e.message} Open My tokens & payments to check this order before paying again.`,
              );
            })
            .finally(() => setBusy(false));
        },
        modal: {
          ondismiss: () => {
            setBusy(false);
            setMessage(
              "Checkout closed. You can check this order in My tokens & payments.",
            );
          },
        },
      });
      checkout.on("payment.failed", () => {
        setBusy(false);
        setMessage(
          "Payment did not complete. Check your orders before retrying.",
        );
      });
      checkout.open();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        eyebrow="BOOK YOUR VISIT"
        title="A place in the queue, ready for you."
      >
        {hospital?.name || "Choose a hospital to start."}
      </Heading>
      <div className="two-columns">
        <section className="card">
          <h2>Choose your service</h2>
          <div className="booking-options">
            {services.map((s) => (
              <button
                key={s.id}
                className={selection?.id === s.id ? "selected" : ""}
                onClick={() => setServiceId(s.id)}
              >
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.waiting} waiting · {s.status}
                  </small>
                </span>
                <strong>{money(s.price)}</strong>
              </button>
            ))}
          </div>
          <label>
            Visitor category
            <select
              name="priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {Object.entries(labels).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <p className="fine-print">
            Priority categories may be checked at the hospital. For a medical
            emergency, contact hospital staff directly.
          </p>
        </section>
        <section className="card">
          <span className="eyebrow">YOUR BOOKING</span>
          <h2 className="section-heading">{user.name}</h2>
          <p>
            {user.mobile} ·{" "}
            <Link className="inline-link" href="/account">
              Edit profile
            </Link>
          </p>
          <div className="receipt-line">
            <span>{selection?.name || "No service selected"}</span>
            <strong>{money(selection?.price || 0)}</strong>
          </div>
          <p>Payment is confirmed before your token is issued.</p>
          <label className="check">
            <input
              name="smsConsent"
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              Send a transactional SMS with my token tracking link to{" "}
              {user.mobile}.
            </span>
          </label>
          {gateway?.mode === "test" && (
            <div className="notice">
              Test payment mode · no real money is charged.
            </div>
          )}
          {!gateway?.connected && (
            <div className="notice">
              This hospital has not enabled online payments yet.
            </div>
          )}
          <ErrorBox message={error} />
          {message && (
            <div className="notice" role="status">
              {message}
            </div>
          )}
          <button
            className="button full-width"
            disabled={
              busy ||
              !gateway?.connected ||
              selection?.status !== "open" ||
              !selection?.price
            }
            onClick={() => void pay()}
          >
            {busy
              ? "Completing payment…"
              : `Pay ${money(selection?.price || 0)} & get token`}
          </button>
          <Link href="/tokens" className="text-link">
            My tokens & payments
          </Link>
          <p className="fine-print">
            Cancelling a token removes you from the queue. Refunds are handled
            separately by the hospital.
          </p>
        </section>
      </div>
    </>
  );
}
function FindToken() {
  const router = useRouter(),
    [value, setValue] = useState(""),
    [error, setError] = useState("");
  return (
    <section className="card narrow">
      <Heading eyebrow="LIVE TRACKING" title="Follow your turn." />
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const match = value.trim().match(/(?:\/track\/)?([a-f0-9]{48})\/?$/);
          if (!match)
            setError(
              "Paste the full tracking link or tracking ID from your token.",
            );
          else router.push(`/track/${match[1]}`);
        }}
      >
        <label>
          Tracking link or tracking ID
          <input
            name="trackingLink"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </label>
        <ErrorBox message={error} />
        <button className="button">Track token</button>
      </form>
      <Link href="/tokens" className="text-link">
        Find tokens in my account
      </Link>
    </section>
  );
}
function Tracker({ id }: { id: string }) {
  const live = useLive<Track>(`track?id=${encodeURIComponent(id)}`),
    [copied, setCopied] = useState(false);
  if (live.error) return <ErrorBox message={live.error} />;
  if (!live.data) return <Empty>Finding your token…</Empty>;
  const t = live.data;
  return (
    <>
      <Heading
        eyebrow="LIVE TOKEN TRACKING"
        title={
          t.status === "called"
            ? "It’s your turn."
            : t.status === "waiting"
              ? "Your place is saved."
              : "Your visit status"
        }
      >
        {t.hospital} · {t.service}
      </Heading>
      <div className="tracker-grid">
        <section className="card token-card">
          <Badge>{t.status}</Badge>
          <div className="big-token">{t.number}</div>
          <img
            width="200"
            height="200"
            src={`/api/v2/qr?id=${encodeURIComponent(t.id)}`}
            alt={`QR code for tracking token ${t.number}`}
          />
          <p>Scan to follow this token.</p>
          <button
            className="button secondary"
            onClick={() =>
              void navigator.clipboard
                .writeText(window.location.href)
                .then(() => setCopied(true))
                .catch(() => setCopied(false))
            }
          >
            {copied ? "Link copied" : "Copy tracking link"}
          </button>
          <a
            className="text-link"
            href={`/api/v2/qr?id=${encodeURIComponent(t.id)}`}
            download={`token-${t.number}.svg`}
          >
            Download QR
          </a>
        </section>
        <div>
          {t.status === "waiting" && t.ahead <= 3 && (
            <div className="notification">
              <h2>Your turn is approaching.</h2>
              <p>Please stay near the service area.</p>
            </div>
          )}
          <section className="card">
            <h2>Queue progress</h2>
            <div className="receipt-line">
              <span>Currently serving</span>
              <strong>{t.current || "—"}</strong>
            </div>
            <div className="receipt-line">
              <span>People ahead</span>
              <strong>{t.ahead}</strong>
            </div>
            <div className="receipt-line">
              <span>Estimated wait</span>
              <strong>
                {t.status === "waiting" ? `${t.estimatedMinutes} min` : "—"}
              </strong>
            </div>
            <p>Wait times are estimates and may change.</p>
            {t.serviceStatus !== "open" && (
              <div className="notice">
                This service is {t.serviceStatus}. Your token is retained; check
                with hospital staff.
              </div>
            )}
            <p className="fine-print">
              Keep this private link safe. Anyone with it can see the token’s
              queue status.
            </p>
          </section>
          <Link className="button secondary" href="/tokens">
            My tokens & payments
          </Link>
        </div>
      </div>
    </>
  );
}
function Orders({ hospital = false }: { hospital?: boolean }) {
  const live = useLive<{ orders: OrderView[] }>("orders", 10000),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState("");
  const pending = (live.data?.orders || [])
    .filter((o) => o.status === "pending")
    .slice(0, 3)
    .map((o) => o.id)
    .join(",");
  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const id of pending.split(",")) {
        if (cancelled) return;
        try {
          await api("reconcile", { orderId: id });
        } catch {
          /* Manual check displays actionable failures. */
        }
      }
      if (!cancelled) live.refresh();
    }, 7500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pending, live.refresh, live.data]);
  async function act(id: string, fn: () => Promise<unknown>, done: string) {
    setBusy(id);
    setError("");
    setMessage("");
    try {
      await fn();
      setMessage(done);
      live.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <Heading
        eyebrow={hospital ? "HOSPITAL PAYMENTS" : "YOUR VISITS"}
        title={hospital ? "Payments & token records" : "My tokens & payments"}
      >
        Payment records stay available after a visit ends.
      </Heading>
      <ErrorBox message={error || live.error} />
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      {live.loading && <Empty>Loading orders…</Empty>}
      {live.data?.orders.length === 0 && (
        <section className="card">
          <Empty>No bookings yet.</Empty>
          {!hospital && (
            <Link className="button" href="/check-in">
              Book your first token
            </Link>
          )}
        </section>
      )}
      {live.data?.orders.map((o) => (
        <section key={o.id} className="card order-card">
          <div className="row">
            <div>
              <span className="eyebrow">{o.hospitalName}</span>
              <h2>{o.number || o.serviceName}</h2>
              <p>
                {o.serviceName}
                {hospital ? ` · ${o.name}` : ""} · {date(o.createdAt)}
              </p>
            </div>
            <div>
              <strong>{money(o.amount)}</strong> <Badge>{o.status}</Badge>
            </div>
          </div>
          {o.tokenStatus && (
            <p>
              Token status: <strong>{o.tokenStatus}</strong> · SMS:{" "}
              <strong>{o.smsStatus?.replaceAll("_", " ")}</strong>
            </p>
          )}
          <details>
            <summary>Receipt details</summary>
            <p>
              Order: <code>{o.id}</code>
            </p>
            <p>
              Payment reference: <code>{o.paymentId || "Not confirmed"}</code>
            </p>
            <p>
              Gateway order: <code>{o.gatewayId || "Not created"}</code>
            </p>
          </details>
          <div className="actions">
            {o.tokenId ? (
              <>
                <Link className="button" href={`/track/${o.tokenId}`}>
                  View token & QR
                </Link>
                {!hospital && o.tokenStatus === "waiting" && (
                  <button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Cancel this waiting token? This does not automatically refund your payment.",
                        )
                      )
                        void act(
                          o.id,
                          () => api("cancel", { tokenId: o.tokenId }),
                          "Token cancelled. Contact the hospital for refund assistance.",
                        );
                    }}
                  >
                    Cancel token
                  </button>
                )}
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() =>
                    void act(
                      o.id,
                      async () => {
                        const r = await api<{ sms: SMS }>("sms", {
                          tokenId: o.tokenId,
                          retry: [
                            "failed",
                            "pending",
                            "needs_configuration",
                          ].includes(o.smsStatus || ""),
                        });
                        if (r.sms.error) throw new Error(r.sms.error);
                      },
                      "SMS status updated.",
                    )
                  }
                >
                  Check SMS / retry failed
                </button>
              </>
            ) : o.gatewayId ? (
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() =>
                  void act(
                    o.id,
                    async () => {
                      const r = await api<{ token: Token | null }>(
                        "reconcile",
                        { orderId: o.id },
                      );
                      if (!r.token)
                        throw new Error(
                          "No captured payment yet. If you were charged, wait and check again.",
                        );
                    },
                    "Payment verified and token issued.",
                  )
                }
              >
                {busy === o.id ? "Checking…" : "Check payment status"}
              </button>
            ) : (
              <p>Checkout was not completed. You can start a new booking.</p>
            )}
          </div>
        </section>
      ))}
    </>
  );
}
function Account({ me, refresh }: { me: Me; refresh: () => void }) {
  const u = me.user!,
    h = me.hospital;
  const [tab, setTab] = useState("profile");
  return (
    <>
      <Heading eyebrow="ACCOUNT CENTRE" title="Everything that makes it yours.">
        Manage your profile, security and{" "}
        {h ? "hospital details" : "contact details"}.
      </Heading>
      <section className="account-banner">
        <div className="avatar large">{u.name.slice(0, 1).toUpperCase()}</div>
        <div>
          <h2>{u.name}</h2>
          <p>{u.email}</p>
          <Badge>
            {u.role === "hospital" ? "Hospital manager" : "Patient account"}
          </Badge>
        </div>
        <div className="account-since">
          Member since
          <br />
          <strong>
            {new Date(u.createdAt).toLocaleDateString("en-IN", {
              month: "long",
              year: "numeric",
            })}
          </strong>
        </div>
      </section>
      <div className="tabs account-tabs">
        {[
          ["profile", "Profile"],
          ["security", "Security"],
          ...(h
            ? [
                ["hospital", "Hospital profile"],
                ["payments", "Payment settings"],
              ]
            : []),
        ].map(([key, title]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {title}
          </button>
        ))}
      </div>
      <section className="card account-panel" key={tab}>
        {tab === "profile" && (
          <>
            <h2>Personal details</h2>
            <p>Your mobile number is used for new token notifications.</p>
            <ActionForm
              onSave={async (d) => {
                await api("profile", d);
                refresh();
              }}
            >
              <div className="two-columns">
                <Field
                  label="Full name"
                  name="name"
                  value={u.name}
                  minLength={2}
                />
                <Field
                  label="Mobile number"
                  name="mobile"
                  type="tel"
                  value={u.mobile}
                />
              </div>
              <label>
                Email address
                <input name="email" value={u.email} disabled />
              </label>
              <p className="fine-print">
                Email changes require administrator assistance in this version.
              </p>
            </ActionForm>
          </>
        )}
        {tab === "security" && (
          <>
            <h2>Change your password</h2>
            <p>Changing your password signs out your other sessions.</p>
            <ActionForm
              onSave={async (d) => {
                if (d.newPassword !== d.confirm)
                  throw new Error("New passwords do not match.");
                await api("password", d);
              }}
              success="Password updated. Other sessions have been signed out."
            >
              <Field
                label="Current password"
                name="currentPassword"
                type="password"
              />
              <Field
                label="New password"
                name="newPassword"
                type="password"
                minLength={12}
              />
              <Field
                label="Confirm new password"
                name="confirm"
                type="password"
                minLength={12}
              />
            </ActionForm>
          </>
        )}
        {tab === "hospital" && h && (
          <>
            <h2>Hospital profile</h2>
            <p>These details identify your hospital to patients.</p>
            <ActionForm
              onSave={async (d) => {
                await api("hospital", d);
                refresh();
              }}
            >
              <div className="two-columns">
                <Field label="Hospital name" name="name" value={h.name} />
                <Field
                  label="Contact phone"
                  name="phone"
                  value={h.phone}
                  type="tel"
                />
              </div>
              <Field
                label="Address"
                name="address"
                value={h.address}
                required={false}
              />
              <div className="two-columns">
                <Field
                  label="UPI ID"
                  name="upiId"
                  value={h.upiId}
                  required={false}
                  placeholder="hospital@bank"
                />
                <Field
                  label="UPI payee name"
                  name="payeeName"
                  value={h.payeeName}
                  required={false}
                />
              </div>
              <p className="fine-print">
                Saved UPI details are contact records. Online token payments use
                your connected Razorpay merchant account.
              </p>
            </ActionForm>
          </>
        )}
        {tab === "payments" && h && <PaymentSettings />}
      </section>
    </>
  );
}
function Services({
  services,
  refresh,
}: {
  services: ServiceView[];
  refresh: () => void;
}) {
  return (
    <>
      <Heading eyebrow="HOSPITAL SETTINGS" title="Services & token prices">
        Set a price, then open a service to accept bookings.
      </Heading>
      <div className="service-grid">
        {services.map((s) => (
          <section
            key={`${s.id}:${s.price}:${s.status}:${s.minutes}`}
            className="card"
          >
            <h2>{s.name}</h2>
            <p>Token prefix · {s.prefix}</p>
            <ActionForm
              onSave={async (d) => {
                await api("service", {
                  id: s.id,
                  price: Math.round(Number(d.rupees) * 100),
                  minutes: Number(d.minutes),
                  status: d.status,
                });
                refresh();
              }}
            >
              <label>
                Token price (₹)
                <input
                  name="rupees"
                  type="number"
                  min="1"
                  max="10000"
                  step="0.01"
                  required
                  defaultValue={s.price / 100 || ""}
                />
              </label>
              <label>
                Typical service time (minutes)
                <input
                  name="minutes"
                  type="number"
                  min="1"
                  max="180"
                  required
                  defaultValue={s.minutes}
                />
              </label>
              <label>
                Availability
                <select name="status" defaultValue={s.status}>
                  <option value="open">Open</option>
                  <option value="paused">Paused</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
            </ActionForm>
          </section>
        ))}
      </div>
    </>
  );
}
type InsightData = {
  metrics: {
    waiting: number;
    completed: number;
    missed: number;
    averageWaitMinutes: number;
    averageServiceMinutes: number;
  };
  openQueues: number;
  services: ServiceView[];
  hours: { hour: number; label: string; count: number }[];
  activity: { at: string; message: string }[];
};
function Insights() {
  const live = useLive<InsightData>('insights', 10000);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const insights = live.data;
  const maxArrival = Math.max(1, ...(insights?.hours.map((h) => h.count) || []));
  async function changeStatus(id: string, status: string) {
    setSaving(id);
    setError('');
    try {
      await api('service-status', { id, status });
      live.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving('');
    }
  }
  return <>
    <Heading eyebrow="HOSPITAL WORKSPACE" title="Insights">Your hospital activity across all recorded visits.</Heading>
    <ErrorBox message={error || live.error} />
    {live.loading && <Empty>Loading insights…</Empty>}
    {insights && <>
      <div className="stats-grid">
        {([
          ['Waiting', insights.metrics.waiting],
          ['Completed', insights.metrics.completed],
          ['No-shows', insights.metrics.missed],
          ['Average wait', `${insights.metrics.averageWaitMinutes} min`],
        ] as const).map(([label, value]) => <section className="card stat" key={label}>
          <span>{label}</span><strong>{value}</strong>
        </section>)}
      </div>
      <p className="muted">{insights.openQueues} open queues · Average completed service time: {insights.metrics.averageServiceMinutes} min</p>
      <h2>Service queues</h2>
      <div className="service-grid">
        {insights.services.map((service) => <section className="card" key={service.id}>
          <div className="activity-row"><strong>{service.name}</strong><Badge>{service.status}</Badge></div>
          <p>{service.waiting} waiting</p>
          <p>Serving: {service.current || 'Available'}</p>
          <label>Queue availability
            <select name={`availability-${service.id}`} aria-label={`${service.name} availability`} value={service.status} disabled={saving === service.id}
              onChange={(event) => void changeStatus(service.id, event.target.value)}>
              <option value="open">Open</option><option value="paused">Paused</option><option value="closed">Closed</option>
            </select>
          </label>
        </section>)}
      </div>
      <section className="card">
        <h2>Arrival patterns</h2>
        <p>Local check-ins by hour across recorded dates.</p>
        <div className="chart" role="img" aria-label={`Arrivals by hour: ${insights.hours.map((h) => `${h.label}:00 ${h.count}`).join(', ')}`}>
          {insights.hours.map((h) => <div className="chart-column" key={h.hour} title={`${h.label}:00 · ${h.count} arrivals`}>
            <span>{h.count}</span><div className="bar" style={{ height: `${Math.max(2, Math.round(h.count / maxArrival * 130))}px` }} />
            <small>{h.label}</small>
          </div>)}
        </div>
      </section>
      <section className="card">
        <h2>Recent activity</h2>
        {insights.activity.length ? insights.activity.map((item, index) => <div className="activity-row" key={`${item.at}-${index}`}>
          <span>{item.message}</span><small>{date(item.at)}</small>
        </div>) : <Empty>No token activity yet.</Empty>}
      </section>
    </>}
  </>;
}
function Dashboard() {
  const live = useLive<{
    services: ServiceView[];
    tokens: (Token & { name: string })[];
  }>("dashboard");
  const [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const services = live.data?.services || [],
    s = services.find((x) => x.id === selected) || services[0];
  const tokens = (live.data?.tokens || []).filter((t) => t.serviceId === s?.id),
    current = tokens.find((t) => t.status === "called");
  async function action(action: string) {
    if (!s || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("counter", { action, serviceId: s.id, tokenId: current?.id });
      live.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading eyebrow="HOSPITAL WORKSPACE" title="Keep every visit moving.">
        Manage one service at a time.
      </Heading>
      <ErrorBox message={error || live.error} />
      <div className="stats-grid">
        {[
          [
            "Waiting",
            live.data?.tokens.filter((t) => t.status === "waiting").length || 0,
          ],
          [
            "Completed",
            live.data?.tokens.filter((t) => t.status === "completed").length ||
              0,
          ],
          [
            "Missed",
            live.data?.tokens.filter((t) => t.status === "missed").length || 0,
          ],
        ].map(([label, value]) => (
          <section className="card stat" key={label}>
            <span>{label} (latest 500 tokens)</span>
            <strong>{value}</strong>
          </section>
        ))}
      </div>
      <label className="service-picker">
        Choose service
        <select
          name="service"
          value={s?.id || ""}
          onChange={(e) => setSelected(e.target.value)}
        >
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="two-columns">
        <section className="card serving">
          <span className="eyebrow">CURRENTLY SERVING</span>
          <div className="big-token">{current?.number || "—"}</div>
          <p>{current?.name || "Ready for the next visitor"}</p>
          <Badge>{s?.status || "loading"}</Badge>
          <div className="control-grid">
            <button
              className="button"
              disabled={busy || !!current || !s || s.status !== "open"}
              onClick={() => void action("next")}
            >
              Call next
            </button>
            <button
              className="button complete"
              disabled={busy || !current}
              onClick={() => void action("complete")}
            >
              Complete
            </button>
            <button
              className="button secondary"
              disabled={busy || !current}
              onClick={() => void action("missed")}
            >
              Mark missed
            </button>
          </div>
        </section>
        <section className="card">
          <h2>Waiting tokens</h2>
          <p>Next: {s?.upcoming.join(" → ") || "No one waiting"}</p>
          {tokens
            .filter((t) => t.status === "waiting")
            .reverse()
            .map((t) => (
              <div className="waiting-row" key={t.id}>
                <strong className="small-token">{t.number}</strong>
                <div>
                  <strong>{t.name}</strong>
                  <small>{labels[t.priority]}</small>
                </div>
                <Badge>{t.status}</Badge>
              </div>
            ))}
          {!s?.waiting && <Empty>The queue is clear.</Empty>}
        </section>
      </div>
    </>
  );
}
function PublicDisplay({
  hospital,
  services,
}: {
  hospital?: Hospital;
  services: ServiceView[];
}) {
  return (
    <>
      <Heading
        eyebrow="LIVE QUEUE BOARD"
        title={hospital?.name || "Public display"}
      >
        Please watch for your token number.
      </Heading>
      <div className="service-grid">
        {services.map((s) => (
          <section className="card serving" key={s.id}>
            <h2>{s.name}</h2>
            <p>Currently serving</p>
            <div className="big-token">{s.current || "—"}</div>
            <Badge>{s.status}</Badge>
            <p>Coming up</p>
            <div className="upcoming">
              {s.upcoming.map((n) => (
                <strong key={n}>{n}</strong>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
