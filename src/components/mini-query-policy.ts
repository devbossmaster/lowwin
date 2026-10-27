/** Display freshness never authorizes a bid, credit or payment. */
export const MINI_QUERY_POLICIES={
 historical:{staleMs:300000,retainMs:1800000,refreshOnResume:false},
 catalog:{staleMs:15000,retainMs:600000,refreshOnResume:true},
 detail:{staleMs:15000,retainMs:600000,refreshOnResume:true},
 account:{staleMs:60000,retainMs:600000,refreshOnResume:false},
 wallet:{staleMs:5000,retainMs:60000,refreshOnResume:true},
 bids:{staleMs:15000,retainMs:300000,refreshOnResume:true},
 private:{staleMs:30000,retainMs:600000,refreshOnResume:false},
} as const;
export function miniQueryPolicy(url:string){
 const path=url.split(/[?#]/,1)[0];
 if(path.startsWith('/api/wallet')||path==='/api/me'||path.startsWith('/api/payments/'))return MINI_QUERY_POLICIES.wallet;
 if(path.startsWith('/api/results/'))return MINI_QUERY_POLICIES.historical;
 if(path.startsWith('/api/auctions/')||path==='/api/my-bids')return MINI_QUERY_POLICIES.bids;
 if(path.startsWith('/api/catalog/auctions/'))return MINI_QUERY_POLICIES.detail;
 if(path.startsWith('/api/catalog/'))return MINI_QUERY_POLICIES.catalog;
 if(path==='/api/profile')return MINI_QUERY_POLICIES.account;
 return MINI_QUERY_POLICIES.private;
}
export function matchesPrivateResource(key:string,scope:string){
 const resource=key.split('#language=',1)[0];
 return resource===scope||(!scope.includes('?')&&(resource.startsWith(scope+'?')||resource.startsWith(scope+'/')));
}
