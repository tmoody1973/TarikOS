"use client";

import { useEffect, useState } from "react";

/* Words arrive one at a time, the way she says them. Shared by the GPT-Live
 * dock; VoiceDock keeps its private copy until phase 4 retires it.
 * Mount with key={text}: a new sentence is a new component, so the count
 * starts at zero without setting state inside an effect. */
export function RevealText({ text }: { text: string }) {
  const words = text.split(" ");
  const [count, setCount] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setCount((c) => Math.min(c + 1, words.length)),
      40,
    );
    return () => clearInterval(timer);
  }, [text, words.length]);
  return (
    <span className="text-foreground/85">
      {words.slice(0, count).join(" ")}
      <span aria-hidden className="opacity-0">
        {" " + words.slice(count).join(" ")}
      </span>
    </span>
  );
}
