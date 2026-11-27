import type { Effect } from "@/lib/conditions";
import { effectSentences, sentencesOf } from "@/lib/effectGrammar";
import EffectInterview from "./EffectInterview";
import { submitEffect } from "./actions";

/**
 * A catalog effect: a name, a description, its rules as handbook sentences (what changes while it's on, or what
 * happens when), and how long it lasts: so many rounds (with its saves and what ends it), while equipped (for what an
 * item gives), or always (a creature's own). Edited as an interview (EffectInterview). Actions, the GM, items,
 * creatures and professions grant effects.
 */
export default function EffectForm({ initial, effects = [] }: { initial?: Effect; effects?: { id: number; name: string }[] }) {
  const named = effects.filter((e) => e.id !== initial?.id);
  const nameOf = (id: number) => effects.find((e) => e.id === id)?.name ?? `#${id}`;
  return (
    <EffectInterview
      action={submitEffect.bind(null, initial?.id ?? null)}
      initial={initial as never}
      initialRules={initial && !initial.builtin ? sentencesOf(initial.modifiers, nameOf) : []}
      builtinRules={initial?.builtin ? { sentences: effectSentences(initial.modifiers, nameOf), modifiers: initial.modifiers } : undefined}
      conditions={named}
    />
  );
}
