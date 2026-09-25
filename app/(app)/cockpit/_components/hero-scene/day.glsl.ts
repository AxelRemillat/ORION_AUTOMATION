/**
 * JOUR : ciel multi-stops (bleu profond → turquoise → doré), soleil avec halo
 * et bloom, nuages volumétriques qui dérivent, brume de chaleur ; mer à houle
 * procédurale, reflets spéculaires scintillants, écume sur le bord.
 */
export const DAY_GLSL = /* glsl */ `
vec3 daySky(vec2 p, vec2 sun, float asp, float horizon) {
  float t = clamp((p.y - horizon) / (1.0 - horizon), 0.0, 1.0);
  vec3 c = mix(vec3(1.0, 0.80, 0.52), vec3(0.42, 0.80, 0.86), smoothstep(0.0, 0.35, t));
  c = mix(c, vec3(0.12, 0.40, 0.78), smoothstep(0.30, 1.0, t));

  // Soleil : disque, halo, bloom (renforcé par le clic).
  float d = length((p - sun) * vec2(asp, 1.0));
  float boost = 1.0 + uFlash * 2.0;
  c += vec3(1.0, 0.85, 0.55) * (exp(-d * 9.0) * 0.55 + exp(-d * 2.6) * 0.20) * boost;
  c = mix(c, vec3(1.0, 0.97, 0.88), smoothstep(0.072, 0.062, d));

  // Nuages : densité fbm, éclairage par différence vers le soleil.
  vec2 cq = vec2(p.x * asp * 1.1 + uTime * 0.012, p.y * 3.2) * 1.4;
  float n = fbm5(cq);
  vec2 toSun = normalize((sun - p) * vec2(asp, 1.0) + 1e-4) * 0.08;
  float light = clamp(0.75 + (n - fbm5(cq + toSun)) * 3.5, 0.45, 1.25);
  float cover = smoothstep(0.50, 0.80, n) * smoothstep(horizon + 0.04, horizon + 0.28, p.y);
  vec3 cloud = mix(vec3(0.78, 0.84, 0.92), vec3(1.0, 0.96, 0.90), clamp(light - 0.4, 0.0, 1.0));
  cloud += vec3(1.0, 0.78, 0.5) * exp(-d * 3.0) * 0.35;
  c = mix(c, cloud * light, cover * 0.8);

  // Brume de chaleur : voile doré au ras de l'horizon.
  c = mix(c, vec3(1.0, 0.90, 0.76), exp(-abs(p.y - horizon) * 26.0) * 0.4);
  return c;
}

vec3 daySea(vec2 p, vec2 sun, float asp, float horizon) {
  float dy = horizon - p.y;
  // Ondulation de chaleur : les premiers pixels sous l'horizon tremblent.
  p.x += sin(p.y * 180.0 + uTime * 3.0) * 0.0015 * exp(-dy * 40.0);
  vec2 w = seaPlane(p, horizon, asp);
  float wave = waves(w, uTime);

  vec3 c = mix(vec3(0.55, 0.83, 0.86), vec3(0.04, 0.33, 0.55), smoothstep(0.0, 0.22, dy));
  c += wave * 0.045;

  // Chemin de lumière : spéculaire sur les crêtes + scintillement.
  float path = exp(-abs((p.x - sun.x) * asp) * (2.5 + 14.0 * dy));
  float sparkle = pow(hash(floor(w * vec2(6.0, 10.0)) + floor(uTime * 8.0)), 16.0);
  float crest = smoothstep(0.15, 0.65, wave);
  float sunUp = smoothstep(horizon - 0.1, horizon + 0.2, sun.y);
  c += vec3(1.0, 0.90, 0.68) * path * (crest * 0.5 + sparkle * 1.8) * sunUp * (1.0 + uFlash);
  c = mix(c, vec3(1.0, 0.88, 0.70), exp(-dy * 45.0) * 0.45);

  // Écume : une ligne de rivage qui respire, puis l'eau peu profonde.
  float shore = 0.065 + 0.018 * sin(p.x * asp * 7.0 + uTime * 0.8) + 0.01 * sin(p.x * asp * 19.0 - uTime * 1.3);
  float lace = smoothstep(0.35, 0.75, noise(vec2(p.x * asp * 28.0, uTime * 0.7 + p.y * 40.0)));
  float foam = smoothstep(0.018, 0.0, abs(p.y - shore)) * (0.5 + lace * 0.5);
  c = mix(c, vec3(0.62, 0.90, 0.88), smoothstep(shore, shore - 0.03, p.y) * 0.55);
  return mix(c, vec3(0.97, 0.99, 1.0), foam * 0.85);
}
`;
