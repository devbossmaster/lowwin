import {CircleUserRound,Gavel,House,Trophy} from 'lucide-react';

export const customerNavigationItems=[
 {href:'/',en:'Home',am:'መነሻ',icon:House},
 {href:'/winners',en:'Winners',am:'አሸናፊዎች',icon:Trophy},
 {href:'/my-bids',en:'My Bids',am:'ጨረታዎቼ',icon:Gavel},
 {href:'/profile',en:'Profile',am:'መገለጫ',icon:CircleUserRound},
] as const;

export function activeCustomerNavigation(path:string){
 if(path==='/payments'||path.startsWith('/payments/')||path==='/wallet'||path.startsWith('/wallet/'))return '/profile';
 if(path.startsWith('/auctions')||path.startsWith('/categories'))return '/';
 if(path.startsWith('/draws'))return '/winners';
 if(path==='/winning-bids')return '/my-bids';
 return customerNavigationItems.filter(({href})=>href==='/'?path==='/':path===href||path.startsWith(`${href}/`)).sort((a,b)=>b.href.length-a.href.length)[0]?.href;
}
