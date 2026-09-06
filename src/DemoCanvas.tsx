import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { FocusRing, KeyframeFocus, ZoomCamera } from "./ZoomCamera";

/**
 * The synthetic automation-builder mockup. Kept as a second composition so the
 * camera rig can be exercised without a screen recording on hand, which is
 * useful for tuning easing and timing in isolation.
 */

/** Focus points, in composition pixels, measured against the layout below. */
export const FOCUS = {
  wide: { x: 960, y: 540 },
  /** The "Webhook URL" parameter input in the right-hand panel. */
  webhookUrlInput: { x: 1550, y: 355 },
  /** The execution status badge in the run log. */
  statusBadge: { x: 348, y: 836 },
} as const;

/** Frames per camera move, and the pause that follows each one. */
const MOVE_DURATION = 85;
const HOLD_DURATION = 35;

const OPENING_HOLD = 45;
const ZOOM_END = OPENING_HOLD + MOVE_DURATION;
const ZOOM_HOLD_END = ZOOM_END + HOLD_DURATION;
const PAN_END = ZOOM_HOLD_END + MOVE_DURATION;
const PAN_HOLD_END = PAN_END + HOLD_DURATION;
const RESET_END = PAN_HOLD_END + MOVE_DURATION;

/** Total length of the mockup shot, consumed by <Composition> in Root.tsx. */
export const MOCKUP_DURATION = RESET_END + 50;

/**
 * Every move runs 85 frames (about 1.4s at 60fps) and each one is followed by a
 * hold, so the viewer gets a beat to read the framed element before the camera
 * starts travelling again.
 */
export const MOCKUP_KEYFRAMES: KeyframeFocus[] = [
  { frame: 0, ...FOCUS.wide, scale: 1 },
  { frame: OPENING_HOLD, ...FOCUS.wide, scale: 1 },
  { frame: ZOOM_END, ...FOCUS.webhookUrlInput, scale: 2.2, easing: "spring" },
  { frame: ZOOM_HOLD_END, ...FOCUS.webhookUrlInput, scale: 2.2 },
  { frame: PAN_END, ...FOCUS.statusBadge, scale: 2.5, easing: "ease-in-out" },
  { frame: PAN_HOLD_END, ...FOCUS.statusBadge, scale: 2.5 },
  { frame: RESET_END, ...FOCUS.wide, scale: 1, easing: "spring" },
  { frame: MOCKUP_DURATION, ...FOCUS.wide, scale: 1 },
];

/** Frames over which the webhook URL is typed into the focused field. */
const TYPING_RANGE = [50, 140] as const;
const WEBHOOK_URL = "https://hook.eu2.make.com/8f3kd91xq7";

const Header: React.FC = () => (
  <div className="absolute inset-x-0 top-0 flex h-[110px] items-center justify-between border-b border-slate-800 bg-slate-900/80 px-14">
    <div className="flex items-center gap-5">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-violet-500 text-2xl font-bold text-white">
        F
      </div>
      <div>
        <div className="text-2xl font-semibold text-white">
          Lead Intake to CRM Sync
        </div>
        <div className="text-base text-slate-400">
          Fabeo Automations / Production
        </div>
      </div>
    </div>
    <div className="flex items-center gap-4">
      <div className="rounded-lg border border-slate-700 px-6 py-3 text-lg text-slate-300">
        Save
      </div>
      <div className="rounded-lg bg-violet-500 px-6 py-3 text-lg font-medium text-white">
        Run once
      </div>
    </div>
  </div>
);

const NodeCard: React.FC<{
  x: number;
  y: number;
  title: string;
  subtitle: string;
  accent: string;
  glyph: string;
  active?: boolean;
}> = ({ x, y, title, subtitle, accent, glyph, active }) => (
  <div
    className={`absolute w-[300px] rounded-2xl border bg-slate-900 p-6 ${
      active ? "border-violet-400" : "border-slate-700"
    }`}
    style={{ left: x, top: y }}
  >
    <div className="flex items-center gap-4">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-lg text-xl text-white"
        style={{ backgroundColor: accent }}
      >
        {glyph}
      </div>
      <div className="text-xl font-semibold text-white">{title}</div>
    </div>
    <div className="mt-4 text-base text-slate-400">{subtitle}</div>
  </div>
);

const StatCard: React.FC<{
  x: number;
  y: number;
  label: string;
  value: string;
  delta: string;
}> = ({ x, y, label, value, delta }) => (
  <div
    className="absolute w-[300px] rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
    style={{ left: x, top: y }}
  >
    <div className="text-base text-slate-400">{label}</div>
    <div className="mt-2 text-4xl font-semibold text-white">{value}</div>
    <div className="mt-2 text-base text-emerald-400">{delta}</div>
  </div>
);

