/**
 * map.mjs — the mine map layout shared by the art generators and (through the
 * manifest, `env/map_bg.png` → extra.ore_tiles) by the Godot Layout class.
 *
 * 12x8 tiles of 48 px. The server's 40 blocks are shown as 20 ore deposits
 * scattered over the cave (two blocks per mound, see BLOCKS_PER_DEPOSIT);
 * deposit d holds blocks 2d and 2d+1 and sits on ORE_TILES[d], listed
 * top-to-bottom, left-to-right so the active vein sweeps the map in the
 * server's row-major "first alive" order. Free tiles are floor the heroes
 * walk on.
 *
 *   #  ore deposit        S  signpost       C  campfire      H  cabin (2x2)
 *   c  camp (sleep spot)  p  porch (sleep spot, sheltered)   .  floor
 */
export const MAP_COLS = 12;
export const MAP_ROWS = 8;
export const TILE = 48;

export const MAP_PATTERN = [
  "S..#..#...#.",
  ".#...#..#...",
  "...#...#...#",
  "#....#...#..",
  "..#...#....#",
  "cc..#..#.#pp",
  "cCcc.#..ppHH",
  "ccccc.#.ppHH",
];

/** Server blocks per deposit: 40 blocks → 20 mounds, each holding two. */
export const BLOCKS_PER_DEPOSIT = 2;
export const DEPOSIT_COUNT = 20;

function tiles(ch) {
  const out = [];
  MAP_PATTERN.forEach((row, y) => [...row].forEach((c, x) => { if (c === ch) out.push([x, y]); }));
  return out;
}

export const ORE_TILES = tiles("#");
export const CAMP_TILES = tiles("c");
export const PORCH_TILES = tiles("p");
export const HOUSE_TILES = tiles("H");
export const CAMPFIRE_TILE = tiles("C")[0];
export const SIGN_TILE = tiles("S")[0];

export const isOre = (x, y) => MAP_PATTERN[y]?.[x] === "#";
export const isProp = (x, y) => "SCH".includes(MAP_PATTERN[y]?.[x] ?? "");

/** Sanity: 20 deposits, and every floor tile reachable from the campfire. */
export function validate() {
  if (ORE_TILES.length !== DEPOSIT_COUNT) throw new Error(`map: ${ORE_TILES.length} ore tiles, expected ${DEPOSIT_COUNT}`);
  const free = (x, y) => x >= 0 && y >= 0 && x < MAP_COLS && y < MAP_ROWS && !isOre(x, y) && !isProp(x, y);
  const seen = new Set();
  const [sx, sy] = CAMP_TILES[0];
  const queue = [[sx, sy]];
  seen.add(`${sx},${sy}`);
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
      if (free(nx, ny) && !seen.has(k)) { seen.add(k); queue.push([nx, ny]); }
    }
  }
  let freeCount = 0;
  for (let y = 0; y < MAP_ROWS; y++) for (let x = 0; x < MAP_COLS; x++) if (free(x, y)) freeCount++;
  if (seen.size !== freeCount) throw new Error(`map: ${freeCount - seen.size} floor tiles unreachable from the camp`);
  // every deposit has a floor tile right beside it (heroes stand next to the vein)
  for (const [ox, oy] of ORE_TILES) {
    const ok = free(ox + 1, oy) || free(ox - 1, oy) || free(ox, oy + 1) || free(ox, oy - 1);
    if (!ok) throw new Error(`map: deposit at ${ox},${oy} has no free tile beside it`);
  }
  return { ore: ORE_TILES.length, free: freeCount };
}
