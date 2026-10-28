// Mini App types adapted from better-auth-telegram 2.0.1, MIT. See LICENSE.
import type {BetterAuthPlugin} from 'better-auth';

export interface TelegramMiniAppUser {
 id:number;first_name:string;last_name?:string;username?:string;photo_url?:string;
 is_bot?:boolean;is_premium?:boolean;language_code?:string;allows_write_to_pm?:boolean;
}
export interface TelegramPluginOptions {
 botToken?:string;botUsername?:string;loginWidget?:boolean;oidc?:{enabled?:boolean};
 autoCreateUser?:boolean;maxAuthAge?:number;testMode?:boolean;
 miniApp?:{enabled?:boolean;validateInitData?:boolean;allowAutoSignin?:boolean;
  mapMiniAppDataToUser?:(user:TelegramMiniAppUser)=>{name?:string;email?:string;image?:string;[key:string]:unknown}};
}
type TelegramField={type:'string';required:false;unique:false;input?:false};
type Endpoint=NonNullable<BetterAuthPlugin['endpoints']>[string];
export declare function telegram(options:TelegramPluginOptions):{
 id:'telegram';
 schema:{user:{fields:{telegramId:TelegramField;telegramPhoneNumber:TelegramField;telegramUsername:TelegramField}};
  account:{fields:{telegramId:TelegramField;telegramUsername:TelegramField}}}|undefined;
 endpoints:{signInWithMiniApp?:Endpoint;validateMiniApp?:Endpoint;getTelegramConfig:Endpoint};
 rateLimit:{pathMatcher:(path:string)=>boolean;window:number;max:number}[];
 $ERROR_CODES:BetterAuthPlugin['$ERROR_CODES'];
};
