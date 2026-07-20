"use client";

import { useEffect, useState, type ReactNode } from "react";

type Screen = "landing" | "problem" | "approach" | "solution";

type OnboardingProps = {
  onComplete: () => void;
};

const STAGGER_MS = 450; // 150ms × 3 (+200%)
const FADE_MS = 1500; // 500ms × 3 (+200%)
const HINT_FADE_MS = 250;

const BG_POSITION: Record<Screen, string> = {
  landing: "calc(50% - 1.5cm) 0%",
  problem: "calc(50% - 1.5cm) 20%",
  approach: "calc(50% - 1.5cm) 40%",
  solution: "calc(50% - 1.5cm) 60%",
};

function FadeIn({
  delayMs = 0,
  durationMs = FADE_MS,
  skip = false,
  className = "",
  children,
}: {
  delayMs?: number;
  durationMs?: number;
  skip?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(skip);

  useEffect(() => {
    if (skip) {
      setVisible(true);
      return;
    }

    setVisible(false);
    const id = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(id);
  }, [delayMs, skip]);

  return (
    <div
      className={`transition-all ease-out ${className}`}
      style={{
        transitionDuration: skip ? "0ms" : `${durationMs}ms`,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(0.75rem)",
      }}
    >
      {children}
    </div>
  );
}

function FullScreen({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="absolute inset-0 z-10 flex cursor-pointer flex-col items-center justify-center px-6 text-center text-white"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex w-full max-w-3xl flex-col items-center">{children}</div>
    </div>
  );
}

/** Hint appears as the last text line finishes fading in. */
function hintDelayAfterLastLine(lastLineIndex: number) {
  return lastLineIndex * STAGGER_MS + FADE_MS;
}

function ClickHint({
  delayMs,
  skip,
  label,
}: {
  delayMs: number;
  skip: boolean;
  label: string;
}) {
  return (
    <FadeIn
      delayMs={delayMs}
      durationMs={HINT_FADE_MS}
      skip={skip}
      className="mt-12"
    >
      <p className="text-sm tracking-wide text-white/50">{label}</p>
    </FadeIn>
  );
}

function screenHintDelay(screen: Screen): number {
  if (screen === "landing") return 0;
  if (screen === "problem") return hintDelayAfterLastLine(1);
  if (screen === "approach") return hintDelayAfterLastLine(2);
  return hintDelayAfterLastLine(1); // solution
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [screen, setScreen] = useState<Screen>("landing");
  const [skip, setSkip] = useState(false);
  const [ready, setReady] = useState(true);

  useEffect(() => {
    if (screen === "landing" || skip) {
      setReady(true);
      return;
    }

    setReady(false);
    const id = window.setTimeout(
      () => setReady(true),
      screenHintDelay(screen),
    );
    return () => window.clearTimeout(id);
  }, [screen, skip]);

  function goTo(next: Screen) {
    setSkip(false);
    setScreen(next);
  }

  function handleScreenClick(advance: () => void) {
    if (!ready) {
      setSkip(true);
      return;
    }
    advance();
  }

  let content: ReactNode;

  if (screen === "landing") {
    content = (
      <FullScreen onClick={() => goTo("problem")}>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Trial-Scout
        </h1>
        <p className="mt-3 max-w-md text-base italic text-white/80 sm:text-lg">
          Find patients for your clinical trial - in minutes, not months
        </p>
        <p className="mt-10 text-sm tracking-wide text-white/50">
          Click to begin
        </p>
      </FullScreen>
    );
  } else if (screen === "problem") {
    const lines = [
      <>
        <span className="text-delfa-yellow">80-85%</span> of trials miss their
        enrollment timeline.
      </>,
      <>
        Recruitment alone eats{" "}
        <span className="text-delfa-yellow">20-30%</span> of total trial budget.
      </>,
    ];
    const hintDelay = hintDelayAfterLastLine(lines.length - 1);

    content = (
      <FullScreen
        key="problem"
        onClick={() => handleScreenClick(() => goTo("approach"))}
      >
        <div className="flex flex-col gap-6">
          {lines.map((line, i) => (
            <FadeIn key={i} delayMs={i * STAGGER_MS} skip={skip}>
              <p className="text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
                {line}
              </p>
            </FadeIn>
          ))}
        </div>
        <ClickHint delayMs={hintDelay} skip={skip} label="Click to continue" />
      </FullScreen>
    );
  } else if (screen === "approach") {
    const lines = [
      "Keyword search fails here: patients don't use clinical terms, and physicians describe fit through case patterns, not single keywords.",
      "The signal lives in conversational text and scattered publications, rather than structured medical pages.",
      "Neural search reads for meaning, so it finds both.",
    ];
    const hintDelay = hintDelayAfterLastLine(lines.length - 1);

    content = (
      <FullScreen
        key="approach"
        onClick={() => handleScreenClick(() => goTo("solution"))}
      >
        <div className="flex flex-col gap-6">
          {lines.map((line, i) => (
            <FadeIn key={line} delayMs={i * STAGGER_MS} skip={skip}>
              <p className="text-2xl font-medium leading-snug text-balance sm:text-3xl">
                {line}
              </p>
            </FadeIn>
          ))}
        </div>
        <ClickHint delayMs={hintDelay} skip={skip} label="Click to continue" />
      </FullScreen>
    );
  } else {
    content = (
      <FullScreen
        key="solution"
        onClick={() => handleScreenClick(onComplete)}
      >
        <FadeIn skip={skip}>
          <p className="text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
            <span className="text-delfa-yellow">Trial-Scout</span> surfaces
            patient channels and physicians, not individual patients.
          </p>
        </FadeIn>
        <FadeIn delayMs={STAGGER_MS} skip={skip} className="mt-8">
          <p className="max-w-2xl text-lg leading-relaxed text-white/75 text-balance sm:text-xl">
            Patient data is private and often regulated (HIPAA/GDPR). Channels
            (communities, forums, advocacy groups) are public, aggregate, and
            consent-safe to target.
          </p>
        </FadeIn>
        <ClickHint
          delayMs={hintDelayAfterLastLine(1)}
          skip={skip}
          label="Click to enter"
        />
      </FullScreen>
    );
  }

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-delfa-cream"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-no-repeat"
        style={{
          backgroundImage: "url(/onboarding-bg.jpg)",
          backgroundSize: "120%",
          backgroundPosition: BG_POSITION[screen],
          transition: "background-position 800ms ease-out",
          filter: "grayscale(40%) sepia(35%) saturate(140%) hue-rotate(5deg)",
          opacity: 0.55,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-[#FFCA51]/25"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-black/50"
      />
      {content}
    </div>
  );
}
