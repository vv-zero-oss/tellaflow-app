/* ─────────────────────────────────────────────────────────
 * VOICE ISLAND — one file, everything included
 *
 * The island and every state it shows: none, idle, listening,
 * dictating, thinking, transcribing, recording, done, dictionary,
 * plan, approval, questions, answer (text, image, video, voice),
 * error, setup, meeting. Its colours, sizes, type and motion live
 * in ISLAND_CSS below, scoped to the island itself, with a light
 * and a dark theme and a translucent and an opaque material.
 *
 * Needs: React 19, Tailwind CSS v4, framer-motion, lucide-react,
 * tailwind-merge. Dark theme follows a `.dark` class on an
 * ancestor. Type is Inter: load it however your app loads fonts
 * (next/font exposing --font-inter, or a plain "Inter" family).
 *
 *   <VoiceIsland state="listening" onAction={(a) => …} />
 * ───────────────────────────────────────────────────────── */

import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import {
  AlertTriangle,
  BookPlus,
  CalendarClock,
  Check,
  Circle,
  LoaderCircle,
  MicOff,
  Pause,
  Play,
  Square,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { twMerge } from "tailwind-merge";

/* ═══ Styles ═══════════════════════════════════════════════ */

const ISLAND_CSS = `
/* Light theme, and the translucent material. */
[data-island] {
  --island-glass: rgb(22 22 22 / 0.56);
  --island-glass-idle: rgb(22 22 22 / 0.28);
  --island-blur: 19.5px;
  --island-button: rgb(0 0 0 / 0.13);
  --island-button-hover: rgb(0 0 0 / 0.26);
  --island-button-active: rgb(0 0 0 / 0.34);
  --island-fg: rgb(233 233 233);
  --island-fg-muted: rgb(233 233 233 / 0.74);
  --island-fg-soft: rgb(233 233 233 / 0.9);
  --island-on-fg: rgb(22 22 22);
  --island-highlight: rgb(255 255 255 / 0.08);
  --island-line: rgb(233 233 233 / 0.35);
  --island-hairline: rgb(255 255 255 / 0.08);
  --island-divider: rgb(233 233 233 / 0.1);
  --island-track: rgb(233 233 233 / 0.14);
  --island-ring: rgb(233 233 233 / 0.5);
  --island-edge: transparent;
  --island-success: oklch(0.87 0.18 152);
  --island-danger: oklch(0.76 0.17 22);
  --island-warning: oklch(0.9 0.15 88);
  --island-radius: 16px;
  --island-radius-button: 11px;
  --island-radius-row: 8px;
  --island-radius-check: 5px;
  --island-shadow: 0 3px 7px rgb(0 0 0 / 0.17), 0 14px 14px rgb(0 0 0 / 0.15),
    0 30px 18px rgb(0 0 0 / 0.09), 0 54px 22px rgb(0 0 0 / 0.03);
  --island-font: var(--font-inter, "Inter"), system-ui, sans-serif;
  --island-weight: 600;
  --island-leading: 1.15;
  --island-text-title: 14px;
  --island-text-button: 13px;
  --island-wave-duration: 900ms;
  --island-shimmer-duration: 1400ms;
}

/* Dark theme. */
.dark [data-island] {
  /* On a near-black page the reference's charcoal glass disappears; lift it
     a step and give it a hairline edge. */
  --island-glass: rgb(44 44 44 / 0.58);
  --island-glass-idle: rgb(44 44 44 / 0.4);
  --island-edge: rgb(255 255 255 / 0.08);
}

/* The opaque material: solid #323232, no blur, in either theme. */
[data-island][data-island-material="opaque"] {
  --island-glass: rgb(50 50 50);
  --island-glass-idle: rgb(50 50 50);
  --island-blur: 0px;
  /* A dark pane barely shows on solid grey, so buttons turn to a light one. */
  --island-button: rgb(255 255 255 / 0.1);
  --island-button-hover: rgb(255 255 255 / 0.16);
  --island-button-active: rgb(255 255 255 / 0.22);
}

@keyframes island-pop {
  from {
    opacity: 0;
    scale: 0.92;
  }
  to {
    opacity: 1;
    scale: 1;
  }
}

@keyframes island-fade-up {
  from {
    opacity: 0;
    translate: 0 4px;
  }
  to {
    opacity: 1;
    translate: 0 0;
  }
}

@keyframes island-word {
  from {
    opacity: 0;
    filter: blur(4px);
  }
  to {
    opacity: 1;
    filter: blur(0);
  }
}

@keyframes island-shimmer {
  from {
    background-position-x: 100%;
  }
  to {
    background-position-x: -100%;
  }
}

@keyframes island-wave-x {
  0%,
  100% {
    scale: 0.3 1;
  }
  50% {
    scale: 1 1;
  }
}

@keyframes island-wave {
  0%,
  100% {
    scale: 1 0.3;
  }
  50% {
    scale: 1 1;
  }
}

/* A highlight that sweeps through the text while the island thinks. */
.island-shimmer {
  background-image: linear-gradient(
    90deg,
    var(--island-fg-muted) 35%,
    var(--island-fg) 50%,
    var(--island-fg-muted) 65%
  );
  background-size: 200% 100%;
  background-clip: text;
  color: transparent;
  animation: island-shimmer var(--island-shimmer-duration) linear infinite;
}

.island-wave-bar {
  animation: island-wave var(--island-wave-duration) ease-in-out infinite;
}

.island-wave-bar-x {
  animation: island-wave-x var(--island-wave-duration) ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .island-wave-bar,
  .island-wave-bar-x {
    animation: none;
  }

  .island-shimmer {
    background-image: none;
    color: var(--island-fg);
    animation: none;
  }
}
`;

/* ═══ Helpers ══════════════════════════════════════════════ */

function cn(...classes: (string | false | null | undefined)[]) {
  return twMerge(classes.filter(Boolean).join(" "));
}

const ANSWER_CHART =
  "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22328%22 height=%22164%22 viewBox=%220 0 328 164%22 role=%22img%22 aria-label=%22Words dictated per day this week%22%3E%0A  %3Crect width=%22328%22 height=%22164%22 rx=%2212%22 fill=%22%231a1a1a%22/%3E%0A  %3Cg font-family=%22system-ui, sans-serif%22 font-size=%2210%22 fill=%22%238c8c8c%22 text-anchor=%22middle%22%3E%0A    %3Ctext x=%2244%22 y=%22150%22%3EMon%3C/text%3E%3Ctext x=%2292%22 y=%22150%22%3ETue%3C/text%3E%3Ctext x=%22140%22 y=%22150%22%3EWed%3C/text%3E%0A    %3Ctext x=%22188%22 y=%22150%22%3EThu%3C/text%3E%3Ctext x=%22236%22 y=%22150%22%3EFri%3C/text%3E%3Ctext x=%22284%22 y=%22150%22%3ESat%3C/text%3E%0A  %3C/g%3E%0A  %3Cg fill=%22%23535353%22%3E%0A    %3Crect x=%2230%22 y=%2286%22 width=%2228%22 height=%2248%22 rx=%226%22/%3E%0A    %3Crect x=%2278%22 y=%2270%22 width=%2228%22 height=%2264%22 rx=%226%22/%3E%0A    %3Crect x=%22174%22 y=%2278%22 width=%2228%22 height=%2256%22 rx=%226%22/%3E%0A    %3Crect x=%22222%22 y=%2294%22 width=%2228%22 height=%2240%22 rx=%226%22/%3E%0A    %3Crect x=%22270%22 y=%22114%22 width=%2228%22 height=%2220%22 rx=%226%22/%3E%0A  %3C/g%3E%0A  %3Crect x=%22126%22 y=%2230%22 width=%2228%22 height=%22104%22 rx=%226%22 fill=%22%23fa4c03%22/%3E%0A  %3Ctext x=%22140%22 y=%2222%22 font-family=%22system-ui, sans-serif%22 font-size=%2210%22 font-weight=%22600%22 fill=%22%23ffffff%22 text-anchor=%22middle%22%3E4,200%3C/text%3E%0A%3C/svg%3E";

/* ═══ Island button ════════════════════════════════════════ */

/* The reference's button: a darker pane of the same glass, full width in a
   card's row. The primary one is told apart by brighter text; the ghost one
   has no pane until it is hovered. */
export function IslandButton({
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"button"> & {
  tone?: "neutral" | "accent" | "danger" | "ghost";
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-[30px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--island-radius-button)] bg-[var(--island-button)] px-2.5 py-[7px] text-[length:var(--island-text-button)] whitespace-nowrap backdrop-blur-[var(--island-blur)] transition-colors outline-none hover:bg-[var(--island-button-hover)] focus-visible:ring-2 focus-visible:ring-[var(--island-ring)] active:bg-[var(--island-button-active)] disabled:pointer-events-none disabled:opacity-40",
        tone === "neutral" && "text-[var(--island-fg-soft)] hover:text-[var(--island-fg)]",
        tone === "accent" && "text-[var(--island-fg)]",
        tone === "danger" && "text-[var(--island-fg)] [&_svg]:text-[var(--island-danger)]",
        tone === "ghost" &&
          "bg-transparent text-[var(--island-fg-muted)] backdrop-blur-none hover:text-[var(--island-fg)]",
        className,
      )}
      {...props}
    />
  );
}

