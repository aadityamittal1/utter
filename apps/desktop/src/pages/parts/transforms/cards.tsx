import { useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { Button, Chord, Input, Modal, ShortcutRecorder, Textarea } from "../../../components/ui";
import { cn } from "../../../lib/cn";
import { ipc } from "../../../lib/ipc";
import type { Transform } from "../../../lib/types";
import { errText } from "../dictionary/useLoader";

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

const CARD = "flex min-h-44 flex-col items-start rounded-card p-5 text-left transition-colors duration-[var(--dur-fast)] ease-fluent";

/** A transform as a card: keycaps, name, what it does. Opens the editor. */
export function TransformCard({ t, onOpen }: { t: Transform; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={cn(CARD, "border border-line bg-surface hover:border-line-strong hover:bg-row-hover")}>
      <span className="flex min-h-6 w-full items-center justify-between gap-2">
        {t.shortcut ? <Chord chord={t.shortcut} /> : <span className="text-caption text-faint">No shortcut</span>}
        {t.builtin && (
          <span className="inline-flex items-center gap-1 text-caption text-faint">
            <Lock size={12} strokeWidth={1.5} aria-hidden /> Built in
          </span>
        )}
      </span>
      <span className="mt-auto block text-body-strong text-ink">{t.name}</span>
      <span className="mt-1 line-clamp-2 block text-body text-muted">{t.instruction}</span>
    </button>
  );
}

/** The dashed "Create your own" card. */
export function CreateCard({ onClick, disabled, hint }: { onClick: () => void; disabled?: boolean; hint?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cn(CARD, "border border-dashed border-line-strong bg-transparent enabled:hover:bg-row-hover disabled:cursor-not-allowed disabled:opacity-60")}
    >
      <span className="flex size-6 items-center justify-center rounded-full bg-muted-surface text-ink">
        <Plus size={16} strokeWidth={1.5} aria-hidden />
      </span>
      <span className="mt-auto block text-body-strong text-ink">Create your own</span>
      <span className="mt-1 block text-body text-muted">{hint ?? "Write your own instruction"}</span>
    </button>
  );
}

export interface TransformDraft {
  id?: string;
  name: string;
  instruction: string;
  shortcut?: string;
  builtin?: boolean;
}

const FORM_ID = "transform-form";

/** Create or edit a transform. Built-ins show their instruction read-only: only the shortcut changes. */
export function TransformModal({ initial, onClose, onSaved, onDelete }: { initial: TransformDraft; onClose: () => void; onSaved: () => void; onDelete?: () => void }) {
  const [name, setName] = useState(initial.name);
  const [instruction, setInstruction] = useState(initial.instruction);
  const [shortcut, setShortcut] = useState(initial.shortcut);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const builtin = !!initial.builtin;
  const isNew = !initial.id;
  const dirty = name !== initial.name || instruction !== initial.instruction || shortcut !== initial.shortcut;

  const save = async () => {
    if (!builtin) {
      if (!name.trim()) return setError("Give it a name.");
      if (!instruction.trim()) return setError("Say what it should do to your text.");
    }
    setBusy(true);
    try {
      if (builtin && initial.id) await ipc.transformsUpdate({ id: initial.id, name: initial.name, instruction: initial.instruction, shortcut, builtin: true });
      else if (initial.id) await ipc.transformsUpdate({ id: initial.id, name: name.trim(), instruction: instruction.trim(), shortcut, builtin: false });
      else await ipc.transformsAdd(name.trim(), instruction.trim(), shortcut);
      setError(null);
      onSaved();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isNew ? "Create a transform" : builtin ? initial.name : "Edit transform"}
      footer={
        <>
          {onDelete && (
            <Button variant="danger" icon={<Trash2 size={16} strokeWidth={1.5} />} onClick={onDelete} className="mr-auto">
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={busy} disabled={!isNew && !dirty}>
            {isNew ? "Add transform" : "Save"}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {builtin ? (
          <p className="text-body text-muted">{initial.instruction}</p>
        ) : (
          <>
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
          </>
        )}
        <div>
          <div className="mb-1.5 text-body-strong text-ink">Shortcut</div>
          <div className="flex items-center gap-3">
            <ShortcutField value={shortcut} onChange={setShortcut} label={name || "New transform"} />
            {!shortcut && <span className="text-caption text-muted">Optional. Select text anywhere and press it.</span>}
          </div>
        </div>
        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
