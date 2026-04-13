export type VoiceEngine = 'neutts';
export type VoiceGender = 'male' | 'female';
export type VoiceAccent = 'american' | 'british' | 'european';

export interface VoiceMeta {
  id: string;          // matches the voice-ref JSON filename (dave, jo, …)
  name: string;
  engine: VoiceEngine;
  gender: VoiceGender;
  accent: VoiceAccent;
  language: string;
  description: string;
}

// ─── NeuTTS Nano preset voices ────────────────────────────────────────────────
// Reference codes for each voice are bundled in src/main/voice-refs/<id>.json
// and loaded by the NeuTTS worker at inference time.

export const NEUTTS_VOICES: VoiceMeta[] = [
  {
    id: 'dave',
    name: 'Dave',
    engine: 'neutts',
    gender: 'male',
    accent: 'american',
    language: 'English',
    description: 'Deep, warm storytelling voice — great for novels',
  },
  {
    id: 'jo',
    name: 'Jo',
    engine: 'neutts',
    gender: 'female',
    accent: 'american',
    language: 'English',
    description: 'Clear, expressive and conversational',
  },
  {
    id: 'greta',
    name: 'Greta',
    engine: 'neutts',
    gender: 'female',
    accent: 'european',
    language: 'English',
    description: 'Crisp European accent, elegant delivery',
  },
  {
    id: 'juliette',
    name: 'Juliette',
    engine: 'neutts',
    gender: 'female',
    accent: 'european',
    language: 'English',
    description: 'Soft and melodic with a European lilt',
  },
  {
    id: 'mateo',
    name: 'Mateo',
    engine: 'neutts',
    gender: 'male',
    accent: 'european',
    language: 'English',
    description: 'Warm, smooth male voice with a Spanish flair',
  },
];

export const ALL_VOICES: VoiceMeta[] = NEUTTS_VOICES;

export function getVoicesForEngine(engine: VoiceEngine): VoiceMeta[] {
  return ALL_VOICES.filter(v => v.engine === engine);
}

export function getVoiceById(id: string): VoiceMeta | undefined {
  return ALL_VOICES.find(v => v.id === id);
}

/** Default voice for new audiobooks */
export const DEFAULT_VOICE_ID = 'dave';

/** Deterministic avatar color from voice name */
const AVATAR_COLORS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-orange-500 to-amber-600',
  'from-pink-500 to-rose-600',
  'from-indigo-500 to-blue-600',
  'from-green-500 to-emerald-600',
  'from-red-500 to-orange-600',
];

export function voiceAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
