"use client";
import { useEffect, useState } from "react";
type Settings = {
  keyId: string;
  mode: string;
  secretConfigured: boolean;
  webhookConfigured: boolean;
  verifiedAt: string | null;
  webhookUrl: string;
};
async function request(body?: unknown): Promise<Settings> {
  const r = await fetch("/api/v2/payment-settings", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: {
      "X-MediQueue-Role": "hospital",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await r.json();
  if (!r.ok)
    throw new Error(result.error || "Unable to update payment settings.");
  return result;
}
export default function PaymentSettings() {
  const [settings, setSettings] = useState<Settings | null>(null),
    [mode, setMode] = useState("test"),
    [keyId, setKeyId] = useState(""),
    [keySecret, setKeySecret] = useState(""),
    [webhookSecret, setWebhookSecret] = useState("");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    let alive = true;
    void request()
      .then((s) => {
        if (alive) {
          setSettings(s);
          setMode(s.mode);
          setKeyId(s.keyId);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function submit(action: string) {
    setBusy(action);
    setMessage("");
    setError("");
    try {
      const result = await request({
        action,
        mode,
        keyId,
        keySecret,
        webhookSecret,
      });
      if (action === "save") {
        setSettings(result);
        setKeySecret("");
        setWebhookSecret("");
        setMessage("Connection verified. Your payment settings are saved.");
      } else
        setMessage(
          "Razorpay accepted these keys. Choose Save settings to use them.",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div>
      <h2>Connect your Razorpay account</h2>
      <p>Enter your hospital’s payment keys. Your secret keys stay private.</p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      {settings && (
        <>
          <p>
            <strong>
              {settings.verifiedAt
                ? `Connection verified ${new Date(settings.verifiedAt).toLocaleString()}`
                : settings.secretConfigured
                  ? "Credentials configured · test the connection below"
                  : "Not connected"}
            </strong>
          </p>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void submit("save");
            }}
          >
            <fieldset
              disabled={!!busy}
              style={{
                border: 0,
                padding: 0,
                margin: 0,
                display: "grid",
                gap: 18,
              }}
            >
              <label>
                Payment mode
                <select name="paymentMode" value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="test">Test · no real charges</option>
                  <option value="live">Live · real payments</option>
                </select>
              </label>
              {mode === "live" && (
                <p className="notice">
                  Live mode accepts real payments using your activated Razorpay
                  merchant account.
                </p>
              )}
              <label>
                Razorpay Key ID
                <input
                  name="razorpayKeyId"
                  required
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                  placeholder={`rzp_${mode}_…`}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label>
                Key Secret
                <input
                  name="razorpayKeySecret"
                  type="password"
                  value={keySecret}
                  onChange={(e) => setKeySecret(e.target.value)}
                  placeholder={
                    settings.secretConfigured
                      ? "Configured · leave blank to keep"
                      : "Enter your Key Secret"
                  }
                  autoComplete="new-password"
                />
              </label>
              <label>
                Webhook Secret
                <input
                  name="razorpayWebhookSecret"
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={
                    settings.webhookConfigured
                      ? "Configured · leave blank to keep"
                      : "Optional for local testing"
                  }
                  autoComplete="new-password"
                />
              </label>
              <small>
                When changing the Key ID, enter its matching secret. Existing
                secrets are never displayed.
              </small>
              <div className="actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => void submit("test")}
                >
                  {busy === "test" ? "Testing…" : "Test connection"}
                </button>
                <button type="submit" className="button">
                  {busy === "save" ? "Verifying & saving…" : "Save settings"}
                </button>
              </div>
            </fieldset>
          </form>
          <div className="card" style={{ marginTop: 26 }}>
            <h3>Payment webhook</h3>
            <p>
              Add this URL to your Razorpay dashboard and subscribe to{" "}
              <code>payment.captured</code>. Use the same webhook secret in both
              places.
            </p>
            <label>
              Webhook URL
              <input name="webhookUrl" readOnly value={settings.webhookUrl} />
            </label>
            <button
              type="button"
              className="button secondary"
              style={{ marginTop: 12 }}
              onClick={() =>
                void navigator.clipboard
                  .writeText(settings.webhookUrl)
                  .then(() => setMessage("Webhook URL copied."))
                  .catch(() => setError("Select and copy the URL above."))
              }
            >
              Copy webhook URL
            </button>
            <p className="fine-print">
              Razorpay cannot reach a localhost address. For local testing,
              check payments from the token history page.
            </p>
          </div>
          <p className="fine-print">
            Update UPI ID and payee name under Hospital profile. Razorpay
            payouts follow your merchant account’s settlement settings.
          </p>
        </>
      )}
    </div>
  );
}
