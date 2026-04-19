/** v1: echo only. Phase 2: voice-adapted mcq / wordBank per game plan */
export type PracticeExerciseType = 'echo' | 'mcq' | 'wordBank';

export type PracticeDeckRound = {
  id: string;
  exerciseType?: PracticeExerciseType;
  tier: number;
  target: string;
  hint?: string | null;
  passThreshold?: number;
};

export type PracticeDeck = {
  id: string;
  title: string;
  rounds: PracticeDeckRound[];
};
