import {withTelegramCommunity} from '@/lib/telegram-community';
// Shared public copy only: safe to import from both the Mini App and bot.
export const CONTACT_ACTION = '📱 የስልክ ቁጥሬን አጋራ';
export const WELCOME_CAPTION = withTelegramCommunity('👋 እንኳን ወደ Lowwin በደህና መጡ! በአንድ ሰው ብቻ የቀረበው ዝቅተኛው የጨረታ መጠን ያሸንፋል። ጨረታዎችን ለማየት ሚኒ አፑን ይክፈቱ።');
export const OPEN_MINI_APP_ACTION = '🎯 Lowwin ክፈት';
export const CONTACT_REQUEST_MESSAGE = withTelegramCommunity('👋 እንኳን ወደ Lowwin በደህና መጡ!\n\n📱 ምዝገባዎን ለማጠናቀቅ ከታች ያለውን “የስልክ ቁጥሬን አጋራ” ቁልፍ ይጫኑ።');
export const CONTACT_VERIFIED_MESSAGE = withTelegramCommunity('✅ በLowwin በተሳካ ሁኔታ ተመዝግበዋል!\n\nከታች ያለውን ቁልፍ ተጭነው ጨረታ ይጀምሩ።');
export const CONTACT_ALREADY_VERIFIED_MESSAGE = withTelegramCommunity('✅ አስቀድመው በLowwin ተመዝግበዋል።\n\nስልክ ቁጥርዎን እንደገና ማጋራት አያስፈልግም። ጨረታ ለመጀመር ከታች ያለውን ቁልፍ ይጫኑ።');
export const START_BIDDING_ACTION = '🎯 ጨረታ ይጀምሩ';
export const CONTACT_REPLY_KEYBOARD = {
  keyboard: [[{text: CONTACT_ACTION, request_contact: true}]],
  resize_keyboard: true,
  input_field_placeholder: 'የስልክ ቁጥሬን አጋራ',
  one_time_keyboard: true,
};
