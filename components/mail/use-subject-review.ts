"use client";

import { useState } from "react";

/**
 * « Objet à revoir » : vrai dès que le corps s'écarte de celui qui a été relu
 * avec l'objet, jusqu'à ce qu'on touche ou confirme l'objet. Le premier corps
 * reçu (généré avec son objet) compte comme relu.
 */
export function useSubjectReview(body: string) {
  const [reviewedBody, setReviewedBody] = useState(body);
  return {
    needsReview: body.trim() !== reviewedBody.trim(),
    markReviewed: () => setReviewedBody(body),
  };
}
