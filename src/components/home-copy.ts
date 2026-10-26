export const defaultHomeCopy={headline:'Small price. Big joy.',headlineAm:'ትንሽ ዋጋ። ትልቅ ደስታ።',lead:'The lowest unique bid wins.',leadAm:'ዝቅተኛና ያልተደገመ ዋጋ ያሸንፋል።'};
type HomeCopy={headline:string;lead:string;headlineAm?:string;leadAm?:string};
export function resolveHomeCopy(managed:HomeCopy|null){if(!managed||/^A little different wins\.?$/i.test(managed.headline.trim()))return defaultHomeCopy;return {...managed,headlineAm:managed.headlineAm?.trim()||defaultHomeCopy.headlineAm,leadAm:managed.leadAm?.trim()||defaultHomeCopy.leadAm};}
