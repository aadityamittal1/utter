import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus, RotateCcw, X } from "lucide-react";
import { Button, IconButton, ShortcutRecorder } from "../../components/ui";
import { ipc } from "../../lib/ipc";
import { toast, useSettings } from "../../lib/store";
import type { Action, Transform } from "../../lib/types";
import { actionLabel, conflictsFor, findConflicts, removeBinding, setBinding } from "./helpers";
import { Section, WithSettings } from "./parts";

const CORE: Array<{ action: Action; title: string; hint: string }> = [
  { action: "dictate", title: "Dictate", hint: "Hold to talk, release to insert. Double-tap to go hands-free." },
  { action: "handsFree", title: "Hands-free", hint: "Press once to start, again to stop." },
  { action: "dictateEnhance", title: "Dictate and enhance", hint: "Hold to talk; Claude polishes the result." },
  { action: "command", title: "Command", hint: "Hold and speak an instruction for the selected text." },
  { action: "cancel", title: "Cancel", hint: "Discards the recording. Only active while recording." },
  { action: "pasteLast", title: "Paste last dictation", hint: "Inserts your most recent result again." },
  { action: "copyLast", title: "Copy last dictation", hint: "Copies your most recent result to the clipboard." },
  { action: "quickNote", title: "Quick note", hint: "Dictate straight into a new note." },
];

export default function Shortcuts() {
  const [transforms, setTransforms] = useState<Transform[]>([]);
  const [adding, setAdding] = useState<Action | null>(null);
  useEffect(() => {
    ipc
      .transformsList()
      .then(setTransforms)
      .catch((e) => toast.error(String(e)));
  }, []);
  const names = useMemo(() => Object.fromEntries(transforms.map((t) => [t.id, t.name])), [transforms]);

  return (
    <WithSettings>
      {(s, update) => {
        const rows = [
          ...CORE,
          ...transforms.map((t) => ({ action: `transform:${t.id}` as Action, title: t.name, hint: "Rewrites the selected text." })),
        ];
        // Compute from the latest store state at save time, not this render's snapshot.
        const mutate = (fn: (cur: typeof s.shortcuts) => typeof s.shortcuts) =>
          void update({ shortcuts: fn(useSettings.getState().settings?.shortcuts ?? s.shortcuts) });
        const allConflicts = findConflicts(s.shortcuts);
        const reset = async () => {
          try {
            await ipc.resetShortcuts();
            await useSettings.getState().load();
            toast.success("Shortcuts reset to defaults");
          } catch (e) {
            toast.error(String(e));
          }
        };
        return (
          <div className="flex flex-col gap-4">
            {allConflicts.length > 0 && (
              <p role="alert" className="flex items-center gap-2 rounded-control bg-danger-soft px-3 py-2 text-[13px] text-danger">
                <AlertTriangle size={14} aria-hidden />
                {allConflicts.length === 1 ? "One shortcut is" : `${allConflicts.length} shortcuts are`} used by more than one action. Only one will fire.
              </p>
            )}
            <Section title="Shortcuts" description="Click a shortcut, then press the keys you want. Each action can have more than one.">
              {rows.map(({ action, title, hint }) => {
                const chords = s.shortcuts[action] ?? [];
                const slots = chords.length === 0 ? [""] : adding === action ? [...chords, ""] : chords;
                return (
                  <div key={action} className="flex items-start justify-between gap-6 py-3.5">
                    <div className="min-w-0 pt-1.5">
                      <div className="text-sm font-medium text-ink">{title}</div>
                      <div className="mt-0.5 max-w-[44ch] text-[13px] text-muted">{hint}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {slots.map((chord, i) => {
                        const clash = chord ? conflictsFor(s.shortcuts, action, chord) : [];
                        return (
                          <div key={`${i}-${chord}`} className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-1">
                              <ShortcutRecorder
                                label={title}
                                value={chord || undefined}
                                onChange={(c) => {
                                  setAdding(null);
                                  mutate((cur) => setBinding(cur, action, i, c));
                                }}
                              />
                              {!chord && adding === action && (
                                <IconButton label={`Cancel adding ${title} shortcut`} onClick={() => setAdding(null)}>
                                  <X size={15} />
                                </IconButton>
                              )}
                              {chord && (
                                <IconButton label={`Remove ${title} shortcut`} onClick={() => mutate((cur) => removeBinding(cur, action, i))}>
                                  <X size={15} />
                                </IconButton>
                              )}
                            </div>
                            {clash.length > 0 && (
                              <p role="alert" className="flex items-center gap-1 text-xs text-danger">
                                <AlertTriangle size={12} aria-hidden />
                                Also used by {clash.map((a) => actionLabel(a, names)).join(", ")}
                              </p>
                            )}
                          </div>
                        );
                      })}
                      {chords.length > 0 && adding !== action && (
                        <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setAdding(action)}>
                          Add another
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </Section>
            <div>
              <Button icon={<RotateCcw size={15} />} onClick={() => void reset()}>
                Reset all to defaults
              </Button>
            </div>
          </div>
        );
      }}
    </WithSettings>
  );
}
