import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

serve(async (req) => {
  const input = await req.json()
  return Response.json({
    status: 'skipped',
    message: 'AI short answer summary is a Phase 7 placeholder.',
    input,
  })
})
