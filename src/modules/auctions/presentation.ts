import {z} from 'zod';

const auctionPresentation = z.object({
  title: z.string(),
  titleAm: z.string().nullable().optional(),
  description: z.string(),
  descriptionAm: z.string().nullable().optional(),
  condition: z.string(),
  conditionAm: z.string().nullable().optional(),
  images: z.array(z.object({
    path: z.string(),
    alt: z.string(),
    sourceType: z.string(),
    sourceCredit: z.string().nullable().optional(),
  })),
}).strict();

export function readAuctionPresentation(value: unknown) {
  const result = auctionPresentation.safeParse(value);
  return result.success ? result.data : null;
}
