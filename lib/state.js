const config = require("./config");

const state = {
  catalogSources: [],
  streamSources: [],
  subtitleSources: [],
  loadedAt: null
};

const liveTvState = {
  dir: config.LIVE_TV_LISTS_DIR,
  loadedAt: null,
  categories: [],
  channels: [],
  channelById: new Map(),
  files: []
};

const manifestCache = new Map();
const tmdbCache = new Map();
const playbackPreflightCache = new Map();
const playbackSessions = new Map();
const playbackAttemptLog = [];

const reliabilityState = {
  providers: {},
  loadedAt: null,
  updatedAt: null
};

let reliabilityPersistTimer = null;
let playbackClient = null;
let playbackClientPromise = null;

function getReliabilityPersistTimer() {
  return reliabilityPersistTimer;
}
function setReliabilityPersistTimer(value) {
  reliabilityPersistTimer = value;
}

function getPlaybackClient() {
  return playbackClient;
}
function setPlaybackClient(value) {
  playbackClient = value;
}

function getPlaybackClientPromise() {
  return playbackClientPromise;
}
function setPlaybackClientPromise(value) {
  playbackClientPromise = value;
}

module.exports = {
  state,
  liveTvState,
  manifestCache,
  tmdbCache,
  playbackPreflightCache,
  playbackSessions,
  playbackAttemptLog,
  reliabilityState,
  getReliabilityPersistTimer,
  setReliabilityPersistTimer,
  getPlaybackClient,
  setPlaybackClient,
  getPlaybackClientPromise,
  setPlaybackClientPromise
};
