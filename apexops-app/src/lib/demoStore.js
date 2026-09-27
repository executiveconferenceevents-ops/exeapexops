export const DEMO_MODE = process.env.REACT_APP_DEMO_MODE === 'true';

const DEMO_SESSION_KEY = 'apexops-demo-session-v1';

function readState() {
  try {
    return JSON.parse(window.sessionStorage.getItem(DEMO_SESSION_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    window.sessionStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(state));
  } catch {
    throw new Error('Demo data could not be saved in this browser tab. Check available session storage and try again.');
  }
}

export function getDemoCollection(name, initialRows = []) {
  if (!DEMO_MODE) return initialRows;
  const state = readState();
  if (!Object.prototype.hasOwnProperty.call(state, name)) {
    state[name] = JSON.parse(JSON.stringify(initialRows));
    writeState(state);
  }
  return state[name];
}

export function setDemoCollection(name, rows) {
  if (!DEMO_MODE) return rows;
  const state = readState();
  state[name] = rows;
  writeState(state);
  return rows;
}

export function getAppStorage() {
  return DEMO_MODE ? window.sessionStorage : window.localStorage;
}
