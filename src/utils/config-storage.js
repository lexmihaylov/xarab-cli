import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { isRecord } from "./config-values.js";

async function readConfig(filePath) {
  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  const parsed = JSON.parse(contents);
  if (!isRecord(parsed)) throw new Error(`Expected a JSON object in ${filePath}.`);
  return parsed;
}

async function writeConfig(filePath, config) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function withFileLock(filePath, operation) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  const deadline = performance.now() + 5_000;
  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (performance.now() >= deadline)
        throw new Error(
          `Timed out waiting for config lock ${lockPath}. If a writer crashed, remove the lock directory only after stopping all Xarab processes.`,
        );
      await delay(25);
    }
  }
  // Never steal an apparently old lock: a paused writer could still commit its update.
  try {
    return await operation();
  } finally {
    await rmdir(lockPath);
  }
}

export function createConfigStorage(configPath, routingConfigPath = configPath, migration) {
  configPath = path.resolve(configPath);
  routingConfigPath = path.resolve(routingConfigPath);
  const separate = configPath !== routingConfigPath;
  const lockPaths = separate ? [configPath, routingConfigPath].sort() : [configPath];
  const withLocks = (operation, index = 0) =>
    index === lockPaths.length
      ? operation()
      : withFileLock(lockPaths[index], () => withLocks(operation, index + 1));
  let snapshot = { general: {}, routing: undefined };
  let queue = Promise.resolve();

  function enqueue(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  async function readFiles() {
    return {
      general: (await readConfig(configPath)) ?? {},
      routing: separate ? await readConfig(routingConfigPath) : undefined,
    };
  }

  function transact(change = () => {}) {
    return withLocks(async () => {
      const next = await readFiles();
      const { general } = next;
      const routing = separate ? (next.routing ?? {}) : general;
      const migrated = separate && migration?.needed(next);
      if (migrated) migration.apply(general, routing);
      let generalDirty = migrated;
      let routingDirty = migrated;
      change({
        general,
        routing,
        touchGeneral: () => (generalDirty = true),
        touchRouting: () => {
          if (separate) routingDirty = true;
          else generalDirty = true;
        },
      });

      // Commit routing first so a failed migration never discards the legacy source.
      if (routingDirty) await writeConfig(routingConfigPath, routing);
      if (generalDirty) {
        delete general.lastModel;
        await writeConfig(configPath, general);
      }
      snapshot = {
        general,
        routing: separate && (routingDirty || next.routing) ? routing : undefined,
      };
    });
  }

  function update(change) {
    return enqueue(() => transact(change));
  }

  return {
    separate,
    get: () => snapshot,
    load: () =>
      enqueue(async () => {
        const next = await readFiles();
        if (separate && migration?.needed(next)) await transact();
        else snapshot = next;
      }),
    update,
    updateGeneral(change) {
      return update(({ general, touchGeneral }) => {
        if (change(general) !== false) touchGeneral();
      });
    },
  };
}
