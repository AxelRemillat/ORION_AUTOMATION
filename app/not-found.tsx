import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
      <p className="text-[13px] font-medium uppercase tracking-wide text-accent">404</p>
      <h1 className="text-xl font-semibold text-fg">Cette page n&apos;existe pas</h1>
      <Link href="/recherche" className="mt-2 text-sm text-accent hover:underline">
        Retour à l&apos;app
      </Link>
    </div>
  );
}
