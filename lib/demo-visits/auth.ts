import { sameSecret } from "@/lib/opportunities/ingest-auth";
import { DEMO_VISITS_HEADER, DEMO_VISITS_SECRET_ENV } from "./model";

/** Secret du portfolio dans l'en-tête, comparé à temps constant. Secret absent côté ORION : tout est refusé. */
export function demoVisitAuthorized(request: Request, expected = process.env[DEMO_VISITS_SECRET_ENV]): boolean {
  const secret = expected?.trim();
  const given = request.headers.get(DEMO_VISITS_HEADER)?.trim() ?? "";
  return Boolean(secret && given && sameSecret(given, secret));
}
