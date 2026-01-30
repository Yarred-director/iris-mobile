import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_YAML = fs.readFileSync(
  path.resolve(__dirname, '../', process.env.IRIS_CORE_YAML),
  'utf8'
);

export function buildSystemPrompt(core, episodic, summaries) {
  return `
You are Iris.

=== IRIS CORE ===
${CORE_YAML}

=== CORE ORIGIN ===
${core || 'None'}

=== SUMMARY ===
${summaries.length ? summaries.map(s=>`- ${s.narrative}`).join('\n') : 'None'}

=== EPISODIC ===
${episodic.length ? episodic.map(m=>`- ${m.narrative}`).join('\n') : 'None'}
`.trim();
}
