function large(quotes, middleRows) {
  return [
    "    _.-" + "'".repeat(quotes) + "-._",
    "  ,'" + " ".repeat(quotes + 6) + "`.",
    " /" + " ".repeat(quotes + 10) + "\\",
    "." + " ".repeat(quotes + 12) + ".",
    ...Array(middleRows).fill("|" + " ".repeat(quotes + 12) + "|"),
    " \\" + " ".repeat(quotes + 10) + "/",
    "  `._" + " ".repeat(quotes + 4) + "_.'",
    "     '-" + ".".repeat(quotes) + "-'",
  ];
}

// Verbatim from svgbob's crates/svgbob/src/map/circle_map.rs; any other art is not recognised as a circle.
export const CIRCLES = [
  ["()"],
  ["(_)"],
  [" __", "(__)"],
  [" ,-.", "(   )", " `-'"],
  [" .--.", "(    )", " `--'"],
  ["   _", " .' '.", "(     )", " `._.'"],
  ["   __", " ,'  '.", "(      )", " `.__.'"],
  ["   ___", " ,'   '.", "(       )", " `.   .'", "   `-'"],
  ["   ___", " ,'   `.", "/       \\", "\\       /", " `.___.'"],
  ["   ____", " ,'    `.", "/        \\", "\\        /", " `.____.'"],
  ["    ____", "  .'    `.", " /        \\", "(          )", " \\        /", "  `.____.'"],
  ["    _____", "  ,'     `.", " /         \\", "(           )", " \\         /", "  `._____.'"],
  ["    ______", "  ,'      `.", " /          \\", "|            |", "|            |", " \\          /", "  `.______.'"],
  ["    _______", "  ,'       `.", " /           \\", "|             |", "|             |", " \\           /", "  `._______.'"],
  ["    ________", "  ,'        `.", " /            \\", "|              |", "|              |", "|              |", " \\            /", "  `.________.'"],
  ["    __-----__", "  ,'         `.", " /             \\", "|               |", "|               |", "|               |", " \\             /", "  `.         .'", "    `-------'"],
  ["    .--------.", "  ,'          `.", " /              \\", "|                |", "|                |", "|                |", " \\              /", "  `.          .'", "    `--------'"],
  large(5, 3),
  large(6, 3),
  large(7, 3),
  large(8, 4),
  large(9, 4),
];

export const MAX_CIRCLE = CIRCLES.length - 1;

export const circleRadius = (i) => (i + 1) / 2;

export function circleSize(i) {
  const art = CIRCLES[i];
  return { w: Math.max(...art.map((l) => l.length)), h: art.length };
}

export function pickCircle(wantW, wantH) {
  const target = Math.max(wantW, wantH * 2);
  let best = 0;
  for (let i = 1; i <= MAX_CIRCLE; i++) {
    if (Math.abs(circleSize(i).w - target) < Math.abs(circleSize(best).w - target)) best = i;
  }
  return best;
}
