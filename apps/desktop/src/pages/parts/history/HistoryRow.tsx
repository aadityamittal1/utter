import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, CornerDownLeft, Ellipsis, FileDiff, Pencil, Play, Plus, RotateCw, Sparkles, Square, Trash2, X } from "lucide-react";
import { ipc } from "../../../lib/ipc";
import { cn } from "../../../lib/cn";
import { formatTime } from "../../../lib/format";
import { toast } from "../../../lib/store";
import type { HistoryItem } from "../../../lib/types";
import { Button, Dropdown, IconButton, Label, Spinner, Textarea } from "../../../components/ui";
import { MenuIconButton } from "./MenuIconButton";
import { CATEGORY_LABEL } from "./shared";
import { wordDiff } from "./diff";
import { playClip } from "./player";

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong");

/**
 * One dictation: time column, text, and hover actions (play, copy, more).
 * Rows sit inside a divided card (see DayList), so the row itself has no border.
 */
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
      toast.success(`Added “${w}” to your dictionary`);
    } catch (e) {
      toast.error(errText(e));
    }
  }

  const onMenu = (key: string | number) => {
    switch (key) {
      case "insert":
        return void run("insert", () => ipc.historyInsert(item.id));
      case "retry":
        return void run(
          "retry",
          async () => {
            await ipc.historyRetry(item.id);
            onChanged();
          },
          "Retried",
        );
      case "details":
        return setOpen((o) => !o);
      case "edit":
        setDraft(item.finalText);
        return setEditing(true);
      case "delete":
        return void run("delete", async () => {
          await ipc.historyDelete(item.id);
          onChanged();
        });
    }
  };

  return (
    <li className="group px-5 py-4 transition-colors duration-[var(--dur-fast)] ease-fluent hover:bg-row-hover focus-within:bg-row-hover">
      <div className="flex items-start">
        <time dateTime={new Date(item.createdAt).toISOString()} className="w-20 shrink-0 pt-0.5 text-caption tabular-nums text-faint">
          {formatTime(item.createdAt).replace(/s/g, "").toLowerCase()}
        </time>
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
            <p className="line-clamp-3 break-words text-body text-ink">{item.finalText || <span className="text-faint">(empty)</span>}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-faint">
            <span>
              {item.appName} · {CATEGORY_LABEL[item.category]}
            </span>
            {item.usedAi && (
              <span className="inline-flex items-center gap-1">
                <Sparkles size={16} strokeWidth={1.5} aria-hidden /> Enhanced
              </span>
            )}
            {item.error && <span className="text-danger">{item.error}</span>}
          </div>
        </div>
        {!editing && (
          <div className={cn("-my-1 ml-3 flex shrink-0 items-center transition-opacity duration-[var(--dur-fast)] ease-fluent focus-within:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100", busy !== null ? "opacity-100" : "opacity-0")}>
            {(busy === "retry" || busy === "delete" || busy === "insert") && <Spinner size="sm" className="mr-1" aria-label={busy === "delete" ? "Deleting" : busy === "retry" ? "Retrying" : "Inserting"} />}
            {item.hasAudio && (
              <IconButton label={playing ? "Stop audio" : "Play audio"} onClick={togglePlay}>
                {playing ? <Square size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} />}
              </IconButton>
            )}
            <IconButton label="Copy" disabled={busy !== null} onClick={() => run("copy", () => ipc.historyCopy(item.id), "Copied")}>
              <Copy size={16} strokeWidth={1.5} />
            </IconButton>
            <Dropdown>
              <MenuIconButton label="More actions" disabled={busy !== null}>
                <Ellipsis size={16} strokeWidth={1.5} />
              </MenuIconButton>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu onAction={onMenu}>
                  <Dropdown.Item id="insert" textValue="Insert again">
                    <CornerDownLeft size={16} strokeWidth={1.5} aria-hidden />
                    <Label>Insert again</Label>
                  </Dropdown.Item>
                  <Dropdown.Item id="retry" textValue="Retry with AI">
                    <RotateCw size={16} strokeWidth={1.5} aria-hidden />
                    <Label>Retry with AI</Label>
                  </Dropdown.Item>
                  <Dropdown.Item id="details" textValue={open ? "Hide changes" : "Show changes"}>
                    <FileDiff size={16} strokeWidth={1.5} aria-hidden />
                    <Label>{open ? "Hide changes" : "Show changes"}</Label>
                  </Dropdown.Item>
                  <Dropdown.Item id="edit" textValue="Edit text">
                    <Pencil size={16} strokeWidth={1.5} aria-hidden />
                    <Label>Edit text</Label>
                  </Dropdown.Item>
                  <Dropdown.Item id="delete" textValue="Delete" variant="danger">
                    <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                    <Label>Delete</Label>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        )}
      </div>

      {candidates.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 pl-20 text-caption text-muted">
          <span>Add to dictionary?</span>
          {candidates.map((w) => (
            <span key={w} className="inline-flex items-center rounded-full border border-line bg-surface text-caption text-ink">
              <button type="button" onClick={() => addWord(w)} className="inline-flex items-center gap-1 rounded-l-full py-0.5 pl-2 pr-1.5 hover:bg-hover">
                <Plus size={16} strokeWidth={1.5} aria-hidden /> {w}
              </button>
              <button type="button" aria-label={`Dismiss ${w}`} onClick={() => setCandidates((c) => c.filter((x) => x !== w))} className="rounded-r-full py-0.5 pr-1.5 text-faint hover:text-ink">
                <X size={16} strokeWidth={1.5} />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-3 border-t border-line pl-20 pt-3">
          <div className="mb-1 text-caption text-faint">{changed ? "What you said, and what changed" : "What you said (no changes)"}</div>
          <p className="text-body text-ink">
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
      )}
    </li>
  );
}
