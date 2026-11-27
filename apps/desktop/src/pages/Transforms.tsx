import { useRef, useState } from "react";
import { Button, Card, Chord, EmptyState, SkeletonRows } from "../components/ui";
import { ipc } from "../lib/ipc";
import { toast, useSettings } from "../lib/store";
import type { Transform } from "../lib/types";
import { errText, useLoader } from "./parts/dictionary/useLoader";
import { Banner, BANNER_BUTTON, RewriteLines } from "./parts/home/Banner";
import { focusFallback } from "./parts/snippets/focus";
import { CreateCard, TransformCard, TransformModal, type TransformDraft } from "./parts/transforms/cards";

const MAX_CUSTOM = 8;

function FeatureRow({ title, chord, children }: { title: string; chord: string | undefined; children: string }) {
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <div className="min-w-0">
        <div className="text-body-strong text-ink">{title}</div>
        <div className="mt-0.5 max-w-[52ch] text-caption text-muted">{children}</div>
      </div>
      <Chord chord={chord} className="shrink-0" />
    </div>
  );
}

export default function Transforms() {
  const settings = useSettings((s) => s.settings);
  const { data: items, error: loadError, reload: load } = useLoader<Transform[]>(ipc.transformsList);
  // undefined = closed, otherwise the draft being created or edited
  const [editing, setEditing] = useState<TransformDraft | undefined>(undefined);
  const createRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openEditor = (d: TransformDraft) => {
    openerRef.current = document.activeElement as HTMLElement | null;
    setEditing(d);
  };

  const remove = async (id: string) => {
    try {
      await ipc.transformsDelete(id);
      setEditing(undefined);
      await load();
      // The card that opened the editor is gone: land on Create new.
      focusFallback(openerRef.current, () => createRef.current);
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const customCount = items?.filter((t) => !t.builtin).length ?? 0;
  const full = customCount >= MAX_CUSTOM;
  const sc = settings?.shortcuts ?? {};
  const hinted = items?.find((t) => t.shortcut);
  const create = () => openEditor({ name: "", instruction: "" });

  return (
    <div>
      <header className="flex items-center justify-between gap-6 pb-6">
        <h1 className="text-title text-ink">Transforms</h1>
        {hinted?.shortcut && (
          <div className="flex shrink-0 items-center gap-2 text-body text-muted">
            <Chord chord={hinted.shortcut} />
            <span>runs {hinted.name} on selected text</span>
          </div>
        )}
      </header>

      <div className="flex flex-col gap-6">
        <Banner
          title="Rewrite text in place"
          art={<RewriteLines />}
          actions={
            <Button className={BANNER_BUTTON} onClick={create} disabled={full}>
              Create a transform
            </Button>
          }
        >
          Each transform is an instruction for Claude. Needs an API key.
        </Banner>

        <Card className="divide-y divide-line px-5">
          <FeatureRow title="Dictate and enhance" chord={sc.dictateEnhance?.[0]}>
            Hold the keys and speak. Claude polishes the result for the app you are in.
          </FeatureRow>
          <FeatureRow title="Command mode" chord={sc.command?.[0]}>
            Select text, hold the keys and say what to change, like “make this friendlier”.
          </FeatureRow>
        </Card>

        <section aria-labelledby="my-transforms">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <h2 id="my-transforms" className="text-serif-heading text-ink">
                My transforms
              </h2>
              <span className="text-caption tabular-nums text-faint">
                {customCount} of {MAX_CUSTOM} custom
              </span>
            </div>
            <Button ref={createRef} variant="primary" disabled={full} onClick={create} title={full ? `You can add up to ${MAX_CUSTOM} custom transforms.` : undefined}>
              Create new
            </Button>
          </div>

          {loadError ? (
            <EmptyState title="Couldn't load transforms" description={loadError} action={<Button onClick={() => void load()}>Try again</Button>} />
          ) : !items ? (
            <SkeletonRows rows={3} />
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {items.map((t) => (
                <li key={t.id} className="flex">
                  <TransformCard t={t} onOpen={() => openEditor({ id: t.id, name: t.name, instruction: t.instruction, shortcut: t.shortcut, builtin: t.builtin })} />
                </li>
              ))}
              <li className="flex">
                <CreateCard onClick={create} disabled={full} hint={full ? `Limit of ${MAX_CUSTOM} reached` : undefined} />
              </li>
            </ul>
          )}
        </section>
      </div>

      {editing && (
        <TransformModal
          key={editing.id ?? "new"}
          initial={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            const wasNew = !editing.id;
            setEditing(undefined);
            if (!wasNew) toast.success("Saved");
            void load();
          }}
          onDelete={editing.id && !editing.builtin ? () => void remove(editing.id!) : undefined}
        />
      )}
    </div>
  );
}
