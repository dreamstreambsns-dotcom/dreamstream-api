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

// ── Shared maps & helpers ──────────────────────────────────────────

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
  birdseye: "bird's eye view, looking down from above",
  wormseye: "worm's eye view, looking up from below, dramatic perspective",
  closeup: 'extreme close-up, intimate framing, shallow depth of field',
  wide: 'ultra-wide angle, expansive vista, grand scale',
  dutch: 'dutch angle, tilted frame, unsettling perspective',
  firstPerson: "first-person POV, through the dreamer's eyes",
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

const colorMap = {
  auto: '',
  warmGolden: 'warm golden hour color palette, amber and honey tones, soft warm light',
  coolBlue: 'cool blue color palette, cyan and navy tones, cold ethereal light',
  moodyDesaturated: 'desaturated moody colors, muted tones, low saturation, atmospheric grey',
  neonVibrant: 'vibrant neon colors, electric pink and cyan, high saturation, glowing',
  pastelSoft: 'soft pastel colors, baby pink and lavender and mint, gentle dreamy tones',
  darkShadowy: 'very dark color palette, deep shadows, barely visible details, noir',
  sunsetWarm: 'sunset colors, deep orange and magenta and purple gradient sky',
  moonlitSilver: 'moonlit silver and blue, cool night palette, luminous pale light',
  emeraldGreen: 'rich emerald and jade green palette, lush vegetation tones, forest light',
  bloodRed: 'deep crimson and blood red palette, dramatic scarlet accents, intense',
  sepiaDream: 'sepia-toned, vintage warmth, old photograph aesthetic, nostalgic amber',
  iridescent: 'iridescent holographic colors, rainbow oil-slick shimmer, prismatic light',
};

const dreamTypeMap = {
  normal: '',
  lucid: 'crystal clear, hyper-real, vivid awareness, sharp details, lucid dream clarity',
  nightmare: 'distorted proportions, unsettling, horror undertones, dark, nightmarish',
  recurring: 'déjà vu feeling, repetitive patterns, familiar yet strange, recurring motifs',
  prophetic: 'divine light, symbolic imagery, oracle-like, mystical signs, prophetic vision',
  childhood: 'nostalgic, oversized world, innocent wonder, soft focus, childhood memory',
  sleepParalysis: 'shadow figures, paralyzed POV, liminal horror, dark bedroom, sleep paralysis',
};

const timeOfDayMap = {
  auto: '',
  dawn: 'dawn lighting, pink and gold sunrise, early morning mist',
  day: 'bright daylight, clear midday sun, sharp shadows',
  dusk: 'dusk atmosphere, purple and orange twilight, golden hour fading',
  night: 'nighttime, moonlit darkness, starry sky, nocturnal',
  timeless: 'timeless atmosphere, no clear time of day, eternal, liminal',
};

const weatherMap = {
  auto: '',
  clear: 'clear sky, calm weather, pristine atmosphere',
  rainy: 'rain falling, wet surfaces, reflections, melancholic rain',
  foggy: 'thick fog, misty, low visibility, ethereal haze',
  stormy: 'dramatic storm, lightning, turbulent clouds, tempestuous',
  snowy: 'snowfall, winter landscape, frost, cold serenity',
};

function getIntensityDesc(intensity) {
  const n = parseInt(intensity) || 5;
  if (n <= 3) return 'subtle, gentle, understated visual metaphors, soft and quiet';
  if (n <= 6) return 'balanced, moderate emotional expression';
  return 'overwhelming, extreme, dramatic, intense visual metaphors, maximum emotional impact';
}

function buildSystemPrompt(intensity) {
  const intensityDesc = getIntensityDesc(intensity);
  return `You are a dream-to-visual-art translator. Your job is to convert dream journal entries into vivid, specific image generation prompts.

DREAM INTERPRETATION RULES:
- Focus on the EMOTIONAL TRUTH, not literal accuracy
- Dreams merge locations, people, and time — embrace the impossibility
- Identify the 2-3 most visually striking moments and combine them
- Translate dream feelings into visual metaphors (anxiety = tight spaces, narrow corridors; freedom = vast skies, open water)
- Use specific sensory details: lighting, texture, color temperature, atmosphere
- Common dream symbols: flying = transcendence, falling = loss of control, water = emotions, doors = opportunities
- If people are mentioned, describe them by their emotional role (a protective figure, a threatening shadow) not by name
- Include composition guidance: foreground/background, perspective, focal point

EMOTIONAL INTENSITY: ${intensityDesc}

OUTPUT: Return ONLY the image prompt, no explanation. Keep it under 200 words. Make it painterly and evocative, not clinical.`;
}

function buildUserPrompt({ dreamText, style, angle, character, colorPalette, dreamType, timeOfDay, weather }) {
  const styleDesc = styleMap[style] || 'dreamlike artistic style';
  let msg = `Dream journal entry:\n"${(dreamText || '').substring(0, 800)}"\n\nArt style: ${styleDesc}`;
  if (angleMap[angle]) msg += `\nCamera angle: ${angleMap[angle]}`;
  if (characterMap[character]) msg += `\nCharacter direction: ${characterMap[character]}`;
  if (colorMap[colorPalette]) msg += `\nColor palette: ${colorMap[colorPalette]}`;
  if (dreamTypeMap[dreamType]) msg += `\nDream type: ${dreamTypeMap[dreamType]}`;
  if (timeOfDayMap[timeOfDay]) msg += `\nTime of day: ${timeOfDayMap[timeOfDay]}`;
  if (weatherMap[weather]) msg += `\nWeather: ${weatherMap[weather]}`;
  msg += '\n\nCreate a vivid image prompt that captures the essence and emotional core of this dream.';
  return msg;
}

