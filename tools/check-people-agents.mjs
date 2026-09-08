import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatPeopleDirectoryBlock, resolvePeopleAgentInvocation } from '../server/people/peopleAgents.js';
import { currentPeopleDirectory, runWithPeopleDirectory } from '../server/people/peopleContext.js';
import { resolvePeopleImageTarget } from '../server/people/peopleImages.js';

const directory = [
  { id: '11111111-1111-1111-1111-111111111111', kind: 'ai', slug: 'myno', name: 'Myno', aliases: ['Tori'], agent_active: true, description: 'Separate persistent AI person.' },
  { id: '22222222-2222-2222-2222-222222222222', kind: 'real', slug: 'yarred', name: 'Yarred', aliases: [], agent_active: false, is_user_self: true },
];

const direct = resolvePeopleAgentInvocation('@Myno ahoj', directory);
assert.equal(direct?.person?.slug, 'myno');
assert.equal(direct?.agentMessage, 'ahoj');
const naturalDirect = resolvePeopleAgentInvocation('myno si tu?', directory);
assert.equal(naturalDirect?.person?.slug, 'myno');
assert.equal(naturalDirect?.agentMessage, 'si tu?');
const alias = resolvePeopleAgentInvocation('@Tori, hello', directory);
assert.equal(alias?.person?.name, 'Myno');
assert.equal(alias?.agentMessage, 'hello');
assert.equal(resolvePeopleAgentInvocation('Iris, what do you know about Myno?', directory), null);
assert.equal(resolvePeopleAgentInvocation('@Unknown hello', directory), null);
assert.match(formatPeopleDirectoryBlock(directory), /separate people, not Iris memories/i);

assert.equal(resolvePeopleImageTarget('vytvor fotku Myno v Tokiu', directory)?.slug, 'myno');
assert.equal(resolvePeopleImageTarget('create a photo of Tori', directory)?.name, 'Myno');
assert.equal(resolvePeopleImageTarget('vytvor fotku Iris', directory), null);

assert.deepEqual(currentPeopleDirectory(), []);
runWithPeopleDirectory(directory, () => {
  assert.equal(currentPeopleDirectory()[0]?.name, 'Myno');
  const block = formatPeopleDirectoryBlock(currentPeopleDirectory());
  assert.match(block, /Myno/);
  assert.match(block, /Tori/);
});
assert.deepEqual(currentPeopleDirectory(), [], 'People directory must not leak between requests.');

const migration = fs.readFileSync('supabase/migrations/20260908140500_people_agents_experimental.sql', 'utf8');
const speakerMigration = fs.readFileSync('supabase/migrations/20260908140600_people_agent_chat_speakers.sql', 'utf8');
const disableRollback = fs.readFileSync('supabase/rollback/people_agents_experimental_disable.sql', 'utf8');
const rollback = fs.readFileSync('supabase/rollback/people_agents_experimental_down.sql', 'utf8');
const assembler = fs.readFileSync('server/helpers/promptAssembler.js', 'utf8');
const peopleRoute = fs.readFileSync('server/routes/peopleRoutes.js', 'utf8');
const peopleImages = fs.readFileSync('server/people/peopleImages.js', 'utf8');
const peopleRelay = fs.readFileSync('server/people/peopleRelay.js', 'utf8');
assert.match(migration, /people_agents/);
assert.match(migration, /memory_limit smallint not null default 20/);
assert.match(speakerMigration, /speaker_person_id/);
assert.match(disableRollback, /enabled = false/);
assert.match(rollback, /drop table if exists public\.iris_people/);
assert.match(rollback, /drop column if exists speaker_person_id/);
assert.match(assembler, /formatPeopleDirectoryBlock\(currentPeopleDirectory\(\)\)/);
assert.match(peopleRoute, /resolvePeopleAgentInvocation\(rawMessage, directory\)/);
assert.match(peopleRoute, /handlePeopleImageRequest/);
assert.match(peopleRoute, /classifyPeopleRelayRequest/);
assert.match(peopleImages, /text-to-image/);
assert.match(peopleImages, /visual_anchor/);
assert.match(peopleRelay, /should_relay/);

console.log('people-agent checks passed');
