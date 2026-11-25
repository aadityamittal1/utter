import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCopy, CornerDownLeft, Ellipsis, Pencil, Play, Plus, RotateCw, Square, Trash2, X, Sparkles } from "lucide-react";
import { ipc } from "../../../lib/ipc";
import { formatTime } from "../../../lib/format";
import { toast } from "../../../lib/store";
import type { HistoryItem } from "../../../lib/types";
import { Button, IconButton, Textarea } from "../../../components/ui";
import { CATEGORY_LABEL } from "./shared";
import { wordDiff } from "./diff";
import { playClip } from "./player";

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong");

export function HistoryRow({ item, onChanged }: { item: HistoryItem; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.finalText);
  const [busy, setBusy] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [playing, setPlaying] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const aliveRef = useRef(true);

  // Silence this row's clip if the row goes away (navigation, delete, filter).
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopRef.current?.();
    };
  }, []);

  const diff = useMemo(() => (open ? wordDiff(item.rawText, item.finalText) : []), [open, item.rawText, item.finalText]);
  const changed = item.rawText.trim() !== item.finalText.trim();

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function togglePlay() {
    if (playing) {
      stopRef.current?.();
      return;
    }
    try {
      const path = await ipc.historyAudioPath(item.id);
      if (!aliveRef.current) return;
      if (!path) {
        toast.error("The audio for this dictation is no longer available");
        return;
      }
      setPlaying(true);
      stopRef.current = playClip(
        path,
        () => setPlaying(false),
        () => toast.error("Couldn't play the audio"),
      );
    } catch (e) {
      setPlaying(false);
      toast.error(errText(e));
    }
  }

  async function save() {
    const text = draft.trim();
    if (!text) {
      toast.error("The text can't be empty");
      return;
    }
    await run("save", async () => {
      const learned = await ipc.historyUpdateText(item.id, text);
      setCandidates(learned);
      setEditing(false);
      onChanged();
    });
  }

  async function addWord(w: string) {
    try {
      await ipc.dictionaryAdd(w);
      setCandidates((c) => c.filter((x) => x !== w));
      toast.success(`Added "${w}" to your dictionary`);
    } catch (e) {
      toast.error(errText(e));
    }
  }

  return (
    <li className="group rounded-card px-3 py-3 transition-colors hover:bg-hover focus-within:bg-hover">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex flex-col gap-2">
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} aria-label="Edit text" autoFocus />
              <div className="flex gap-2">
                <Button size="sm" variant="primary" loading={busy === "save"} onClick={save}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false);
                    setDraft(item.finalText);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="line-clamp-2 text-sm leading-snug text-ink">{item.finalText || <span className="text-faint">(empty)</span>}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
            <span>{item.appName}</span>
            <span className="rounded-full border border-line px-2 py-px text-[11px] text-muted">{CATEGORY_LABEL[item.category]}</span>
            <span>{formatTime(item.createdAt)}</span>
            {item.usedAi && (
              <span className="inline-flex items-center gap-1 rounded-full bg-highlight-soft px-2 py-px text-[11px] font-medium text-ink">
                <Sparkles size={10} aria-hidden /> AI
              </span>
            )}
            {item.error && <span className="text-danger">{item.error}</span>}
          </div>
        </div>
        {!editing && (
          <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            <IconButton label="Copy" disabled={busy !== null} onClick={() => run("copy", () => ipc.historyCopy(item.id), "Copied")}>
              <ClipboardCopy size={15} />
            </IconButton>
            <IconButton label="Insert again" disabled={busy !== null} onClick={() => run("insert", () => ipc.historyInsert(item.id))}>
              <CornerDownLeft size={15} />
            </IconButton>
            <IconButton
              label="Retry with AI"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "retry",
                  async () => {
                    await ipc.historyRetry(item.id);
                    onChanged();
                  },
                  "Retried",
                )
              }
            >
              <RotateCw size={15} className={busy === "retry" ? "animate-spin" : ""} />
            </IconButton>
            {item.hasAudio && (
              <IconButton label={playing ? "Stop audio" : "Play audio"} onClick={togglePlay}>
                {playing ? <Square size={14} /> : <Play size={14} />}
              </IconButton>
            )}
            <IconButton label={open ? "Hide details" : "More"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <Ellipsis size={16} />
            </IconButton>
          </div>
        )}
      </div>

      {candidates.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>Add to dictionary?</span>
          {candidates.map((w) => (
            <span key={w} className="inline-flex items-center rounded-full border border-line bg-surface text-[12px] text-ink">
              <button type="button" onClick={() => addWord(w)} className="inline-flex items-center gap-1 rounded-l-full py-0.5 pl-2 pr-1.5 hover:bg-hover">
                <Plus size={11} aria-hidden /> {w}
              </button>
              <button
                type="button"
                aria-label={`Dismiss ${w}`}
                onClick={() => setCandidates((c) => c.filter((x) => x !== w))}
                className="rounded-r-full py-0.5 pr-1.5 text-faint hover:text-ink"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
          <div>
            <div className="mb-1 text-[11px] font-medium text-faint">{changed ? "What you said, and what changed" : "What you said (no changes)"}</div>
            <p className="text-[13px] leading-relaxed text-ink">
              {diff.map((op, i) =>
                op.kind === "same" ? (
                  <span key={i}>{op.text} </span>
                ) : op.kind === "del" ? (
                  <del key={i} className="rounded-sm bg-danger-soft px-0.5 text-danger decoration-1">
                    {op.text}{" "}
                  </del>
                ) : (
                  <ins key={i} className="rounded-sm bg-success-soft px-0.5 text-success no-underline">
                    {op.text}{" "}
                  </ins>
                ),
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              icon={<Pencil size={13} />}
              onClick={() => {
                setDraft(item.finalText);
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <Button size="sm" variant="danger" icon={<Trash2 size={13} />} loading={busy === "delete"} onClick={() => run("delete", async () => { await ipc.historyDelete(item.id); onChanged(); })}>
              Delete
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
