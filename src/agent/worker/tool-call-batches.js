// Only known, read-only tools may overlap. Unknown/external tools, commands,
// mutations, questions, skills and image tools remain execution barriers.
const readOnlyTools = new Set([
  "read_file",
  "list_files",
  "search_files",
  "search_content",
  "webfetch",
  "websearch",
]);
const MAX_READ_ONLY_BATCH = 4;

export function* toolCallBatches(calls, getName) {
  for (let index = 0; index < calls.length;) {
    const start = index++;
    const name = getName(calls[start]);
    if (name === "task") {
      // Preserve the existing, separate adjacent-task batching contract.
      while (index < calls.length && getName(calls[index]) === "task") index++;
    } else if (readOnlyTools.has(name)) {
      while (
        index < calls.length &&
        index - start < MAX_READ_ONLY_BATCH &&
        readOnlyTools.has(getName(calls[index]))
      )
        index++;
    }
    yield calls.slice(start, index);
  }
}
