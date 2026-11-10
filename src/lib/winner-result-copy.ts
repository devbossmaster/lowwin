/** Localize only committed result facts; never select or infer a winner. */
export function winnerResultExplanation(result:{outcome:string;decision:string|null;explanation:string},am:boolean){
 if(!am)return result.explanation;
 if(result.outcome==='CANCELLED')return result.decision==='MINIMUM_PARTICIPANTS'?'በመዝጊያ ጊዜ ከሁለት ያነሱ ብቁ ተሳታፊዎች ስለነበሩ ጨረታው ተሰርዟል።':'ጨረታው ተሰርዟል።';
 if(result.outcome==='NO_WINNER')return 'አንድ ጊዜ ብቻ የቀረበ ቁጥር ስላልነበረ ጨረታው ያለ አሸናፊ ተጠናቋል።';
 if(result.outcome==='WINNER')return result.decision==='FIRST_ACCEPTED_LOWEST'?'አንድ ጊዜ ብቻ የቀረበ ቁጥር ስላልነበረ፣ ዝቅተኛውን ቁጥር ቀድሞ ያቀረበው አሸንፏል።':'አንድ ጊዜ ብቻ የቀረበው ዝቅተኛ ቁጥር አሸንፏል።';
 return result.explanation;
}
