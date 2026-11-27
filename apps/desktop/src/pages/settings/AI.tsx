import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound, Trash2, XCircle } from "lucide-react";
import { Button, Input, Select } from "../../components/ui";
import { ipc } from "../../lib/ipc";
import { formatNumber, formatUsd } from "../../lib/format";
import { toast } from "../../lib/store";
import type { ApiKeyStatus, Usage } from "../../lib/types";
import { openExternal } from "./helpers";
import { Block, Group, RaisedButton, Row, SettingsPage, WithSettings } from "./parts";

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
    <SettingsPage title="AI">
      <WithSettings>
        {(s, update) => {
          const chosen = MODELS.find((m) => m.id === s.aiModel);
          return (
            <>
              <Group title="Claude API key" description="Optional. Powers cleanup, enhance, command and transforms. Only text is sent, never audio. Without a key Utter cleans text locally.">
                {status?.set && (
                  <Row
                    title="Saved key"
                    description={
                      <span className="inline-flex items-center gap-2 font-mono" aria-label={`Key ending in ${status.last4 ?? ""}`}>
                        <KeyRound size={16} strokeWidth={1.5} aria-hidden />
                        {"•".repeat(12)}
                        {status.last4}
                      </span>
                    }
                  >
                    <RaisedButton loading={testing} onClick={() => void test()}>
                      Test
                    </RaisedButton>
                    <RaisedButton variant="danger" icon={<Trash2 size={16} strokeWidth={1.5} />} onClick={() => void remove()}>
                      Remove
                    </RaisedButton>
                  </Row>
                )}
                <Block>
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
                      placeholder="sk-ant-…"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      className="flex-1"
                    />
                    <Button type="submit" variant="primary" loading={saving} disabled={!draft.trim()}>
                      Save and test
                    </Button>
                  </form>
                  <div aria-live="polite" className="mt-3 min-h-6">
                    {result?.ok && (
                      <p className="flex items-center gap-2 text-body text-success">
                        <CheckCircle2 size={16} strokeWidth={1.5} aria-hidden /> Key works. Claude is ready.
                      </p>
                    )}
                    {result && !result.ok && (
                      <p role="alert" className="flex items-start gap-2 text-body text-danger">
                        <XCircle size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0" /> {result.message}
                      </p>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-caption text-faint">Your key is stored in Windows Credential Manager. It is never written to settings or logs.</p>
                    <RaisedButton icon={<ExternalLink size={16} strokeWidth={1.5} />} onClick={() => void openExternal(KEYS_URL)}>
                      Get a key
                    </RaisedButton>
                  </div>
                </Block>
              </Group>

              <Group title="Model">
                <Row title="Claude model" description={chosen ? `${chosen.note} ${chosen.price}.` : undefined}>
                  <Select aria-label="Claude model" value={s.aiModel} onChange={(e) => void update({ aiModel: e.target.value })} className="w-44">
                    {MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </Row>
              </Group>

              <Group title="Usage this month" description="Estimated from list prices. Your Anthropic console has the exact bill.">
                <Block>
                  {usage ? (
                    <dl className="grid grid-cols-3 gap-4">
                      <Stat label="Input tokens" value={formatNumber(usage.monthInputTokens)} />
                      <Stat label="Output tokens" value={formatNumber(usage.monthOutputTokens)} />
                      <Stat label="Estimated cost" value={formatUsd(usage.estCostUsd)} />
                    </dl>
                  ) : (
                    <p className="text-body text-muted">Usage isn't available right now.</p>
                  )}
                </Block>
              </Group>
            </>
          );
        }}
      </WithSettings>
    </SettingsPage>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="mt-1 text-serif-figure text-ink">{value}</dd>
    </div>
  );
}
