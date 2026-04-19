import { cn } from '@/lib/utils';

/** Bundled under `public/practice/noto/` (Noto Emoji Animation, Google Fonts CDN originals). */
const BASE = `${import.meta.env.BASE_URL}practice/noto/`;

export const PRACTICE_NOTO_PASS_IDS = [
  '1f642_200d_2195_fe0f',
  '1f973',
  '1f929',
  '1f60d',
  '1f970',
  '1f4af',
  '26a1',
  '1f31f',
  '1faf6_1f3fb',
] as const;

export const PRACTICE_NOTO_FAIL_IDS = ['1f62c', '1f642_200d_2194_fe0f', '1f636_200d_1f32b_fe0f', '1f9d0'] as const;

export type PracticeNotoEmojiProps = {
  /** File stem, e.g. `1f973` */
  id: string;
  alt: string;
  /** Pixel size (width & height). */
  size?: number;
  className?: string;
};

export function PracticeNotoEmoji({ id, alt, size = 40, className }: PracticeNotoEmojiProps) {
  return (
    <picture className={cn('shrink-0 [-webkit-app-region:no-drag]', className)}>
      <source srcSet={`${BASE}${id}.webp`} type="image/webp" />
      <img
        src={`${BASE}${id}.gif`}
        alt={alt}
        width={size}
        height={size}
        className="object-contain select-none"
        style={{ width: size, height: size }}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    </picture>
  );
}

export function practicePassNotoId(roundIndex: number): string {
  return PRACTICE_NOTO_PASS_IDS[roundIndex % PRACTICE_NOTO_PASS_IDS.length]!;
}

export function practiceFailNotoId(roundIndex: number): string {
  return PRACTICE_NOTO_FAIL_IDS[roundIndex % PRACTICE_NOTO_FAIL_IDS.length]!;
}
