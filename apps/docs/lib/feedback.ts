import { z } from "zod/mini";

/** The route the feedback card posts a rating to (app/docs/api/feedback). */
export const feedbackRoute = "/docs/api/feedback";

/** The custom event a rating becomes in Vercel Web Analytics. */
export const feedbackEvent = "docs_feedback";

// Web Analytics drops a value longer than 255 characters.
export const MAX_LENGTH = 255;

export const OPINIONS = ["awful", "bad", "good", "great"] as const;

/** A rating of one docs page, as the card sends it and the event keeps it. */
export const pageFeedback = z.object({
  opinion: z.enum(OPINIONS),
  page: z.string().check(z.startsWith("/docs"), z.maxLength(MAX_LENGTH)),
  message: z.string().check(z.maxLength(MAX_LENGTH)),
});

export type PageFeedback = z.infer<typeof pageFeedback>;
