/**
 * Auto-scroll helper — moves the page to the "Review the plan" section
 * (Stage 2, id="plan-review") so the confirm-payment → payment-preview →
 * approve & settle flow is in view after a payment is sent/confirmed.
 */
export function scrollToPlanReview(): void {
  if (typeof window === "undefined") return;
  requestAnimationFrame(() => {
    document
      .getElementById("plan-review")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