/* ═══ Glide menu ═══════════════════════════════════════════ */

/**
 * A list whose hover highlight glides from row to row instead of jumping.
 * Rows mark themselves with `data-menu-row`; the highlight follows the
 * pointer, and keyboard focus too, and fades when both leave.
 */
export function GlideMenu({
  className,
  highlightClassName,
  children,
}: {
  className?: string;
  highlightClassName?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);

  const follow = (target: EventTarget | null) => {
    const row = (target as HTMLElement | null)?.closest<HTMLElement>("[data-menu-row]");
    if (!row || !ref.current?.contains(row)) return;
    setBox({ top: row.offsetTop, height: row.offsetHeight });
  };

  return (
    <div
      ref={ref}
      className={cn("relative", className)}
      onPointerOver={(event) => follow(event.target)}
      onFocus={(event) => follow(event.target)}
      onPointerLeave={() => {
        if (!ref.current?.contains(document.activeElement)) setBox(null);
      }}
      onBlur={(event) => {
        if (!ref.current?.contains(event.relatedTarget as Node | null)) setBox(null);
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute transition-[top,height,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          highlightClassName,
        )}
        style={{ top: box?.top ?? 0, height: box?.height ?? 0, opacity: box ? 1 : 0 }}
      />
      {children}
    </div>
  );
}

/* ═══ Streaming answer ═════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────
 * STREAMING TEXT, in the island's glass
 * Words resolve out of blur, inline citations appear in
 * context, then actions and follow-up prompts become usable.
 * ───────────────────────────────────────────────────────── */

const WORD_MS = 55;
const HOLD_MS = 3400;

/* one streamed word, or a `cite` placeholder that renders an inline source chip */
export type StreamingToken = { text: string; cite?: boolean };

const TOKENS: StreamingToken[] = [
  ..."Pistachio is your fastest-growing flavor — sales are up 23% this month and margins beat vanilla by 8 points."
    .split(" ")
    .map((text) => ({ text })),
  { text: "", cite: true },
  ..."Stone-fruit flavors are trending in the same range."
    .split(" ")
    .map((text) => ({ text })),
];

const FOLLOW_UPS = [
  "Which flavors sell best in winter",
  "Compare gelato and soft serve margins",
];

const SOURCE_IMAGES = {
  scoop:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%231f7a5f'/%3E%3Cpath d='M20 36c0 7 5.4 12 12 12s12-5 12-12H20Z' fill='%23fff'/%3E%3Ccircle cx='32' cy='25' r='11' fill='%23bff3dd'/%3E%3Cpath d='M24 24c4-7 13-7 17 0' fill='none' stroke='%231f7a5f' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E",
  trends:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%232f6fec'/%3E%3Cpath d='M15 43 27 31l8 7 14-18' fill='none' stroke='%23fff' stroke-width='7' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='49' cy='20' r='5' fill='%23bfe0ff'/%3E%3C/svg%3E",
  market:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23e56d24'/%3E%3Cpath d='M17 45V25h8v20h-8Zm11 0V16h8v29h-8Zm11 0V30h8v15h-8Z' fill='%23fff'/%3E%3Cpath d='M16 49h32' stroke='%23ffd6b8' stroke-width='4' stroke-linecap='round'/%3E%3C/svg%3E",
};

/* one cited source rendered as an inline chip and in the sources list */
export type StreamingSource = { name: string; domain: string; href: string; image: string };

const SOURCES: StreamingSource[] = [
  { name: "Scoop Data", domain: "scoopdata.io", href: "https://scoopdata.io/", image: SOURCE_IMAGES.scoop },
  { name: "Trends Index", domain: "trends.google.com", href: "https://trends.google.com/trends/", image: SOURCE_IMAGES.trends },
  { name: "Market Basket", domain: "marketbasket.io", href: "https://marketbasket.io/", image: SOURCE_IMAGES.market },
];

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-[var(--island-ring)]";

function SourceChip({ source }: { source?: StreamingSource }) {
  if (!source) return null;
  return (
    <a
      href={source.href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "mr-1 inline-flex h-4.5 translate-y-[-1px] items-center gap-1 rounded-[5px] bg-[var(--island-button)] px-[3px] align-middle font-mono text-[10.5px] text-[var(--island-fg-soft)] shadow-[inset_0_0_0_1px_var(--island-hairline)] transition-colors duration-150 hover:bg-[var(--island-highlight)] hover:text-[var(--island-fg)]",
        focusRing,
      )}
      style={{ animation: "island-pop 250ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      <img src={source.image} alt="" className="size-3 rounded-[3px]" />
      <span>{source.domain}</span>
    </a>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const COPY = <g><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></g>;
const COPIED = <path d="M20 6L9 17l-5-5" />;
const RETRY = <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />;
const UP = <path d="M7 10v12M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z" />;
const DOWN = <path d="M17 14V2M9 18.12L10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88z" />;

export type StreamingLabels = {
  /** label on the collapsed sources toggle */
  sources: string;
  /** heading above the follow-up prompts */
  followUps: string;
};

const STREAMING_LABELS: StreamingLabels = {
  sources: "10 sources",
  followUps: "Follow-ups",
};

export function StreamingText({
  content = TOKENS,
  sources = SOURCES,
  followUps = FOLLOW_UPS,
  labels,
  loop = true,
  onDone,
  onFollowUp,
}: {
  /** the streamed tokens; `cite` tokens render an inline source chip */
  content?: StreamingToken[];
  /** cited sources shown in the chip, avatar stack, and expanded list */
  sources?: StreamingSource[];
  /** follow-up prompt suggestions shown once the stream completes */
  followUps?: string[];
  /** prominent copy strings */
  labels?: Partial<StreamingLabels>;
  /** restart the stream after a hold; turn off when embedding in a real thread */
  loop?: boolean;
  onDone?: () => void;
  /** fired when a follow-up prompt is chosen */
  onFollowUp?: (text: string, index: number) => void;
} = {}) {
  const l = { ...STREAMING_LABELS, ...labels };
  const [count, setCount] = useState(0);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const done = count >= content.length;

  useEffect(() => {
    if (done && !loop) {
      onDone?.();
      return;
    }
    const t = setTimeout(
      () => setCount((c) => (c >= content.length ? 0 : c + 1)),
      done ? HOLD_MS : WORD_MS,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, done, loop]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = () => {
    const text = content.filter((token) => !token.cite).map((token) => token.text).join(" ");
    navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {});
  };

  const retry = () => {
    setSourcesOpen(false);
    setRating(null);
    setCount(0);
  };

  const actionButton = cn(
    "flex size-6 cursor-pointer items-center justify-center rounded-[6px] text-[var(--island-fg-muted)] transition-colors duration-100 hover:bg-[var(--island-highlight)] hover:text-[var(--island-fg-soft)] aria-pressed:text-[var(--island-fg)]",
    focusRing,
  );

  return (
    <div className="w-full">
      <p className="text-[length:var(--island-text-button)] leading-relaxed text-[var(--island-fg)]" aria-busy={!done}>
        {content.slice(0, count).map((token, i) =>
          token.cite ? (
            <SourceChip key={i} source={sources[0]} />
          ) : (
            <span
              key={i}
              className="inline motion-reduce:animate-none"
              style={{ animation: "island-word 260ms ease-out both" }}
            >
              {token.text}{" "}
            </span>
          ),
        )}
        {!done && (
          <span
            aria-hidden="true"
            className="ml-0.5 inline-block h-3 w-0.5 translate-y-0.5 rounded-full bg-[var(--island-fg)]"
            style={{ animation: "island-pop 150ms ease-out both" }}
          />
        )}
      </p>

      {/* action icons row */}
      <div
        className="mt-2 flex items-center gap-0.5 transition-opacity duration-400"
        style={{ opacity: done ? 1 : 0, pointerEvents: done ? "auto" : "none" }}
        inert={!done}
      >
        <button type="button" aria-label={copied ? "Copied" : "Copy answer"} onClick={copy} className={actionButton}>
          <Icon>{copied ? COPIED : COPY}</Icon>
        </button>
        <button type="button" aria-label="Retry" onClick={retry} className={actionButton}>
          <Icon>{RETRY}</Icon>
        </button>
        <button
          type="button"
          aria-label="Good answer"
          aria-pressed={rating === "up"}
          onClick={() => setRating((r) => (r === "up" ? null : "up"))}
          className={actionButton}
        >
          <Icon>{UP}</Icon>
        </button>
        <button
          type="button"
          aria-label="Bad answer"
          aria-pressed={rating === "down"}
          onClick={() => setRating((r) => (r === "down" ? null : "down"))}
          className={actionButton}
        >
          <Icon>{DOWN}</Icon>
        </button>
        {sources.length > 0 && (
        <button
          type="button"
          aria-expanded={sourcesOpen}
          onClick={() => setSourcesOpen((current) => !current)}
          className={cn(
            "ml-1.5 flex cursor-pointer items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-left transition-colors duration-150 hover:bg-[var(--island-highlight)]",
            focusRing,
          )}
        >
          <span className="flex -space-x-1">
            {sources.map((source) => (
              <img
                key={source.domain}
                src={source.image}
                alt=""
                className="size-3.5 rounded-full shadow-[0_0_0_1.5px_var(--island-glass)]"
              />
            ))}
          </span>
          <span className="text-[12px] text-[var(--island-fg-soft)]">{l.sources}</span>
        </button>
        )}
      </div>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: done && sourcesOpen ? "1fr" : "0fr",
          opacity: done && sourcesOpen ? 1 : 0,
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
        inert={!(done && sourcesOpen)}
      >
        <div className="overflow-hidden">
          <ul className="mt-1.5 flex flex-col rounded-[10px] bg-[var(--island-button)] p-1 shadow-[inset_0_0_0_1px_var(--island-hairline)]">
            {sources.map((source) => (
              <li key={source.domain}>
                <a
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "group flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-[12px] text-[var(--island-fg-soft)] transition-colors duration-150 hover:bg-[var(--island-highlight)] hover:text-[var(--island-fg)]",
                    focusRing,
                  )}
                >
                  <img src={source.image} alt="" className="size-4 rounded-[4px]" />
                  <span className="underline decoration-transparent underline-offset-2 transition-[text-decoration-color] duration-150 group-hover:decoration-current">
                    {source.name}
                  </span>
                  <span className="ml-auto font-mono text-[10.5px] text-[var(--island-fg-muted)]">{source.domain}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* follow-ups */}
      {followUps.length > 0 && (
      <div
        className="mt-2.5 transition-opacity duration-400"
        style={{ opacity: done ? 1 : 0, pointerEvents: done ? "auto" : "none" }}
        inert={!done}
      >
        <p className="text-[12px] text-[var(--island-fg-soft)]">{l.followUps}</p>
        <ul className="mt-0.5 flex flex-col">
          {followUps.map((text, i) => (
            <li key={text} className="border-b border-[var(--island-divider)] last:border-b-0">
              <button
                type="button"
                onClick={() => onFollowUp?.(text, i)}
                className={cn(
                  "-mx-1.5 flex w-[calc(100%+0.75rem)] cursor-pointer items-center gap-2 rounded-[7px] px-1.5 py-1.5 text-left text-[12.5px] text-[var(--island-fg)] transition-colors duration-100 hover:bg-[var(--island-highlight)]",
                  focusRing,
                )}
                style={
                  done
                    ? { animation: `island-fade-up 350ms cubic-bezier(0.23,1,0.32,1) ${i * 90}ms both` }
                    : { opacity: 0 }
                }
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--island-fg-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
                  <path d="M9 10l-5 5 5 5" />
                  <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                </svg>
                {text}
              </button>
            </li>
          ))}
        </ul>
      </div>
      )}
    </div>
  );
}

/* ═══ Approval card ════════════════════════════════════════ */

/* ─────────────────────────────────────────────────────────
 * APPROVAL CARD (human-in-the-loop), in the island's glass
 * One question at a time. The stack slides vertically as you
 * move between questions (the card's height animates to fit),
 * the step counter rolls like an odometer, and the footer uses
 * glass actions — a quiet Skip and a bright Continue with a ⏎.
 * Single-choice answers auto-advance; multi-select waits.
 * It draws no surface of its own: the island is the card.
 * ───────────────────────────────────────────────────────── */

export type ApprovalQuestion = {
  q: string;
  type: "radio" | "check";
  options: string[];
};

const QUESTIONS: ApprovalQuestion[] = [
  {
    q: "How many flavors should we launch?",
    type: "radio",
    options: ["Three (core line)", "Five (full case)", "Just one hero"],
  },
  {
    q: "Which mix-ins should we stock?",
    type: "check",
    options: ["Chocolate chips", "Waffle bits", "Sprinkles"],
  },
  {
    q: "Which market do we enter first?",
    type: "radio",
    options: ["Food trucks", "Grocery freezers", "Scoop shops"],
  },
];

export type ApprovalLabels = {
  skip: string;
  continue: string;
  send: string;
  customPlaceholder: string;
  sentMessage: string;
};

const APPROVAL_LABELS: ApprovalLabels = {
  skip: "Skip",
  continue: "Continue",
  send: "Send",
  customPlaceholder: "Something else…",
  sentMessage: "Answers sent",
};

const ROLL_MS = 400;
const SLIDE = "360ms cubic-bezier(0.22, 1, 0.36, 1)";

/* odometer digits — each character that changes rolls up (or down) */
function RollingDigits({ value }: { value: string }) {
  const prevRef = useRef(value);
  const [oldVal, setOldVal] = useState(value);
  const [newVal, setNewVal] = useState(value);
  const [rolling, setRolling] = useState(false);
  const [shifted, setShifted] = useState(false);
  const [dir, setDir] = useState<"up" | "down">("up");

  useEffect(() => {
    if (prevRef.current === value) return;
    const from = prevRef.current;
    prevRef.current = value;
    const fromN = parseInt(from, 10);
    const toN = parseInt(value, 10);
    setDir(Number.isFinite(fromN) && Number.isFinite(toN) && toN < fromN ? "down" : "up");
    setOldVal(from);
    setNewVal(value);
    setRolling(true);
    setShifted(false);

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShifted(true));
    });
    const done = setTimeout(() => {
      setRolling(false);
      setOldVal(value);
      setShifted(false);
    }, ROLL_MS);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(done);
    };
  }, [value]);

  const chars = rolling ? newVal : oldVal;

  return (
    <>
      {Array.from({ length: chars.length }, (_, i) => {
        const o = oldVal[i] ?? "";
        const n = chars[i] ?? "";
        if (!rolling || o === n) {
          return <span key={`${i}-${n}`}>{n}</span>;
        }
        const top = dir === "down" ? n : o;
        const bottom = dir === "down" ? o : n;
        const restY = dir === "down" ? "0" : "-1em";
        const startY = dir === "down" ? "-1em" : "0";
        return (
          <span
            key={`${i}-${o}-${n}-${dir}`}
            style={{ display: "inline-block", position: "relative", overflow: "hidden", height: "1em", lineHeight: "1em", verticalAlign: "-0.05em" }}
          >
            <span
              style={{
                display: "flex",
                flexDirection: "column",
                transition: "transform 350ms cubic-bezier(0.4, 0, 0.2, 1)",
                transform: `translateY(${shifted ? restY : startY})`,
              }}
            >
              <span style={{ height: "1em", lineHeight: "1em" }}>{top}</span>
              <span style={{ height: "1em", lineHeight: "1em" }}>{bottom}</span>
            </span>
          </span>
        );
      })}
    </>
  );
}

function Ico({ path, size = 14, sw = 2 }: { path: ReactNode; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {path}
    </svg>
  );
}

const iconButton =
  "flex cursor-pointer items-center justify-center text-[var(--island-fg-muted)] transition-colors duration-100 outline-none hover:text-[var(--island-fg)] focus-visible:ring-2 focus-visible:ring-[var(--island-ring)]";

export function ApprovalCard({
  questions = QUESTIONS,
  labels,
  onSubmitted,
  onAnswerChange,
  onDismiss,
  resettable = true,
}: {
  questions?: ApprovalQuestion[];
  labels?: Partial<ApprovalLabels>;
  onSubmitted?: (answers: Record<number, number[]>) => void;
  onAnswerChange?: (questionIndex: number, answer: number[]) => void;
  /** Given, the × hands dismissal to the island; otherwise the card folds itself away. */
  onDismiss?: () => void;
  resettable?: boolean;
} = {}) {
  const t = { ...APPROVAL_LABELS, ...labels };
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number[]>>({});
  const [custom, setCustom] = useState<Record<number, string>>({});
  const [sent, setSent] = useState(false);
  const [open, setOpen] = useState(true);

  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const questionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const measured = useRef(false);
  const [viewportH, setViewportH] = useState<number | undefined>(undefined);
  const [trackY, setTrackY] = useState(0);
  const [animate, setAnimate] = useState(false);
  // Until the first question is measured, render only the active one so the
  // initial (and SSR) height is Q1's height — not all questions stacked, which
  // would flash to full height and then shrink on mount.
  const [ready, setReady] = useState(false);

  const last = qi === questions.length - 1;
  const selected = answers[qi] ?? [];
  const hasAnswer = selected.length > 0 || Boolean(custom[qi]?.trim());

  const sync = (withAnim: boolean) => {
    const item = questionRefs.current[qi];
    if (!item) return;
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setViewportH(item.offsetHeight);
    setTrackY(item.offsetTop);
    setAnimate(withAnim && !reduce);
  };

  useLayoutEffect(() => {
    const withAnim = measured.current;
    measured.current = true;
    sync(withAnim);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qi, answers, custom, open, sent]);

  useEffect(() => {
    const id = requestAnimationFrame(() => sync(measured.current));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qi]);

  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);

  const goTo = (next: number) => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setQi(Math.min(Math.max(next, 0), questions.length - 1));
  };

  const send = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setSent(true);
    onSubmitted?.(answers);
  };

  const advance = () => {
    if (last) send();
    else goTo(qi + 1);
  };

  const dismiss = () => {
    if (onDismiss) onDismiss();
    else setOpen(false);
  };

  const toggle = (index: number) => {
    const type = questions[qi].type;
    setAnswers((current) => {
      const picked = current[qi] ?? [];
      const next = type === "radio"
        ? [index]
        : picked.includes(index)
          ? picked.filter((item) => item !== index)
          : [...picked, index];
      onAnswerChange?.(qi, next);
      return { ...current, [qi]: next };
    });
    if (type === "radio") {
      setCustom((current) => ({ ...current, [qi]: "" }));
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      advanceTimer.current = setTimeout(() => {
        if (last) send();
        else setQi((current) => Math.min(questions.length - 1, current + 1));
      }, 480);
    }
  };

  const reset = () => {
    setQi(0);
    setAnswers({});
    setCustom({});
    setSent(false);
    setOpen(true);
    measured.current = false;
  };

  if (!open) {
    return (
      <IslandButton onClick={() => setOpen(true)}>Open approval</IslandButton>
    );
  }

  if (sent) {
    return (
      <div
        className="flex items-center gap-3 px-2 pb-2"
        style={{ animation: "island-pop 260ms cubic-bezier(0.23,1,0.32,1) both" }}
      >
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--island-success)]/15 py-1 pr-2.5 pl-1 text-[length:var(--island-text-button)] text-[var(--island-success)]">
          <span className="flex size-4.5 items-center justify-center rounded-full bg-[var(--island-success)] text-[var(--island-on-fg)]">
            <Ico size={11} sw={3} path={<path d="M20 6L9 17l-5-5" />} />
          </span>
          {t.sentMessage}
        </span>
        {resettable && (
          <button
            type="button"
            onClick={reset}
            className="cursor-pointer rounded-[var(--island-radius-check)] text-[length:var(--island-text-button)] whitespace-nowrap text-[var(--island-fg-muted)] transition-colors duration-150 outline-none hover:text-[var(--island-fg)] focus-visible:ring-2 focus-visible:ring-[var(--island-ring)]"
          >
            Start over
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-[288px]">
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className={cn(iconButton, "absolute -top-2 right-0 z-10 size-6 rounded-full hover:bg-[var(--island-highlight)]")}
      >
        <Ico size={14} sw={2.2} path={<path d="M18 6L6 18M6 6l12 12" />} />
      </button>

      {/* the question itself is the heading */}
      <div
        className="overflow-hidden"
        style={{ height: viewportH, transition: animate ? `height ${SLIDE}` : undefined }}
        aria-live="polite"
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 26,
            transform: `translate3d(0, ${-trackY}px, 0)`,
            transition: animate ? `transform ${SLIDE}` : undefined,
            willChange: "transform",
          }}
        >
          {questions.map((question, qIdx) => {
            const active = qIdx === qi;
            // Before the first measure, mount only the active question so the
            // card opens at its real height instead of flashing to full height.
            if (!ready && !active) return null;
            const picked = answers[qIdx] ?? [];
            const questionStyle: CSSProperties = {
              opacity: active ? 1 : 0,
              transition: animate ? `opacity ${SLIDE}` : undefined,
              pointerEvents: active ? undefined : "none",
            };
            return (
              <div
                key={qIdx}
                ref={(el) => { questionRefs.current[qIdx] = el; }}
                aria-hidden={active ? undefined : true}
                style={questionStyle}
              >
                <p className="px-2 pr-8 text-[length:var(--island-text-title)]">{question.q}</p>
                <GlideMenu
                  className="mt-2.5 flex flex-col gap-1"
                  highlightClassName="inset-x-0 rounded-[var(--island-radius-row)] bg-[var(--island-highlight)]"
                >
                  {question.options.map((option, i) => {
                    const on = picked.includes(i);
                    return (
                      <button
                        key={option}
                        type="button"
                        data-menu-row
                        role={question.type === "radio" ? "radio" : "checkbox"}
                        aria-checked={on}
                        tabIndex={active ? 0 : -1}
                        onClick={() => { if (active) toggle(i); }}
                        className="relative z-10 flex cursor-pointer items-center gap-2 rounded-[var(--island-radius-row)] py-1.5 pr-2 pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--island-ring)]"
                      >
                        <span
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center transition-colors duration-200",
                            question.type === "radio" ? "rounded-full" : "rounded-[var(--island-radius-check)]",
                            on
                              ? "bg-[var(--island-fg)] text-[var(--island-on-fg)]"
                              : "text-transparent shadow-[inset_0_0_0_1.5px_var(--island-line)]",
                          )}
                        >
                          {question.type === "radio" ? (
                            <span
                              className="size-1.5 rounded-full bg-[var(--island-on-fg)] transition-transform duration-200"
                              style={{ transform: on ? "scale(1)" : "scale(0)" }}
                            />
                          ) : (
                            <Ico size={12} sw={3} path={<path d="M20 6L9 17l-5-5" />} />
                          )}
                        </span>
                        <span
                          className={cn(
                            "text-[length:var(--island-text-button)] leading-none transition-colors duration-200",
                            on ? "text-[var(--island-fg)]" : "text-[var(--island-fg-soft)]",
                          )}
                        >
                          {option}
                        </span>
                      </button>
                    );
                  })}
                  <label
                    data-menu-row
                    className="relative z-10 flex cursor-text items-center gap-2 rounded-[var(--island-radius-row)] py-1.5 pr-2 pl-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--island-ring)]"
                  >
                    <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center text-[var(--island-fg-muted)]">
                      <Ico size={12} sw={2.2} path={<path d="M12 5v14M5 12h14" />} />
                    </span>
                    <input
                      value={custom[qIdx] ?? ""}
                      tabIndex={active ? 0 : -1}
                      onChange={(event) => {
                        if (!active) return;
                        setCustom((current) => ({ ...current, [qIdx]: event.target.value }));
                        if (question.type === "radio") setAnswers((current) => ({ ...current, [qIdx]: [] }));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && hasAnswer) {
                          event.preventDefault();
                          advance();
                        }
                      }}
                      placeholder={t.customPlaceholder}
                      aria-label="Custom answer"
                      className="min-w-0 flex-1 bg-transparent text-[length:var(--island-text-button)] leading-none text-[var(--island-fg)] outline-none placeholder:text-[var(--island-fg-muted)]"
                    />
                  </label>
                </GlideMenu>
              </div>
            );
          })}
        </div>
      </div>

      {/* footer — step nav (rolling counter) + glass actions */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 pl-1.5">
          <button
            type="button"
            aria-label="Previous question"
            disabled={qi <= 0}
            onClick={() => goTo(qi - 1)}
            className={cn(iconButton, "size-[18px] rounded-[var(--island-radius-check)] disabled:cursor-default disabled:opacity-30 disabled:hover:text-[var(--island-fg-muted)]")}
          >
            <Ico size={14} path={<path d="M18 15l-6-6-6 6" />} />
          </button>
          <span
            className="inline-flex items-center text-[12px] tabular-nums text-[var(--island-fg-muted)]"
            style={{ letterSpacing: "-0.1px", lineHeight: 1 }}
            aria-label={`Question ${qi + 1} of ${questions.length}`}
          >
            <RollingDigits value={`${qi + 1} / ${questions.length}`} />
          </span>
          <button
            type="button"
            aria-label="Next question"
            disabled={last}
            onClick={() => goTo(qi + 1)}
            className={cn(iconButton, "size-[18px] rounded-[var(--island-radius-check)] disabled:cursor-default disabled:opacity-30 disabled:hover:text-[var(--island-fg-muted)]")}
          >
            <Ico size={14} path={<path d="M6 9l6 6 6-6" />} />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <IslandButton tone="ghost" className="flex-none" onClick={() => (last ? dismiss() : goTo(qi + 1))}>
            {t.skip}
          </IslandButton>
          <IslandButton tone="accent" className="flex-none" disabled={!hasAnswer} onClick={advance}>
            {last ? t.send : t.continue}
            <kbd aria-hidden="true" className="font-[inherit] text-[var(--island-fg-muted)]">⏎</kbd>
          </IslandButton>
        </div>
      </div>
    </div>
  );
}

