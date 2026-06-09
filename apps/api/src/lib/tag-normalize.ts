import { tagSlugFromName } from "./tag-slug.ts";

/**
 * Canonical tag normalization map. Each entry encodes a single concept with:
 *   - `slug`: canonical slug used in URLs (lowercase ASCII when there's an
 *     obvious English form; CJK otherwise)
 *   - `zh` / `en`: bilingual display names
 *   - `aliases`: source-data variants (case-insensitive match against the
 *     incoming normalized_tag string). Includes the canonical zh + en as
 *     implicit aliases (you don't need to repeat them).
 *
 * Used by:
 *   - The import path (apps/api/src/repositories/imports.ts) — every
 *     `normalized_tag` lookup runs through `lookupCanonicalTag()` before
 *     `upsertTag()`; matches reuse the canonical slug + bilingual name so
 *     re-imports never recreate the duplicates we just merged.
 *   - The one-shot migration (apps/api/scripts/normalize-existing-tags.ts)
 *     that rewrites the 26 tags created by the food.jsonl import.
 *
 * Entries are roughly ordered by how often the alias is expected to appear
 * in the 33K crawl manifest's top_tags lists. Add new entries here when
 * future imports surface a common duplicate.
 */
export type TagCanon = {
  slug: string;
  zh: string;
  en: string;
  /** Lowercase-compared list of incoming names that should resolve here. */
  aliases: readonly string[];
};

