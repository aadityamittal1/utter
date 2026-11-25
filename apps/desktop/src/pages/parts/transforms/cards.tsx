import { useState } from "react";
import { Lock, Trash2 } from "lucide-react";
import { Button, Card, Chord, Input, ShortcutRecorder, Textarea } from "../../../components/ui";
import { ipc } from "../../../lib/ipc";
import { toast } from "../../../lib/store";
import type { Transform } from "../../../lib/types";

export const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong");

export function ShortcutField({ value, onChange, label }: { value: string | undefined; onChange: (v: string | undefined) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <ShortcutRecorder value={value} onChange={onChange} label={label} />
      {value && (
        <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
          Clear
        </Button>
      )}
    </div>
  );
}

/** Polish / Prompt engineer: instruction is fixed, only the shortcut can change. */
export function BuiltinCard({ t, onChanged }: { t: Transform; onChanged: () => void }) {
  const setShortcut = async (shortcut: string | undefined) => {
    try {
      await ipc.transformsUpdate({ ...t, shortcut });
      onChanged();
    } catch (e) {
      toast.error(errText(e));
    }
  };
  return (
    <Card className="flex items-start justify-between gap-6 p-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-semibold text-ink">{t.name}</h3>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted-surface px-2 py-0.5 text-[11px] text-muted">
            <Lock size={10} aria-hidden /> Built in
          </span>
        </div>
        <p className="mt-1 max-w-[54ch] text-[13px] leading-relaxed text-muted">{t.instruction}</p>
      </div>
      <div className="shrink-0">
        <div className="mb-1.5 text-right text-[11px] font-medium text-faint">Shortcut</div>
        <ShortcutField value={t.shortcut} onChange={setShortcut} label={t.name} />
      </div>
    </Card>
  );
}

export interface CustomDraft {
  id?: string;
  name: string;
  instruction: string;
  shortcut?: string;
}

export function CustomCard({ initial, onSaved, onDiscard, onDelete }: { initial: CustomDraft; onSaved: () => void; onDiscard?: () => void; onDelete?: () => void }) {
  const [name, setName] = useState(initial.name);
  const [instruction, setInstruction] = useState(initial.instruction);
  const [shortcut, setShortcut] = useState(initial.shortcut);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dirty = name !== initial.name || instruction !== initial.instruction || shortcut !== initial.shortcut;
  const isNew = !initial.id;

  const save = async () => {
    if (!name.trim()) return setError("Give it a name.");
    if (!instruction.trim()) return setError("Say what it should do to your text.");
    setBusy(true);
    try {
      if (initial.id) await ipc.transformsUpdate({ id: initial.id, name: name.trim(), instruction: instruction.trim(), shortcut, builtin: false });
      else await ipc.transformsAdd(name.trim(), instruction.trim(), shortcut);
      setError(null);
      onSaved();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          label="Name"
          value={name}
          autoFocus={isNew}
          placeholder="Make it shorter"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
        <Textarea
          label="What should Claude do?"
          rows={3}
          value={instruction}
          placeholder="Cut this to the essential points without changing the meaning."
          onChange={(e) => {
            setInstruction(e.target.value);
            setError(null);
          }}
        />
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-ink">Shortcut</div>
          <div className="flex items-center gap-3">
            <ShortcutField value={shortcut} onChange={setShortcut} label={name || "New transform"} />
            {!shortcut && <span className="text-xs text-muted">Optional. Select text anywhere and press it.</span>}
          </div>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between">
          <div>
            {onDelete && (
              <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={onDelete}>
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {onDiscard && <Button onClick={onDiscard}>Cancel</Button>}
            <Button type="submit" variant="primary" loading={busy} disabled={!isNew && !dirty}>
              {isNew ? "Add transform" : "Save"}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

export function ExplainerCard({ title, chord, children }: { title: string; chord: string[] | undefined; children: string }) {
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{children}</p>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        Hold <Chord chord={chord} />
      </div>
    </Card>
  );
}
