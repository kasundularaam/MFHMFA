export function extractSvgDimensions(
  svgMarkup: string
): { width: number; height: number } | null {
  const vbMatch = svgMarkup.match(/viewBox="([^"]+)"/i);
  if (!vbMatch) return null;
  const nums = vbMatch[1].trim().split(/[\s,]+/).map(Number);
  if (nums.length !== 4 || !(nums[2] > 0) || !(nums[3] > 0)) return null;
  return {
    width: Math.ceil(nums[2]),
    height: Math.ceil(nums[3]),
  };
}

export function normalizeSvgIntrinsicDimensions(svgMarkup: string): string {
  const dims = extractSvgDimensions(svgMarkup);
  if (!dims) return svgMarkup;

  return svgMarkup.replace(/<svg\b([^>]*)>/i, (_full, attrs: string) => {
    const cleaned = attrs
      .replace(/\bwidth="100%"/gi, `width="${dims.width}"`)
      .replace(/max-width:\s*[^;"]+;?/gi, '');
    if (!/\bwidth=/i.test(cleaned)) {
      return `<svg width="${dims.width}" height="${dims.height}"${cleaned}>`;
    }
    if (!/\bheight=/i.test(cleaned)) {
      return `<svg height="${dims.height}"${cleaned}>`;
    }
    return `<svg${cleaned}>`;
  });
}

export function slugify(input: string, fallback = 'diagram'): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || fallback;
}