/* ═══ Voice island ═════════════════════════════════════════ */

export type IslandState =
  | "none"
  | "idle"
  | "listening"
  | "dictating"
  | "thinking"
  | "transcribing"
  | "plan"
  | "approval"
  | "questions"
  | "answer"
  | "done"
  | "dictionary"
  | "error"
  | "setup"
  | "meeting"
  | "recording";

export type AnswerKind = "text" | "image" | "video" | "voice";

/** The screen edge the island sits on. */
export type IslandPlacement = "left" | "bottom" | "right";

/* On a side edge these pills stand upright, so they take no width from
   the screen; every other state keeps its shape wherever it sits. */
const UPRIGHT_ON_SIDES: IslandState[] = ["listening", "dictating"];

/* Upright pills pad top and bottom instead of left and right. */
const UPRIGHT_PADDING: Partial<Record<IslandState, string>> = {
  listening: "p-0",
  dictating: "py-[3px]",
};

/** Translucent is frosted glass over whatever is behind; opaque is solid #323232. */
export type IslandMaterial = "translucent" | "opaque";

/* Compact states stay a 30px pill (idle, a 16px one) as wide as what is in
   it; the rest open into a card that sizes to its content, up to 320px. */
const PILL_HEIGHT: Partial<Record<IslandState, number>> = {
  idle: 20,
  listening: 30,
  dictating: 30,
  thinking: 30,
  transcribing: 30,
  recording: 30,
  done: 30,
  dictionary: 30,
};

