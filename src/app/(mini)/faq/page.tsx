import {AdditionalFaq} from '@/components/additional-faq';
import {AuctionRule} from '@/components/auction-rule';
import {MiniPhrase} from '@/components/mini-locale';
import {faqAm} from '@/components/faq-am';
import {publicFaqContent} from '@/modules/admin/public-content';
import {legacyTermsInEtb} from '@/lib/money';
const faq = [
  ['What does “lowest unique” mean?', 'At close, we count accepted bids at every whole ETB amount. The smallest amount chosen exactly once wins. For example: ETB 1.00 twice, ETB 2.00 once, ETB 3.00 twice and ETB 4.00 once — ETB 2.00 wins. The smallest submitted bid does not automatically win.'],
  ['Can I bid now?', 'Verified, enrolled staging testers may bid on labelled DEMO auctions. Production rejects bids on DEMO items. Illustrative result examples are not settled bids or real winners.'],
  ['How many bids can I place?', 'Each auction permits at most 100 distinct whole ETB amounts per person. The allowed range and step are shown on its detail page. Repeating your own amount is rejected without another fee; another person may choose the same amount.'],
  ['What happens to ETB holds?', 'Your largest accepted bid in each auction is reserved from AVAILABLE to HELD. A higher bid increases that hold only by the difference; a lower bid adds no hold. Browsing alone moves no ETB.'],
  ['What is an entry fee?', 'Each auction shows its ETB fee per accepted bid. A configured fee is charged separately from the maximum bid hold and shown before confirmation.'],
  ['What happens when an original v1 auction ends?', 'Bidding stops at the deadline. Until settlement completes, the outcome is “Closing / result pending.” Settlement selects the lowest unique amount, charges that winning amount from the winner’s hold, and releases every unused hold. With no unique amount, there is no winner and all holds are released. Disclosed per-bid fees are retained for a valid completed auction, including a no-winner close.'],
  ['What if Lowwin cancels an original v1 auction?', 'Cancellation returns all charged entry fees and held ETB for that auction. A completed no-winner auction releases holds but retains its disclosed entry fees.'],
  ['Can I see other bids?', 'Live bid amounts, uniqueness hints and bidder identities are private. A public result may explain the final outcome after close without publishing private bidder data.'],
  ['What do the DEMO labels mean?', '“DEMO example” is an illustrative result from the catalog, not a record of real bids. “DEMO · settled test” is an actual settlement of local test bids. Neither promises a real prize. Public winner identities are anonymous; your own accepted amounts and outcomes are available privately in My Bids.'],
  ['Can I add ETB?', 'Payment funding is unavailable in this staging showcase. DEMO ETB credits are test grants with no cash value; they are not verified Telebirr, CBE or Check.et deposits. Never send money to an account shown as a DEMO preview.'],
  ['How do I receive a prize?', 'Winners submit delivery contact privately in Winning Bids. Assigned staff record packing, shipment and delivery. A winning result alone does not imply shipment. Each real auction must disclose its delivery area, eligibility and fulfillment terms. DEMO items will not be shipped. Animals have no live listing and require eligibility and welfare review.'],
  ['Where are notifications?', 'The inbox shows account and auction events recorded by Lowwin. External Telegram delivery and fulfillment updates are separate from an inbox alert.'],
  ['Why do I open Lowwin in Telegram?', 'A verified Telegram launch and your own shared contact link your private wallet and bids. Sharing contact alone never adds ETB.'],
];
export default async function FAQ() {
 const additional=await publicFaqContent();
 return <section className="page-inset">
  <h1 className="page-title"><MiniPhrase en="Simple idea." am="ቀላል ሐሳብ።"/><br/><em><MiniPhrase en="Clear rules." am="ግልጽ ደንቦች።"/></em></h1>
  <p className="page-lead"><MiniPhrase en="A little understanding before your first bid." am="ከመጀመሪያው ጨረታዎ በፊት ማወቅ ያለብዎት።"/></p>
  <section className="detail-section"><h2><MiniPhrase en="New auctions: frozen v2 rules" am="አዲስ ጨረታዎች፦ የማይለወጡ የv2 ደንቦች"/></h2><AuctionRule ruleVersion="lowest-unique-v2"/></section>
  <div className="faq-list" id="terms">{faq.map(([question,answer], i)=><details key={`${i}-${question}`} open={i===0}><summary><MiniPhrase en={question} am={faqAm[i]?.[0]??question}/></summary><p><MiniPhrase en={answer} am={faqAm[i]?.[1]??answer}/></p></details>)}<AdditionalFaq items={additional.map(item=>({...item,answer:legacyTermsInEtb(item.answer)}))}/></div>
 </section>;
}
