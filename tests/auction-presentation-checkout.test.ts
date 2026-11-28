import {Prisma, type ChapaCheckout, type PrismaClient} from '@prisma/client';
import {afterEach, expect, it, vi} from 'vitest';
import {auctionDetailUrl, seedAuctionQuery} from '../src/components/auction-query';
import {readPrivateQuery, setPrivateQueryIdentity} from '../src/components/private-query-cache';
import {toPublicAuction} from '../src/modules/auctions/catalog';
import {RULE_V5} from '../src/modules/auctions/rules';
import {getChapaCheckout} from '../src/modules/payments/chapa';

const now = new Date('2026-11-28T10:00:00Z');
const slug = 'tecno-buds-3';
const owner = 'player:test-session';
const frozenProduct = {
 title: 'TECNO Buds 3', titleAm: 'ቴክኖ ባድስ 3',
 description: 'Original description', descriptionAm: 'የመጀመሪያው መግለጫ',
 condition: 'New', conditionAm: 'አዲስ',
 images: [{path: '/original.webp', alt: 'TECNO Buds 3', sourceType: 'OWNED'}],
};
const revisedProduct = {
 title: 'Soundcore R50i NC', titleAm: null,
 description: 'Revised description', descriptionAm: null,
 condition: 'New', conditionAm: null,
 images: [{path: '/revised.webp', alt: 'Soundcore R50i NC', sourceType: 'OWNED'}],
};
const auction = {
 slug, publicCode: 8, status: 'LIVE', publishedAt: now, startsAt: now,
 endsAt: new Date('2026-12-05T19:00:00Z'), controlVersion: 4,
 featured: false, isDemo: false, acceptedBidCount: 7, publicViewCount: 100n,
 product: frozenProduct, presentation: revisedProduct,
 category: {slug: 'accessories', name: 'Accessories', nameAm: null},
 fulfillmentSummary: 'Delivery', fulfillmentSummaryAm: null,
 fulfillmentRegion: 'Addis Ababa', fulfillmentRegionAm: null,
 terms: {
  version: 1, ruleVersion: RULE_V5, minParticipants: 2,
  minPoints: 1, maxPoints: null, stepPoints: 0.01, entryFeePoints: 50,
  maxDistinctBids: 100, noWinnerTerms: 'Refund', cancellationTerms: 'Refund', fulfillmentSnapshot: {},
 },
 feeRevisions: [], result: null, settlement: null, winnerPresentation: null,
} as unknown as Parameters<typeof toPublicAuction>[0];

afterEach(() => setPrivateQueryIdentity(null));

it('uses the revised photo and has no inherited translation from a different product', () => {
 const view = toPublicAuction(auction, now);
 expect(view.product).toMatchObject(revisedProduct);
 expect(view).toMatchObject({slug, code: '8', presentationVersion: 4, terms: {version: 1, entryFeePoints: '50'}});
});

it('refreshes a cached presentation without replacing a newer fee or presentation version', () => {
 setPrivateQueryIdentity(owner);
 const previous = toPublicAuction({...auction, controlVersion: 3, presentation: null}, now);
 const revised = toPublicAuction(auction, now);
 seedAuctionQuery(owner, previous);
 seedAuctionQuery(owner, revised);
 seedAuctionQuery(owner, previous);
 expect(readPrivateQuery(owner, auctionDetailUrl(slug))?.value).toEqual(revised);

 const newFee = {...revised, terms: {...revised.terms, version: 2, entryFeePoints: '55'}};
 seedAuctionQuery(owner, newFee);
 seedAuctionQuery(owner, {...revised, presentationVersion: 5});
 expect(readPrivateQuery(owner, auctionDetailUrl(slug))?.value).toEqual(newFee);
});

it('keeps the revised auction title in owned checkout status before and after a payment failure', async () => {
 const order = {
  id: 'db92bf26-a98d-4f01-92f4-964a190c5695', userId: 'player',
  purpose: 'BID', flowVersion: 5, initialization: {apiVersion: 'v2'},
  chargeType: 'DIRECT', mode: 'live', amountCents: 5000n, currency: 'ETB',
  status: 'PENDING', verificationState: 'UNVERIFIED',
  merchantReference: 'LW-payment-fixture', discountPoints: new Prisma.Decimal(0),
  auctionSlug: slug, createdAt: now, updatedAt: now, expiresAt: auction.endsAt,
 } as unknown as ChapaCheckout;
 const attachedAuction = {
  publicCode: 8, status: 'LIVE', endsAt: auction.endsAt,
  presentation: revisedProduct, product: frozenProduct,
 };
 const findFirst = vi.fn()
  .mockResolvedValueOnce({...order, auction: attachedAuction})
  .mockResolvedValueOnce({...order, status: 'FAILED', auction: attachedAuction})
  .mockResolvedValueOnce({...order, auction: {...attachedAuction, presentation: null}});
 const db = {chapaCheckout: {findFirst}} as unknown as PrismaClient;
 for (const status of ['PENDING','FAILED']) {
  const view = await getChapaCheckout(db, order.userId, order.id);
  expect(view).toMatchObject({
   status, auctionSlug: slug, auctionCode: '8', auctionTitle: revisedProduct.title,
   auctionTitleAm: null, amount: '50.00',
  });
 }
 expect(await getChapaCheckout(db, order.userId, order.id)).toMatchObject({
  auctionTitle: frozenProduct.title, auctionTitleAm: frozenProduct.titleAm,
 });
 expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
  where: {id: order.id, userId: order.userId},
  include: {auction: {select: expect.objectContaining({presentation: true})}},
 }));
});
