/**
 * Tests des helpers de graphique — aucune dependance de test.
 *
 * Contexte : l'axe gauche affichait « 2, 2, 1, 1, 0 » et l'axe euros
 * « 1 €, 1 €, 1 €, 0 € ». On divisait le domaine en parts egales puis on
 * arrondissait chaque libelle : deux graduations tombaient sur le meme entier.
 *
 * Execution : `npm run test:charts`.
 */
import { formatEurCompact, niceTicks } from "../lib/charts/nice-ticks";
import { monotonePath, type Point } from "../lib/charts/monotone-path";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const unique = (list: number[]) => new Set(list).size === list.length;

console.log("\n1. Graduations entieres : jamais de doublon apres arrondi");
{
  for (const max of [0, 1, 2, 3, 4, 7, 12, 137, 1999]) {
    const scale = niceTicks(max, { integer: true });
    check(
      `max=${max} -> [${scale.ticks.join(", ")}]`,
      unique(scale.ticks) &&
        scale.ticks.every((tick) => Number.isInteger(tick)) &&
        scale.max >= max &&
        scale.ticks[0] === 0 &&
        scale.ticks[scale.ticks.length - 1] === scale.max,
    );
  }
}

console.log("\n2. Les cas exacts du bug");
{
  check("max=2 donne 0,1,2,3", niceTicks(2, { integer: true }).ticks.join(",") === "0,1,2,3");
  check("max=1 donne 0,1,2", niceTicks(1, { integer: true }).ticks.join(",") === "0,1,2");
  check("max=0 donne 0,1", niceTicks(0, { integer: true }).ticks.join(",") === "0,1");
  const big = niceTicks(137, { integer: true });
  check("max=137 -> pas rond", big.ticks.join(",") === "0,50,100,150", big.ticks.join(","));
  check("au plus 5 graduations", big.ticks.length <= 5, String(big.ticks.length));
}

console.log("\n3. Jamais de courbe collee au plafond");
{
  check("max pile sur une graduation -> on monte d'un cran", niceTicks(150).max > 150, String(niceTicks(150).max));
  check("max=4 entier -> plafond a 5", niceTicks(4, { integer: true }).max === 5);
}

console.log("\n4. Axe euros");
{
  const scale = niceTicks(1200);
  check("1200 -> graduations rondes", unique(scale.ticks) && scale.max >= 1200, scale.ticks.join(","));
  check("format 1200 -> 1,2 k€", formatEurCompact(1200) === "1,2 k€", formatEurCompact(1200));
  check("format 15000 -> 15 k€", formatEurCompact(15000) === "15 k€", formatEurCompact(15000));
  check("format 340 -> 340 €", formatEurCompact(340) === "340 €", formatEurCompact(340));
  check("format 0 -> 0 €", formatEurCompact(0) === "0 €", formatEurCompact(0));
}

console.log("\n5. Courbe monotone : aucun depassement des donnees");
{
  /** Echantillonne une Bezier cubique pour verifier ses valeurs intermediaires. */
  function sampleCubic(p0: Point, c1: Point, c2: Point, p1: Point): number[] {
    const out: number[] = [];
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const u = 1 - t;
      out.push(u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y);
    }
    return out;
  }

  /** Rejoue le `d` produit et collecte tous les y traverses. */
  function allY(d: string): number[] {
    const numbers = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const ys: number[] = [];
    let cursor = { x: numbers[0], y: numbers[1] };
    for (let i = 2; i + 5 < numbers.length; i += 6) {
      const c1 = { x: numbers[i], y: numbers[i + 1] };
      const c2 = { x: numbers[i + 2], y: numbers[i + 3] };
      const end = { x: numbers[i + 4], y: numbers[i + 5] };
      ys.push(...sampleCubic(cursor, c1, c2, end));
      cursor = end;
    }
    return ys;
  }

  const datasets: { label: string; values: number[] }[] = [
    { label: "creux entre deux pics", values: [10, 0, 10, 0, 10] },
    { label: "plateau puis saut", values: [0, 0, 0, 8, 8, 8] },
    { label: "strictement croissant", values: [0, 1, 3, 7, 20] },
    { label: "serie a zero", values: [0, 0, 0, 0, 0] },
    { label: "pic unique", values: [0, 0, 25, 0, 0] },
    { label: "decroissant", values: [40, 30, 12, 3, 0] },
  ];

  for (const { label, values } of datasets) {
    const points: Point[] = values.map((value, index) => ({ x: index * 20, y: value }));
    const ys = allY(monotonePath(points));
    const min = Math.min(...values);
    const max = Math.max(...values);
    // Tolerance d'arrondi : le `d` est ecrit a deux decimales.
    const inside = ys.every((y) => y >= min - 0.02 && y <= max + 0.02);
    check(
      `${label} : reste dans [${min}, ${max}]`,
      inside,
      inside ? "" : `min=${Math.min(...ys).toFixed(2)} max=${Math.max(...ys).toFixed(2)}`,
    );
  }

  check("un seul point", monotonePath([{ x: 0, y: 5 }]) === "M 0 5");
  check("aucun point", monotonePath([]) === "");
  check(
    "deux points -> segment droit",
    monotonePath([{ x: 0, y: 0 }, { x: 10, y: 4 }]) === "M 0 0 L 10 4",
  );
}

console.log(failures === 0 ? "\nTous les tests passent.\n" : `\n${failures} test(s) en echec.\n`);
process.exit(failures === 0 ? 0 : 1);
