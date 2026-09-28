// 'auto' quality: a gpu-string heuristic picks the starting tier; the renderer then steps down
// if measured frame intervals stay slow (never steps up on its own).
export function gpuInfo(gl) {
  let name = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    name = '';
  }
  return name;
}

// touch-first device (phone, tablet) or a small high-dpr screen; desktops with a mouse never match
export function isMobileDevice() {
  if (typeof matchMedia !== 'function') return false;
  const coarse = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  const s = typeof screen !== 'undefined' ? Math.min(screen.width || 0, screen.height || 0) : 0;
  const small = s > 0 && s <= 540 && (globalThis.devicePixelRatio || 1) >= 2;
  return coarse || small;
}

export function detectTier(gl) {
  if (isMobileDevice()) return 'mobile';
  const n = gpuInfo(gl).toLowerCase();
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(n)) return 'low';
  if (maxTex < 8192) return 'low';
  if (/intel.*(hd|uhd) graphics|mali-[gt]\d|adreno \(tm\) [1-5]\d\d|powervr/.test(n)) return 'low';
  if (/apple m\d (pro|max|ultra)|rtx|radeon rx|geforce gtx 1[0-9]{3}|rx [5-9]\d{3}|arc a/.test(n)) return 'high';
  return 'medium';
}
