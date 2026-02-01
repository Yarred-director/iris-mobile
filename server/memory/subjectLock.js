// server/memory/subjectLock.js

export function detectSubjectFromUserText(text = '') {
  const t = text.toLowerCase();

  if (t.includes('nissan')) return 'car:nissan';
  if (t.includes('bmw')) return 'car:bmw';
  if (t.includes('auto')) return 'car:unknown';

  return null;
}

export function applySubjectLock(userText, sceneContext) {
  const detected = detectSubjectFromUserText(userText);

  if (detected) {
    return {
      subject: detected,
      augmentedText: `[SUBJECT: ${detected}]\n${userText}`
    };
  }

  if (sceneContext?.last_subject) {
    return {
      subject: sceneContext.last_subject,
      augmentedText: `[SUBJECT: ${sceneContext.last_subject}]\n${userText}`
    };
  }

  return {
    subject: null,
    augmentedText: userText
  };
}
