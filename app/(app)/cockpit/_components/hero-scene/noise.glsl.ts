/**
 * Bruit de valeur et fbm, partagés par le jour et la nuit.
 * GLSL ES 1.0 : bornes de boucle constantes, d'où deux fbm (5 et 3 octaves).
 */
export const NOISE_GLSL = /* glsl */ `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm5(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.02 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(5.1, 1.3);
    a *= 0.5;
  }
  return v;
}

// Houle : trois échelles de sinus + un bruit, sur le plan de la mer.
float waves(vec2 w, float t) {
  return sin(w.y * 1.3 + t * 1.1 + sin(w.x * 0.7) * 1.3) * 0.5
       + sin(w.y * 2.9 - t * 1.6 + w.x * 1.4) * 0.25
       + sin(w.y * 6.1 + t * 2.3 - w.x * 2.2) * 0.1
       + (noise(w * vec2(1.5, 2.0) + t * 0.35) - 0.5) * 0.6;
}

// Coordonnées sur le plan de la mer : la perspective resserre vers l'horizon.
vec2 seaPlane(vec2 p, float horizon, float asp) {
  float dy = max(horizon - p.y, 0.0);
  float z = 1.0 / (dy * 6.0 + 0.05);
  return vec2((p.x - 0.5) * asp * z * 1.2, z * 3.0);
}
`;
