export const defaultHomeCopy={
 headline:'LOWWIN Auction Platform',
 headlineAm:'LOWWIN የጨረታ መድረክ',
 lead:'The lowest unique bid wins.\nTry up to 100 amounts per auction.\nDiscover premium items for less.',
 leadAm:'አንድ ጊዜ ብቻ የቀረበው ዝቅተኛ መጠን ያሸንፋል።\nበአንድ ጨረታ እስከ 100 የተለያዩ መጠኖችን ያቅርቡ።\nጥራት ያላቸውን ዕቃዎች በአነስተኛ ዋጋ ያግኙ።',
};
type HomeCopy={headline:string;lead:string;headlineAm?:string;leadAm?:string};
export function resolveHomeCopy(managed:HomeCopy|null){
 // Replace the retired showcase copy without discarding future Owner edits.
 if(!managed||/^A little different wins\.?$/i.test(managed.headline.trim()))return defaultHomeCopy;
 return {...managed,headlineAm:managed.headlineAm?.trim()||defaultHomeCopy.headlineAm,leadAm:managed.leadAm?.trim()||defaultHomeCopy.leadAm};
}
