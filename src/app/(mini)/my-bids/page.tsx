import {MyBidsPage} from '@/components/my-bids-page';

export default async function MyBids({searchParams}:{searchParams:Promise<{view?:string}>}){
  const {view}=await searchParams;
  return <MyBidsPage initialView={view==='finished'||view==='history'?'finished':'live'}/>;
}
