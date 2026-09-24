/**
 * Mer calme et reflet de lune — la moitie basse de la scene de nuit.
 *
 * Deux couches seulement, et plus lentes que de jour : la nuit ne doit pas
 * attirer l'oeil autant que le soleil.
 */

/** Meme motif que de jour : periode de 100, translation de -100 pour boucler. */
const WAVE =
  "M0 8 q25 -6 50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 V70 H0 Z";

export function NightWater() {
  return (
    <>
        {[
          { y: 158, fill: "var(--scene-night-sea-far)", speed: 34 },
          { y: 176, fill: "var(--scene-night-sea-near)", speed: 22 },
        ].map((layer) => (
          <g key={layer.y} style={{ animation: "scene-bob 9s ease-in-out infinite" }}>
            <g
              transform={`translate(-100 ${layer.y})`}
              style={{ animation: `scene-scroll ${layer.speed}s linear infinite` }}
            >
              <path d={WAVE} fill={layer.fill} />
            </g>
          </g>
        ))}

        {[
          { x: 288, y: 172, w: 24, d: 0 },
          { x: 296, y: 180, w: 14, d: 0.9 },
          { x: 284, y: 188, w: 20, d: 1.8 },
        ].map((bar) => (
          <rect
            key={bar.d}
            x={bar.x}
            y={bar.y}
            width={bar.w}
            height="1.6"
            rx="0.8"
            fill="var(--scene-moon-core)"
            opacity="0.7"
            style={{ animation: "scene-twinkle 3.6s ease-in-out infinite", animationDelay: `${bar.d}s` }}
          />
        ))}
    </>
  );
}
