import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Embleme ORION.
 *
 * Passe par `next/image` : le PNG source (512 px) n'est jamais servi tel quel,
 * Next en derive un WebP a la bonne taille et fournit le srcset 1x/2x, ce qui
 * garde un rendu net sur ecran haute densite.
 *
 * Toujours DECORATIF (`alt=""`, `aria-hidden`) : partout ou il apparait, le
 * nom « PROSPECT » est lisible juste a cote ou porte par le lien parent.
 * L'annoncer une seconde fois ne ferait que doubler la lecture vocale.
 */
const SIZES = { sm: 28, md: 40, lg: 96 } as const;

export type LogoSize = keyof typeof SIZES;

export function Logo({
  size = "md",
  className,
  priority = false,
}: {
  size?: LogoSize;
  className?: string;
  /** Pour un logo visible des le premier rendu (evite un chargement differe). */
  priority?: boolean;
}) {
  const px = SIZES[size];

  return (
    <Image
      src="/orion-logo.png"
      alt=""
      aria-hidden
      width={px}
      height={px}
      priority={priority}
      className={cn("shrink-0 select-none", className)}
    />
  );
}