function appendModifiers(prompt, { style, angle, character, colorPalette, dreamType, timeOfDay, weather }) {
  let p = prompt;
  if (angleMap[angle]) p += `. Camera: ${angleMap[angle]}`;
  if (characterMap[character]) p += `. ${characterMap[character]}`;
  if (colorMap[colorPalette]) p += `. Color: ${colorMap[colorPalette]}`;
  if (dreamTypeMap[dreamType]) p += `. ${dreamTypeMap[dreamType]}`;
  if (timeOfDayMap[timeOfDay]) p += `. ${timeOfDayMap[timeOfDay]}`;
  if (weatherMap[weather]) p += `. ${weatherMap[weather]}`;
  const styleDesc = styleMap[style] || 'dreamlike artistic style';
  p += `. ${styleDesc}. Masterpiece quality, highly detailed, atmospheric depth.`;
  return p;
}

async function authenticateRequest(req) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data, error: authError } = await supabase.auth.getUser(token);
  if (authError || !data.user) return null;
  return { user: data.user, supabase, token };
}

// ── POST /api/craft-prompt ─────────────────────────────────────────

app.post('/api/craft-prompt', async (req, res) => {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const { dreamId, dreamText, style, angle, character, colorPalette, dreamType, intensity, timeOfDay, weather } = req.body;
    if (!dreamText?.trim() || !style) {
      return res.status(400).json({ error: 'dreamText and style are required' });
    }

    const interpretation = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: buildSystemPrompt(intensity) },
        { role: 'user', content: buildUserPrompt({ dreamText, style, angle, character, colorPalette, dreamType, timeOfDay, weather }) },
      ],
      max_tokens: 250,
      temperature: 0.9,
    });

    let prompt = interpretation.choices[0]?.message?.content || `Dream visualization: ${dreamText.substring(0, 300)}`;
    prompt = appendModifiers(prompt, { style, angle, character, colorPalette, dreamType, timeOfDay, weather });

    res.json({ success: true, prompt });
  } catch (err) {
    console.error('Craft prompt error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/refine-prompt ────────────────────────────────────────

app.post('/api/refine-prompt', async (req, res) => {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const { previousPrompt, refinement } = req.body;
    if (!previousPrompt || !refinement?.trim()) {
      return res.status(400).json({ error: 'previousPrompt and refinement are required' });
    }

    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a prompt refinement assistant. You will receive an existing image generation prompt and a refinement instruction. Produce an updated prompt that incorporates the refinement while keeping the original vision intact. Return ONLY the updated prompt, no explanation. Keep it under 250 words.`
        },
        {
          role: 'user',
          content: `Original prompt:\n"${previousPrompt}"\n\nRefinement instruction: "${refinement}"\n\nProduce the updated prompt.`
        },
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const prompt = result.choices[0]?.message?.content || previousPrompt;
    res.json({ success: true, prompt });
  } catch (err) {
    console.error('Refine prompt error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/generate-image ───────────────────────────────────────

app.post('/api/generate-image', async (req, res) => {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });
    const { user, supabase } = auth;

    const { dreamId, dreamText, style, angle, character, colorPalette, dreamType, intensity, timeOfDay, weather } = req.body;
    let { prompt } = req.body;

    if (!dreamId || !dreamText?.trim() || !style) {
      return res.status(400).json({ error: 'dreamId, dreamText, and style are required' });
    }

    // Verify dream ownership
    const { data: dream, error: dreamError } = await supabase
      .from('dreams').select('user_id, title, mood').eq('id', dreamId).single();
    if (dreamError || !dream) return res.status(404).json({ error: 'Dream not found' });
    if (dream.user_id !== user.id) return res.status(403).json({ error: 'Forbidden' });

    // If no prompt provided, craft one via GPT
    if (!prompt) {
      console.log('Crafting dream prompt with GPT-4o-mini for dream:', dreamId);
      try {
        const interpretation = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: buildSystemPrompt(intensity) },
            { role: 'user', content: buildUserPrompt({ dreamText, style, angle, character, colorPalette, dreamType, timeOfDay, weather }) },
          ],
          max_tokens: 250,
          temperature: 0.9,
        });
        prompt = interpretation.choices[0]?.message?.content || `Dream visualization: ${dreamText.substring(0, 300)}`;
      } catch (gptErr) {
        console.warn('GPT prompt crafting failed, using fallback:', gptErr.message);
        const styleDesc = styleMap[style] || 'dreamlike artistic style';
        prompt = `Dream visualization: ${dreamText.substring(0, 500)}. Style: ${styleDesc}. High quality, detailed, atmospheric.`;
      }
      prompt = appendModifiers(prompt, { style, angle, character, colorPalette, dreamType, timeOfDay, weather });
    }

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
        generation_params: { model: 'dall-e-3', style, dreamType, intensity, timeOfDay, weather, timestamp: new Date().toISOString() }
      }])
      .select('*')
      .single();

    if (insertError) {
      console.error('DB insert error:', JSON.stringify(insertError));
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
