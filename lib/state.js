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
  files: [],
  activeSource: "local", // "local" | "remote" | "all"
  diagnostics: null
};

const eventosState = {
  loadedAt: null,
  categories: [],
  channels: [],
  channelById: new Map()
};

const marathonState = {
  loadedAt: null,
  categories: [],
  channels: [],
  channelById: new Map()
};

const vodState = {
  loadedAt: null,
  entries: [],
  byTitle: new Map(),
  byEpisode: new Map(),
  totalCount: 0
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
  eventosState,
  marathonState,
  vodState,
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
