/**
 * Auto-scroll helper — moves the page to the "Review the plan" section
 * (Stage 2, id="plan-review") so the confirm-payment → payment-preview →
 * approve & settle flow is in view after a payment is confirmed.
 *
 * Uses a manual requestAnimationFrame animation instead of
 * `scrollIntoView({ behavior: "smooth" })` because Chromium drops CSS-smooth
 * programmatic scrolls when there is no user activation (e.g. async calls),
 * which made the scroll silently fail. Manual scrolling always works.
 */
export function scrollToPlanReview(): void {
  if (typeof window === "undefined") return;
  requestAnimationFrame(() => {
    const el = document.getElementById("plan-review");
    if (!el) return;
    // Match the section's scroll-mt-24 (96px) so the sticky header doesn't overlap.
    const target = el.getBoundingClientRect().top + window.scrollY - 96;
    const startY = window.scrollY;
    const delta = target - startY;
    if (Math.abs(delta) < 2) return;

    const duration = 550;
    const start = performance.now();
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      window.scrollTo(0, startY + delta * ease(t));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
