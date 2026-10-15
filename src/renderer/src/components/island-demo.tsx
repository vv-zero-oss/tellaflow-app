import { useState } from "react";

import {
  VoiceIsland,
  type AnswerKind,
  type IslandMaterial,
  type IslandPlacement,
  type IslandState,
} from "@/components/voice-island";
import { cn } from "@/lib/utils";

const STATES: { value: IslandState; label: string }[] = [
  { value: "none", label: "None" },
  { value: "idle", label: "Idle" },
  { value: "listening", label: "Listening" },
  { value: "dictating", label: "Dictating" },
  { value: "thinking", label: "Thinking" },
  { value: "transcribing", label: "Transcribing" },
  { value: "plan", label: "Plan" },
  { value: "approval", label: "Approval" },
  { value: "questions", label: "Questions" },
  { value: "answer", label: "Answer" },
  { value: "done", label: "Done" },
  { value: "dictionary", label: "Dictionary" },
  { value: "error", label: "Error" },
  { value: "setup", label: "Setup needed" },
  { value: "meeting", label: "Meeting" },
  { value: "recording", label: "Recording" },
];

const MATERIALS: { value: IslandMaterial; label: string }[] = [
  { value: "translucent", label: "Translucent" },
  { value: "opaque", label: "Opaque" },
];

const PLACEMENTS: { value: IslandPlacement; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "bottom", label: "Bottom" },
  { value: "right", label: "Right" },
];

/* Where the island hangs on the screen for each edge. */
const ANCHOR: Record<IslandPlacement, string> = {
  left: "inset-y-0 left-4 items-center",
  bottom: "inset-x-0 bottom-4 justify-center",
  right: "inset-y-0 right-4 items-center",
};

const ANSWER_KINDS: { value: AnswerKind; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "voice", label: "Voice" },
];

/* Where each island button leads, so the demo can be walked through. */
const NEXT: Partial<Record<string, IslandState>> = {
  "stop-recording": "transcribing",
  "start-listening": "listening",
  "expand-listening": "dictating",
  "cancel-dictation": "idle",
  "finish-dictation": "transcribing",
  undo: "idle",
  "dictionary-yes": "idle",
  "dictionary-no": "idle",
  retry: "listening",
  dismiss: "idle",
  "open-settings": "idle",
  later: "idle",
  approve: "done",
  edit: "listening",
  cancel: "idle",
  transcribe: "recording",
  "not-now": "idle",
  "follow-up": "thinking",
};

export function IslandDemo({
  initialState = "idle",
  initialAnswerKind = "text",
  initialMaterial = "translucent",
  initialPlacement = "bottom",
}: {
  initialState?: IslandState;
  initialAnswerKind?: AnswerKind;
  initialMaterial?: IslandMaterial;
  initialPlacement?: IslandPlacement;
} = {}) {
  const [state, setState] = useState<IslandState>(initialState);
  const [answerKind, setAnswerKind] = useState<AnswerKind>(initialAnswerKind);
  const [material, setMaterial] = useState<IslandMaterial>(initialMaterial);
  const [placement, setPlacement] = useState<IslandPlacement>(initialPlacement);

  return (
    <section
      id="island"
      aria-labelledby="island-title"
      className="mx-auto flex w-full max-w-3xl flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <h1 id="island-title" className="text-2xl font-semibold tracking-tight">
          Voice island
        </h1>
        <p className="text-sm text-muted-foreground">
          One island for every moment of voice typing. Pick a state, or use the
          buttons inside the island to move through a flow.
        </p>
      </div>

      {/* A screen, with the island floating at its top edge. */}
      <div className="relative min-h-[440px] overflow-hidden rounded-xl border bg-muted">
        {/* The document being dictated into, so the glass has something to blur. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-10 top-8 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground select-none"
        >
          <p className="text-base font-semibold text-foreground">Island v3 — review notes</p>
          <p>
            The compact states read well at a glance. Listening needs to feel
            alive without pulling the eye, and thinking should never look like
            an error.
          </p>
          <p>
            Cards open only when there is something to decide: an approval, an
            answer, a meeting. Everything else stays a pill and gets out of the
            way within two seconds.
          </p>
          <p>
            Next: test the recording timer against long meetings, and check the
            glass over photos and dark wallpapers.
          </p>
        </div>
        <div className={cn("absolute flex", ANCHOR[placement])}>
          <VoiceIsland
            state={state}
            answerKind={answerKind}
            material={material}
            placement={placement}
            onAction={(action) => {
              const next = NEXT[action];
              if (next) setState(next);
            }}
          />
        </div>
      </div>

      <ChipGroup
        legend="Position"
        name="island-placement"
        options={PLACEMENTS}
        value={placement}
        onChange={setPlacement}
      />
      <ChipGroup
        legend="Material"
        name="island-material"
        options={MATERIALS}
        value={material}
        onChange={setMaterial}
      />
      <ChipGroup
        legend="State"
        name="island-state"
        options={STATES}
        value={state}
        onChange={setState}
      />
      {state === "answer" && (
        <ChipGroup
          legend="Answer as"
          name="answer-kind"
          options={ANSWER_KINDS}
          value={answerKind}
          onChange={setAnswerKind}
        />
      )}
    </section>
  );
}

function ChipGroup<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "inline-flex h-8 cursor-pointer items-center rounded-full border bg-background px-3 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
              "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
              "has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
