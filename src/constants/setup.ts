/** In-game slider min/max for setup parameters. Copied setups print `L`/`R`
 *  and `MIN`/`MAX` for values at these ends (see `analysis/shareText.ts`). */
export const CAR_SETUP_RANGES: Record<string, [number, number]> = {
  "front-wing": [0, 50],
  "rear-wing": [0, 50],
  "on-throttle": [50, 100],
  "off-throttle": [50, 100],
  "front-camber": [-3.5, -2.5],
  "rear-camber": [-2.0, -1.0],
  "front-toe": [0.0, 0.5],
  "rear-toe": [0.1, 0.5],
  "front-suspension": [1, 41],
  "rear-suspension": [1, 41],
  "front-anti-roll-bar": [1, 21],
  "rear-anti-roll-bar": [1, 21],
  "front-suspension-height": [1, 50],
  "rear-suspension-height": [1, 75],
  "brake-pressure": [80, 100],
  "brake-bias": [50, 70],
  "front-left-tyre-pressure": [22.5, 29.5],
  "front-right-tyre-pressure": [22.5, 29.5],
  "rear-left-tyre-pressure": [20.5, 26.5],
  "rear-right-tyre-pressure": [20.5, 26.5],
};
