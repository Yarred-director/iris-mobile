export function detectTimeOfDay(now = new Date()) {
  const h = now.getHours();

  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

export function formatTimeBlock(timeOfDay) {
  if (!timeOfDay) return '';

  return `
TIME CONTEXT:
- time_of_day: ${timeOfDay}
- Adapt tone, energy, and pacing naturally to this time of day.
`;
}
