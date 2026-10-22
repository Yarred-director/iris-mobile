import assert from 'node:assert/strict';
import { buildLiveAssistanceDirective } from '../server/helpers/liveAssistance.js';


const directive = buildLiveAssistanceDirective({
  location_city: 'Dubai',
  location_country: 'UAE',
  place: 'Jumeirah Beach',
});
assert.match(directive, /Jumeirah Beach, Dubai, UAE/);
assert.match(directive, /web search/i);
assert.match(directive, /Stay fully in character/i);
assert.match(directive, /never print a long raw URL/i);
assert.match(directive, /Markdown link/i);
assert.match(directive, /Google Maps/i);

console.log('live assistance regression checks passed');
