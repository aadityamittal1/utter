import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, Trash2, X } from "lucide-react";
import { Button, Select, SettingRow, SkeletonRows, Switch } from "../../components/ui";
import { ipc } from "../../lib/ipc";
import { formatBytes } from "../../lib/format";
import type { ModelStatus } from "../../lib/types";
import { LANGUAGES, modelTraits, without } from "./helpers";
import { beginDownload, clearDownloadError, failDownload, markCancelled, useDownloads } from "./downloads";
import { Badge, Section, WithSettings } from "./parts";

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
    <WithSettings>
      {(s, update) => (
        <div className="flex flex-col gap-4">
          <Section title="Language">
            <SettingRow title="Spoken language" description="Auto-detect works well for most people. Pick one for best accuracy.">
              <Select aria-label="Spoken language" value={s.language} onChange={(e) => void update({ language: e.target.value })} className="w-48">
                <option value="auto">Auto-detect</option>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </SettingRow>
            <SettingRow title="Translate to English" description="Speak in any language and get English text. Needs a multilingual model.">
              <Switch label="Translate to English" checked={s.translateToEnglish} onChange={(translateToEnglish) => void update({ translateToEnglish })} />
            </SettingRow>
          </Section>

          <Section title="Speech models" description="Models run on your PC. Audio never leaves it.">
            <div className="flex flex-col gap-3 pt-4">
              {loadError && (
                <p role="alert" className="text-sm text-danger">
                  Couldn't load models: {loadError}
                </p>
              )}
              {!models && !loadError && <SkeletonRows rows={3} />}
              {models?.map((m) => {
                const t = modelTraits(m);
                const p = progress[m.id];
                const pct = p && p.total > 0 ? Math.min(100, Math.round((p.downloaded / p.total) * 100)) : 0;
                const err = errors[m.id];
                return (
                  <article
                    key={m.id}
                    aria-label={m.label}
                    className={`rounded-card border px-4 py-3.5 ${m.active ? "border-ember bg-ember-soft" : "border-line bg-surface"}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-ink">{m.label}</h3>
                          {m.recommended && <Badge tone="ember">Recommended</Badge>}
                          {m.active && <Badge tone="success">Active</Badge>}
                        </div>
                        <p className="mt-0.5 text-[13px] text-muted">{t.blurb}</p>
                        <p className="mt-1.5 text-xs text-faint">
                          {formatBytes(m.sizeBytes)} · {t.accuracy} · {t.speed} · {m.multilingual ? "Multilingual" : "English only"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {p ? (
                          <Button size="sm" icon={<X size={14} />} onClick={() => void cancel(m.id)}>
                            Cancel
                          </Button>
                        ) : m.downloaded ? (
                          <>
                            {!m.active && (
                              <Button size="sm" variant="primary" icon={<Check size={14} />} loading={busy === m.id} onClick={() => void run(m.id, () => ipc.setActiveModel(m.id))}>
                                Use
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="danger"
                              icon={<Trash2 size={14} />}
                              disabled={m.active}
                              title={m.active ? "Switch to another model to delete this one" : undefined}
                              onClick={() => void run(m.id, () => ipc.deleteModel(m.id))}
                            >
                              Delete
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" icon={<Download size={14} />} onClick={() => void download(m.id)}>
                            Download
                          </Button>
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
                          className="h-1.5 overflow-hidden rounded-full bg-muted-surface"
                        >
                          <div className="h-full rounded-full bg-ember transition-[width] duration-200" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {p.total > 0 ? `${formatBytes(p.downloaded)} of ${formatBytes(p.total)}` : "Starting..."}
                        </p>
                      </div>
                    )}
                    {err && (
                      <p role="alert" className="mt-2 text-xs text-danger">
                        {err}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </Section>
        </div>
      )}
    </WithSettings>
  );
}
