"use client";
import { useEffect, useState } from "react";

/**
 * Dark / light theme toggle, mirroring the prototype's sun-moon button.
 * Flips `data-theme` on <html> and persists the choice so the layout's
 * pre-hydration script can restore it before first paint.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") !== "light");
  }, []);

  const toggle = () => {
    const next = dark ? "light" : "dark";
    setDark(!dark);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("mova-theme", next);
    } catch {
      /* private mode — theme still applies for this session */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-hairline bg-surface text-muted transition hover:text-ink"
    >
      {/* Sun */}
      <svg
        className="absolute h-[18px] w-[18px] transition-transform duration-300"
        style={{
          opacity: dark ? 1 : 0,
          transform: dark ? "rotate(0) scale(1)" : "rotate(-70deg) scale(0.5)",
        }}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
      </svg>
      {/* Moon */}
      <svg
        className="absolute h-[18px] w-[18px] transition-transform duration-300"
        style={{
          opacity: dark ? 0 : 1,
          transform: dark ? "rotate(70deg) scale(0.5)" : "rotate(0) scale(1)",
        }}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z" />
      </svg>
    </button>
  );
}
