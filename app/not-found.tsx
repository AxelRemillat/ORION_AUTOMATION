import Link from "next/link";

export default function NotFound() {
  return (
    <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-data text-[12px] font-medium uppercase tracking-[0.2em] text-primary-ink">
        404
      </p>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-text">
        Cette page n&apos;existe pas
      </h1>
      <Link
        href="/aujourdhui"
        className="mt-2 text-sm font-medium text-primary-ink underline-offset-4 hover:underline"
      >
        Retour à l&apos;app
      </Link>
    </div>
  );
}
