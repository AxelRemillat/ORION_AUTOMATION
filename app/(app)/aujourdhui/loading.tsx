import { PageSkeleton } from "@/components/layout/page-skeleton";

/** Affiché tout de suite au clic, pendant que le serveur prépare la page (Cowork #23). */
export default function Loading() {
  return <PageSkeleton layout="aujourdhui" />;
}
