// server/memory/timeJudge.js
import { DateTime } from 'luxon';

function normalizeText(s) {
  return (s || '').toString().trim();
}

function hasIntent(text) {
  // len keď je to sľub/plan (aby neotravovalo)
  return /\b(dnes|zajtra)\b/i.test(text) && /\b(obed|vecer|ráno|popoludní|o\s*\d{1,2}:\d{2})\b/i.test(text);
}

function pickTimeAnchor(text) {
  const t = text.toLowerCase();

  // explicit "o 13:30"
  const m = t.match(/\bo\s*(\d{1,2})\s*:\s*(\d{2})\b/);
  if (m) {
    const hh = Math.min(23, Math.max(0, parseInt(m[1], 10)));
    const mm = Math.min(59, Math.max(0, parseInt(m[2], 10)));
    return { kind: 'explicit', hh, mm };
  }

  // parts of day (default anchors)
  if (/\bna\s+obed\b|\bobed\b/.test(t)) return { kind: 'anchor', hh: 12, mm: 30 };
  if (/\bvecer\b|\bvečer\b/.test(t)) return { kind: 'anchor', hh: 19, mm: 30 };
  if (/\brano\b|\bráno\b/.test(t)) return { kind: 'anchor', hh: 9, mm: 0 };
  if (/\bpopoludn[ií]\b/.test(t)) return { kind: 'anchor', hh: 15, mm: 0 };

  return null;
}

function pickDay(text) {
  const t = text.toLowerCase();
  if (/\bzajtra\b/.test(t)) return 'tomorrow';
  if (/\bdnes\b/.test(t)) return 'today';
  return null;
}

export function buildReminderFromText({ text, timezone }) {
  const msg = normalizeText(text);
  if (!msg) return null;
  if (!hasIntent(msg)) return null;

  const day = pickDay(msg);
  const anchor = pickTimeAnchor(msg);
  if (!day || !anchor) return null;

  const tz = timezone || 'UTC';
  let now = DateTime.now().setZone(tz);
  if (!now.isValid) now = DateTime.utc();

  let base = day === 'tomorrow' ? now.plus({ days: 1 }) : now;
  let due = base.set({ hour: anchor.hh, minute: anchor.mm, second: 0, millisecond: 0 });

  // ak už “dnes” prešlo, posuň na zajtra (ľudské)
  if (day === 'today' && due < now.plus({ minutes: 2 })) {
    due = due.plus({ days: 1 });
  }

  // text do pushu – s tvojím vibom, ale bez cringe
  const body = `Architect… čo bude s tým sľúbeným jedlom? 😼`;

  return {
    due_at: due.toUTC().toISO(),
    title: 'Pripomienka',
    body,
    meta: {
      tz,
      source: 'timeJudge',
      user_text: msg.slice(0, 500),
      local_due: due.toISO(),
    },
  };
}