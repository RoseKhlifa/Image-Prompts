/**
 * Demo seed data for local dev only. Tiny, hand-written. M8 will replace this
 * with the real nanobanana-website 2380 prompt migration.
 */
export const DEMO_CATEGORIES = [
  { slug: "landscape", nameZh: "风景", nameEn: "Landscape", order: 1 },
  { slug: "portrait", nameZh: "人物", nameEn: "Portrait", order: 2 },
  { slug: "anime", nameZh: "二次元", nameEn: "Anime", order: 3 },
  { slug: "guofeng", nameZh: "国风", nameEn: "Chinese Style", order: 4 },
  { slug: "animal", nameZh: "动物", nameEn: "Animal", order: 5 },
  { slug: "architecture", nameZh: "建筑", nameEn: "Architecture", order: 6 },
];

export const DEMO_TAGS = [
  { slug: "cyberpunk", nameZh: "赛博朋克", nameEn: "Cyberpunk" },
  { slug: "neon", nameZh: "霓虹", nameEn: "Neon" },
  { slug: "minimal", nameZh: "极简", nameEn: "Minimal" },
  { slug: "film", nameZh: "胶片", nameEn: "Film" },
  { slug: "night", nameZh: "夜景", nameEn: "Night" },
  { slug: "rain", nameZh: "雨", nameEn: "Rain" },
  { slug: "purple", nameZh: "紫调", nameEn: "Purple" },
  { slug: "nature", nameZh: "自然", nameEn: "Nature" },
];

export const DEMO_R2_ACCOUNT = {
  name: "Local Dev Placeholder",
  accountId: "dev-account",
  accessKeyId: "dev-key-id",
  // Plaintext placeholder ONLY for dev seed. M4 will switch to AES-GCM-encrypted.
  accessKeySecretEncrypted: "DEV_PLACEHOLDER_NOT_ENCRYPTED",
  bucket: "image-prompts-dev",
  endpoint: "https://placeholder.example.com",
  publicUrl: "https://placeholder.example.com",
  enabled: true,
  priority: 100,
};

export const DEMO_PROMPTS = [
  {
    slug: "cyberpunk-neon-cat",
    titleZh: "赛博朋克霓虹猫",
    titleEn: "Cyberpunk Neon Cat",
    promptZh:
      "一只赛博朋克风格的橘猫,坐在雨夜霓虹招牌下的窗台,毛发被霓虹灯照亮,蓝紫色调,电影级侧逆光,50mm 镜头,浅景深,写实摄影风格",
    promptEn:
      "A cyberpunk-style orange cat sitting on a windowsill under neon signs in a rainy night, fur illuminated by neon lights, blue-purple tones, cinematic side backlighting, 50mm lens, shallow depth of field, photorealistic style",
    negativeZh: "模糊, 噪点, 多余的手",
    negativeEn: "blurry, noisy, extra hands",
    aspectRatio: "16:9",
    categorySlug: "landscape",
    tagSlugs: ["cyberpunk", "neon", "night", "rain"],
  },
  {
    slug: "purple-minimal-portrait",
    titleZh: "紫调极简肖像",
    titleEn: "Purple Minimal Portrait",
    promptZh: "极简紫调人物肖像,正面光,纯色背景,胶片质感,柔焦",
    promptEn:
      "Minimal purple-toned portrait, frontal lighting, solid color background, film texture, soft focus",
    negativeZh: undefined,
    negativeEn: undefined,
    aspectRatio: "3:2",
    categorySlug: "portrait",
    tagSlugs: ["purple", "minimal", "film"],
  },
  {
    slug: "misty-forest-morning",
    titleZh: "青绿森林晨雾",
    titleEn: "Misty Forest Morning",
    promptZh: "清晨青绿森林中的薄雾,阳光透过树叶形成丁达尔光束,广角",
    promptEn:
      "Misty morning in a green forest, sunlight filtering through leaves as Tyndall beams, wide angle",
    negativeZh: undefined,
    negativeEn: undefined,
    aspectRatio: "16:9",
    categorySlug: "landscape",
    tagSlugs: ["nature"],
  },
  {
    slug: "gobi-sunset-road",
    titleZh: "黄昏戈壁公路",
    titleEn: "Gobi Sunset Road",
    promptZh: "落日下的戈壁公路,远景一辆车,暖橙色调,公路片质感",
    promptEn: "Gobi highway at sunset, a distant car, warm orange tones, road movie aesthetic",
    negativeZh: undefined,
    negativeEn: undefined,
    aspectRatio: "16:9",
    categorySlug: "landscape",
    tagSlugs: ["film"],
  },
  {
    slug: "rainy-street-deep-grey",
    titleZh: "深灰雨夜街景",
    titleEn: "Rainy Street Deep Grey",
    promptZh: "深灰色调雨夜街景,反光路面,孤独人物背影,电影质感",
    promptEn:
      "Deep grey rainy night street, reflective pavement, lone figure from behind, cinematic",
    negativeZh: undefined,
    negativeEn: undefined,
    aspectRatio: "16:9",
    categorySlug: "landscape",
    tagSlugs: ["night", "rain", "film"],
  },
  {
    slug: "japanese-zen-garden",
    titleZh: "日式禅院庭院",
    titleEn: "Japanese Zen Garden",
    promptZh: "极简日式禅院庭院,白沙耙痕,枯石,苔藓,黄昏柔光",
    promptEn: "Minimalist Japanese zen garden, raked white sand, dry rocks, moss, soft dusk light",
    negativeZh: undefined,
    negativeEn: undefined,
    aspectRatio: "3:2",
    categorySlug: "architecture",
    tagSlugs: ["minimal"],
  },
];

export const DEMO_SITE_SETTINGS = [
  { key: "submit.daily_limit", value: 10, description: "Per-user daily submission limit" },
  { key: "community_guidelines.version", value: 1, description: "Current guidelines version" },
  {
    key: "community_guidelines.body",
    value: { zh: "请遵守社区准则。", en: "Please follow community guidelines." },
    description: "Guidelines body bilingual",
  },
  { key: "translation.enabled", value: false, description: "AI translation feature toggle" },
  { key: "view_count.dedup_hours", value: 24, description: "View dedup window" },
];
