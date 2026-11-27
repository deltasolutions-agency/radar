"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type SearchOption = { value: string; label: string; hint?: string };

/**
 * Tendina con ricerca: scrivi per filtrare l'elenco e scegli con clic o Invio.
 * Sostituisce le <select> lunghe (servizi, clienti).
 *
 * Controllata (value + onChange) oppure non controllata (defaultValue + name):
 * con `name` invia il valore scelto nei form GET/POST come un campo nascosto.
 */
export function SearchSelect({
  id,
  name,
  value,
  defaultValue = "",
  onChange,
  options,
  placeholder = "Scrivi per cercare…",
  emptyLabel = "— Nessuno —",
  allowEmpty = true,
  className = "",
  ariaLabel,
  invalid = false,
}: {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  /** Voce "vuota" in cima all'elenco (es. "Tutti i clienti"). */
  emptyLabel?: string;
  allowEmpty?: boolean;
  className?: string;
  ariaLabel?: string;
  invalid?: boolean;
}) {
  const autoId = useId();
  const inputId = id ?? `ss-${autoId}`;
  const listId = `${inputId}-list`;
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  const selected = options.find((o) => o.value === current) ?? null;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = options.filter((o) => {
      const text = `${o.label} ${o.hint ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    return allowEmpty && !query ? [{ value: "", label: emptyLabel }, ...matches] : matches;
  }, [options, query, allowEmpty, emptyLabel]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(v: string) {
    if (value === undefined) setInner(v);
    onChange?.(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className={`relative ${className}`}>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        className="field pr-8"
        placeholder={selected ? selected.label : allowEmpty ? emptyLabel : placeholder}
        value={open ? query : selected?.label ?? ""}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setActive(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            if (open && items[active]) {
              e.preventDefault();
              choose(items[active].value);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery("");
          }
        }}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-white py-1 shadow-lg"
        >
          {items.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-500">Nessun risultato per &quot;{query}&quot;.</li>
          ) : (
            items.map((o, i) => (
              <li
                key={o.value || "__empty"}
                id={`${listId}-${i}`}
                data-idx={i}
                role="option"
                aria-selected={o.value === current}
                className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-canvas text-ink" : "text-slate-700"} ${
                  o.value === current ? "font-medium" : ""
                } ${o.value === "" ? "text-slate-500" : ""}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o.value);
                }}
              >
                {o.label}
                {o.hint ? <span className="ml-2 text-xs text-slate-400">{o.hint}</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
