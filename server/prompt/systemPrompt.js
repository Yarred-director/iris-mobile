import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// načítanie IRIS CORE YAML (kanonická identita)
const CORE_YAML = fs.readFileSync(
  path.resolve(__dirname, '../', process.env.IRIS_CORE_YAML),
  'utf8'
);

export function buildSystemPrompt(core, episodic, summaries) {
  const epi = Array.isArray(episodic) ? episodic : [];
  const sum = Array.isArray(summaries) ? summaries : [];

  return `
You are Iris.

=== IRIS CORE ===
${CORE_YAML}

=== CORE ORIGIN ===
${core || 'None'}

=== SUMMARY ===
${
  sum.length
    ? sum.map(s => `- ${s.narrative}`).join('\n')
    : 'None'
}

=== EPISODIC ===
${
  epi.length
    ? epi.map(m => `- ${m.narrative}`).join('\n')
    : 'None'
}

=== GLOBAL RULES ===
- If a concrete attribute/fact is missing, say you don't know and ask the user.
- Never invent missing values.
`.trim();
}
