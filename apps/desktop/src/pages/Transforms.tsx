import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, EmptyState, PageHeader, SkeletonRows } from "../components/ui";
import { ipc } from "../lib/ipc";
import { formatChord } from "../lib/format";
import { toast, useSettings } from "../lib/store";
import type { Transform } from "../lib/types";
import { errText, useLoader } from "./parts/dictionary/useLoader";
import { BuiltinCard, CustomCard, ExplainerCard } from "./parts/transforms/cards";

const MAX_CUSTOM = 8;

export default function Transforms() {
  const settings = useSettings((s) => s.settings);
  const { data: items, error: loadError, reload: load } = useLoader<Transform[]>(ipc.transformsList);
  const [adding, setAdding] = useState(false);

  const remove = async (t: Transform) => {
    try {
      await ipc.transformsDelete(t.id);
      await load();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const builtins = items?.filter((t) => t.builtin) ?? [];
  const custom = items?.filter((t) => !t.builtin) ?? [];
  const full = custom.length >= MAX_CUSTOM;
  const sc = settings?.shortcuts ?? {};

  return (
    <div>
      <PageHeader title="Transforms" description="Select text in any app, press a shortcut, and Claude rewrites it in place. Use the built-ins or teach it your own." />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ExplainerCard title="Dictate & enhance" chord={formatChord(sc.dictateEnhance?.[0])}>
          Speak as usual and Claude polishes the result: clearer wording and tone for the app you are in. Needs an API key.
        </ExplainerCard>
        <ExplainerCard title="Command mode" chord={formatChord(sc.command?.[0])}>
          Select text, hold the keys and say what to change: “make this friendlier” or “translate to Spanish”. Needs an API key.
        </ExplainerCard>
      </div>

      {loadError ? (
        <div className="mt-8">
          <EmptyState title="Couldn't load transforms" description={loadError} action={<Button onClick={() => void load()}>Try again</Button>} />
        </div>
      ) : !items ? (
        <div className="mt-8">
          <SkeletonRows rows={3} />
        </div>
      ) : (
        <>
          <h2 className="mb-3 mt-8 text-[15px] font-semibold text-ink">Built in</h2>
          <div className="flex flex-col gap-3">
            {builtins.map((t) => (
              <BuiltinCard key={t.id} t={t} onChanged={() => void load()} />
            ))}
          </div>

          <div className="mb-3 mt-8 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-ink">
              Your transforms{" "}
              <span className="num ml-1 font-normal text-faint">
                {custom.length} of {MAX_CUSTOM}
              </span>
            </h2>
            <Button variant="primary" size="sm" icon={<Plus size={15} />} disabled={full || adding} onClick={() => setAdding(true)} title={full ? `You can add up to ${MAX_CUSTOM} custom transforms.` : undefined}>
              New transform
            </Button>
          </div>

          <div className="flex flex-col gap-3">
            {adding && (
              <CustomCard
                initial={{ name: "", instruction: "" }}
                onDiscard={() => setAdding(false)}
                onSaved={() => {
                  setAdding(false);
                  void load();
                }}
              />
            )}
            {custom.map((t) => (
              <CustomCard
                key={`${t.id}:${t.name}:${t.instruction}:${t.shortcut ?? ""}`}
                initial={{ id: t.id, name: t.name, instruction: t.instruction, shortcut: t.shortcut }}
                onSaved={() => {
                  toast.success("Saved");
                  void load();
                }}
                onDelete={() => void remove(t)}
              />
            ))}
            {custom.length === 0 && !adding && (
              <EmptyState title="No custom transforms yet" description="Try “Turn into bullet points” or “Write as a friendly reply”. Give it a shortcut and it is one keypress away." />
            )}
          </div>
        </>
      )}
    </div>
  );
}
