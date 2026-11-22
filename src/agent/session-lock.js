import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SQLITE_BUSY = 5;

// SQLite uses OS file locks, so a killed owner cannot leave a stale lock.
// Each session has its own database; the transaction never writes to it.
// Keep these files even after release/delete: unlinking a lock file could let
// a contender lock a new inode while someone else still holds the old one.
export async function acquireSessionLock(directory, id) {
  const lockDirectory = path.join(directory, ".locks");
  await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
  const filename = path.join(lockDirectory, `${id.toLowerCase()}.sqlite`);
  let database;
  try {
    database = new DatabaseSync(filename, { timeout: 0 });
    database.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    database?.close();
    if ((error.errcode & 0xff) === SQLITE_BUSY) {
      const busy = new Error(
        "Session is in use by another controller. Close it there and try again.",
        {
          cause: error,
        },
      );
      busy.code = "SESSION_LOCKED";
      throw busy;
    }
    throw error;
  }
  return () => {
    if (!database) return;
    database.close();
    database = undefined;
  };
}
