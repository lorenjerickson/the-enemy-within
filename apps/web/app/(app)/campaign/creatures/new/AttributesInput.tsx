"use client";

import { useState } from "react";
import {
  ATTRIBUTES, MAX_SCORE, MIN_SCORE, POINT_BUY_BUDGET,
  defaultAttributes, formatModifier, modifier, pointBuySpent, rollScore, skillModifiers, type Attribute, type Attributes,
} from "@/lib/attributes";

type Method = "roll" | "pointbuy";

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Attribute score inputs (form fields named after each attribute, plus "method"). */
export default function AttributesInput({ initial }: { initial?: Attributes }) {
  const [method, setMethod] = useState<Method>("roll");
  const [scores, setScores] = useState<Attributes>({ ...defaultAttributes(), ...initial });
  const pointBuy = method === "pointbuy";
  const remaining = POINT_BUY_BUDGET - pointBuySpent(scores);

  function switchMethod(m: Method) {
    setMethod(m);
    setScores(defaultAttributes(m === "pointbuy" ? 8 : 10));
  }

  const set = (k: Attribute, v: number) => setScores({ ...scores, [k]: v });
  const rollAll = () => setScores(Object.fromEntries(ATTRIBUTES.map((k) => [k, rollScore()])) as Attributes);

  return (
    <fieldset className="fieldset">
      <legend className="fieldset-legend">Attributes</legend>
      <input type="hidden" name="method" value={method} />
      <div className="flex items-center gap-3 mb-2">
        <div className="join">
          <button type="button" className={`btn btn-sm join-item ${!pointBuy ? "btn-primary" : ""}`} onClick={() => switchMethod("roll")}>Roll</button>
          <button type="button" className={`btn btn-sm join-item ${pointBuy ? "btn-primary" : ""}`} onClick={() => switchMethod("pointbuy")}>Point buy</button>
        </div>
        {pointBuy ? (
          <span className={`text-sm ${remaining < 0 ? "text-error" : "opacity-70"}`}>{remaining} of {POINT_BUY_BUDGET} points left</span>
        ) : (
          <button type="button" className="btn btn-sm" onClick={rollAll}>Roll all (4d6 drop lowest)</button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {ATTRIBUTES.map((k) => {
          const m = modifier(scores[k]);
          return (
            <div key={k} className="flex items-center gap-2">
              <label className="floating-label flex-1">
                <span>{capitalize(k)}</span>
                <input
                  name={k}
                  type="number"
                  required
                  min={pointBuy ? 8 : MIN_SCORE}
                  max={pointBuy ? 15 : MAX_SCORE}
                  value={scores[k]}
                  onChange={(e) => set(k, Number(e.target.value))}
                  className="input w-full"
                />
              </label>
              <span className={`badge w-10 ${m > 0 ? "badge-success" : m < 0 ? "badge-error" : "badge-ghost"}`}>
                {formatModifier(m)}
              </span>
            </div>
          );
        })}
      </div>
      {pointBuy && remaining < 0 && <p className="text-error text-sm">Over budget by {-remaining} points.</p>}
      <div className="mt-3">
        <div className="text-sm font-semibold mb-1">Skills <span className="font-normal opacity-60">(from attributes)</span></div>
        <div className="grid grid-cols-3 gap-x-6 gap-y-1">
          {skillModifiers(scores).map(({ skill, attributes, modifier: m }) => (
            <div key={skill} className="flex items-center justify-between text-sm">
              <span>
                {capitalize(skill)} <span className="opacity-50 text-xs">{attributes.map((a) => a.slice(0, 3).toUpperCase()).join("/")}</span>
              </span>
              <span className={m > 0 ? "text-success" : m < 0 ? "text-error" : "opacity-60"}>{formatModifier(m)}</span>
            </div>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
