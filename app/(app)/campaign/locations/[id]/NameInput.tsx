"use client";

/** A name edited in place (lights, effects, doors: the names scripts use). Saved when it loses focus or on Enter. */
export default function NameInput({ value, onRename, label }: { value: string; onRename: (name: string) => void; label: string }) {
  const save = (el: HTMLInputElement) => {
    const name = el.value.trim();
    if (!name) el.value = value;
    else if (name !== value) onRename(name);
  };
  return (
    <input
      aria-label={label}
      defaultValue={value}
      onBlur={(e) => save(e.currentTarget)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className="input input-xs w-36 font-medium"
    />
  );
}
