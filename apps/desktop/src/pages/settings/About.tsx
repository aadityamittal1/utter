import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { LogoMark } from "../../components/Logo";
import { ipc } from "../../lib/ipc";
import { openExternal } from "./helpers";
import { Block, Group, RaisedButton, Row, SettingsPage } from "./parts";

const REPO = "https://github.com/aadityamittal1/utter";
const RELEASES = `${REPO}/releases`;

export default function About() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    ipc
      .appInfo()
      .then((i) => setVersion(i.version))
      .catch(() => setVersion(null));
  }, []);

  return (
    <SettingsPage title="About">
      <Group>
        <div className="flex items-center gap-4 py-5">
          <LogoMark width={48} />
          <div className="min-w-0">
            <div className="text-subtitle text-ink">Utter</div>
            <div className="text-body text-muted">Free, open source dictation for Windows.</div>
          </div>
        </div>
        <Row title="Version" description={<span className="tabular-nums">{version ?? "Unknown"}</span>}>
          <RaisedButton icon={<ExternalLink size={16} strokeWidth={1.5} />} onClick={() => void openExternal(RELEASES)}>
            Check for updates
          </RaisedButton>
        </Row>
        <Row title="Source code" description="github.com/aadityamittal1/utter">
          <RaisedButton icon={<ExternalLink size={16} strokeWidth={1.5} />} onClick={() => void openExternal(REPO)}>
            Open on GitHub
          </RaisedButton>
        </Row>
        <Row title="License" description="Utter is released under the MIT License. Copyright (c) 2026 Utter contributors." />
      </Group>

      <Group title="Credits">
        <Block>
          <ul className="flex flex-col gap-1.5 text-body text-muted">
            <li>whisper.cpp (MIT) runs speech recognition on your PC.</li>
            <li>Tauri builds the desktop shell.</li>
            <li>AI cleanup: Claude Haiku via your own Anthropic API key.</li>
          </ul>
        </Block>
      </Group>
    </SettingsPage>
  );
}
