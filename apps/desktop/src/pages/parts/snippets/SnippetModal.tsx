import { useState } from "react";
import { Button, Input, Modal, Textarea } from "../../../components/ui";
import { ipc } from "../../../lib/ipc";
import type { Snippet } from "../../../lib/types";
import { errText } from "../dictionary/useLoader";
import { EXPANSION_MAX, TRIGGER_MAX, validateSnippet } from "./presets";

export interface SnippetDraft {
  id?: string;
  trigger: string;
  expansion: string;
  placeholder?: string;
}

const FORM_ID = "snippet-form";

export function SnippetModal({ draft, onClose, onSaved }: { draft: SnippetDraft; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [trigger, setTrigger] = useState(draft.trigger);
  const [expansion, setExpansion] = useState(draft.expansion);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const v = validateSnippet(trigger, expansion);
    if (v) return setError(v);
    setBusy(true);
    try {
      if (draft.id) await ipc.snippetsUpdate({ id: draft.id, trigger: trigger.trim(), expansion } satisfies Snippet);
      else await ipc.snippetsAdd(trigger.trim(), expansion);
      await onSaved();
    } catch (e) {
      setError(errText(e, "Couldn't save the snippet"));
      setBusy(false);
    }
  };

  const count = expansion.length;
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={draft.id ? "Edit snippet" : "New snippet"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={busy}>
            {draft.id ? "Save changes" : "Add snippet"}
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
        <Input
          label="When I say"
          autoFocus={!draft.expansion && !draft.placeholder}
          placeholder="my linkedin"
          value={trigger}
          onChange={(e) => {
            setTrigger(e.target.value);
            setError(null);
          }}
          helper={`${trigger.trim().length}/${TRIGGER_MAX}`}
        />
        <Textarea
          label="Insert"
          autoFocus={!!draft.placeholder && !draft.expansion}
          rows={5}
          placeholder={draft.placeholder ?? "The text or link to paste"}
          value={expansion}
          onChange={(e) => {
            setExpansion(e.target.value);
            setError(null);
          }}
          helper={<span className={count > EXPANSION_MAX ? "text-danger" : undefined}>{`${count.toLocaleString("en-US")} / ${EXPANSION_MAX.toLocaleString("en-US")}`}</span>}
        />
        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
