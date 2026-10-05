// Local photographs are navigation artwork, not representations of available stock.
const photos=new Set(['home-furniture','vehicles','accessories','computer-office-equipment','home-furnishings','jewelry','watches','phones','animals']);
export function categoryPhoto(slug:string,name:string){
 if(photos.has(slug))return `/catalog/categories/${slug}.png`;
 const label=`${slug} ${name}`.toLowerCase();
 const category=/watch/.test(label)?'watches':/phone|mobile/.test(label)?'phones':/computer|laptop|office/.test(label)?'computer-office-equipment':/furnishing|decor/.test(label)?'home-furnishings':/furniture/.test(label)?'home-furniture':/vehicle|car|motor|bicycle|bike/.test(label)?'vehicles':/jewel/.test(label)?'jewelry':/animal|pet|ox|sheep/.test(label)?'animals':'accessories';
 return `/catalog/categories/${category}.png`;
}
