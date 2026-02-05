import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
// OPENAI + IRIS_CORE sú potrebné len pre chat/LLM časti.
// Cron reminders sú deterministic DB worker, takže ich nevyžadujeme.
const REQUIRE_LLM = process.env.REQUIRE_LLM === 'true';

if (REQUIRE_LLM) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
  if (!process.env.IRIS_CORE_YAML) throw new Error('IRIS_CORE_YAML missing');
}
