// ─────────────────────────────────────────────────────────────
// src/lib/supabase.js
// Supabase client + all database operations
// ─────────────────────────────────────────────────────────────
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn('⚠️  Supabase keys missing — check your .env.local file');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  }
});

// ── AUTH ──────────────────────────────────────────────────────

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session, event);
  });
}

// ── PROFILE ───────────────────────────────────────────────────

export async function saveProfile(userId, profile) {
  const { error } = await supabase
    .from('profiles')
    .upsert(
      { user_id: userId, ...profile, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  if (error) throw error;
}

export async function loadProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── JOURNAL ENTRIES ───────────────────────────────────────────

export async function saveJournalEntry(userId, entry) {
  // Upsert by id to prevent duplicates on autosave
  if (entry.id) {
    const { data, error } = await supabase
      .from('journal_entries')
      .update({ text: entry.text, title: entry.title || '' })
      .eq('id', entry.id)
      .eq('user_id', userId);
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from('journal_entries')
    .insert({ user_id: userId, text: entry.text, title: entry.title || '', created_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function loadJournalEntries(userId) {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', threeMonthsAgo.toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function deleteJournalEntry(entryId) {
  const { error } = await supabase
    .from('journal_entries')
    .delete()
    .eq('id', entryId);
  if (error) throw error;
}

// ── PROGRESS NOTES ────────────────────────────────────────────

export async function saveProgressNote(userId, note) {
  const { data, error } = await supabase
    .from('progress_notes')
    .insert({ user_id: userId, ...note, created_at: new Date().toISOString() });
  if (error) throw error;
  return data;
}

export async function loadProgressNotes(userId) {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const { data, error } = await supabase
    .from('progress_notes')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', threeMonthsAgo.toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── CALENDAR EVENTS ───────────────────────────────────────────

export async function saveCalendarEvent(userId, event) {
  const { data, error } = await supabase
    .from('calendar_events')
    .insert({ user_id: userId, ...event });
  if (error) throw error;
  return data;
}

export async function loadCalendarEvents(userId) {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const { data, error } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('user_id', userId)
    .gte('event_date', threeMonthsAgo.toISOString().split('T')[0]);
  if (error) throw error;
  return data || [];
}

// ── SUBSCRIPTION STATUS ───────────────────────────────────────

export async function saveSubscription(userId, stripeData) {
  const { error } = await supabase
    .from('subscriptions')
    .upsert({
      user_id:              userId,
      stripe_customer_id:   stripeData.customerId,
      stripe_subscription_id: stripeData.subscriptionId,
      plan_name:            stripeData.planName,
      status:               stripeData.status,
      current_period_end:   stripeData.currentPeriodEnd,
      updated_at:           new Date().toISOString(),
    });
  if (error) throw error;
}

export async function loadSubscription(userId) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── CHECK-INS ─────────────────────────────────────────────────

export async function saveCheckIn(userId, checkIn) {
  const { data, error } = await supabase
    .from('check_ins')
    .upsert(
      { user_id: userId, ...checkIn, created_at: new Date().toISOString() },
      { onConflict: 'user_id,date' }
    );
  if (error) throw error;
  return data;
}

export async function loadCheckIns(userId) {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const { data, error } = await supabase
    .from('check_ins')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', threeMonthsAgo.toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── WORKOUT LOGS ──────────────────────────────────────────────

export async function saveWorkoutLog(userId, entries) {
  const rows = entries.map(e => ({ user_id: userId, ...e, created_at: new Date().toISOString() }));
  const { data, error } = await supabase
    .from('workout_logs')
    .insert(rows);
  if (error) throw error;
  return data;
}

export async function loadWorkoutLogs(userId) {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const { data, error } = await supabase
    .from('workout_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', threeMonthsAgo.toISOString())
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ── WEIGHT LOGS ───────────────────────────────────────────────

export async function saveWeightEntry(userId, entry) {
  // Use date-based upsert to prevent duplicate entries for the same day
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('weight_logs')
    .upsert(
      { user_id: userId, ...entry, date: entry.date || today, created_at: new Date().toISOString() },
      { onConflict: 'user_id,date', ignoreDuplicates: false }
    );
  if (error) throw error;
  return data;
}

export async function loadWeightLogs(userId) {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const { data, error } = await supabase
    .from('weight_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', threeMonthsAgo.toISOString())
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ── NUTRITION LOGS ────────────────────────────────────────────

export async function saveNutritionEntry(userId, entry) {
  const { data, error } = await supabase
    .from('nutrition_logs')
    .upsert(
      { user_id: userId, ...entry, created_at: new Date().toISOString() },
      { onConflict: 'user_id,date' }
    );
  if (error) throw error;
  return data;
}

export async function loadNutritionLogs(userId) {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const { data, error } = await supabase
    .from('nutrition_logs')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', threeMonthsAgo.toISOString())
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ── PERFORMANCE BENCHMARKS ────────────────────────────────────

export async function saveBenchmark(userId, benchmark) {
  const { data, error } = await supabase
    .from('benchmarks')
    .insert({ user_id: userId, ...benchmark, created_at: new Date().toISOString() });
  if (error) throw error;
  return data;
}

export async function loadBenchmarks(userId) {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const { data, error } = await supabase
    .from('benchmarks')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', threeMonthsAgo.toISOString())
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ── PROGRESS PHOTOS ───────────────────────────────────────────

export async function uploadProgressPhoto(userId, dataUrl, meta) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const ext = blob.type === 'image/png' ? 'png' : 'jpg';
  const storagePath = userId + '/' + Date.now() + '.' + ext;
  const { error: uploadErr } = await supabase.storage
    .from('progress-photos')
    .upload(storagePath, blob, { contentType: blob.type });
  if (uploadErr) throw uploadErr;
  const { data, error } = await supabase
    .from('progress_photos')
    .insert({ user_id: userId, storage_path: storagePath,
      label: meta.label||'', date: meta.date||'',
      weight: meta.weight||'', note: meta.note||'' })
    .select().single();
  if (error) throw error;
  return data;
}

export async function loadProgressPhotos(userId) {
  const { data, error } = await supabase
    .from('progress_photos').select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return await Promise.all((data || []).map(async (row) => {
    const { data: urlData } = await supabase.storage
      .from('progress-photos').createSignedUrl(row.storage_path, 3600);
    return { ...row, dataUrl: urlData?.signedUrl || '' };
  }));
}

export async function deleteProgressPhoto(userId, photoId, storagePath) {
  await supabase.storage.from('progress-photos').remove([storagePath]);
  const { error } = await supabase.from('progress_photos')
    .delete().eq('id', photoId).eq('user_id', userId);
  if (error) throw error;
}
