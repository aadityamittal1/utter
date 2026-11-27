import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, Trash2, XCircle } from "lucide-react";
import { Button, Input } from "../../components/ui";
import { ipc } from "../../lib/ipc";
import { formatNumber, formatUsd } from "../../lib/format";
import { toast } from "../../lib/store";
import type { ApiKeyStatus, Usage } from "../../lib/types";
import { openExternal } from "./helpers";
import { Section, WithSettings } from "./parts";

const KEYS_URL = "https://console.anthropic.com/settings/keys";

const MODELS = [
  { id: "claude-haiku-5-5", name: "Haiku 5.5", price: "$0.10 / $0.50 per million tokens", note: "Fast and very cheap. Default." },
  { id: "claude-sonnet-5-5", name: "Sonnet 5.5", price: "$2 / $10 per million tokens", note: "Smarter on tricky rewrites, about 20 times the cost." },
];

type Result = { ok: true } | { ok: false; message: string } | null;

export default function AI() {
  const [status, setStatus] = useState<ApiKeyStatus | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<Result>(null);

  useEffect(() => {
    ipc
      .apiKeyStatus()
      .then(setStatus)
      .catch((e) => setResult({ ok: false, message: String(e) }));
    ipc
      .usageGet()
      .then(setUsage)
      .catch(() => setUsage(null));
  }, []);

  const refreshUsage = () =>
    ipc
      .usageGet()
      .then(setUsage)
      .catch(() => undefined);

  const runTest = async (prefix = "") => {
    try {
      await ipc.testApiKey();
      setResult({ ok: true });
    } catch (e) {
      setResult({ ok: false, message: `${prefix}${String(e)}` });
    }
    void refreshUsage();
  };

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    setSaving(true);
    setResult(null);
    try {
      await ipc.setApiKey(key);
    } catch (e) {
      setDraft(""); // never keep the key text around after a failed save
      setResult({ ok: false, message: `Couldn't save the key: ${String(e)}` });
      setSaving(false);
      return;
    }
    setDraft("");
    // From here the key IS saved. Later failures must not say otherwise.
    try {
      setStatus(await ipc.apiKeyStatus());
    } catch {
      setStatus({ set: true });
    }
    await runTest("Key saved, but it didn't work: ");
    setSaving(false);
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    await runTest();
    setTesting(false);
  };

  const remove = async () => {
    try {
      await ipc.clearApiKey();
      setResult(null);
      setStatus(await ipc.apiKeyStatus());
      toast.success("API key removed");
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <WithSettings>
      {(s, update) => (
        <div className="flex flex-col gap-4">
          <Section title="Claude API key" description="Optional. Powers cleanup, enhance, command and transforms. Only text is sent, never audio. Without a key Utter cleans text locally.">
            <div className="flex flex-col gap-4 py-4">
              {status?.set && (
                <div className="flex items-center justify-between gap-4 rounded-control border border-line bg-surface px-3.5 py-2.5">
                  <span className="flex items-center gap-2.5 text-sm text-ink">
                    <KeyRound size={16} aria-hidden className="text-muted" />
                    <span className="font-mono text-[13px]" aria-label={`Key ending in ${status.last4 ?? ""}`}>
                      {"•".repeat(12)}
                      {status.last4}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" loading={testing} onClick={() => void test()}>
                      Test
                    </Button>
                    <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => void remove()}>
                      Remove
                    </Button>
                  </span>
                </div>
              )}
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <Input
                  label={status?.set ? "Replace key" : "API key"}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="sk-ant-..."
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="flex-1"
                />
                <Button type="submit" variant="primary" loading={saving} disabled={!draft.trim()}>
                  Save and test
                </Button>
              </form>
              <div aria-live="polite" className="min-h-5">
                {result?.ok && (
                  <p className="flex items-center gap-1.5 text-sm text-success">
                    <CheckCircle2 size={16} aria-hidden /> Key works. Claude is ready.
                  </p>
                )}
                {result && !result.ok && (
                  <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
                    <XCircle size={16} aria-hidden className="mt-0.5 shrink-0" /> {result.message}
                  </p>
                )}
              </div>
              <div>
                <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => void openExternal(KEYS_URL)}>
                  Get a key
                </Button>
              </div>
              <p className="text-xs text-faint">Your key is stored in Windows Credential Manager. It is never written to settings or logs.</p>
            </div>
          </Section>

          <Section title="Model">
            <fieldset className="py-4">
              <legend className="sr-only">Claude model</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {MODELS.map((m) => {
                  const on = s.aiModel === m.id;
                  return (
                    <label
                      key={m.id}
                      className={`flex cursor-pointer flex-col gap-1 rounded-card border px-4 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--ring)] ${on ? "border-ember bg-ember-soft" : "border-line bg-surface hover:border-line-strong"}`}
                    >
                      <input type="radio" name="ai-model" className="sr-only" checked={on} onChange={() => void update({ aiModel: m.id })} />
                      <span className="text-sm font-semibold text-ink">{m.name}</span>
                      <span className="text-[13px] text-muted">{m.note}</span>
                      <span className="mt-1 font-mono text-xs text-faint">{m.price}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </Section>

          <Section title="Usage this month">
            <div className="py-4">
              {usage ? (
                <dl className="grid grid-cols-3 gap-4">
                  <Stat label="Input tokens" value={formatNumber(usage.monthInputTokens)} />
                  <Stat label="Output tokens" value={formatNumber(usage.monthOutputTokens)} />
                  <Stat label="Estimated cost" value={formatUsd(usage.estCostUsd)} />
                </dl>
              ) : (
                <p className="text-sm text-muted">Usage isn't available right now.</p>
              )}
              <p className="mt-3 text-xs text-faint">Estimate based on list prices. Your Anthropic console has the exact bill.</p>
            </div>
          </Section>
        </div>
      )}
    </WithSettings>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-display text-[28px] leading-none text-ink tabular-nums">{value}</dd>
    </div>
  );
}
