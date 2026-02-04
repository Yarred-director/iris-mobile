// server/memory/factSchema.js

export async function getActiveFactSchema(supabaseClient) {
  const { data, error } = await supabaseClient
    .from('fact_schema')
    .select('fact_key, description, value_type, allowed_values, confidence_default')
    .eq('active', true);

  if (error) return [];
  return data || [];
}
