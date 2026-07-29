// Deterministic gates for the memory/governance pipeline.
// These checks intentionally avoid an LLM call for routine chat messages.

const GREETING_ONLY = /^(ahoj|čau|cau|hello|hi|hey|dobr[éeý]\s*(ráno|rano|deň|den|večer|vecer)?|ok|okay|dobre|ďakujem|dakujem|thanks|thx)[!.?\s]*$/iu;
const IMAGE_REQUEST = /\b(fotk|foto|obráz|obraz|selfie|picture|photo|image|vygeneruj|nakresli|ukáž sa|ukaz sa|pošli mi seba|posli mi seba)\w*/iu;
const SCENE_SIGNAL = /\b(sme|som|si)\s+(na|v|vo|pri|u)\b|\b(pláž|plaz|hotel|izba|spálňa|spalna|kuchyňa|kuchyna|reštaurácia|restauracia|mesto|krajina|ráno|rano|večer|vecer|noc|dnes|zajtra|lietadlo|letisko|beach|room|hotel|morning|evening|night)\b/iu;
const MEMORY_SIGNAL = /\b(pamätaj|pamataj|zapamätaj|zapamataj|mám rád|mam rad|nemám rád|nemam rad|milujem|neznášam|neznasam|preferujem|volám sa|volam sa|pracujem|bývam|byvam|narodil|moja rodina|môj projekt|moj projekt|dôležité|dolezite|remember|i like|i love|i hate|i prefer|my name|my family|my project)\b/iu;
const EMOTIONAL_SIGNAL = /\b(chýbaš|chybas|ľúbim|lubim|milujem|bojím|bojim|smutn|šťastn|stastn|nahnevan|osamel|dôver|dover|vzťah|vztah|žiarli|ziarli|miss you|love you|trust|relationship|lonely|sad|happy|angry)\w*/iu;
const INTIMACY_SIGNAL = /\b(kiss|bozk|objím|objim|dotyk|nahý|nahy|sex|erotic|intím|intim|flirt|posteľ|postel|telo|prsia|zadok|cock|pussy)\w*/iu;
const PREFERENCE_SIGNAL = /\b(mám rád|mam rad|nemám rád|nemam rad|preferujem|páči sa mi|paci sa mi|nepáči|nepaci|i like|i dislike|i prefer|favorite|favourite)\b/iu;

function clean(text) {
  return String(text || '').trim();
}

export function shouldRunSemanticRecall(text) {
  const value = clean(text);
  if (!value || GREETING_ONLY.test(value)) return false;
  return value.split(/\s+/u).length >= 3 || value.length >= 24;
}

export function shouldExtractSceneContext(text) {
  return SCENE_SIGNAL.test(clean(text));
}

export function looksLikeImageRequest(text) {
  return IMAGE_REQUEST.test(clean(text));
}

export function shouldPersistExchange(userText, irisReply) {
  const user = clean(userText);
  const combined = `${user}\n${clean(irisReply)}`;
  if (!user || GREETING_ONLY.test(user)) return false;
  return MEMORY_SIGNAL.test(user) || EMOTIONAL_SIGNAL.test(combined) || INTIMACY_SIGNAL.test(combined) || user.length >= 120;
}

export function shouldClassifyIntent(text) {
  return INTIMACY_SIGNAL.test(clean(text));
}

export function shouldRunRelationshipUpdate(userText, irisReply) {
  return EMOTIONAL_SIGNAL.test(`${clean(userText)}\n${clean(irisReply)}`) || INTIMACY_SIGNAL.test(`${clean(userText)}\n${clean(irisReply)}`);
}

export function shouldRunSelfAwareness(userText, irisReply) {
  const combined = `${clean(userText)}\n${clean(irisReply)}`;
  return EMOTIONAL_SIGNAL.test(combined) || INTIMACY_SIGNAL.test(combined);
}

export function shouldRunPersonalityEvolution(userText) {
  return PREFERENCE_SIGNAL.test(clean(userText));
}

export function couldBeFactualQuestion(text) {
  const value = clean(text);
  return /[?？]$/u.test(value) || /^(čo|co|kto|kde|kedy|prečo|preco|ako|koľko|kolko|what|who|where|when|why|how)\b/iu.test(value);
}
