import { createClient } from '@supabase/supabase-js'

const fallbackSupabaseUrl = 'https://pxzvojcxdotayklnpvxs.supabase.co'
const fallbackSupabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4enZvamN4ZG90YXlrbG5wdnhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMTAxODIsImV4cCI6MjA5Nzc4NjE4Mn0.8hEg70t3HjS-23GcfHR0YslMQZyTlja9OiMoGYLyWKU'

function getUrlHost(value) {
  try {
    return new URL(value).host
  } catch {
    return 'invalid-url'
  }
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const envSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const envSupabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const hasCompleteEnv = Boolean(envSupabaseUrl && envSupabaseAnonKey)
const hasValidEnvUrl = Boolean(envSupabaseUrl && isValidHttpUrl(envSupabaseUrl))
const shouldUseEnvSupabase = hasCompleteEnv && hasValidEnvUrl
const supabaseUrl = shouldUseEnvSupabase ? envSupabaseUrl : fallbackSupabaseUrl
const supabaseAnonKey = shouldUseEnvSupabase ? envSupabaseAnonKey : fallbackSupabaseAnonKey
const isUsingFallbackSupabase = !shouldUseEnvSupabase

export const supabaseConfig = {
  hasCompleteEnv,
  hasValidEnvUrl,
  isUsingFallback: isUsingFallbackSupabase,
  source: shouldUseEnvSupabase ? 'env' : hasCompleteEnv ? 'fallback-invalid-env' : 'fallback-missing-env',
  urlHost: getUrlHost(supabaseUrl),
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
