import { AppWindow, Gift, ShieldCheck } from "lucide-react";
import { LogoMark } from "../../components/Logo";
import { Button } from "../../components/ui";
import type { StepProps } from "../parts";

const PROMISES = [
  { icon: ShieldCheck, title: "Private", body: "Your audio never leaves your PC. Speech is recognized on this machine." },
  { icon: Gift, title: "Free and open source", body: "No subscription, no account. You only pay Claude for the polish, if you want it." },
  { icon: AppWindow, title: "Works in every app", body: "Hold a shortcut anywhere you can type. Utter writes it for you." },
];

export function Welcome({ next }: StepProps) {
  return (
    <div className="flex flex-col items-start">
      <LogoMark width={64} />
      <h1 className="mt-8 font-display text-[56px] leading-[1.04] text-ink outline-none focus:outline-none">
        Speak anywhere.
        <br />
        <span className="text-ember-text">Utter</span> writes it.
      </h1>
      <p className="mt-4 max-w-[46ch] text-base leading-relaxed text-muted">
        Dictation that sounds like you, not like a transcript. Setup takes about two minutes.
      </p>
      <ul className="mt-9 flex w-full flex-col gap-4">
        {PROMISES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex items-start gap-3.5">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control bg-ember-soft text-ember-text">
              <Icon size={16} aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">{title}</p>
              <p className="text-[13px] leading-relaxed text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ul>
      <Button variant="primary" className="mt-10 h-10 px-5" onClick={next}>
        Get started
      </Button>
    </div>
  );
}
