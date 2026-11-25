import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { Button, Input } from "../../components/ui";
import { ipc } from "../../lib/ipc";
import { openExternal } from "../helpers";
import { StepFooter, StepFrame, type StepProps } from "../parts";

const KEYS_URL = "https://console.anthropic.com/settings/keys";

export function ConnectClaude({ next, back }: StepProps) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<string | null>(null); // last4

  useEffect(() => {
    ipc
      .apiKeyStatus()
      .then((s) => s.set && setConnected(s.last4 ?? ""))
      .catch(() => undefined);
  }, []);

  const connect = async () => {
    const k = key.trim();
    if (!k) return;
    setBusy(true);
    setError(null);
    try {
      await ipc.setApiKey(k);
      await ipc.testApiKey();
      setConnected(k.slice(-4));
      setKey("");
    } catch (e) {
      setError(String(e));
      // Don't keep a key that failed validation.
      void ipc.clearApiKey().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepFrame
      eyebrow="Step 2"
      title="Connect Claude"
      subtitle="Claude turns your rough speech into clean writing: punctuation, filler words, the right tone for the app you're in. Bring your own key and you only pay for what you use."
    >
      {connected !== null ? (
        <div className="flex items-center gap-3 rounded-card border border-line bg-success-soft px-4 py-3.5" role="status">
          <CheckCircle2 size={18} className="text-success" aria-hidden />
          <div className="flex-1">
            <p className="text-sm font-semibold text-ink">Connected</p>
            <p className="text-xs text-muted">{connected ? `Key ending in ${connected} is stored in Windows Credential Manager.` : "Your key is stored in Windows Credential Manager."}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await ipc.clearApiKey().catch(() => undefined);
              setConnected(null);
            }}
          >
            Change
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <Input
            label="Anthropic API key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setError(null);
            }}
            error={error}
            helper={
              <>
                Create one at{" "}
                <button type="button" className="inline-flex items-center gap-1 font-medium text-accent underline-offset-2 hover:underline" onClick={() => void openExternal(KEYS_URL)}>
                  console.anthropic.com <ExternalLink size={11} aria-hidden />
                </button>
                . It's saved only on this PC.
              </>
            }
          />
          <div>
            <Button variant="primary" type="submit" loading={busy} disabled={!key.trim()}>
              {busy ? "Checking…" : "Connect"}
            </Button>
          </div>
        </form>
      )}

      <p className="mt-5 text-[13px] leading-relaxed text-muted">
        Cost, plainly: about <span className="font-medium text-ink">$0.0003 per dictation</span> with Claude Haiku 5.5, roughly 3,000 dictations per dollar. Only the text of what you said is sent, never audio.
      </p>

      <StepFooter
        onBack={back}
        onNext={next}
        nextLabel={connected !== null ? "Continue" : "Skip — use without AI"}
        nextVariant={connected !== null ? "primary" : "secondary"}
      />
      {connected === null && <p className="mt-2 text-right text-xs text-faint">You can add a key later in Settings. Utter still cleans up text locally.</p>}
    </StepFrame>
  );
}
