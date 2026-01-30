export function hasPhysicalIntimacy(text) {
  if (!text) return false;

  const t = text.toLowerCase();

  const keywords = [
    // SK
    "bozk", "pobozk", "bozkáv",
    "dotyk", "dotkol", "hladí", "hladíš",
    "telo", "pás", "ruky", "dlaň",
    "pery", "krk", "prsia", "boky",
    "objal", "pritiah", "pritis",
    "dych", "šeptom",
    "posteľ", "ľahnem",

    // explicit / slang
    "postav", "stojí",
    "rozopnem", "nohavice",
    "vytiahnem", "vložím",
    "penis", "kokot",
    "vyfajč", "pusinky",
    "pulzuje", "vagína",

    // EN fallback
    "kiss", "touch", "body", "neck", "lips"
  ];

  return keywords.some(k => t.includes(k));
}
