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
  const [stored, setStored] = useState<string | null>(null); // last4 of the saved key ("" if unknown)
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    ipc
      .apiKeyStatus()
      .then((s) => s.set && setStored(s.last4 ?? ""))
      .catch(() => undefined);
  }, []);

  const connect = async () => {
    const k = key.trim();
    if (!k) return;
    setBusy(true);
    setError(null);
    try {
      // Validate the candidate first so a bad paste or a network blip never touches the stored key.
      await ipc.testApiKey(k);
      await ipc.setApiKey(k);
      setStored(k.slice(-4));
      setKey("");
      setChanging(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const showInput = stored === null || changing;

  return (
    <StepFrame
      eyebrow="Step 2"
      title="Connect Claude"
      subtitle="Claude turns your rough speech into clean writing: punctuation, filler words, the right tone for the app you're in. Bring your own key and you only pay for what you use."
      onSubmit={() => (showInput && key.trim() ? void connect() : next())}
    >
      {!showInput ? (
        <div className="flex items-center gap-3 rounded-card border border-line bg-success-soft px-4 py-3.5" role="status">
          <CheckCircle2 size={16} strokeWidth={1.5} className="text-success" aria-hidden />
          <div className="flex-1">
            <p className="text-body-strong text-ink">Connected</p>
            <p className="text-caption text-muted">{stored ? `Key ending in ${stored} is stored in Windows Credential Manager.` : "Your key is stored in Windows Credential Manager."}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setChanging(true)}>
            Change
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
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
                <button type="button" className="inline-flex items-center gap-1 font-medium text-ember-text underline-offset-2 hover:underline" onClick={() => void openExternal(KEYS_URL)}>
                  console.anthropic.com <ExternalLink size={16} strokeWidth={1.5} aria-hidden />
                </button>
                . It's saved only on this PC.
              </>
            }
          />
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={() => void connect()} loading={busy} disabled={!key.trim()}>
              {busy ? "Checking…" : "Connect"}
            </Button>
            {changing && (
              <Button
                variant="ghost"
                onClick={() => {
                  setChanging(false);
                  setKey("");
                  setError(null);
                }}
              >
                Keep current key
              </Button>
            )}
          </div>
        </div>
      )}

      <p className="mt-5 text-body text-muted">
        Cost, plainly: about <span className="font-medium text-ink">$0.0003 per dictation</span> with Claude Haiku 5.5, roughly 3,000 dictations per dollar. Only the text of what you said is sent, never audio.
      </p>

      <StepFooter onBack={back} nextLabel={stored !== null ? "Continue" : "Skip for now"} nextVariant={stored !== null ? "primary" : "secondary"} />
      {stored === null && <p className="mt-2 text-right text-caption text-faint">You can add a key later in Settings. Utter still cleans up text locally.</p>}
    </StepFrame>
  );
}
