import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, IconButton, Input, Select, SettingRow, Switch } from "../../components/ui";
import { ipc } from "../../lib/ipc";
import { toast } from "../../lib/store";
import { CATEGORIES, type Category, type CategoryRule, type HistoryRetention } from "../../lib/types";
import { CATEGORY_LABELS, cleanRule, moveItem } from "./helpers";
import { Section, WithSettings } from "./parts";

export default function Privacy() {
  return (
    <WithSettings>
      {(s, update) => (
        <div className="flex flex-col gap-4">
          <Section title="Your data" description="Audio never leaves your PC. There is no telemetry.">
            <SettingRow title="Keep history" description="How long Utter remembers what you dictated.">
              <Select aria-label="History retention" value={s.historyRetention} onChange={(e) => void update({ historyRetention: e.target.value as HistoryRetention })} className="w-44">
                <option value="forever">Forever</option>
                <option value="day">For one day</option>
                <option value="never">Don't keep</option>
              </Select>
            </SettingRow>
            <SettingRow title="Keep audio" description="Save recordings next to history so you can replay and retry them. Stored only on this PC.">
              <Switch label="Keep audio" checked={s.keepAudio} disabled={s.historyRetention === "never"} onChange={(keepAudio) => void update({ keepAudio })} />
            </SettingRow>
            <SettingRow title="Context awareness" description="Read the active app's name and window title to pick a writing style. Nothing else on screen is read.">
              <Switch label="Context awareness" checked={s.contextAwareness} onChange={(contextAwareness) => void update({ contextAwareness })} />
            </SettingRow>
            <ClearHistory />
          </Section>

          <Section
            title="Category rules"
            description="Tell Utter which category an app belongs to. The first matching rule wins, so order matters. Leave a field empty to match anything."
          >
            <RulesEditor rules={s.categoryRules} onChange={(categoryRules) => void update({ categoryRules })} />
          </Section>
        </div>
      )}
    </WithSettings>
  );
}

function ClearHistory() {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 6000);
    return () => clearTimeout(t);
  }, [confirm]);
  const run = async () => {
    setBusy(true);
    try {
      await ipc.historyClear();
      toast.success("History deleted");
      setConfirm(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingRow title="Delete all history" description="Removes every dictation and saved recording. This can't be undone.">
      {confirm ? (
        <span className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            Keep it
          </Button>
          <Button size="sm" variant="danger" loading={busy} icon={<Trash2 size={14} />} onClick={() => void run()}>
            Yes, delete everything
          </Button>
        </span>
      ) : (
        <Button variant="danger" icon={<Trash2 size={15} />} onClick={() => setConfirm(true)}>
          Delete all history
        </Button>
      )}
    </SettingRow>
  );
}

const hasMatch = (r: CategoryRule) => !!r.process?.trim() || !!r.titleContains?.trim();

function RulesEditor({ rules, onChange }: { rules: CategoryRule[]; onChange: (r: CategoryRule[]) => void }) {
  // Rows are edited locally. Only rules with a process or title are ever persisted,
  // so a freshly added blank row can't override classification for every app.
  const [draft, setDraft] = useState(rules);
  const [seen, setSeen] = useState(rules);
  const [focused, setFocused] = useState(false);
  if (seen !== rules && !focused) {
    setSeen(rules);
    setDraft(rules);
  }

  const persist = (next: CategoryRule[]) => {
    const cleaned = next.map(cleanRule).filter(hasMatch);
    if (JSON.stringify(cleaned) !== JSON.stringify(rules.map(cleanRule))) onChange(cleaned);
  };
  const commit = (next: CategoryRule[]) => {
    setDraft(next);
    persist(next);
  };
  const patch = (i: number, p: Partial<CategoryRule>) => setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <div
      className="py-4"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {draft.length === 0 ? (
        <p className="rounded-control border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-muted">
          No rules yet. Utter guesses the category from the app. Add a rule to override it, for example <span className="font-mono">code.exe</span> as Code.
        </p>
      ) : (
        <table className="w-full border-separate border-spacing-y-2">
          <caption className="sr-only">Category rules, first match wins</caption>
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="w-[150px] px-1 font-normal">Category</th>
              <th scope="col" className="px-1 font-normal">Process name</th>
              <th scope="col" className="px-1 font-normal">Title contains</th>
              <th scope="col" className="w-[96px]"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {draft.map((r, i) => (
              <tr key={i}>
                <td className="pr-2 align-top">
                  <Select aria-label={`Rule ${i + 1} category`} value={r.category} onChange={(e) => commit(draft.map((x, j) => (j === i ? { ...x, category: e.target.value as Category } : x)))}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="pr-2 align-top">
                  <Input aria-label={`Rule ${i + 1} process name`} placeholder="e.g. slack.exe" value={r.process ?? ""} onChange={(e) => patch(i, { process: e.target.value })} onBlur={() => persist(draft)} />
                </td>
                <td className="pr-2 align-top">
                  <Input
                    aria-label={`Rule ${i + 1} title contains`}
                    placeholder="e.g. Gmail"
                    value={r.titleContains ?? ""}
                    onChange={(e) => patch(i, { titleContains: e.target.value })}
                    onBlur={() => persist(draft)}
                    helper={hasMatch(r) ? undefined : "Not saved until you add a process or title."}
                  />
                </td>
                <td className="align-top">
                  <div className="flex items-center justify-end">
                    <IconButton label={`Move rule ${i + 1} up`} disabled={i === 0} onClick={() => commit(moveItem(draft, i, i - 1))}>
                      <ArrowUp size={15} />
                    </IconButton>
                    <IconButton label={`Move rule ${i + 1} down`} disabled={i === draft.length - 1} onClick={() => commit(moveItem(draft, i, i + 1))}>
                      <ArrowDown size={15} />
                    </IconButton>
                    <IconButton label={`Remove rule ${i + 1}`} onClick={() => commit(draft.filter((_, j) => j !== i))}>
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3">
        <Button size="sm" icon={<Plus size={14} />} onClick={() => setDraft([...draft, { category: "other" }])}>
          Add rule
        </Button>
      </div>
    </div>
  );
}
