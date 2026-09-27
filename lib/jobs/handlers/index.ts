import type { JobHandler } from "../runner";
import type { JobType } from "../types";
import { emailHandler } from "./email";
import { reanalyzeHandler } from "./reanalyze";
import { searchCriteriaHandler } from "./search";
import { searchSignalsHandler } from "./signals";
import { signalFunnelHandler } from "./funnel";

/** Un exécuteur par type de job. */
export const HANDLERS: Record<JobType, JobHandler> = {
  search_criteria: searchCriteriaHandler,
  search_signals: searchSignalsHandler,
  signal_funnel: signalFunnelHandler,
  email_generate: emailHandler,
  email_rewrite: emailHandler,
  reanalyze: reanalyzeHandler,
};
