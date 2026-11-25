import type {ComponentProps} from 'react';
import {cn} from '@/modules/ui/utils';
import styles from './card.module.css';

export function Card({className,...props}:ComponentProps<'div'>) {
  return <div data-slot="card" className={cn(styles.card,className)} {...props}/>;
}

export function CardHeader({className,...props}:ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn(styles.header,className)} {...props}/>;
}

export function CardContent({className,...props}:ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn(styles.content,className)} {...props}/>;
}
