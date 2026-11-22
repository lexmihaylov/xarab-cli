export function createSingleWorkerPolicy({ getSingleModel }) {
  return {
    getAssignment: () => getSingleModel(),
    assignmentError: () => "Choose a worker model with /model first.",
    assignmentEvent: (_tier, assignment) => ({ ...assignment }),
    prepareTierAdjustment: () => false,
    suppressTaskTools: (assignment) => assignment?.provider === "local",
  };
}
