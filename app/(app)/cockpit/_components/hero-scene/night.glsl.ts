/**
 * NUIT : ciel indigo → bleu nuit, voie lactée subtile, étoiles scintillantes à
 * densité variable (dont quelques grosses à halo), halo de lune, étoile
 * filante toutes les 20 s ; mer sombre au reflet de lune fragmenté, brouillard
 * bas fbm qui dérive.
 */
export const NIGHT_GLSL = /* glsl */ `
float starLayer(vec2 r, float scale, float rarity, float size) {
  vec2 g = r * scale;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash(id);
  float dens = smoothstep(0.30, 0.75, fbm3(r * 2.5));
  if (h < rarity - dens * 0.04) return 0.0;
  vec2 o = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
  float s = length(f - o * 0.6);
  float twinkle = 0.55 + 0.45 * sin(uTime * (1.2 + h * 3.0) + h * 40.0);
  return (smoothstep(size, 0.0, s) + exp(-s * 9.0 / size) * 0.15) * twinkle;
}

vec3 nightSky(vec2 p, vec2 moon, float asp, float horizon) {
  float t = clamp((p.y - horizon) / (1.0 - horizon), 0.0, 1.0);
  vec3 c = mix(vec3(0.11, 0.16, 0.34), vec3(0.03, 0.04, 0.14), smoothstep(0.0, 1.0, t));
  vec2 r = vec2(p.x * asp, p.y);

  // Voie lactée : bande diagonale, grain fbm, très discrète.
  float band = exp(-pow((r.y - 0.62 - (r.x - asp * 0.5) * 0.35) * 4.5, 2.0));
  c += vec3(0.42, 0.38, 0.62) * band * fbm3(r * 7.0) * 0.20;

  float stars = starLayer(r, 70.0, 0.955, 0.10) + starLayer(r + 11.3, 14.0, 0.93, 0.07) * 1.6;
  c += vec3(0.92, 0.94, 1.0) * stars * smoothstep(horizon, horizon + 0.12, p.y);

  float d = length((p - moon) * vec2(asp, 1.0));
  c += vec3(0.95, 0.84, 0.60) * (exp(-d * 4.0) * 0.28 + exp(-d * 1.5) * 0.09);

  // Étoile filante : 0,9 s toutes les 20 s, départ tiré au sort par cycle.
  float cycle = floor(uTime / 20.0);
  float phase = uTime - cycle * 20.0;
  if (phase < 0.9) {
    vec2 dir = normalize(vec2(-1.0, -0.42));
    vec2 start = vec2((0.35 + hash(vec2(cycle, 1.0)) * 0.55) * asp, 0.78 + hash(vec2(cycle, 2.0)) * 0.17);
    vec2 rel = r - (start + dir * phase * 0.7);
    float behind = dot(rel, -dir);
    float perp = length(rel + dir * behind);
    float fade = sin(phase / 0.9 * 3.14159);
    c += vec3(1.0, 0.95, 0.85) * smoothstep(0.004, 0.0, perp) * smoothstep(0.22, 0.0, behind) * step(0.0, behind) * fade;
  }
  return c;
}

vec3 nightSea(vec2 p, vec2 moon, float asp, float horizon) {
  float dy = horizon - p.y;
  vec2 w = seaPlane(p, horizon, asp);
  float wave = waves(w, uTime * 0.7);
  vec3 c = mix(vec3(0.08, 0.12, 0.26), vec3(0.02, 0.03, 0.10), smoothstep(0.0, 0.25, dy));
  c += wave * 0.025;

  // Reflet de lune : colonne découpée par les crêtes, en fragments.
  float column = exp(-abs((p.x - moon.x) * asp) * (3.5 + 10.0 * dy));
  float shards = smoothstep(0.55, 0.85, wave * 0.5 + 0.5 + (noise(w * vec2(3.0, 7.0) + uTime * 0.2) - 0.5) * 0.9);
  c += vec3(0.95, 0.85, 0.62) * column * (shards * 0.85 + 0.08);
  return c + vec3(0.25, 0.30, 0.50) * exp(-dy * 30.0) * 0.25;
}

// Brouillard bas : visible, jamais opaque, dérive lentement.
float nightFog(vec2 p, float asp, float horizon) {
  vec2 r = vec2(p.x * asp * 1.3 + uTime * 0.025, p.y * 5.0);
  float n = fbm3(r + vec2(fbm3(r * 0.5 - uTime * 0.01), 0.0));
  return smoothstep(0.36, 0.78, n) * (1.0 - smoothstep(horizon - 0.12, horizon + 0.24, p.y)) * 0.6;
}
`;
