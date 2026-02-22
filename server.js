const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');
const helmet = require('helmet');

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: false,
}));

// Rate limiting — per IP
const rateLimit = new Map();
const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX_REQUESTS = 30;  // 30 requests per minute

app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  const entry = rateLimit.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_WINDOW_MS;
  }
  
  entry.count++;
  rateLimit.set(ip, entry);
  
  if (entry.count > RATE_MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too many requests. Please wait.' });
  }
  next();
});

// Clean up rate limit map every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimit) {
    if (now > entry.resetAt) rateLimit.delete(ip);
  }
}, 300_000);

// Manual CORS middleware (Express 5 compatible)
const ALLOWED_ORIGINS = [
  'https://dreamstream-seven.vercel.app',
  'https://dreamstream-app.surge.sh',
];

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin.match(/^http:\/\/localhost(:\d+)?$/)) return true;
  return false;
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Body size limit
app.use(express.json({ limit: '1mb' }));

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

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

SAFETY: NEVER include nudity, sexual content, graphic violence, gore, or real people in the prompt. Keep all output safe for all ages. If the dream contains such elements, translate them into abstract visual metaphors instead.

OUTPUT: Return ONLY the image prompt, no explanation. Keep it under 200 words. Make it painterly and evocative, not clinical.`;
}

// Input sanitization
function sanitizeText(text, maxLen = 5000) {
  if (typeof text !== 'string') return '';
  return text.slice(0, maxLen).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function validateEnum(value, allowed) {
  if (!value || typeof value !== 'string') return undefined;
  return allowed.includes(value) ? value : undefined;
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

    // NSFW filter
    const BLOCKED_TERMS = [
      'nude', 'naked', 'nsfw', 'porn', 'sexual', 'explicit', 'erotic',
      'genitals', 'breasts', 'topless', 'orgasm', 'intercourse',
      'hentai', 'xxx', 'fetish', 'bondage', 'gore', 'mutilation',
      'child abuse', 'pedophil', 'underage',
    ];
    if (BLOCKED_TERMS.some(t => dreamText.toLowerCase().includes(t))) {
      return res.status(400).json({ error: 'Content cannot be visualized. Please edit and try again.', code: 'CONTENT_BLOCKED' });
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

    // NSFW content filter — block before wasting API calls
    const BLOCKED_TERMS = [
      'nude', 'naked', 'nsfw', 'porn', 'sexual', 'explicit', 'erotic',
      'genitals', 'breasts', 'topless', 'orgasm', 'intercourse',
      'hentai', 'xxx', 'fetish', 'bondage', 'gore', 'mutilation',
      'child abuse', 'pedophil', 'underage',
    ];
    const textToCheck = `${dreamText} ${prompt || ''}`.toLowerCase();
    const blocked = BLOCKED_TERMS.some(term => textToCheck.includes(term));
    if (blocked) {
      return res.status(400).json({ 
        error: 'Your dream contains content that cannot be visualized. Please edit the description and try again.',
        code: 'CONTENT_BLOCKED'
      });
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

  // SSRF protection: only allow Supabase storage and OpenAI URLs
  const ALLOWED_HOSTS = [
    'kgqijksnkffxqjjplgqo.supabase.co',
    'oaidalleapiprodscus.blob.core.windows.net',
  ];
  try {
    const parsedUrl = new URL(imageUrl);
    if (!ALLOWED_HOSTS.some(h => parsedUrl.hostname.endsWith(h))) {
      return res.status(403).json({ error: 'URL not allowed' });
    }
    if (parsedUrl.protocol !== 'https:') {
      return res.status(403).json({ error: 'HTTPS only' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return res.status(502).json({ error: 'Failed to fetch' });
    
    const contentType = response.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) {
      return res.status(403).json({ error: 'Not an image' });
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    
    // Max 10MB
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'Image too large' });
    }
    
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    res.status(502).json({ error: 'Proxy error' });
  }
});

// ── POST /api/transcribe ───────────────────────────────────────────

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: 'Groq API key not configured' });
    }

    // Build multipart form for Groq API using form-data + https
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname || 'audio.webm',
      contentType: req.file.mimetype || 'audio/webm',
    });
    formData.append('model', 'whisper-large-v3');
    formData.append('prompt', 'Dream journal entry, recording after waking up');

    const result = await new Promise((resolve, reject) => {
      formData.submit({
        host: 'api.groq.com',
        path: '/openai/v1/audio/transcriptions',
        protocol: 'https:',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
      }, (err, groqRes) => {
        if (err) return reject(err);
        let body = '';
        groqRes.on('data', chunk => body += chunk);
        groqRes.on('end', () => {
          if (groqRes.statusCode !== 200) {
            console.error('Groq API error:', groqRes.statusCode, body);
            return reject(new Error(`Groq API error ${groqRes.statusCode}: ${body}`));
          }
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('Invalid Groq response')); }
        });
      });
    });
    console.log('Transcription complete:', (result.text || '').substring(0, 100) + '...');
    res.json({ success: true, text: result.text || '' });
  } catch (err) {
    console.error('Transcribe error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/structure-dream ──────────────────────────────────────

app.post('/api/structure-dream', async (req, res) => {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const { text } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a dream journal assistant. The user just woke up and recorded a voice memo about their dream. The text is raw speech transcription — it may be rambling, repetitive, or incoherent.

Your job:
1. Clean up the text into readable paragraphs while preserving the dream's narrative
2. Extract a short, evocative title (max 6 words)
3. Suggest a mood from: amazing, good, neutral, confused, scared, nightmare
4. Suggest 2-5 relevant tags (single words, lowercase)

Return JSON only:
{
  "title": "string",
  "content": "string (cleaned up, paragraphed dream text)",
  "mood": "string (one of the mood options)",
  "tags": ["string"]
}`
        },
        { role: 'user', content: text }
      ],
      max_tokens: 1000,
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });

    const structured = JSON.parse(result.choices[0]?.message?.content || '{}');
    res.json({
      success: true,
      title: structured.title || 'Untitled Dream',
      content: structured.content || text,
      mood: structured.mood || 'neutral',
      tags: structured.tags || [],
    });
  } catch (err) {
    console.error('Structure dream error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/auto-tag ────────────────────────────────────────────

app.post('/api/auto-tag', async (req, res) => {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const { text, title } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a dream analysis AI. Given a dream journal entry, extract meaningful tags in these categories:

1. **characters** — people, animals, creatures (e.g. "mother", "stranger", "dog", "dragon")
2. **locations** — places, settings (e.g. "ocean", "school", "forest", "city")
3. **emotions** — feelings experienced (e.g. "fear", "joy", "confusion", "wonder")
4. **themes** — recurring motifs, symbols (e.g. "flying", "falling", "chase", "water", "death", "transformation")
5. **objects** — significant items (e.g. "mirror", "door", "car", "phone")

Rules:
- Each tag is 1-2 lowercase words
- 3-8 total tags (quality over quantity)
- Only extract what's actually in the dream, don't infer
- Prioritize unusual/specific tags over generic ones

Return JSON only:
{
  "tags": ["string"],
  "characters": ["string"],
  "locations": ["string"],
  "emotions": ["string"],
  "themes": ["string"],
  "objects": ["string"]
}`
        },
        { role: 'user', content: `Title: ${title || 'Untitled'}\n\nDream:\n${text}` }
      ],
      max_tokens: 300,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(result.choices[0]?.message?.content || '{}');
    
    // Flatten all categories into a single tags array (deduplicated)
    const allTags = new Set([
      ...(parsed.tags || []),
      ...(parsed.characters || []),
      ...(parsed.locations || []),
      ...(parsed.emotions || []),
      ...(parsed.themes || []),
      ...(parsed.objects || []),
    ]);

    res.json({
      success: true,
      tags: [...allTags].slice(0, 12),
      categories: {
        characters: parsed.characters || [],
        locations: parsed.locations || [],
        emotions: parsed.emotions || [],
        themes: parsed.themes || [],
        objects: parsed.objects || [],
      },
    });
  } catch (err) {
    console.error('Auto-tag error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/detect-patterns ──────────────────────────────────────

app.post('/api/detect-patterns', async (req, res) => {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const { dreams } = req.body;
    if (!Array.isArray(dreams) || dreams.length < 2) {
      return res.status(400).json({ error: 'At least 2 dreams are required' });
    }

    // Build a summary of dreams for GPT
    const dreamSummaries = dreams.slice(0, 50).map((d, i) => {
      const tags = (d.tags || []).join(', ');
      const mood = d.mood || 'unknown';
      return `Dream ${i + 1} (${d.date || 'unknown date'}, mood: ${mood}${tags ? ', tags: ' + tags : ''}):\n${(d.content || '').substring(0, 300)}`;
    }).join('\n\n');

    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a dream pattern analyst. Given multiple dream journal entries, identify recurring patterns across them.

Find:
1. **Recurring themes** — repeated motifs, situations, or storylines
2. **Recurring symbols** — objects, elements, or imagery that appear multiple times
3. **Recurring characters** — people, creatures, or entities that reappear
4. **Recurring locations** — places or settings that repeat
5. **Emotional patterns** — mood trends or emotional arcs

For each pattern:
- Give it a short name (2-4 words)
- Describe the pattern briefly (1-2 sentences)
- List which dream numbers it appears in
- Rate its frequency: "high" (>50% of dreams), "medium" (25-50%), or "low" (<25%)
- Assign a category: "theme", "symbol", "character", "location", or "emotion"
- Suggest a single emoji that represents it

Return JSON only:
{
  "patterns": [
    {
      "name": "string",
      "description": "string",
      "dreamIndices": [0, 1, 3],
      "frequency": "high|medium|low",
      "category": "theme|symbol|character|location|emotion",
      "emoji": "string",
      "count": 3
    }
  ],
  "summary": "A 2-3 sentence overall summary of the dreamer's pattern landscape"
}`
        },
        { role: 'user', content: `Analyze these ${dreams.length} dreams for recurring patterns:\n\n${dreamSummaries}` }
      ],
      max_tokens: 1500,
      temperature: 0.4,
      response_format: { type: 'json_object' },
    });

    const parsed = JSON.parse(result.choices[0]?.message?.content || '{}');
    res.json({
      success: true,
      patterns: parsed.patterns || [],
      summary: parsed.summary || '',
    });
  } catch (err) {
    console.error('Detect patterns error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/describe-sketch ──────────────────────────────────────

app.post('/api/describe-sketch', upload.single('sketch'), async (req, res) => {
  try {
    const auth = await authenticateRequest(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    if (!req.file) {
      return res.status(400).json({ error: 'No sketch image provided' });
    }

    const dreamContext = req.body.dreamText || '';
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/png';

    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a sketch interpreter for a dream visualization app. The user drew a quick sketch representing elements from their dream. Describe what you see in the sketch in vivid, specific visual terms that can enhance an image generation prompt.

Focus on:
- Shapes, objects, and their spatial arrangement
- Any recognizable elements (buildings, figures, landscapes, etc.)
- The composition and layout
- Implied movement or energy

Keep your description to 2-3 sentences. Be specific and visual. Do NOT mention that it's a sketch or drawing — describe it as if describing a scene.`
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: dreamContext
                ? `Here is my sketch of elements from my dream. Dream context: "${dreamContext.substring(0, 500)}"`
                : 'Here is my sketch of elements from my dream. Describe what you see.',
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: 'low',
              },
            },
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0.7,
    });

    const description = result.choices[0]?.message?.content || '';
    res.json({ success: true, description });
  } catch (err) {
    console.error('Describe sketch error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/waitlist ─────────────────────────────────────────────

const waitlistEmails = [];

app.post('/api/waitlist', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    
    // Store in Supabase if available
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      await supabase.from('waitlist').insert({ email: cleanEmail });
    } catch (dbErr) {
      // Table might not exist yet — store in memory as fallback
      if (!waitlistEmails.includes(cleanEmail)) {
        waitlistEmails.push(cleanEmail);
      }
      console.log('Waitlist (memory):', waitlistEmails.length, 'emails');
    }

    res.json({ success: true, message: 'Added to waitlist!' });
  } catch (err) {
    console.error('Waitlist error:', err.message);
    res.status(500).json({ error: 'Failed to join waitlist' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => console.log(`LucidInk API running on port ${PORT}`));
