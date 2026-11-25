import { LogoMark } from "../components/Logo";
import { Button } from "../components/ui";
import { ipc } from "../lib/ipc";
import { useSettings } from "../lib/store";

/** Placeholder: the onboarding task replaces this component. */
export default function Onboarding() {
  const load = useSettings((s) => s.load);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-bg p-8 text-center">
      <LogoMark width={72} />
      <div>
        <h1 className="font-display text-5xl text-ink">Speak anywhere.</h1>
        <p className="mt-2 text-muted">Utter writes it.</p>
      </div>
      <Button
        variant="primary"
        onClick={async () => {
          await ipc.completeOnboarding();
          await load();
        }}
      >
        Get started
      </Button>
    </div>
  );
}
