type Stage='feedback'|'request'|'authorization'|'confirmed'|'code-confirmed';
export type PaymentUiTiming={mark:(stage:Stage)=>void;codeSubmitted:()=>void};

/** Local Performance timeline only. Names and values contain no payment,
 * account, phone, authorization code, URL or credential data. No telemetry. */
export function beginPaymentUiTiming():PaymentUiTiming{
 const started=performance.now(),seen=new Set<Stage>();let codeStarted:number|undefined;
 return {
  codeSubmitted(){codeStarted=performance.now()},
  mark(stage){
   if(seen.has(stage)||stage==='code-confirmed'&&codeStarted===undefined)return;
   seen.add(stage);const name=`lowwin:payment:${stage==='code-confirmed'?'code-submit': 'tap'}-to-${stage==='code-confirmed'?'confirmed':stage}`;
   // Bound repeated use on long-lived Mini App sessions.
   if(performance.getEntriesByName(name,'measure').length>=40)performance.clearMeasures(name);
   performance.measure(name,{start:stage==='code-confirmed'?codeStarted!:started,end:performance.now()});
  },
 };
}
