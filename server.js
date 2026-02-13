const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Manual CORS middleware (Express 5 compatible)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

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

    const { dreamId, dreamText, style, angle, character } = req.body;
    if (!dreamId || !dreamText?.trim() || !style) {
      return res.status(400).json({ error: 'dreamId, dreamText, and style are required' });
    }

    // Verify dream ownership
    const { data: dream, error: dreamError } = await supabase
      .from('dreams').select('user_id, title, mood').eq('id', dreamId).single();
    if (dreamError || !dream) return res.status(404).json({ error: 'Dream not found' });
    if (dream.user_id !== user.id) return res.status(403).json({ error: 'Forbidden' });

    // Use GPT-4o-mini to craft the perfect visual prompt from dream text
    const styleMap = {
      surrealist: 'surrealist art, Salvador Dali meets Remedios Varo, impossible geometry, melting reality, dreamlike distortions, vivid saturated colors',
      watercolor: 'ethereal watercolor painting, soft bleeding colors, delicate washes, impressionistic, Turner-inspired atmospheric effects',
      cinematic: 'cinematic still frame, anamorphic lens, volumetric lighting, Blade Runner meets Terrence Malick, dramatic color grading',
      anime: 'Studio Ghibli inspired, Makoto Shinkai lighting, detailed anime art, luminous skies, emotional atmosphere, vibrant colors',
      abstract: 'abstract expressionism, Kandinsky meets cosmic nebula, emotional color fields, dynamic shapes, non-representational dreamscape',
      oilPainting: 'classical oil painting, rich impasto texture, Rembrandt lighting, old masters technique, luminous glazes',
      darkFantasy: 'dark fantasy art, Beksinski inspired, gothic atmosphere, ominous lighting, haunting beauty, eldritch details',
      psychedelic: 'psychedelic art, Alex Grey meets fractals, vibrant neon colors, sacred geometry, kaleidoscopic patterns, DMT visuals',
      minimalist: 'minimalist art, clean composition, negative space, subtle color palette, zen-like simplicity, Rothko inspired',
      photoreal: 'photorealistic, hyperrealism, natural lighting, 8K detail, shallow depth of field, documentary photography',
      retroFuturism: 'retro futurism, 70s sci-fi book cover, Syd Mead inspired, chrome and neon, analog future aesthetic',
      stainedGlass: 'stained glass art, luminous backlit colors, lead line borders, cathedral window style, jewel tones, sacred geometry',
    };

    const angleMap = {
      auto: '',
      birdseye: 'bird\'s eye view, looking down from above',
      wormseye: 'worm\'s eye view, looking up from below, dramatic perspective',
      closeup: 'extreme close-up, intimate framing, shallow depth of field',
      wide: 'ultra-wide angle, expansive vista, grand scale',
      dutch: 'dutch angle, tilted frame, unsettling perspective',
      firstPerson: 'first-person POV, through the dreamer\'s eyes',
      overhead: 'top-down overhead view, flat lay perspective',
    };

    const characterMap = {
      auto: '',
      female: 'featuring a female figure as the central character',
      male: 'featuring a male figure as the central character',
      androgynous: 'featuring an androgynous ethereal figure',
      silhouette: 'figures shown only as dark silhouettes',
      noCharacters: 'no human figures, empty landscape, absence of people',
    };
    const styleDesc = styleMap[style] || 'dreamlike artistic style';

    console.log('Crafting dream prompt with GPT-4o-mini for dream:', dreamId);
    
    let prompt;
    try {
      const interpretation = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a dream-to-visual-art translator. Your job is to convert dream journal entries into vivid, specific image generation prompts.

DREAM INTERPRETATION RULES:
- Focus on the EMOTIONAL TRUTH, not literal accuracy
- Dreams merge locations, people, and time — embrace the impossibility
- Identify the 2-3 most visually striking moments and combine them
- Translate dream feelings into visual metaphors (anxiety = tight spaces, narrow corridors; freedom = vast skies, open water)
- Use specific sensory details: lighting, texture, color temperature, atmosphere
- Common dream symbols: flying = transcendence, falling = loss of control, water = emotions, doors = opportunities
- If people are mentioned, describe them by their emotional role (a protective figure, a threatening shadow) not by name
- Include composition guidance: foreground/background, perspective, focal point

OUTPUT: Return ONLY the image prompt, no explanation. Keep it under 200 words. Make it painterly and evocative, not clinical.`
          },
          {
            role: 'user',
            content: `Dream journal entry:\n"${dreamText.substring(0, 800)}"\n\nArt style: ${styleDesc}${angleMap[angle] ? `\nCamera angle: ${angleMap[angle]}` : ''}${characterMap[character] ? `\nCharacter direction: ${characterMap[character]}` : ''}\n\nCreate a vivid image prompt that captures the essence and emotional core of this dream.`
          }
        ],
        max_tokens: 250,
        temperature: 0.9,
      });
      prompt = interpretation.choices[0]?.message?.content || `Dream visualization: ${dreamText.substring(0, 300)}`;
    } catch (gptErr) {
      console.warn('GPT prompt crafting failed, using fallback:', gptErr.message);
      prompt = `Dream visualization: ${dreamText.substring(0, 500)}. Style: ${styleDesc}. High quality, detailed, atmospheric.`;
    }
    
    // Append angle, character direction, and quality modifiers
    if (angleMap[angle]) prompt += `. Camera: ${angleMap[angle]}`;
    if (characterMap[character]) prompt += `. ${characterMap[character]}`;
    prompt += `. ${styleDesc}. Masterpiece quality, highly detailed, atmospheric depth.`;

    console.log('Final prompt:', prompt.substring(0, 150) + '...');

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt,
      size: '1024x1024',
      quality: 'standard',
      n: 1,
    });

    const dalleUrl = response.data?.[0]?.url;
    if (!dalleUrl) throw new Error('No image URL returned');

    console.log('Image generated, uploading to storage...');

    // Download and upload to Supabase Storage for permanent URL
    let finalUrl = dalleUrl;
    try {
      const imgRes = await fetch(dalleUrl);
      if (imgRes.ok) {
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        const fileName = `${user.id}/${dreamId}/${Date.now()}.png`;
        
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('dream-images')
          .upload(fileName, imgBuffer, { contentType: 'image/png', upsert: true });

        if (!uploadError && uploadData) {
          const { data: pubData } = supabase.storage
            .from('dream-images')
            .getPublicUrl(fileName);
          finalUrl = pubData.publicUrl;
          console.log('Uploaded to storage:', finalUrl);
        } else {
          console.warn('Storage upload failed:', uploadError?.message);
        }
      }
    } catch (storageErr) {
      console.warn('Storage upload error:', storageErr.message);
    }

    // Save to database
    const { data: dreamImage, error: insertError } = await supabase
      .from('dream_images')
      .insert([{
        dream_id: dreamId,
        image_url: finalUrl,
        style,
        prompt_used: prompt,
        generation_params: { model: 'dall-e-3', style, timestamp: new Date().toISOString() }
      }])
      .select('*')
      .single();

    if (insertError) {
      console.error('DB insert error:', JSON.stringify(insertError));
      // Still return success with the image URL even if DB save fails
      return res.json({ success: true, imageUrl: finalUrl, prompt, dbError: insertError.message });
    }

    console.log('Dream image saved to DB:', dreamImage?.id);
    res.json({ success: true, imageUrl: finalUrl, prompt, dreamImage });
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
