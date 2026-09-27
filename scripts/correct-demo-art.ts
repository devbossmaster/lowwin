import 'dotenv/config';
import {PrismaClient} from '@prisma/client';
import {demoBidAllowed} from '../src/modules/auctions/bids';
import {stagingDemoEnabled} from '../src/modules/auctions/staging-demo';
if(!(demoBidAllowed()||stagingDemoEnabled()))throw Error('Isolated or pinned staging fixture only');
const db=new PrismaClient({datasourceUrl:stagingDemoEnabled()?process.env.DIRECT_URL:process.env.DATABASE_URL});
try{const result=await db.$transaction(async tx=>{
 const id='demo-art-correction-tote-notebook-v1';if(await tx.adminAudit.findUnique({where:{id}}))return {replayed:true};
 let changed=0;for(const [where,path] of [[{slug:'demo-everyday-tote'},'/catalog/tote.svg'],[{slug:{startsWith:'demo-'},title:'DEMO Everyday notebook computer'},'/catalog/notebook.svg']] as const){const products=await tx.product.findMany({where:{...where,isDemo:true},select:{id:true}});for(const p of products)changed+=(await tx.productImage.updateMany({where:{productId:p.id,sortOrder:0,sourceType:'ORIGINAL',path:{in:['/catalog/accessory.svg','/catalog/computer.svg']}},data:{path}})).count}
 await tx.adminAudit.create({data:{id,actorId:'demo-showcase-operator',action:'DEMO_ART_CORRECTED',target:'original-placeholder-assets',details:{changed,reason:'Match existing tote and notebook titles. No inventory identity, schedule, terms, bids or results changed.'}}});return {replayed:false,changed};
 },{timeout:60000});console.log(JSON.stringify(result))}finally{await db.$disconnect()}
