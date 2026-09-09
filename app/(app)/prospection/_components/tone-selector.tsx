"use client";

import { TONES, type ToneKey } from "../_lib/tones";

/**
 * Choix du registre de rédaction. La valeur part avec la demande de
 * génération ; tant que la route ne la lit pas, elle n'altère rien — d'où la
 * mention sous les boutons, pour ne pas laisser croire à un effet immédiat.
 */
export function ToneSelector({
  value,
  onChange,
  disabled,
}: {
  value: ToneKey;
  onChange: (tone: ToneKey) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="mb-2 text-[13px] font-medium text-muted" id="tone-label">
        Ton du message
      </p>

      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="tone-label">
        {TONES.map((tone) => {
          const active = tone.key === value;
          return (
            <button
              key={tone.key}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              title={tone.hint}
              onClick={() => onChange(tone.key)}
              className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 motion-reduce:transition-none ${
                active
                  ? "border-transparent bg-brand-grad text-primary-fg"
                  : "border-line bg-surface text-muted hover:bg-surface-2 hover:text-text"
              }`}
            >
              {tone.label}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] leading-snug text-faint">
        Le ton choisi accompagne la demande de génération. Il ne sera réellement pris en compte
        qu&apos;une fois lu par <span className="font-data">/api/emails/generate</span> — le
        brouillon affiché reste toujours celui que le modèle a produit.
      </p>
    </div>
  );
}
