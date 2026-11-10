'use client';
import {useState} from 'react';
import {AdminLink} from './admin-query';
import {ErrorNotice,Pagination,eat,useAdminRead} from './admin-ui';
import {useAdminAccess} from './admin-shell';
import AdminWinnerPhoto from './admin-winner-photo';

type Review={auctionId:string;settlementId:string;publicCode:number;proofHash:string;frequencies:{amount:string;count:number}[];frequencyTotal:number;frequenciesTruncated:boolean;winningFrequency:number|null;outcome:string;decision:string|null;winningPoints:string|null;winningBidId:string|null;winnerName:string|null;completedAt:string;publishedAt:string|null;isDemo:boolean;winnerPresentationMode?:string;winnerBannerId?:string|null;winnerBannerPath?:string|null;winnerBannerVersion?:number;winnerPhotoId:string|null;winnerPhotoPath:string|null;winnerPhotoVersion:number;bids:{items:{id:string;amount:string;acceptedAt:string;acceptanceOrder:string|null;user:{id:string;name:string}}[];page:number;total:number;totalPages:number}};
export function AdminResultPublication({auctionId}:{auctionId:string}){
 const [page,setPage]=useState(1),[frequencyPage,setFrequencyPage]=useState(1);
 const r=useAdminRead<Review>(`results/${auctionId}?page=${page}`),access=useAdminAccess(),d=r.data;
 return <section className="admin-panel"><h2>Result &amp; Winners banner</h2><p>Settlement and publication run automatically. You can update the Winners banner; calculated results and financial records are read-only.</p><ErrorNotice error={r.error} retry={r.reload}/>{d&&<>
  <dl className="admin-facts"><div><dt>Calculated outcome</dt><dd>{d.outcome}</dd></div><div><dt>Calculated winner</dt><dd>{d.winnerName??'No winner'}</dd></div><div><dt>Winning number</dt><dd>{d.winningPoints??'—'}</dd></div><div><dt>Times submitted</dt><dd>{d.winningFrequency??'—'}</dd></div><div><dt>Decision</dt><dd>{d.decision??'Original lowest unique rule'}</dd></div><div><dt>Publication</dt><dd>{d.publishedAt?`Published ${eat(d.publishedAt)}`:'Awaiting automatic publication'}</dd></div></dl>
  <details open={!d.publishedAt}><summary>Bid uniqueness — {d.frequencyTotal} distinct numbers</summary>{d.frequenciesTruncated&&<p>Showing the first 100 numbers. Inspect all accepted bids below; the complete immutable proof remains in Audit records.</p>}<div className="admin-table-wrap"><table><thead><tr><th>Number</th><th>Accepted bids</th><th>Unique</th></tr></thead><tbody>{d.frequencies.slice((frequencyPage-1)*50,frequencyPage*50).map(row=><tr key={row.amount}><td>{row.amount}{row.amount===d.winningPoints?' · Calculated winner':''}</td><td>{row.count}</td><td>{row.count===1?'Yes':'No'}</td></tr>)}</tbody></table></div><Pagination page={frequencyPage} total={d.frequencies.length} totalPages={Math.ceil(d.frequencies.length/50)} onPage={setFrequencyPage}/></details>
  <details><summary>Accepted bids — {d.bids.total}</summary><div className="admin-table-wrap"><table><thead><tr><th>Player</th><th>Number</th><th>Acceptance order</th><th>Accepted</th></tr></thead><tbody>{d.bids.items.map(bid=><tr key={bid.id}><td>{bid.user.name}{bid.id===d.winningBidId&&<small>Calculated winner</small>}</td><td>{bid.amount}</td><td>{bid.acceptanceOrder??'—'}</td><td>{eat(bid.acceptedAt)}</td></tr>)}</tbody></table></div><Pagination {...d.bids} onPage={setPage}/></details>
  {d.outcome==='WINNER'&&!d.isDemo&&access.role==='OWNER'&&<AdminWinnerPhoto key={d.winnerBannerVersion??d.winnerPhotoVersion} winner={d} onSaved={r.reload}/>}
  {d.publishedAt&&<p role="status">Published automatically. <AdminLink href={`/winners/${d.publicCode}`}>View public result</AdminLink></p>}
 </>}</section>;
}
