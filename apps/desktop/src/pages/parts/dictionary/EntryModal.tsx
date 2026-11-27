import { useState } from "react";
import { Button, Input, Modal, Switch } from "../../../components/ui";
import { ipc } from "../../../lib/ipc";
import type { DictEntry } from "../../../lib/types";
import { errText } from "./useLoader";
import { countLabel, validateEntry, WORD_MAX, type EntryErrors } from "./validate";

const FORM_ID = "dictionary-entry-form";

/** Add a word, or edit an existing entry (word and, optionally, what it is usually misheard as). */
export function EntryModal({ entry, onClose, onSaved }: { entry: DictEntry | null; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [word, setWord] = useState(entry?.word ?? "");
  const [fix, setFix] = useState(!!entry?.heardAs);
  const [heard, setHeard] = useState(entry?.heardAs ?? "");
  const [errs, setErrs] = useState<EntryErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clear = () => {
    setErrs({});
    setServerError(null);
  };

  const submit = async () => {
    const v = validateEntry(word, fix ? heard : "");
    if (v.word || v.heardAs) return setErrs(v);
    setBusy(true);
    try {
      const heardAs = fix && heard.trim() ? heard.trim() : undefined;
      if (entry) await ipc.dictionaryUpdate({ ...entry, word: word.trim(), heardAs, auto: false });
      else await ipc.dictionaryAdd(word.trim(), heardAs);
      await onSaved();
    } catch (e) {
      setServerError(errText(e)); // shown under the word field
      setBusy(false);
    }
  };

  const live = validateEntry(word, fix ? heard : "");
  const wordError = serverError ?? (word.trim().length > WORD_MAX ? live.word : errs.word) ?? null;
  const heardError = (heard.trim().length > WORD_MAX ? live.heardAs : errs.heardAs) ?? null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={entry ? "Edit word" : "Add a word"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={FORM_ID} variant="primary" loading={busy} disabled={!word.trim()}>
            {entry ? "Save changes" : "Add word"}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Input
          label="Word or phrase"
          placeholder="Kubernetes"
          autoFocus
          value={word}
          onChange={(e) => {
            setWord(e.target.value);
            clear();
          }}
          helper={countLabel(word) ?? `Up to ${WORD_MAX} characters.`}
          error={wordError}
        />
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-body-strong text-ink">Correct a misspelling</div>
            <div className="text-caption text-muted">Utter swaps what it heard for the word above.</div>
          </div>
          <Switch checked={fix} onChange={setFix} label="Correct a misspelling" />
        </div>
        {fix && (
          <Input
            label="Heard as"
            placeholder="cooper netties"
            value={heard}
            onChange={(e) => {
              setHeard(e.target.value);
              clear();
            }}
            error={heardError}
            helper={countLabel(heard) ?? "How the speech engine usually gets it wrong."}
          />
        )}
      </form>
    </Modal>
  );
}
