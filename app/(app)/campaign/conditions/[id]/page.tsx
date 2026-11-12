import { redirect } from "next/navigation";

/** Conditions are effects now (2026-11-13): their ids changed, so an old link goes to the list. */
export default function Condition() {
  redirect("/campaign/effects");
}
