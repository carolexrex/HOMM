import type { PlayerId } from "../engine";
import type { OnlineDraft } from "./onlineDraft";
import { loadOnlineDraft, removeOnlineDraft, saveOnlineDraft } from "./storage";

/**
 * Cross-tab coordination for stored online drafts.
 *
 * The stored draft is the source of truth for a match seat. Every write is a compare-and-set
 * on its `revision`, run under an exclusive lock scoped to that match and seat, so two tabs
 * can never both "win" a read-modify-write. A tab that is behind (it missed another tab's
 * write) is refused and must adopt the stored draft instead. A frozen submission is never
 * replaced; it is only removed by exact revision once the server has answered definitively.
 *
 * Ownership is not tied to a tab being open: closing any tab leaves the stored draft intact,
 * and any other tab or a reload can take it over and resend it with the same submission ID.
 */

/** Runs `task` while holding the exclusive lock `name`. */
export type LockRunner = <T>(name: string, task: () => T) => Promise<T>;

export function onlineDraftLockName(matchId: string, side: PlayerId): string {
  return `bannerfront.online-draft:${matchId}:${side}`;
}

/** Serializes tasks per lock name within this tab only. */
export function createLocalLockRunner(): LockRunner {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(name: string, task: () => T) => {
    const run = (tails.get(name) ?? Promise.resolve()).then(task);
    const tail = run.then(() => undefined, () => undefined);
    tails.set(name, tail);
    void tail.then(() => {
      if (tails.get(name) === tail) tails.delete(name);
    });
    return run;
  };
}

/**
 * Web Locks are shared by every tab of the origin and are released when a tab closes, so a
 * closed tab cannot strand them. Browsers without the API fall back to a lock inside the tab.
 */
export function createBrowserLockRunner(): LockRunner {
  const local = createLocalLockRunner();
  return <T>(name: string, task: () => T) => {
    const locks = typeof navigator !== "undefined" ? (navigator as Partial<Navigator>).locks : undefined;
    return locks ? (locks.request(name, { mode: "exclusive" }, () => task()) as Promise<T>) : local(name, task);
  };
}

export type DraftWriteResult =
  /** Written; `draft` is what is now stored (null after a removal). */
  | { ok: true; draft: OnlineDraft | null }
  /**
   * Not written. "conflict": another tab changed the stored draft. "obsolete": the caller's
   * `isCurrent` check failed, because the tab moved on while the write waited for the lock.
   * `current` is what is stored.
   */
  | { ok: false; reason: "conflict" | "obsolete"; current: OnlineDraft | null };

/**
 * Runs inside the lock, immediately before storage is modified. Returning false abandons the
 * write, so an operation queued behind the lock cannot store a draft for a board the tab no
 * longer shows. It must be synchronous; nothing else in the tab can run between it and the write.
 */
export type WriteGuard = () => boolean;

export interface OnlineDraftStore {
  load(matchId: string, side: PlayerId): OnlineDraft | null;
  /**
   * Stores `next` only if the stored draft is still `expected` (null: nothing stored).
   * A stored submission is frozen and is never replaced.
   */
  replace(expected: OnlineDraft | null, next: OnlineDraft, isCurrent?: WriteGuard): Promise<DraftWriteResult>;
  /** Removes the stored draft only if it is still `expected`. Already gone counts as removed. */
  remove(expected: OnlineDraft, isCurrent?: WriteGuard): Promise<DraftWriteResult>;
}

function revisionOf(draft: OnlineDraft | null): string | null {
  return draft ? draft.revision ?? "" : null;
}

export function createOnlineDraftStore(lock: LockRunner, newRevision: () => string = () => crypto.randomUUID()): OnlineDraftStore {
  return {
    load: loadOnlineDraft,

    replace(expected, next, isCurrent) {
      return lock(onlineDraftLockName(next.matchId, next.side), (): DraftWriteResult => {
        const current = loadOnlineDraft(next.matchId, next.side);
        if (isCurrent && !isCurrent()) {
          return { ok: false, reason: "obsolete", current };
        }
        if (revisionOf(current) !== revisionOf(expected) || current?.status === "submitting") {
          return { ok: false, reason: "conflict", current };
        }
        const stored = { ...next, revision: newRevision() };
        saveOnlineDraft(stored);
        return { ok: true, draft: stored };
      });
    },

    remove(expected, isCurrent) {
      return lock(onlineDraftLockName(expected.matchId, expected.side), (): DraftWriteResult => {
        const current = loadOnlineDraft(expected.matchId, expected.side);
        if (isCurrent && !isCurrent()) {
          return { ok: false, reason: "obsolete", current };
        }
        if (current && revisionOf(current) !== revisionOf(expected)) {
          return { ok: false, reason: "conflict", current };
        }
        removeOnlineDraft(expected.matchId, expected.side);
        return { ok: true, draft: null };
      });
    }
  };
}
