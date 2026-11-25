import { useState } from "react";
import { Input, Select, SettingRow, Switch } from "../../components/ui";
import type { ThemePref } from "../../lib/types";
import { Section, WithSettings } from "./parts";

export default function General() {
  return (
    <WithSettings>
      {(s, update) => (
        <div className="flex flex-col gap-4">
          <Section title="Profile">
            <NameRow value={s.userName} onCommit={(userName) => void update({ userName })} />
          </Section>
          <Section title="Appearance and behavior">
            <SettingRow title="Theme" description="Follow Windows, or pick one.">
              <Select aria-label="Theme" value={s.theme} onChange={(e) => void update({ theme: e.target.value as ThemePref })} className="w-40">
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </SettingRow>
            <SettingRow title="Launch at login" description="Start Utter in the tray when you sign in to Windows.">
              <Switch label="Launch at login" checked={s.launchAtLogin} onChange={(launchAtLogin) => void update({ launchAtLogin })} />
            </SettingRow>
            <SettingRow title="Sounds" description="A soft tick when recording starts and stops.">
              <Switch label="Sounds" checked={s.sounds} onChange={(sounds) => void update({ sounds })} />
            </SettingRow>
            <SettingRow title="Show pill" description="The small floating indicator while you dictate.">
              <Switch label="Show pill" checked={s.showPill} onChange={(showPill) => void update({ showPill })} />
            </SettingRow>
            <SettingRow title="Keep microphone warm" description="Keeps the mic open so the first word is never clipped. Your PC shows the mic as in use.">
              <Switch label="Keep microphone warm" checked={s.keepMicWarm} onChange={(keepMicWarm) => void update({ keepMicWarm })} />
            </SettingRow>
          </Section>
        </div>
      )}
    </WithSettings>
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
    <SettingRow title="Your name" description="Used for greetings and signing off emails.">
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
    </SettingRow>
  );
}