export const TAG_CANON: readonly TagCanon[] = [
  // ─── The 16 import-manifest categories also surface as normalized_tags ─
  { slug: "food", zh: "美食", en: "Food", aliases: ["美食", "美食餐饮", "food", "美食类", "餐饮"] },
  { slug: "photography", zh: "摄影", en: "Photography", aliases: ["摄影", "摄影写真", "photo", "photography"] },
  { slug: "ecommerce", zh: "电商营销", en: "E-commerce", aliases: ["电商", "电商营销", "ecommerce", "commerce"] },
  { slug: "anime", zh: "动漫游戏", en: "Anime & Game", aliases: ["动漫", "动漫漫画", "动漫游戏", "anime", "动漫 游戏", "漫画"] },
  { slug: "illustration", zh: "插画", en: "Illustration", aliases: ["插画", "风格插画", "illustration", "艺术插画", "插画设计"] },
  { slug: "graphic-design", zh: "平面设计", en: "Graphic Design", aliases: ["平面设计", "graphic", "graphic design", "graphic-design"] },
  { slug: "architecture", zh: "建筑空间", en: "Architecture", aliases: ["建筑", "建筑空间", "建筑物", "建筑室内", "建筑及室内设计", "建筑及空间设计", "architecture"] },
  { slug: "cultural-goods", zh: "文创周边", en: "Cultural Goods", aliases: ["文创周边", "文创"] },
  { slug: "novel", zh: "小说推文", en: "Novel & Story", aliases: ["小说", "小说推文", "小说写作", "story", "novel"] },
  { slug: "creative-play", zh: "创意玩法", en: "Creative Play", aliases: ["创意玩法", "创意"] },
  { slug: "branding", zh: "品牌视觉", en: "Branding", aliases: ["品牌视觉", "品牌及视觉设计", "branding"] },
  { slug: "product-design", zh: "产品设计", en: "Product Design", aliases: ["产品设计", "product design", "product-design"] },
  { slug: "character", zh: "角色人物", en: "Character", aliases: ["角色", "角色人物", "角色设计", "character", "characters"] },
  { slug: "landscape", zh: "风景场景", en: "Landscape", aliases: ["风景", "风景场景", "风景自然", "风景摄影", "landscape", "scenery"] },
  { slug: "tech-scifi", zh: "科技科幻", en: "Tech & Sci-Fi", aliases: ["科技科幻", "科幻", "sci-fi", "scifi", "tech-scifi", "赛博科幻", "赛博朋克"] },
  { slug: "other", zh: "其他", en: "Other", aliases: ["其他", "other"] },

  // ─── Common subjects ────────────────────────────────────────────────
  { slug: "portrait", zh: "人像", en: "Portrait", aliases: ["人像", "人像摄影", "人像写真", "portrait"] },
  { slug: "poster", zh: "海报", en: "Poster", aliases: ["海报", "poster"] },
  { slug: "poster-design", zh: "海报设计", en: "Poster Design", aliases: ["海报设计", "poster design", "poster-design"] },
  { slug: "logo", zh: "LOGO 图标", en: "Logo", aliases: ["logo", "logo图标", "logo 图标", "LOGO图标", "图标", "icon"] },
  { slug: "ui", zh: "UI 界面", en: "UI", aliases: ["ui", "ui界面", "ui 界面", "ui设计", "user interface"] },
  { slug: "product", zh: "产品", en: "Product", aliases: ["产品", "product", "商品"] },
  { slug: "food-photography", zh: "美食摄影", en: "Food Photography", aliases: ["美食摄影", "food photography", "食物摄影"] },
  { slug: "food-styling", zh: "食物精修", en: "Food Styling", aliases: ["食物精修", "food styling"] },
  { slug: "photo-retouching", zh: "修图调色", en: "Photo Retouching", aliases: ["修图调色", "photo retouching", "retouching"] },
  { slug: "infographic", zh: "信息图", en: "Infographic", aliases: ["infographic", "信息图表", "信息图设计", "信息图"] },
  { slug: "typography", zh: "字体设计", en: "Typography", aliases: ["字体", "字体设计", "typography"] },
  { slug: "animal", zh: "动物", en: "Animal", aliases: ["动物", "动物萌宠", "animal", "animals", "wildlife"] },
  { slug: "girl", zh: "女生", en: "Female", aliases: ["女生", "女神", "女神神", "girl", "female"] },
  { slug: "boy", zh: "男生", en: "Male", aliases: ["男生", "boy", "male"] },
  { slug: "fantasy", zh: "游戏幻想", en: "Fantasy", aliases: ["游戏幻想", "幻想", "fantasy"] },
  { slug: "guofeng", zh: "国风", en: "Chinese Style", aliases: ["国风", "国风国潮", "国风美学", "guofeng", "chinese style"] },
  { slug: "minimal", zh: "极简", en: "Minimal", aliases: ["极简", "minimal", "minimalist", "minimalism"] },
  { slug: "neon", zh: "霓虹", en: "Neon", aliases: ["霓虹", "neon"] },
  { slug: "night", zh: "夜景", en: "Night", aliases: ["夜景", "night"] },
  { slug: "film", zh: "胶片", en: "Film", aliases: ["胶片", "film"] },
  { slug: "rain", zh: "雨", en: "Rain", aliases: ["雨", "rain"] },
  { slug: "nature", zh: "自然", en: "Nature", aliases: ["自然", "nature"] },
  { slug: "lifestyle", zh: "生活分享", en: "Lifestyle", aliases: ["生活分享", "生活娱乐", "lifestyle"] },
  { slug: "fashion", zh: "时尚", en: "Fashion", aliases: ["时尚", "时尚摄影", "fashion"] },

  // ─── Style descriptors (single-language → bilingual) ───────────────
  { slug: "realistic", zh: "写实", en: "Realistic", aliases: ["realistic", "写实", "真实感", "realism"] },
  { slug: "cinematic", zh: "电影感", en: "Cinematic", aliases: ["cinematic", "电影感", "电影质感"] },
  { slug: "bright", zh: "明亮", en: "Bright", aliases: ["bright", "明亮"] },
  { slug: "dynamic", zh: "动感", en: "Dynamic", aliases: ["dynamic", "动感"] },
  { slug: "surreal", zh: "超现实", en: "Surreal", aliases: ["surreal", "超现实"] },
  { slug: "whimsical", zh: "奇趣", en: "Whimsical", aliases: ["whimsical", "奇趣"] },
  { slug: "digital-art", zh: "数字艺术", en: "Digital Art", aliases: ["digital art", "digital-art", "数字艺术"] },
  { slug: "still-life", zh: "静物", en: "Still Life", aliases: ["still life", "still-life", "静物"] },
  { slug: "vintage", zh: "复古", en: "Vintage", aliases: ["vintage", "复古"] },
  { slug: "abstract", zh: "抽象", en: "Abstract", aliases: ["abstract", "抽象"] },
  { slug: "dramatic", zh: "戏剧感", en: "Dramatic", aliases: ["dramatic", "戏剧感"] },
  { slug: "ethereal", zh: "空灵", en: "Ethereal", aliases: ["ethereal", "空灵"] },
  { slug: "peaceful", zh: "平静", en: "Peaceful", aliases: ["peaceful", "平静"] },
  { slug: "dark", zh: "暗黑", en: "Dark", aliases: ["dark", "暗黑", "暗黑奇幻"] },
  { slug: "cartoon", zh: "卡通", en: "Cartoon", aliases: ["cartoon", "卡通", "卡通动漫"] },
  { slug: "3d-render", zh: "3D 渲染", en: "3D Render", aliases: ["3d render", "3d-render", "3d渲染", "3d设计"] },
  { slug: "watercolor", zh: "水彩", en: "Watercolor", aliases: ["watercolor", "水彩"] },
  { slug: "vector", zh: "矢量", en: "Vector", aliases: ["vector", "矢量"] },
  { slug: "other-use-cases", zh: "其他用途", en: "Other Use Cases", aliases: ["other use cases", "other-use-cases", "其他用途"] },
  { slug: "instagram-style", zh: "Instagram 风格", en: "Instagram Style", aliases: ["instagram", "instagram风格", "instagram 风格", "instagram style"] },
];

// Build a lookup map at module load. Key is `name.trim().toLowerCase()`.
const LOOKUP = new Map<string, TagCanon>();
for (const c of TAG_CANON) {
  const seed: string[] = [c.slug, c.zh, c.en, ...c.aliases];
  for (const key of seed) {
    LOOKUP.set(key.trim().toLowerCase(), c);
  }
}

/**
 * Resolve an incoming `normalized_tag` string to its canonical form.
 * Returns null when no canonical entry matches — caller should fall back
 * to `tagSlugFromName(name)` + `{ zh: name, en: name }`.
 */
export function lookupCanonicalTag(name: string): TagCanon | null {
  return LOOKUP.get(name.trim().toLowerCase()) ?? null;
}

/**
 * Resolve a name to a (slug, bilingual) pair the importer can use directly.
 * Falls back to the previous behavior (slug from tagSlugFromName, name with
 * both sides equal to the raw input) when no canon match.
 */
export function resolveTagForImport(
  name: string,
): { slug: string; zh: string; en: string; canonical: boolean } {
  const canon = lookupCanonicalTag(name);
  if (canon) return { slug: canon.slug, zh: canon.zh, en: canon.en, canonical: true };
  return {
    slug: tagSlugFromName(name),
    zh: name,
    en: name,
    canonical: false,
  };
}
