import assert from 'node:assert/strict';
import { buildLiveAssistanceDirective, looksLikeLiveAssistanceRequest } from '../server/helpers/liveAssistance.js';

assert.equal(
  looksLikeLiveAssistanceRequest('vyhľadaj najlepšie reštaurácie v okolí nášho apartmánu na Jumeirah Beach'),
  true,
);
assert.equal(looksLikeLiveAssistanceRequest('find good restaurants near our apartment'), true);
assert.equal(looksLikeLiveAssistanceRequest('pozri ktoré sushi podniky sú teraz otvorené'), true);
assert.equal(looksLikeLiveAssistanceRequest('mám rada sushi'), false);
assert.equal(looksLikeLiveAssistanceRequest('poďme na večeru'), false);

const directive = buildLiveAssistanceDirective({
  location_city: 'Dubai',
  location_country: 'UAE',
  place: 'Jumeirah Beach',
});
assert.match(directive, /Jumeirah Beach, Dubai, UAE/);
assert.match(directive, /web search/i);
assert.match(directive, /Stay fully in character/i);

console.log('live assistance regression checks passed');
