'use strict';

const path = require('path');
const fs = require('fs');

// Calibration paragraphs — the user can cycle through them across sessions
const CALIBRATION_TEXTS = [
  `The quick brown fox jumps over the lazy dog. My name is often mispronounced, but technology adapts to how I speak. Programming concepts like JavaScript, Python, and React are part of my daily vocabulary. I frequently mention specific terms unique to my work and personal life.`,
  `Machine learning and artificial intelligence are transforming software development. Kubernetes clusters orchestrate containerized microservices while PostgreSQL databases handle persistent storage. The architecture leverages WebSocket connections for real-time communication.`,
  `During yesterday's standup meeting, we discussed the deployment pipeline and the OAuth integration. The API endpoint returns JSON responses with pagination tokens. We should refactor the authentication middleware before the next sprint review.`,
];

let profilePath = null;
let profile = null;

const EMPTY_PROFILE = {
  vocabulary: [],
  sessions: [],       // { timestamp, expectedWords, matchedWords, missedWords, accuracy }
  calibratedAt: null,
  score: 0,           // 0-100, based on vocabulary size + session count + accuracy trend
};

function init(userDataPath) {
  profilePath = path.join(userDataPath, 'speaker-profile.json');
  load();
}

function load() {
  if (!profilePath) return;
  try {
    if (fs.existsSync(profilePath)) {
      const raw = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
      profile = { ...EMPTY_PROFILE, ...raw };
      // Migrate old format
      if (!profile.sessions) profile.sessions = [];
      if (typeof profile.score !== 'number') profile.score = calculateScore();
    }
  } catch (err) {
    console.warn('Failed to load speaker profile:', err.message);
  }
  if (!profile) {
    profile = { ...EMPTY_PROFILE };
  }
}

function save() {
  if (!profilePath || !profile) return;
  try {
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  } catch (err) {
    console.warn('Failed to save speaker profile:', err.message);
  }
}

/**
 * Score from 0-100 based on:
 * - Vocabulary size (up to 30 pts: 1 pt per 5 words, max 150 words)
 * - Number of sessions (up to 30 pts: 10 pts per session, max 3 sessions)
 * - Average accuracy across sessions (up to 40 pts)
 */
function calculateScore() {
  if (!profile) return 0;

  const vocabPts = Math.min(30, Math.floor(profile.vocabulary.length / 5));

  const sessionPts = Math.min(30, profile.sessions.length * 10);

  let accuracyPts = 0;
  if (profile.sessions.length > 0) {
    const avgAccuracy = profile.sessions.reduce((sum, s) => sum + (s.accuracy || 0), 0) / profile.sessions.length;
    accuracyPts = Math.round(avgAccuracy * 40 / 100);
  }

  return Math.min(100, vocabPts + sessionPts + accuracyPts);
}

function getCalibrationText() {
  // Cycle through texts based on session count
  const idx = profile ? profile.sessions.length % CALIBRATION_TEXTS.length : 0;
  return CALIBRATION_TEXTS[idx];
}

function isCalibrated() {
  return profile && profile.calibratedAt !== null;
}

function getProfile() {
  if (!profile) load();
  if (!profile) profile = { ...EMPTY_PROFILE };
  return {
    vocabulary: profile.vocabulary || [],
    sessions: profile.sessions || [],
    calibratedAt: profile.calibratedAt || null,
    score: profile.score || 0,
  };
}

/**
 * Process a calibration session. Compares expected text to transcription,
 * accumulates vocabulary, and records the session with accuracy metrics.
 */
function processCalibration(expectedText, transcribedText) {
  if (!profile) load();

  const clean = (s) => s.toLowerCase().replace(/[.,!?;:'"()]/g, '').split(/\s+/).filter(w => w.length > 2);
  const expected = clean(expectedText);
  const transcribed = clean(transcribedText);

  const expectedSet = new Set(expected);
  const transcribedSet = new Set(transcribed);

  const matchedWords = expected.filter(w => transcribedSet.has(w));
  const missedWords = expected.filter(w => !transcribedSet.has(w));
  const accuracy = expected.length > 0 ? Math.round((matchedWords.length / expected.length) * 100) : 0;

  // Accumulate vocabulary — merge with existing, don't replace
  const combined = new Set([...profile.vocabulary, ...expected]);
  profile.vocabulary = [...combined];

  // Record session
  const session = {
    timestamp: Date.now(),
    expectedWords: expected.length,
    matchedWords: matchedWords.length,
    missedWords: missedWords,
    accuracy,
  };
  profile.sessions.push(session);
  profile.calibratedAt = Date.now();
  profile.score = calculateScore();

  save();

  return {
    session,
    totalVocabulary: profile.vocabulary.length,
    score: profile.score,
    tip: getTip(accuracy, profile.sessions.length),
  };
}

/**
 * Contextual tip based on accuracy and session count.
 */
function getTip(accuracy, sessionCount) {
  if (sessionCount === 1) {
    if (accuracy >= 90) return 'Great start! Do another session to improve your score further.';
    if (accuracy >= 70) return 'Good first session. Try again in a quieter environment to boost accuracy.';
    return 'Try speaking more slowly and clearly. A second session will help.';
  }
  if (accuracy >= 95) return 'Excellent accuracy. Your voice profile is well-tuned.';
  if (accuracy >= 80) return 'Good progress. Add any frequently misrecognized words to your custom vocabulary.';
  return 'Consider adding specific technical terms or names you use often.';
}

function addVocabulary(words) {
  if (!profile) load();
  const newWords = Array.isArray(words) ? words : [words];
  const combined = new Set([
    ...profile.vocabulary,
    ...newWords.map(w => w.toLowerCase().trim()).filter(w => w.length > 0),
  ]);
  profile.vocabulary = [...combined];
  profile.score = calculateScore();
  save();
}

function removeVocabulary(word) {
  if (!profile) load();
  profile.vocabulary = profile.vocabulary.filter(w => w !== word.toLowerCase().trim());
  profile.score = calculateScore();
  save();
}

function clearProfile() {
  profile = { ...EMPTY_PROFILE };
  save();
}

function getInitialPromptHint() {
  if (!profile || profile.vocabulary.length === 0) return '';
  const words = profile.vocabulary.slice(0, 50);
  return words.join(', ');
}

module.exports = {
  init,
  getCalibrationText,
  isCalibrated,
  getProfile,
  processCalibration,
  addVocabulary,
  removeVocabulary,
  clearProfile,
  getInitialPromptHint,
};
