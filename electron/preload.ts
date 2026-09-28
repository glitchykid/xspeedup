import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, Method, RequestMap } from '../shared/contracts';

const api: DesktopApi = {
  onBenchStop(callback) {
    const listener = () => callback();
    ipcRenderer.on('xspeedup:bench-stop', listener);
    return () => ipcRenderer.removeListener('xspeedup:bench-stop', listener);
  },
  async request<M extends Method>(method: M, args: RequestMap[M]) {
    const result = await ipcRenderer.invoke(
      'xspeedup:request',
      method,
      args,
      document.documentElement.lang,
    );
    if (!result.ok) throw new Error(result.error);
    return result.data;
  },
};
contextBridge.exposeInMainWorld('desktop', Object.freeze(api));
