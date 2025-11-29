import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { article_id, nombre } = await req.json()
    
    if (!article_id || !nombre) {
      return new Response(
        JSON.stringify({ error: 'Missing article_id or nombre' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Debug: Check if environment variables are loaded
    const DB_URL = Deno.env.get('DB_URL')
    const SERVICE_KEY = Deno.env.get('SERVICE_KEY')
    
    console.log('DB_URL exists:', !!DB_URL)
    console.log('SERVICE_KEY exists:', !!SERVICE_KEY)

    if (!DB_URL || !SERVICE_KEY) {
      console.log('Missing env vars - DB_URL:', DB_URL, 'SERVICE_KEY:', SERVICE_KEY)
      return new Response(
        JSON.stringify({ error: 'Server misconfigured - missing environment variables' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(DB_URL, SERVICE_KEY)
    console.log('Attempting to insert:', { article_id, nombre })

    // Insert and return the inserted row so we can debug what's saved
    const { data, error } = await supabase
      .from('buenos_private')
      .insert([{ article_id, nombre }])
      .select()

    if (error) {
      console.log('Supabase error:', error)
      return new Response(
        JSON.stringify({ error: String(error) }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Successfully inserted name, data:', data)
    // Now update the public counter (buenos_public) atomically: read then update or insert
    try {
      // Get existing public counter row
      const { data: pubRows, error: pubErr } = await supabase
        .from('buenos_public')
        .select('id,buenos')
        .eq('article_id', article_id)

      if (pubErr) {
        console.log('Error reading public counter:', pubErr)
      }

      let updatedCount = null
      if (pubRows && pubRows.length > 0) {
        const row = pubRows[0]
        const newCount = (row.buenos || 0) + 1
        const { data: patched, error: patchErr } = await supabase
          .from('buenos_public')
          .update({ buenos: newCount })
          .eq('id', row.id)
          .select()

        if (patchErr) {
          console.log('Error patching public counter:', patchErr)
        } else if (patched && patched.length > 0) {
          updatedCount = patched[0].buenos
        }
      } else {
        // create new public counter row
        const { data: created, error: createErr } = await supabase
          .from('buenos_public')
          .insert([{ article_id, buenos: 1 }])
          .select()

        if (createErr) {
          console.log('Error creating public counter:', createErr)
        } else if (created && created.length > 0) {
          updatedCount = created[0].buenos
        }
      }

      return new Response(
        JSON.stringify({ success: true, inserted: data, updatedCount }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } catch (e) {
      console.log('Error updating public counter:', e)
      return new Response(
        JSON.stringify({ success: true, inserted: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  } catch (error) {
    console.log('General error:', error)
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})