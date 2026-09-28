const handlers = new Map();

export const events = {
  on(name, fn) {
    let list = handlers.get(name);
    if (!list) handlers.set(name, (list = []));
    list.push(fn);
    return () => events.off(name, fn);
  },
  off(name, fn) {
    const list = handlers.get(name);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  },
  emit(name, payload) {
    const list = handlers.get(name);
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](payload);
  },
};
