import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
// New projects use a publishable key; older ones an anon key. Either works.
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

// "Remember me": session lives in localStorage (survives closing the browser)
// when on, sessionStorage (cleared when the browser closes) when off.
const REMEMBER_KEY = 'rs-remember'
const EMAIL_KEY = 'rs-email'

export const safe = (fn, fallback) => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export const getRemember = () => safe(() => localStorage.getItem(REMEMBER_KEY) !== '0', true)
export const setRemember = (on) => safe(() => localStorage.setItem(REMEMBER_KEY, on ? '1' : '0'))
export const getRememberedEmail = () => safe(() => localStorage.getItem(EMAIL_KEY) ?? '', '')
export const setRememberedEmail = (email) =>
  safe(() => (email ? localStorage.setItem(EMAIL_KEY, email) : localStorage.removeItem(EMAIL_KEY)))

export const authStorage = {
  getItem: (k) => safe(() => (getRemember() ? localStorage : sessionStorage).getItem(k), null),
  setItem: (k, v) => safe(() => (getRemember() ? localStorage : sessionStorage).setItem(k, v)),
  removeItem: (k) =>
    safe(() => {
      localStorage.removeItem(k)
      sessionStorage.removeItem(k)
    }),
}

// The placeholder from .env.example does not count as configured
export const isConfigured = Boolean(url && key && !url.includes('your-project-ref'))
export const supabase = isConfigured ? createClient(url, key, { auth: { storage: authStorage } }) : null
