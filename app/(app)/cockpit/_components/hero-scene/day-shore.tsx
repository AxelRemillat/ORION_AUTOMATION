/**
 * Mer, reflets, plage et palmier — la moitie basse de la scene de jour.
 *
 * Les trois couches de vagues defilent a trois vitesses : c'est la parallaxe
 * qui donne la profondeur, pas un degrade.
 */

/** Une vague : periode de 100, dessinee large pour couvrir le defilement. */
const WAVE =
  "M0 8 q25 -7 50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 V70 H0 Z";

/** Barres de reflet : positions et decalages fixes, jamais tires au hasard. */
const SPARKLES = [
  { x: 286, y: 122, w: 22, d: 0 },
  { x: 298, y: 132, w: 14, d: 0.7 },
  { x: 280, y: 142, w: 26, d: 1.4 },
  { x: 302, y: 152, w: 12, d: 2.1 },
  { x: 288, y: 163, w: 18, d: 2.8 },
];

export function DayShore() {
  return (
    <>
        {/* Mer : trois couches, trois vitesses — la parallaxe fait la profondeur. */}
        {[
          { y: 100, fill: "var(--scene-sea-far)", speed: 26, bob: 7 },
          { y: 118, fill: "var(--scene-sea-mid)", speed: 17, bob: 5 },
          { y: 140, fill: "var(--scene-sea-near)", speed: 11, bob: 4 },
        ].map((layer) => (
          <g
            key={layer.y}
            style={{ animation: `scene-bob ${layer.bob}s ease-in-out infinite` }}
          >
            <g
              transform={`translate(-100 ${layer.y})`}
              style={{ animation: `scene-scroll ${layer.speed}s linear infinite` }}
            >
              <path d={WAVE} fill={layer.fill} />
            </g>
          </g>
        ))}

        {SPARKLES.map((bar) => (
          <rect
            key={bar.d}
            x={bar.x}
            y={bar.y}
            width={bar.w}
            height="2"
            rx="1"
            fill="var(--scene-sun-core)"
            style={{ animation: "scene-twinkle 3.2s ease-in-out infinite", animationDelay: `${bar.d}s` }}
          />
        ))}

        {/* Plage, ecume, palmier. */}
        <path d="M250 200 q60 -46 150 -58 V200 Z" fill="var(--scene-sand)" />
        <path
          d="M250 200 q60 -46 150 -58"
          fill="none"
          stroke="var(--scene-foam)"
          strokeWidth="3"
          strokeLinecap="round"
          style={{ animation: "scene-foam 6s ease-in-out infinite" }}
        />
        <g transform="translate(352 150)">
          <path d="M0 0 q-3 -18 2 -30" stroke="var(--scene-palm)" strokeWidth="3" fill="none" />
          <g className="scene-pivot-corner" style={{ animation: "scene-sway 5s ease-in-out infinite" }}>
            {[-38, -12, 14, 40].map((angle) => (
              <path
                key={angle}
                d="M2 -30 q13 -6 21 1 q-12 -1 -21 3 Z"
                fill="var(--scene-palm)"
                transform={`rotate(${angle} 2 -30)`}
              />
            ))}
          </g>
        </g>

        {[
          { delay: 0, duration: 25, x: 60, y: 30 },
          { delay: -13, duration: 31, x: 128, y: 44 },
        ].map((gull) => (
          <g
            key={gull.duration}
            style={{ animation: `scene-fly ${gull.duration}s linear infinite`, animationDelay: `${gull.delay}s` }}
          >
            <path
              d={`M${gull.x} ${gull.y} q5 -4 9 0 q4 -4 9 0`}
              fill="none"
              stroke="var(--scene-bird)"
              strokeWidth="1.6"
              strokeLinecap="round"
              opacity="0.6"
            />
          </g>
        ))}
    </>
  );
}
