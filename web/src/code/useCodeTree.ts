import { useCallback, useEffect, useRef, useState } from 'react';
import { codeApi } from './codeApi';
import { ancestors, type Dirs } from './treeModel';

/**
 * The project's tree, loaded a folder at a time as folders open, plus what the top level says about the project (git or
 * not, file count) and the paths runs changed in the last 30 days.
 */
export function useCodeTree(ws: string) {
  const [dirs, setDirs] = useState<Dirs>({});
  const loaded = useRef(new Set<string>());
  const [rootError, setRootError] = useState<string>();
  const [info, setInfo] = useState<{ git: boolean; files?: number }>();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [changed, setChanged] = useState<string[]>([]);

  const load = useCallback(
    async (dir: string) => {
      const r = await codeApi.tree(ws, dir);
      loaded.current.add(dir);
      setDirs((d) => ({ ...d, [dir]: r.entries }));
      return r;
    },
    [ws],
  );
  const loadRoot = useCallback(async () => {
    setRootError(undefined);
    try {
      const r = await load('');
      setInfo({ git: r.git, files: r.files });
      if (r.git) setChanged((await codeApi.changed(ws)).paths);
    } catch (e) {
      setRootError((e as Error).message);
    }
  }, [load, ws]);
  useEffect(() => void loadRoot(), [loadRoot]);

  const collapse = useCallback((dir: string) => setExpanded((s) => new Set([...s].filter((x) => x !== dir))), []);
  /** Opens folders (loading the ones not seen yet); a folder that fails to load closes again and the error is thrown. */
  const expand = useCallback(
    async (...list: string[]) => {
      setExpanded((s) => new Set([...s, ...list]));
      try {
        await Promise.all(list.filter((d) => !loaded.current.has(d)).map(load));
      } catch (e) {
        setExpanded((s) => new Set([...s].filter((x) => !list.includes(x))));
        throw e;
      }
    },
    [load],
  );
  /** Open every folder that holds `path`, so the file shows in the tree. */
  const reveal = useCallback((path: string) => expand(...ancestors(path)), [expand]);
  return { dirs, rootError, info, expanded, changed, expand, collapse, reveal, reload: loadRoot };
}
