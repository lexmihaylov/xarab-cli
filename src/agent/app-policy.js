import { singleAppPolicy } from "../single/utils/app-policy.js";
import { tieredAppPolicy } from "../tiered/utils/app-policy.js";

export function resolveAppPolicy(mode) {
  if (mode === "single") return singleAppPolicy;
  if (mode === "tiered") return tieredAppPolicy;
  throw new Error("An explicit valid application mode is required: single or tiered.");
}
