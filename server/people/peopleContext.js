import { AsyncLocalStorage } from 'node:async_hooks';

const peopleContextStorage = new AsyncLocalStorage();

export function runWithPeopleDirectory(directory, callback) {
  const safeDirectory = Array.isArray(directory) ? directory : [];
  return peopleContextStorage.run({ directory: safeDirectory }, callback);
}

export function currentPeopleDirectory() {
  return peopleContextStorage.getStore()?.directory || [];
}
