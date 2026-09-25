import { DAY_GLSL } from "./day.glsl";
import { NIGHT_GLSL } from "./night.glsl";
import { NOISE_GLSL } from "./noise.glsl";

/**
 * Shader de la scène du Cockpit : un seul plein écran, jour et nuit mélangés
 * par `uNight` (0 → 1 en 800 ms). Hors transition, une seule des deux scènes
 * est calculée : le coût par pixel reste celui d'une scène.
 */

export const VERTEX_GLSL = /* glsl */ `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const FRAGMENT_GLSL = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform float uNight;
uniform float uFlash;
uniform vec2 uMouse;
uniform vec2 uSun;
uniform vec2 uMoon;
${NOISE_GLSL}
${DAY_GLSL}
${NIGHT_GLSL}
const float HORIZON = 0.30;

void main() {
  float asp = uRes.x / uRes.y;
  // Parallaxe : le ciel bouge moins que la mer (couches 1 et 2 ; le premier
  // plan DOM est la couche 3).
  vec2 ps = vUv + uMouse * vec2(0.006, 0.004);
  vec2 pw = vUv + uMouse * vec2(0.012, 0.0);
  bool sky = vUv.y > HORIZON;

  vec3 day = vec3(0.0);
  vec3 night = vec3(0.0);
  if (uNight < 0.999) {
    day = sky ? daySky(ps, uSun, asp, HORIZON) : daySea(pw, uSun, asp, HORIZON);
  }
  if (uNight > 0.001) {
    night = sky ? nightSky(ps, uMoon, asp, HORIZON) : nightSea(pw, uMoon, asp, HORIZON);
    night = mix(night, vec3(0.52, 0.58, 0.78), nightFog(pw, asp, HORIZON));
  }
  vec3 c = mix(day, night, uNight);
  // Tramage : supprime les bandes des dégradés longs.
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
`;
