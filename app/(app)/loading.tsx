import { PageSkeleton } from "@/components/layout/page-skeleton";

/** Repli pour toute page sans squelette propre (Cowork #23). */
export default function Loading() {
  return <PageSkeleton layout="tableau" />;
}