const NodeCanvas: React.FC = () => (
  <div
    className="absolute"
    style={{ left: 60, top: 150, width: 1140, height: 590 }}
  >
    {/* Connectors between the three workflow nodes */}
    <svg width={1140} height={590} className="absolute inset-0">
      <path d="M 340 145 H 420" stroke="#475569" strokeWidth={3} fill="none" />
      <path d="M 720 145 H 800" stroke="#475569" strokeWidth={3} fill="none" />
    </svg>
    <NodeCard
      x={40}
      y={70}
      title="Webhook"
      subtitle="Trigger / POST /lead-intake"
      accent="#7c3aed"
      glyph="W"
      active
    />
    <NodeCard
      x={420}
      y={70}
      title="Set Fields"
      subtitle="Map 6 properties"
      accent="#0ea5e9"
      glyph="S"
    />
    <NodeCard
      x={800}
      y={70}
      title="HTTP Request"
      subtitle="POST to CRM /contacts"
      accent="#10b981"
      glyph="H"
    />
    <StatCard x={40} y={330} label="Runs today" value="1,284" delta="+12.4%" />
    <StatCard x={420} y={330} label="Avg duration" value="820ms" delta="-40ms" />
    <StatCard x={800} y={330} label="Success rate" value="99.2%" delta="+0.3%" />
  </div>
);

const ParametersPanel: React.FC = () => {
  const frame = useCurrentFrame();

  // Reveal the URL character by character while the camera flies in.
  const typed = Math.round(
    interpolate(
      frame,
      [TYPING_RANGE[0], TYPING_RANGE[1]],
      [0, WEBHOOK_URL.length],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    ),
  );
  const isTyping = frame >= TYPING_RANGE[0] && frame <= TYPING_RANGE[1] + 40;
  const caretVisible = Math.floor(frame / 15) % 2 === 0;

  return (
    <div
      className="absolute rounded-2xl border border-slate-800 bg-slate-900/60 p-8"
      style={{ left: 1240, top: 150, width: 620, height: 590 }}
    >
      <div className="text-xl font-semibold text-white">Webhook parameters</div>
      <div className="mt-2 text-base text-slate-400">Trigger configuration</div>

      {/* Focus target: FOCUS.webhookUrlInput sits at the centre of this field. */}
      <div className="mt-10">
        <div className="text-base text-slate-400">Webhook URL</div>
        <div
          className={`mt-3 flex h-[72px] items-center rounded-xl border-2 bg-slate-950 px-5 text-xl ${
            isTyping ? "border-violet-400" : "border-slate-700"
          }`}
        >
          <span className="text-slate-100">{WEBHOOK_URL.slice(0, typed)}</span>
          {isTyping && caretVisible ? (
            <span className="ml-1 inline-block h-8 w-[3px] bg-violet-300" />
          ) : null}
        </div>
      </div>

      <div className="mt-8">
        <div className="text-base text-slate-400">Method</div>
        <div className="mt-3 flex h-[72px] items-center rounded-xl border border-slate-700 bg-slate-950 px-5 text-xl text-slate-100">
          POST
        </div>
      </div>

      <div className="mt-8">
        <div className="text-base text-slate-400">Response mode</div>
        <div className="mt-3 flex h-[72px] items-center rounded-xl border border-slate-700 bg-slate-950 px-5 text-xl text-slate-100">
          When last node finishes
        </div>
      </div>
    </div>
  );
};

const ExecutionLog: React.FC = () => (
  <div
    className="absolute rounded-2xl border border-slate-800 bg-slate-900/60 p-8"
    style={{ left: 60, top: 780, width: 1800, height: 240 }}
  >
    <div className="flex items-center gap-6">
      <div className="text-xl font-semibold text-white">Execution log</div>
      {/* Focus target: FOCUS.statusBadge sits at the centre of this badge. */}
      <div className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-5 py-2 text-lg font-medium text-emerald-300">
        Success 200 in 812ms
      </div>
      <div className="text-lg text-slate-500">Run #4,201 at 12:04:33 PHT</div>
    </div>
    <pre className="mt-5 text-lg leading-8 text-slate-400">
      {`{ "lead_id": "ld_8f31", "email": "ana@studio.ph", "source": "webhook", "synced": true }`}
    </pre>
  </div>
);

/** The synthetic screen the camera flies over. */
export const DemoCanvas: React.FC = () => (
  <AbsoluteFill className="bg-slate-950 font-sans">
    <Header />
    <NodeCanvas />
    <ParametersPanel />
    <ExecutionLog />
  </AbsoluteFill>
);

/** Mockup canvas plus the camera rig and focus overlay. */
export const MockupDemo: React.FC = () => (
  <ZoomCamera keyframes={MOCKUP_KEYFRAMES}>
    <DemoCanvas />
    <FocusRing />
  </ZoomCamera>
);
