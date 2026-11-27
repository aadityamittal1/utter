import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { LogoMark } from "../../components/Logo";
import { ipc } from "../../lib/ipc";
import { openExternal } from "./helpers";
import { Section } from "./parts";

const REPO = "https://github.com/aadityamittal1/utter";

export default function About() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    ipc
      .appInfo()
      .then((i) => setVersion(i.version))
      .catch(() => setVersion(null));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 py-2">
        <LogoMark width={64} />
        <div>
          <div className="font-display text-[28px] leading-none text-ink">Utter</div>
          <div className="mt-1 text-[13px] text-muted">Version {version ?? "unknown"} · Free, open source dictation for Windows.</div>
        </div>
      </div>

      <Section title="License">
        <p className="py-4 text-sm text-muted">Utter is released under the MIT License. Copyright (c) 2026 Utter contributors.</p>
      </Section>

      <Section title="Source code">
        <div className="py-4">
          <a
            href={REPO}
            onClick={(e) => {
              e.preventDefault();
              void openExternal(REPO);
            }}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ember-text underline-offset-4 hover:underline"
          >
            github.com/aadityamittal1/utter <ExternalLink size={14} aria-hidden />
          </a>
        </div>
      </Section>

      <Section title="Credits">
        <ul className="flex flex-col gap-1.5 py-4 text-sm text-muted">
          <li>whisper.cpp (MIT) runs speech recognition on your PC.</li>
          <li>Tauri builds the desktop shell.</li>
          <li>AI cleanup: Claude Haiku via your own Anthropic API key</li>
        </ul>
      </Section>
    </div>
  );
}