/* A button at a pill's end sits 3px from the edge, inside the curve. */
const PILL_PADDING: Partial<Record<IslandState, string>> = {
  idle: "p-0",
  listening: "p-0",
  dictating: "px-[3px]",
  recording: "pl-3 pr-[3px]",
  done: "pl-3 pr-[3px]",
  dictionary: "pl-3 pr-[3px]",
};

const LABELS: Record<IslandState, string> = {
  none: "",
  idle: "Voice typing ready",
  listening: "Listening",
  dictating: "Dictating",
  thinking: "Thinking",
  transcribing: "Transcribing",
  plan: "Working through a plan",
  approval: "Approval needed",
  questions: "Questions waiting",
  answer: "Answer ready",
  done: "Done",
  dictionary: "Add word to dictionary",
  error: "Something went wrong",
  setup: "Setup needed",
  meeting: "Meeting starting",
  recording: "Recording",
};

/** A card's title, body and button labels. A `null` label hides that button. */
export type IslandNotice = {
  title: string;
  body: string;
  primary?: string;
  secondary?: string | null;
  tertiary?: string | null;
};

export type PlanStep = { label: string; status: "done" | "current" | "pending" };

/**
 * Live content for the island. Every field is optional: anything left out
 * falls back to the design's sample copy, so the demo page needs none of it.
 */
