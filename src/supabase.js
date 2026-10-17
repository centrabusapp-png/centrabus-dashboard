import { createClient } from '@supabase/supabase-js';
import { signOutNativeUser } from './auth/supabaseNativeAuth';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Supabase frontend configuration is missing.');
}

// Keep SDK-native session persistence, refresh and Realtime auth synchronization.
// No external accessToken callback is configured.
export const supabase = createClient(supabaseUrl, supabasePublishableKey);

export async function signOutActiveUser() {
  return signOutNativeUser(supabase);
}

export default supabase;
