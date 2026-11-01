// Supabase project used for encrypted cloud sync.
// These two values are public by design: Row Level Security only lets a signed-in user
// read and write their own row, and everything stored there is encrypted on the device.
export const CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};
