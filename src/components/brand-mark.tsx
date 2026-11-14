import {LOWWIN_LOGO_SRC} from '@/lib/brand';
import styles from './brand-mark.module.css';

/** Display the approved symbol without repeating its embedded wordmark. */
export function BrandMark(){
 return <span className={styles.mark} aria-hidden="true"><img src={LOWWIN_LOGO_SRC} width={256} height={256} alt="" data-lowwin-logo/></span>;
}
