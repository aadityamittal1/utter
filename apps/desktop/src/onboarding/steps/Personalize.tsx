import { useState } from "react";
import { Input } from "../../components/ui";
import { ipc } from "../../lib/ipc";
import { cn } from "../../lib/cn";
import { toast, useSettings } from "../../lib/store";
import type { StyleKind } from "../../lib/types";
import { buildSnippets, validatePersonal, type PersonalInputs } from "../helpers";
import { StepFooter, StepFrame, type StepProps } from "../parts";

const WRITTEN: Array<{ id: StyleKind; label: string; hint: string }> = [
  { id: "formal", label: "Formal", hint: "Full sentences, polite" },
  { id: "casual", label: "Casual", hint: "Relaxed but clean" },
];
const CHAT: Array<{ id: StyleKind; label: string; hint: string }> = [
  { id: "casual", label: "Casual", hint: "Clean, friendly" },
  { id: "veryCasual", label: "Very casual", hint: "lowercase, light" },
  { id: "excited", label: "Excited", hint: "Energy and exclamation!" },
];

function Choice<T extends string>({ label, options, value, onChange }: { label: string; options: Array<{ id: T; label: string; hint: string }>; value: T | undefined; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-medium text-ink">{label}</legend>
      <div role="radiogroup" className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={cn(
              "rounded-control border px-3 py-1.5 text-left transition-colors",
              value === o.id ? "border-ember bg-accent-soft" : "border-line bg-surface hover:border-line-strong",
            )}
          >
            <span className="block text-[13px] font-medium text-ink">{o.label}</span>
            <span className="block text-[11px] text-muted">{o.hint}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function Personalize({ next, back }: StepProps) {
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const [name, setName] = useState(settings?.userName ?? "");
  const [vals, setVals] = useState<PersonalInputs>({ linkedin: "", email: "", website: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof PersonalInputs, string>>>({});
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState<StyleKind | undefined>(settings?.styles.email);
  const [chat, setChat] = useState<StyleKind | undefined>(settings?.styles.workChat);

  const set = (k: keyof PersonalInputs) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setVals((v) => ({ ...v, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const save = async () => {
    const errs = validatePersonal(vals);
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setBusy(true);
    const patch: Partial<NonNullable<typeof settings>> = { userName: name.trim() };
    if (settings && (written || chat)) {
      patch.styles = {
        ...settings.styles,
        ...(written ? { email: written, document: written } : {}),
        ...(chat ? { workChat: chat, personalChat: chat } : {}),
      };
    }
    await update(patch);

    const existing: string[] = [];
    const failed: string[] = [];
    for (const s of buildSnippets(vals)) {
      try {
        await ipc.snippetsAdd(s.trigger, s.expansion);
      } catch (e) {
        // Most likely "already exists" from an earlier run: never block onboarding on it.
        if (/exist/i.test(String(e))) existing.push(`“${s.trigger}”`);
        else failed.push(`“${s.trigger}”: ${String(e)}`);
      }
    }
    setBusy(false);
    if (existing.length) toast.info(`You already have ${existing.join(" and ")}. Left as is.`);
    if (failed.length) toast.error(`Couldn't add ${failed.join("; ")}`);
    next();
  };

  return (
    <StepFrame
      eyebrow="Step 7"
      title="Make it yours"
      subtitle="Say “my linkedin”, “my email” or “my website” in any dictation and Utter types the real thing. All optional."
    >
      <div className="flex flex-col gap-4">
        <Input label="Your name" placeholder="Maya" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="LinkedIn" placeholder="linkedin.com/in/you" value={vals.linkedin} onChange={set("linkedin")} error={errors.linkedin} inputMode="url" />
          <Input label="Website" placeholder="yoursite.com" value={vals.website} onChange={set("website")} error={errors.website} inputMode="url" />
        </div>
        <Input label="Email" placeholder="you@example.com" value={vals.email} onChange={set("email")} error={errors.email} type="email" />
        <div className="mt-1 grid gap-4">
          <Choice label="Emails and documents" options={WRITTEN} value={written} onChange={setWritten} />
          <Choice label="Chat messages" options={CHAT} value={chat} onChange={setChat} />
        </div>
      </div>
      <StepFooter onBack={back} onNext={() => void save()} loading={busy} />
    </StepFrame>
  );
}