export type IslandContent = {
  /** done: what just happened, and whether Undo applies */
  doneText?: string;
  canUndo?: boolean;
  /** error, setup, approval, meeting */
  notice?: IslandNotice;
  plan?: { title: string; steps: PlanStep[] };
  /** answer (text): the reply, plus optional follow-up prompts */
  answerText?: string;
  followUps?: string[];
  /** recording: epoch ms the recording started, so the timer survives re-renders */
  recordingSince?: number;
};

const spring = { type: "spring", bounce: 0.22, duration: 0.55 } as const;

export function VoiceIsland({
  state: requested,
  answerKind = "text",
  material = "translucent",
  placement = "bottom",
  correctedWord = "Kubernetes",
  content = {},
  onAction,
}: {
  /** "none" takes the island off screen; any other state brings it back. */
  state: IslandState;
  answerKind?: AnswerKind;
  material?: IslandMaterial;
  placement?: IslandPlacement;
  /** The word the person just corrected, offered to the dictionary. */
  correctedWord?: string;
  /** Live text for the current state; see IslandContent. */
  content?: IslandContent;
  /** Every chip and button in the island reports here by name. */
  onAction?: (action: string) => void;
}) {
  const notice = content.notice;
  // While it leaves for "none", the island keeps drawing the state it was in.
  const lastShown = useRef<Exclude<IslandState, "none">>("idle");
  if (requested !== "none") lastShown.current = requested;
  const state = lastShown.current;

  const pillHeight = PILL_HEIGHT[state];
  const isCard = pillHeight === undefined;
  const upright = placement !== "bottom" && UPRIGHT_ON_SIDES.includes(state);
  const act = (action: string) => () => onAction?.(action);

  return (
    <MotionConfig reducedMotion="user" transition={spring}>
      {/* React hoists this into <head> once, however many islands render. */}
      <style href="voice-island" precedence="default">
        {ISLAND_CSS}
      </style>
      <AnimatePresence>
        {requested !== "none" && (
          <motion.div
            key="island"
            layout
            initial={{ opacity: 0, scale: 0.6, filter: "blur(8px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.6, filter: "blur(8px)" }}
            role="status"
            data-island=""
            data-island-material={material}
            aria-live="polite"
            aria-label={LABELS[state]}
            /* Radii are numbers, not a pill's 9999px, so framer can keep the
               corners round while the island stretches between sizes. */
            style={
              isCard
                ? { width: "auto", height: "auto", maxWidth: 320, borderRadius: 16 }
                : upright
                  ? { width: pillHeight, height: "auto", maxWidth: "none", borderRadius: pillHeight / 2 }
                  : { width: "auto", height: pillHeight, maxWidth: "none", borderRadius: pillHeight / 2 }
            }
            className={cn(
              "relative overflow-hidden font-[family-name:var(--island-font)] leading-[var(--island-leading)] font-[number:var(--island-weight)] text-[var(--island-fg)] shadow-[var(--island-shadow)] ring-1 ring-[var(--island-edge)] ring-inset backdrop-blur-[var(--island-blur)] [font-feature-settings:'case']",
              state === "idle" ? "bg-[var(--island-glass-idle)]" : "bg-[var(--island-glass)]",
            )}
          >

            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                layout="position"
                key={state === "answer" ? `answer-${answerKind}` : state}
                initial={{ opacity: 0, scale: 0.94, filter: "blur(6px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.94, filter: "blur(6px)" }}
                transition={{ duration: 0.22 }}
                className={cn(
                  isCard && "px-2 pt-4 pb-2",
                  !isCard && "flex h-full items-center justify-center",
                  !isCard && upright && (UPRIGHT_PADDING[state] ?? "py-3"),
                  !isCard && !upright && (PILL_PADDING[state] ?? "px-3"),
                )}
              >
                {state === "idle" && <IdleDot onStart={act("start-listening")} />}
                {state === "listening" && (
                  /* The whole pill is the button: press it for the dictation controls. */
                  <button
                    type="button"
                    onClick={act("expand-listening")}
                    aria-label="Show dictation controls"
                    className={cn(
                      "flex size-full cursor-pointer items-center justify-center rounded-full outline-none hover:bg-[var(--island-highlight)] focus-visible:ring-2 focus-visible:ring-[var(--island-ring)] focus-visible:ring-inset active:scale-[0.97]",
                      upright ? "py-3" : "px-3",
                    )}
                  >
                    <Wave upright={upright} />
                  </button>
                )}
                {state === "dictating" && (
                  <div className={cn("flex items-center gap-2.5", upright && "flex-col")}>
                    <RoundButton label="Cancel dictation" onClick={act("cancel-dictation")}>
                      <X className="size-3.5" strokeWidth={2.75} aria-hidden="true" />
                    </RoundButton>
                    <Wave upright={upright} />
                    <RoundButton label="Finish dictation" tone="confirm" onClick={act("finish-dictation")}>
                      <Check className="size-3.5" strokeWidth={2.75} aria-hidden="true" />
                    </RoundButton>
                  </div>
                )}
                {state === "thinking" && (
                  <span className="island-shimmer text-[length:var(--island-text-button)] whitespace-nowrap">
                    Thinking
                  </span>
                )}
                {state === "transcribing" && (
                  <span className="island-shimmer text-[length:var(--island-text-button)] whitespace-nowrap">
                    Transcribing…
                  </span>
                )}
                {state === "recording" && <Recording since={content.recordingSince} onStop={act("stop-recording")} />}
                {state === "dictionary" && (
                  <div className="flex items-center gap-2">
                    <BookPlus className="size-3.5 shrink-0 text-[var(--island-fg-muted)]" aria-hidden="true" />
                    <span className="text-[length:var(--island-text-button)] whitespace-nowrap">
                      Add “{correctedWord}” to dictionary?
                    </span>
                    <div className="ml-1 flex items-center gap-1">
                      <IslandButton className="h-6 flex-none" onClick={act("dictionary-no")}>
                        No
                      </IslandButton>
                      <IslandButton tone="accent" className="h-6 flex-none" onClick={act("dictionary-yes")}>
                        Yes
                      </IslandButton>
                    </div>
                  </div>
                )}
                {state === "done" && (
                  <div className="flex items-center gap-2">
                    <Check className="size-3.5 text-[var(--island-success)]" aria-hidden="true" />
                    <span className="text-[length:var(--island-text-button)] whitespace-nowrap">{content.doneText ?? "Inserted 38 words"}</span>
                    {(content.canUndo ?? true) && (
                      <IslandButton className="ml-1 h-6 flex-none" onClick={act("undo")}>
                        Undo
                      </IslandButton>
                    )}
                  </div>
                )}
                {state === "error" && (
                  <Notice
                    icon={<MicOff className="size-4 text-[var(--island-danger)]" aria-hidden="true" />}
                    title={notice?.title ?? "Microphone disconnected"}
                    body={notice?.body ?? "Your AirPods stopped sending audio. Reconnect them, then try again."}
                  >
                    {notice?.primary !== null && (
                      <IslandButton tone="accent" onClick={act("retry")}>
                        {notice?.primary ?? "Try again"}
                      </IslandButton>
                    )}
                    <IslandButton onClick={act("dismiss")}>{notice?.secondary ?? "Dismiss"}</IslandButton>
                  </Notice>
                )}
                {state === "setup" && (
                  <Notice
                    icon={
                      <AlertTriangle className="size-4 text-[var(--island-warning)]" aria-hidden="true" />
                    }
                    title={notice?.title ?? "Allow microphone access"}
                    body={notice?.body ?? "Voice typing needs the microphone to hear you. You can change this any time in System Settings."}
                  >
                    <IslandButton tone="accent" onClick={act("open-settings")}>
                      {notice?.primary ?? "Open System Settings"}
                    </IslandButton>
                    {notice?.secondary !== null && (
                      <IslandButton onClick={act("later")}>{notice?.secondary ?? "Later"}</IslandButton>
                    )}
                  </Notice>
                )}
                {state === "plan" && <Plan plan={content.plan} />}
                {state === "approval" && (
                  <Notice
                    icon={<span className="size-2 rounded-full bg-[var(--island-fg)]" aria-hidden="true" />}
                    title={notice?.title ?? "Send this to #design?"}
                    body={notice?.body ?? "“Moved the review to Thursday at 2pm — the new mocks are in Figma under Island v3.”"}
                  >
                    <IslandButton tone="accent" onClick={act("approve")}>
                      {notice?.primary ?? "Send"}
                    </IslandButton>
                    {notice?.secondary !== null && (
                      <IslandButton onClick={act("edit")}>{notice?.secondary ?? "Edit first"}</IslandButton>
                    )}
                    {notice?.tertiary !== null && (
                      <IslandButton onClick={act("cancel")}>{notice?.tertiary ?? "Cancel"}</IslandButton>
                    )}
                  </Notice>
                )}
                {state === "answer" && (
                  <Answer kind={answerKind} text={content.answerText} followUps={content.followUps} onFollowUp={act("follow-up")} />
                )}
            {state === "questions" && <ApprovalCard onDismiss={act("dismiss")} />}
                {state === "meeting" && (
                  <Notice
                    icon={
                      <CalendarClock className="size-4" aria-hidden="true" />
                    }
                    title={notice?.title ?? "Design sync is starting"}
                    body={notice?.body ?? "Google Meet · 6 people · 30 min. Take notes as it happens?"}
                  >
                    <IslandButton tone="accent" onClick={act("transcribe")}>
                      {notice?.primary ?? "Transcribe meeting"}
                    </IslandButton>
                    <IslandButton onClick={act("not-now")}>{notice?.secondary ?? "Not now"}</IslandButton>
                  </Notice>
                )}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

/* The whole idle pill is the button: press it to start listening. */
function IdleDot({ onStart }: { onStart: () => void }) {
  return (
    <button
      type="button"
      onClick={onStart}
      aria-label="Start voice typing"
      className="group grid size-5 cursor-pointer place-items-center rounded-full outline-none hover:bg-[var(--island-highlight)] focus-visible:ring-2 focus-visible:ring-[var(--island-ring)] focus-visible:ring-inset"
    >
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full bg-[var(--island-fg)] transition-transform duration-150 group-hover:scale-125 group-active:scale-90"
      />
    </button>
  );
}

/* A 24px round button for the ends of a 30px pill. */
function RoundButton({
  label,
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"button"> & { label: string; tone?: "neutral" | "confirm" }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "grid size-6 shrink-0 cursor-pointer place-items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--island-ring)] active:scale-95",
        tone === "neutral" &&
          "bg-[var(--island-button)] text-[var(--island-fg-soft)] hover:bg-[var(--island-button-hover)] hover:text-[var(--island-fg)]",
        tone === "confirm" &&
          "bg-[var(--island-fg)] text-[var(--island-on-fg)] hover:bg-[var(--island-fg-soft)]",
        className,
      )}
      {...props}
    />
  );
}

const WAVE = [0.45, 0.8, 1, 0.65, 0.9, 0.55, 0.75];

/* Upright, the bars lie across the pill and stack down it. */
function Wave({ upright = false }: { upright?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn("flex items-center gap-[3px]", upright ? "w-4 flex-col" : "h-4")}
    >
      {WAVE.map((length, i) => (
        <span
          key={i}
          className={cn(
            "rounded-full bg-[var(--island-fg)]",
            upright ? "island-wave-bar-x h-[3px]" : "island-wave-bar w-[3px]",
          )}
          style={{
            [upright ? "width" : "height"]: `${length * 16}px`,
            animationDelay: `${i * -130}ms`,
          }}
        />
      ))}
    </span>
  );
}

function Recording({ since, onStop }: { since?: number; onStop: () => void }) {
  const elapsed = () => (since ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0);
  const [seconds, setSeconds] = useState(elapsed);

  useEffect(() => {
    setSeconds(elapsed());
    const timer = setInterval(() => setSeconds(since ? elapsed() : (s) => s + 1), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [since]);

  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-[var(--island-danger)]" />
      <span className="text-[length:var(--island-text-button)] tabular-nums" aria-label={`Recording for ${seconds} seconds`}>
        {time}
      </span>
      <IslandButton tone="danger" className="ml-1 h-6 flex-none" onClick={onStop}>
        <Square className="size-3 fill-current" aria-hidden="true" />
        Stop
      </IslandButton>
    </div>
  );
}

const STEPS = [
  { label: "Transcribe what you said", status: "done" },
  { label: "Find the thread in Slack", status: "done" },
  { label: "Draft the reply", status: "current" },
  { label: "Ask before sending", status: "pending" },
] as const;

function Plan({ plan }: { plan?: { title: string; steps: readonly PlanStep[] } }) {
  const steps = plan?.steps ?? STEPS;
  const finished = steps.filter((s) => s.status === "done").length;

  return (
    <div className="flex flex-col gap-3 px-2 pb-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[length:var(--island-text-title)]">{plan?.title ?? "Replying to Maya"}</p>
        <p className="text-[length:var(--island-text-button)] text-[var(--island-fg-muted)] tabular-nums whitespace-nowrap">
          Step {Math.min(finished + 1, steps.length)} of {steps.length}
        </p>
      </div>
      <div
        role="progressbar"
        aria-label="Plan progress"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={finished}
        className="h-1 overflow-hidden rounded-full bg-[var(--island-track)]"
      >
        <motion.div
          className="h-full rounded-full bg-[var(--island-fg)]"
          initial={{ width: 0 }}
          animate={{ width: `${(Math.min(finished + 0.5, steps.length) / Math.max(steps.length, 1)) * 100}%` }}
        />
      </div>
      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li
            key={`${i}-${step.label}`}
            className={cn(
              "flex items-center gap-2 text-[length:var(--island-text-button)]",
              step.status === "pending" && "text-[var(--island-fg-muted)]",
            )}
          >
            {step.status === "done" && (
              <Check className="size-4 text-[var(--island-success)]" aria-label="Done" />
            )}
            {step.status === "current" && (
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-label="In progress"
              />
            )}
            {step.status === "pending" && (
              <Circle className="size-4 text-[var(--island-fg-muted)]" aria-label="Not started" />
            )}
            {step.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

const ANSWER_TEXT =
  "Your next free hour is Thursday from 2 to 3pm. Maya and Theo are both free then too.";

function Answer({
  kind,
  text,
  followUps,
  onFollowUp,
}: {
  kind: AnswerKind;
  text?: string;
  followUps?: string[];
  onFollowUp: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 px-2 pb-2">
      <p className="text-[length:var(--island-text-button)] text-[var(--island-fg-muted)]">Answer</p>
      {kind === "text" && (
        <div className="w-[288px]">
          {text === undefined ? (
            <StreamingText loop={false} onFollowUp={onFollowUp} />
          ) : (
            <StreamingText
              loop={false}
              content={text.split(/\s+/).filter(Boolean).map((word) => ({ text: word }))}
              sources={[]}
              followUps={followUps ?? []}
              onFollowUp={onFollowUp}
            />
          )}
        </div>
      )}
      {kind === "image" && (
        <figure className="flex flex-col gap-2">
          <img
            src={ANSWER_CHART}
            alt="Bar chart of dictated words per day this week, peaking at 4,200 on Wednesday"
            width={328}
            height={164}
            className="h-auto w-full rounded-[var(--island-radius-button)]"
          />
          <figcaption className="text-[length:var(--island-text-button)]">You dictated 14,800 words this week.</figcaption>
        </figure>
      )}
      {kind === "video" && (
        <figure className="flex flex-col gap-2">
          <video
            controls
            playsInline
            preload="metadata"
            className="aspect-video w-full rounded-[var(--island-radius-button)] bg-[var(--island-button)]"
            src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
          >
            <track kind="captions" />
          </video>
          <figcaption className="text-[length:var(--island-text-button)]">The clip you asked for, from Tuesday’s capture.</figcaption>
        </figure>
      )}
      {kind === "voice" && <VoicePlayback text={text ?? ANSWER_TEXT} />}
    </div>
  );
}

/* Reads the answer aloud with the browser's own voice. */
function VoicePlayback({ text }: { text: string }) {
  const [playing, setPlaying] = useState(false);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const toggle = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    if (playing) {
      synth.cancel();
      setPlaying(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => setPlaying(false);
    utterance.current = u;
    synth.speak(u);
    setPlaying(true);
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause the spoken answer" : "Play the answer aloud"}
        className="grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-[var(--island-radius-button)] bg-[var(--island-button)] text-[var(--island-fg)] transition-colors outline-none hover:bg-[var(--island-button-hover)] focus-visible:ring-2 focus-visible:ring-[var(--island-ring)] active:bg-[var(--island-button-active)]"
      >
        {playing ? (
          <Pause className="size-4 fill-current" aria-hidden="true" />
        ) : (
          <Play className="size-4 fill-current" aria-hidden="true" />
        )}
      </button>
      <span aria-hidden="true" className="flex h-6 flex-1 items-center gap-0.5">
        {Array.from({ length: 32 }, (_, i) => (
          <span
            key={i}
            className={cn(
              "w-1 flex-1 rounded-full bg-[var(--island-fg-muted)]",
              playing && "island-wave-bar bg-[var(--island-fg)]",
            )}
            style={{
              height: `${30 + Math.abs(Math.sin(i * 1.7)) * 70}%`,
              animationDelay: `${i * -60}ms`,
            }}
          />
        ))}
      </span>
      <span className="text-[length:var(--island-text-button)] text-[var(--island-fg-muted)] tabular-nums">0:06</span>
    </div>
  );
}

function Notice({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 px-2">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-[length:var(--island-text-title)]">{title}</p>
        </div>
        <p className="text-[length:var(--island-text-button)] text-pretty text-[var(--island-fg-muted)]">
          {body}
        </p>
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}
