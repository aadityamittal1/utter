import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Chord, Input, Select, Switch } from "../../components/ui";
import type { AccentSource, ThemePref } from "../../lib/types";
import { LANGUAGES } from "./helpers";
import Microphone from "./Microphone";
import { Group, RaisedButton, Row, SettingsPage, WithSettings } from "./parts";
import Shortcuts from "./Shortcuts";

export default function General() {
  const [view, setView] = useState<"main" | "shortcuts">("main");
  const backRef = useRef<HTMLButtonElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const moved = useRef(false);

  // Keep keyboard focus with the user across the in-place view swap.
  useEffect(() => {
    if (!moved.current) return;
    (view === "shortcuts" ? backRef : changeRef).current?.focus();
  }, [view]);
  const go = (v: "main" | "shortcuts") => {
    moved.current = true;
    setView(v);
  };

  if (view === "shortcuts") {
    return (
      <SettingsPage title="Shortcuts">
        <div className="-mt-4">
          <Button ref={backRef} variant="ghost" size="sm" icon={<ArrowLeft size={16} strokeWidth={1.5} aria-hidden />} onClick={() => go("main")}>
            Back to General
          </Button>
        </div>
        <Shortcuts />
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title="General">
      <WithSettings>
        {(s, update) => (
          <>
            <Group title="Dictation">
              <Row
                title="Shortcuts"
                description={
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    Hold <Chord chord={s.shortcuts.dictate?.[0]} /> and speak.
                  </span>
                }
              >
                <RaisedButton ref={changeRef} onClick={() => go("shortcuts")}>Change</RaisedButton>
              </Row>
            </Group>

            <Microphone />

            <Group title="Language">
              <Row title="Spoken language" description="Auto-detect works well for most people. Pick one for the best accuracy.">
                <Select aria-label="Spoken language" value={s.language} onChange={(e) => void update({ language: e.target.value })} className="w-48">
                  <option value="auto">Auto-detect</option>
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Row>
              <Row title="Translate to English" description="Speak in any language and get English text. Needs a multilingual model.">
                <Switch label="Translate to English" checked={s.translateToEnglish} onChange={(translateToEnglish) => void update({ translateToEnglish })} />
              </Row>
            </Group>

            <Group title="Appearance">
              <Row title="Theme" description="Follow Windows, or pick one.">
                <Select aria-label="Theme" value={s.theme} onChange={(e) => void update({ theme: e.target.value as ThemePref })} className="w-48">
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </Select>
              </Row>
              <Row title="Accent color" description="Utter's ember, or the accent color you chose in Windows.">
                <Select aria-label="Accent color" value={s.accentSource} onChange={(e) => void update({ accentSource: e.target.value as AccentSource })} className="w-48">
                  <option value="utter">Utter ember</option>
                  <option value="windows">Windows accent</option>
                </Select>
              </Row>
              <Row title="Text size" description="Follows Windows. Change it under Settings, Accessibility, Text size." />
            </Group>

            <Group title="Profile">
              <NameRow value={s.userName} onCommit={(userName) => void update({ userName })} />
            </Group>
          </>
        )}
      </WithSettings>
    </SettingsPage>
  );
}

function NameRow({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const commit = () => {
    const v = draft.trim();
    if (v !== value) onCommit(v);
  };
  return (
    <Row title="Your name" description="Used for greetings and signing off emails.">
      <Input
        aria-label="Your name"
        className="w-56"
        value={draft}
        maxLength={60}
        placeholder="Your name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </Row>
  );
}
