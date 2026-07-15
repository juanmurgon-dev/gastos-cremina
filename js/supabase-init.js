// ─────────────────────────────────────────────────────────────
//  Conexión con Supabase
//  ⚠️  PEGA AQUÍ los datos de TU proyecto (ver la GUÍA, paso 5).
//      Supabase → Project Settings → Data API / API Keys.
// ─────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://ntnyqezytwvwidzsleye.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_0ac28fHoDp-jW-CiVD-zAA_dtuylypF";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});
