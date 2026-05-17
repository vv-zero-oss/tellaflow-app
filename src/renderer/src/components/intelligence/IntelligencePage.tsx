import { useState, useEffect, useCallback } from 'react';
import { X, Plus } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Well, WellHeader, WellTitle, WellCard, WellItem } from '@/components/ui/well';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { AppConfig, SpeakerProfile, CalibrationResult } from '@/lib/ipc';
import { ipc } from '@/lib/ipc';

interface IntelligencePageProps {
  config: AppConfig;
  refreshConfig: () => Promise<void>;
}

function ScoreRing({ score }: { score: number }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? 'text-success' : score >= 40 ? 'text-yellow-500' : 'text-muted-foreground';

  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="currentColor" strokeWidth="5" className="text-border/40" />
        <circle
          cx="40" cy="40" r={radius} fill="none"
          stroke="currentColor" strokeWidth="5" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className={`${color} transition-all duration-700 ease-out`}
        />
      </svg>
      <span className="absolute text-xl font-bold">{score}</span>
    </div>
  );
}

export function IntelligencePage({ config, refreshConfig }: IntelligencePageProps) {
  const [profile, setProfile] = useState<SpeakerProfile | null>(null);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [calibrationText, setCalibrationText] = useState('');
  const [calibrationInput, setCalibrationInput] = useState('');
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationResult, setCalibrationResult] = useState<CalibrationResult | null>(null);
  const [vocabInput, setVocabInput] = useState('');

  const loadProfile = useCallback(async () => {
    try {
      const p = await ipc.getSpeakerProfile();
      setProfile(p);
    } catch (err) {
      console.error('Failed to load speaker profile:', err);
      setProfile({ vocabulary: [], sessions: [], calibratedAt: null, score: 0 });
    }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const openCalibration = async () => {
    const text = await ipc.getCalibrationText();
    setCalibrationText(text);
    setCalibrationInput('');
    setCalibrationResult(null);
    setCalibrationOpen(true);
  };

  const submitCalibration = async () => {
    setCalibrating(true);
    try {
      const result = await ipc.runCalibration(calibrationInput.trim());
      setCalibrationResult(result);
      await loadProfile();
      refreshConfig();
    } catch (err) {
      console.error('Calibration failed:', err);
    } finally {
      setCalibrating(false);
    }
  };

  const addWord = async () => {
    const word = vocabInput.trim();
    if (!word) return;
    await ipc.addVocabulary(word);
    setVocabInput('');
    loadProfile();
  };

  const removeWord = async (word: string) => {
    await ipc.removeVocabulary(word);
    loadProfile();
  };

  const clearAll = async () => {
    await ipc.clearSpeakerProfile();
    loadProfile();
    refreshConfig();
  };

  if (!profile) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="px-7 pt-12 pb-4 [-webkit-app-region:drag]">
          <h2 className="text-xl font-bold tracking-tight">Intelligence</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-7 pt-12 pb-4 [-webkit-app-region:drag]">
        <h2 className="text-xl font-bold tracking-tight">Intelligence</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Smart features that learn and adapt to how you work
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-7 py-6">

          {/* Feature toggles */}
          <Well className="mb-7">
            <WellHeader>
              <WellTitle>Features</WellTitle>
            </WellHeader>
            <WellCard>
              <WellItem>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <span className="text-sm">Voice commands</span>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                      Say "new line", "select all", or "undo that" to execute actions
                    </p>
                  </div>
                  <Switch
                    checked={config.voiceCommandsEnabled ?? false}
                    onCheckedChange={(enabled) => { ipc.setVoiceCommandsEnabled(enabled); refreshConfig(); }}
                  />
                </div>
              </WellItem>
              <WellItem>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <span className="text-sm">App-aware formatting</span>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                      Auto-adjust grammar tone for code editors, email, and chat apps
                    </p>
                  </div>
                  <Switch
                    checked={config.appContextEnabled ?? false}
                    onCheckedChange={(enabled) => { ipc.setAppContextEnabled(enabled); refreshConfig(); }}
                  />
                </div>
              </WellItem>
              <WellItem>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <span className="text-sm">Meeting transcription</span>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                      Capture system audio from calls instead of microphone
                    </p>
                  </div>
                  <Switch
                    checked={config.meetingMode ?? false}
                    onCheckedChange={(enabled) => { ipc.setMeetingMode(enabled); refreshConfig(); }}
                  />
                </div>
              </WellItem>
            </WellCard>
          </Well>

          {/* Speaker adaptation */}
          <Well className="mb-7">
            <WellHeader>
              <WellTitle>Speaker adaptation</WellTitle>
            </WellHeader>
            <WellCard>
              <WellItem>
                <div className="flex items-center gap-6">
                  <ScoreRing score={profile?.score ?? 0} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {!profile?.calibratedAt
                        ? 'Not calibrated'
                        : `Score: ${profile.score}/100`}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {!profile?.calibratedAt
                        ? 'Calibrate your voice to improve transcription accuracy'
                        : `${profile?.sessions?.length ?? 0} session${(profile?.sessions?.length ?? 0) !== 1 ? 's' : ''} completed · ${profile?.vocabulary?.length ?? 0} vocabulary words`}
                    </p>
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" onClick={openCalibration}>
                        {profile?.calibratedAt ? 'Train again' : 'Start calibration'}
                      </Button>
                      {profile?.calibratedAt && (
                        <Button variant="ghost" size="sm" onClick={clearAll}>
                          Reset
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </WellItem>

              {/* Session history */}
              {profile && profile.sessions.length > 0 && (
                <WellItem>
                  <div className="space-y-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sessions</span>
                    {profile.sessions.map((s, i) => (
                      <div key={s.timestamp} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          Session {i + 1} — {new Date(s.timestamp).toLocaleDateString()}
                        </span>
                        <span className={s.accuracy >= 80 ? 'text-success font-medium' : 'text-muted-foreground'}>
                          {s.accuracy}% accuracy ({s.matchedWords}/{s.expectedWords} words)
                        </span>
                      </div>
                    ))}
                  </div>
                </WellItem>
              )}
            </WellCard>
          </Well>

          {/* Vocabulary */}
          <Well className="mb-7">
            <WellHeader>
              <WellTitle>Custom vocabulary</WellTitle>
            </WellHeader>
            <WellCard>
              <WellItem>
                <p className="text-xs text-muted-foreground mb-3">
                  Add words and names that are often misrecognized. These are fed to the transcription engine as hints.
                </p>
                <div className="flex gap-2">
                  <input
                    className="flex-1 h-8 rounded-md bg-background border border-input px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="Add a word or name..."
                    value={vocabInput}
                    onChange={(e) => setVocabInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addWord()}
                  />
                  <Button size="sm" variant="outline" onClick={addWord} disabled={!vocabInput.trim()}>
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </WellItem>
              {profile && profile.vocabulary.length > 0 && (
                <WellItem>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.vocabulary.slice(0, 60).map((word) => (
                      <span
                        key={word}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/50 border border-border/40 text-xs"
                      >
                        {word}
                        <button
                          onClick={() => removeWord(word)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                    {profile.vocabulary.length > 60 && (
                      <span className="text-xs text-muted-foreground px-2 py-0.5">
                        +{profile.vocabulary.length - 60} more
                      </span>
                    )}
                  </div>
                </WellItem>
              )}
            </WellCard>
          </Well>

        </div>
      </ScrollArea>

      {/* Calibration dialog */}
      <Dialog open={calibrationOpen} onOpenChange={(open) => {
        setCalibrationOpen(open);
        if (!open) { setCalibrationResult(null); setCalibrationInput(''); }
      }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {calibrationResult ? 'Calibration complete' : `Training session ${(profile?.sessions.length ?? 0) + 1}`}
            </DialogTitle>
            {!calibrationResult && (
              <DialogDescription>
                Read the paragraph below out loud, record it with Tellaflow, then paste the transcription result.
              </DialogDescription>
            )}
          </DialogHeader>

          {!calibrationResult ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg bg-muted/50 border border-border/40 p-3">
                <p className="text-sm leading-relaxed italic text-muted-foreground">
                  {calibrationText}
                </p>
              </div>
              <textarea
                className="w-full h-24 rounded-lg bg-background border border-input px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="Paste your transcription result here..."
                value={calibrationInput}
                onChange={(e) => setCalibrationInput(e.target.value)}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <ScoreRing score={calibrationResult.score} />
                <div>
                  <p className="text-2xl font-bold">{calibrationResult.session.accuracy}%</p>
                  <p className="text-xs text-muted-foreground">
                    {calibrationResult.session.matchedWords} of {calibrationResult.session.expectedWords} words matched
                  </p>
                </div>
              </div>

              <div className="rounded-lg bg-muted/50 border border-border/40 p-3">
                <p className="text-sm">{calibrationResult.tip}</p>
              </div>

              {calibrationResult.session.missedWords.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                    Missed words
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {calibrationResult.session.missedWords.slice(0, 15).map((w) => (
                      <span key={w} className="px-2 py-0.5 rounded-md bg-destructive/10 text-destructive text-xs border border-destructive/20">
                        {w}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Total vocabulary: <strong>{calibrationResult.totalVocabulary}</strong> words ·
                Overall score: <strong>{calibrationResult.score}/100</strong>
              </p>
            </div>
          )}

          <DialogFooter>
            {calibrationResult ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setCalibrationOpen(false)}>
                  Done
                </Button>
                <Button size="sm" onClick={openCalibration}>
                  Train again
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => setCalibrationOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!calibrationInput.trim() || calibrating}
                  onClick={submitCalibration}
                >
                  {calibrating ? 'Analyzing...' : 'Submit'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
