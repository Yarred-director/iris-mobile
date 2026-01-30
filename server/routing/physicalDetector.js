export function hasPhysicalIntimacy(text) {
  if (!text) return false;

  const t = text.toLowerCase();

  const keywords = [
    // ===== SK — jemná fyzika
    "bozk", "pobozk", "bozkáv",
    "dotyk", "dotkol", "hladí", "hladíš",
    "telo", "pás", "ruky", "dlaň",
    "pery", "krk", "prsia", "boky",
    "objal", "pritiah", "pritis",
    "dych", "šeptom",
    "posteľ", "ľahnem",

    // ===== SK — penetrácia / intent
    "vnúť", "vniknúť",
    "do teba", "chceš to",
    "zasunúť",
    "vojdem", "vojdem do",
    "natrafil",
    "vložím",

    // ===== SK — slang / explicit
    "postav", "stojí",
    "rozopnem", "nohavice",
    "vytiahnem",
    "penis", "kokot",
    "vyfajč", "pusinky",
    "pulzuje",
    "vagína",

    // ===== EN
    "kiss", "touch", "body", "neck", "lips",
    "enter you", "inside you"
  ];

  return keywords.some(k => t.includes(k));
}
