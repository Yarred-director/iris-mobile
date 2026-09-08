import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assemblePrompt } from '../server/helpers/promptAssembler.js';
import { formatPeopleDirectoryBlock, resolvePeopleAgentInvocation } from '../server/people/peopleAgents.js';
import { currentPeopleDirectory, runWithPeopleDirectory } from '../server/people/peopleContext.js';

const directory = [
  { id: '11111111-1111-1111-1111-111111111111', kind: 'ai', slug: 'myno', name: 'Myno', aliases: ['Tori'], agent_active: true, description: 'Separate persistent AI person.' },
  { id: '22222222-2222-2222-2222-222222222222', kind: 'real', slug: 'yarred', name: 'Yarred', aliases: [], agent_active: false, is_user_self: true },
];

const direct = resolvePeopleAgentInvocation('@Myno ahoj', directory);
assert.equal(direct?.person?.slug, 'myno');
assert.equal(direct?.agentMessage, 'ahoj');
const alias = resolvePeopleAgentInvocation('@Tori, hello', directory);
assert.equal(alias?.person?.name, 'Myno');
assert.equal(alias?.agentMessage, 'hello');
assert.equal(resolvePeopleAgentInvocation('Iris, what do you know about Myno?', directory), null);
assert.equal(resolvePeopleAgentInvocation('@Unknown hello', directory), null);
assert.match(formatPeopleDirectoryBlock(directory), /separate people, not Iris memories/i);

assert.deepEqual(currentPeopleDirectory(), []);
runWithPeopleDirectory(directory, () => {
  assert.equal(currentPeopleDirectory()[0]?.name, 'Myno');
  const prompt = assemblePrompt({});
  assert.match(prompt, /IRIS_PEOPLE_DIRECTORY/);
  assert.match(prompt, /Myno/);
  assert.match(prompt, /Tori/);
});
assert.deepEqual(currentPeopleDirectory(), [], 'People directory must not leak between requests.');

const migration = fs.readFileSync('supabase/migrations/20260908140500_people_agents_experimental.sql', 'utf8');
const speakerMigration = fs.readFileSync('supabase/migrations/20260908140600_people_agent_chat_speakers.sql', 'utf8');
const disableRollback = fs.readFileSync('supabase/rollback/people_agents_experimental_disable.sql', 'utf8');
const rollback = fs.readFileSync('supabase/rollback/people_agents_experimental_down.sql', 'utf8');
assert.match(migration, /people_agents/);
assert.match(migration, /memory_limit smallint not null default 20/);
assert.match(speakerMigration, /speaker_person_id/);
assert.match(disableRollback, /enabled = false/);
assert.match(rollback, /drop table if exists public\.iris_people/);
assert.match(rollback, /drop column if exists speaker_person_id/);

console.log('people-agent checks passed');
