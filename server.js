const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 120000,
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

app.post('/api/generate-image', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { data, error: authError } = await supabase.auth.getUser(token);
    if (authError || !data.user) return res.status(401).json({ error: 'Unauthorized' });
    const user = data.user;

    const { dreamId, dreamText, style } = req.body;
    if (!dreamId || !dreamText?.trim() || !style) {
      return res.status(400).json({ error: 'dreamId, dreamText, and style are required' });
    }

    // Verify dream ownership
    const { data: dream, error: dreamError } = await supabase
      .from('dreams').select('user_id, title, mood').eq('id', dreamId).single();
    if (dreamError || !dream) return res.status(404).json({ error: 'Dream not found' });
    if (dream.user_id !== user.id) return res.status(403).json({ error: 'Forbidden' });

    // Build prompt
    const styleMap = {
      surrealist: 'surrealist art style, dreamlike, impossible geometry, melting objects, vivid colors',
      watercolor: 'watercolor painting, soft flowing colors, artistic brushstrokes, ethereal',
      cinematic: 'cinematic lighting, dramatic composition, film still aesthetic, atmospheric',
      anime: 'anime art style, vibrant colors, Studio Ghibli inspired, detailed',
      abstract: 'abstract art, emotional colors, dynamic shapes, cosmic, non-representational',
    };
    const styleDesc = styleMap[style] || 'dreamlike artistic style';
    const prompt = `Dream visualization: ${dreamText.substring(0, 500)}. Style: ${styleDesc}. High quality, detailed, atmospheric.`;

    console.log('Generating image for dream:', dreamId, 'style:', style);

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt,
      size: '1024x1024',
      quality: 'standard',
      n: 1,
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) throw new Error('No image URL returned');

    console.log('Image generated, saving to DB...');

    // Save to database
    const { data: dreamImage, error: insertError } = await supabase
      .from('dream_images')
      .insert([{
        dream_id: dreamId,
        image_url: imageUrl,
        style,
        prompt_used: prompt,
        generation_params: { model: 'dall-e-3', style, timestamp: new Date().toISOString() }
      }])
      .select('*')
      .single();

    if (insertError) {
      console.error('DB insert error:', insertError);
      return res.status(500).json({ error: 'Failed to save image' });
    }

    res.json({ success: true, imageUrl, prompt, dreamImage });
  } catch (err) {
    console.error('Generation error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Image proxy for CORS
app.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).json({ error: 'url required' });

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return res.status(502).json({ error: 'Failed to fetch' });
    const buffer = Buffer.from(await response.arrayBuffer());
    res.set('Content-Type', response.headers.get('content-type') || 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    res.status(502).json({ error: 'Proxy error' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => console.log(`DreamStream API running on port ${PORT}`));
