import type {CatalogAuction} from '@/modules/auctions/catalog';

/** Product browsing never serializes the independently protected result record. */
export function catalogProductPreview(auction:CatalogAuction):CatalogAuction{
 return {slug:auction.slug,code:auction.code,status:auction.status,publishedAt:auction.publishedAt,featured:auction.featured,isDemo:auction.isDemo,bidCount:auction.bidCount,viewCount:auction.viewCount,presentationVersion:auction.presentationVersion,startsAt:auction.startsAt,endsAt:auction.endsAt,product:auction.product,category:auction.category,fulfillment:auction.fulfillment,terms:auction.terms,result:null};
}

export function publishedWinnerBannerPath({status,isDemo,result}:Pick<CatalogAuction,'status'|'isDemo'|'result'>){
 const path=result?.winnerBannerPath;
 return status==='closed'&&!isDemo&&result?.source==='SETTLED'&&result.outcome==='WINNER'&&typeof path==='string'&&/^\/api\/media\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(path)?path:null;
}

/** Home may show consented published artwork without exposing private result fields. */
export function recentWinnerPreview(auction:CatalogAuction):CatalogAuction{
 const preview=catalogProductPreview(auction),result=auction.result;
 if(!result)return preview;
 const summary={outcome:result.outcome,closedAt:result.closedAt,publishedAt:result.publishedAt,isDemo:result.isDemo,winningPoints:null,explanation:'',winnerDisplay:null,winnerUsername:null,winnerPhoneMasked:null,winnerPhotoPath:null,winnerBannerPath:null,winnerBannerVersion:0};
 if(result.source==='SETTLED')return {...preview,result:{...summary,source:'SETTLED',demoLabel:result.demoLabel,decision:result.decision,acceptedBidCount:result.acceptedBidCount,
  winnerBannerPath:publishedWinnerBannerPath(auction),winnerBannerVersion:!auction.isDemo&&result.outcome==='WINNER'?result.winnerBannerVersion:0}};
 return {...preview,result:{...summary,source:'ILLUSTRATIVE',demoLabel:result.demoLabel,decision:null,acceptedBidCount:null}};
}
