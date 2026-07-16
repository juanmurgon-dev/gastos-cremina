// ─────────────────────────────────────────────────────────────
//  Conexión con Supabase
//  Producción por defecto. Para probar contra STAGING, abre la app
//  con  ?staging  en la URL (no se guarda: al recargar sin el
//  parámetro, vuelve a producción). Cada proyecto guarda su propia
//  sesión, así que no se mezclan.
// ─────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROD = {
  url: "https://ntnyqezytwvwidzsleye.supabase.co",
  key: "sb_publishable_0ac28fHoDp-jW-CiVD-zAA_dtuylypF",
};
const STAGING = {
  url: "https://addlnoyoqswpshwbmzsf.supabase.co",
  key: "sb_publishable_RcIv7KMypzVBqzpR8KItog_ebeE0WkH",
};

export const ENV = new URLSearchParams(location.search).has("staging") ? "staging" : "prod";
const cfg = ENV === "staging" ? STAGING : PROD;

export const supabase = createClient(cfg.url, cfg.key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
