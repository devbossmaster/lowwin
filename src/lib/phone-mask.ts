/** Keep up to seven leading digits and the final two. Older masks can only
 * retain digits which are already visible. */
export function maskPhoneDisplay(value:string|null|undefined):string|null {
  const phone=value?.trim();
  if(!phone)return null;
  const full=/^\+?([1-9]\d{7,14})$/.exec(phone);
  if(full){
    const digits=full[1];
    return `${digits.slice(0,-5).slice(0,7)}***${digits.slice(-2)}`;
  }
  const masked=/^\+?([1-9]\d{0,6})?\s*[*•xX](?:\s*[*•xX])*\s*(\d{2,4})$/.exec(phone);
  return masked?`${masked[1]??''}***${masked[2].slice(-2)}`:null;
}

export function maskPhoneSuffix(value:string|null|undefined):string|null {
  return value&&/^\d{2,4}$/.test(value)?`***${value.slice(-2)}`:null;
}
