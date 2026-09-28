const root = (window.__br = window.__br || { ready: false });

export function registerDebug(name, obj) {
  root[name] = obj;
}

export const debugRoot = root;
