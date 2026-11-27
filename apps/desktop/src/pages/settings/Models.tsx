import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, Trash2, X } from "lucide-react";
import { Button, SkeletonRows } from "../../components/ui";
import { ipc } from "../../lib/ipc";
import { formatBytes } from "../../lib/format";
import type { ModelStatus } from "../../lib/types";
import { modelTraits, without } from "./helpers";
import { beginDownload, clearDownloadError, failDownload, markCancelled, useDownloads } from "./downloads";
import { Badge, Block, Group, RaisedButton, SettingsPage, WithSettings } from "./parts";

export default function Models() {
  const [models, setModels] = useState<ModelStatus[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const { progress, errors: dlErrors, doneTick } = useDownloads();
  const errors = { ...dlErrors, ...localErrors };
  const seq = useRef(0);

  /** Latest call wins, so a slow earlier refresh can't overwrite newer data. */
  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const list = await ipc.listModels();
      if (mine !== seq.current) return;
      setModels(list);
      setLoadError(null);
    } catch (e) {
      if (mine === seq.current) setLoadError(String(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, doneTick]);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setLocalErrors((c) => without(c, id));
    clearDownloadError(id);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setLocalErrors((cur) => ({ ...cur, [id]: String(e) }));
    } finally {
      setBusy(null);
    }
  };

  const download = (id: string) =>
    run(id, async () => {
      beginDownload(id);
      try {
        await ipc.downloadModel(id);
      } catch (e) {
        failDownload(id, String(e));
      }
    });
  const cancel = (id: string) =>
    run(id, async () => {
      markCancelled(id);
      await ipc.cancelDownload(id);
    });

  return (
    <SettingsPage title="Speech model">
      <WithSettings>
        {(s) => (
          <Group
            title="Models on this PC"
            description={`Speech recognition runs on your PC and audio never leaves it.${s.translateToEnglish ? " Translate to English is on, so pick a multilingual model." : ""}`}
          >
            {loadError && (
              <Block>
                <p role="alert" className="text-body text-danger">
                  Couldn't load models: {loadError}
                </p>
              </Block>
            )}
            {!models && !loadError && (
              <Block>
                <SkeletonRows rows={3} />
              </Block>
            )}
            {models?.map((m) => {
              const t = modelTraits(m);
              const p = progress[m.id];
              const pct = p && p.total > 0 ? Math.min(100, Math.round((p.downloaded / p.total) * 100)) : 0;
              const err = errors[m.id];
              return (
                <article key={m.id} aria-label={m.label} className="py-4">
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-body-strong text-ink">{m.label}</h3>
                        {m.recommended && <Badge tone="ember">Recommended</Badge>}
                        {m.active && <Badge tone="success">Active</Badge>}
                      </div>
                      <p className="mt-0.5 text-body text-muted">{t.blurb}</p>
                      <p className="mt-1 text-caption text-faint">
                        {formatBytes(m.sizeBytes)} · {t.accuracy} · {t.speed} · {m.multilingual ? "Multilingual" : "English only"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {p ? (
                        <RaisedButton icon={<X size={16} strokeWidth={1.5} />} onClick={() => void cancel(m.id)}>
                          Cancel
                        </RaisedButton>
                      ) : m.downloaded ? (
                        <>
                          {!m.active && (
                            <Button size="sm" variant="primary" icon={<Check size={16} strokeWidth={1.5} />} loading={busy === m.id} onClick={() => void run(m.id, () => ipc.setActiveModel(m.id))}>
                              Use
                            </Button>
                          )}
                          <RaisedButton
                            variant="danger"
                            icon={<Trash2 size={16} strokeWidth={1.5} />}
                            disabled={m.active}
                            title={m.active ? "Switch to another model to delete this one" : undefined}
                            onClick={() => void run(m.id, () => ipc.deleteModel(m.id))}
                          >
                            Delete
                          </RaisedButton>
                        </>
                      ) : (
                        <RaisedButton icon={<Download size={16} strokeWidth={1.5} />} onClick={() => void download(m.id)}>
                          Download
                        </RaisedButton>
                      )}
                    </div>
                  </div>
                  {p && (
                    <div className="mt-3">
                      <div
                        role="progressbar"
                        aria-label={`Downloading ${m.label}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pct}
                        className="h-1.5 overflow-hidden rounded-full bg-(--surface-tertiary)"
                      >
                        <div className="h-full rounded-full bg-ember transition-[width] duration-[167ms] ease-fluent" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1 text-caption text-muted tabular-nums">{p.total > 0 ? `${formatBytes(p.downloaded)} of ${formatBytes(p.total)}` : "Starting…"}</p>
                    </div>
                  )}
                  {err && (
                    <p role="alert" className="mt-2 text-caption text-danger">
                      {err}
                    </p>
                  )}
                </article>
              );
            })}
          </Group>
        )}
      </WithSettings>
    </SettingsPage>
  );
}
