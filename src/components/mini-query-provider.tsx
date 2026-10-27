'use client';
import {QueryClientProvider} from '@tanstack/react-query';
import {getMiniQueryClient} from './private-query-cache';

/** Shared by the launch/auth boundary and every customer route. */
export function MiniQueryProvider({children}:{children:React.ReactNode}){
 return <QueryClientProvider client={getMiniQueryClient()}>{children}</QueryClientProvider>;
}
