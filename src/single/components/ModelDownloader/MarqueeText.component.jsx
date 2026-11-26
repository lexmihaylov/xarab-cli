import React, { useEffect, useState } from "react";

export function MarqueeText({ text, width, active, fg, bold }) {
  const [offset, setOffset] = useState(0);
  const value = String(text ?? "");
  const available = Math.max(1, width);
  const isLong = value.length > available;

  useEffect(() => {
    setOffset(0);
    if (!isLong || !active) return undefined;
    const timer = setInterval(() => {
      setOffset((current) => (current + 1) % (value.length + 4));
    }, 180);
    return () => clearInterval(timer);
  }, [active, isLong, value, available]);

  let display = value;
  if (isLong) {
    const padded = `${value}    `;
    const start = offset % padded.length;
    const window = padded.slice(start) + padded.slice(0, start);
    display = window.slice(0, available);
  }

  return (
    <text fg={fg} bold={bold} width="100%" truncate>
      {display}
    </text>
  );
}

